// Universal, domain-agnostic progress contract ("progress.v1").
//
// A *producer* (any shell script, bot, or job) records progress for a run keyed
// by a stable `key` (normally the chat task id). A *consumer* (the dashboard MCP
// server) reads it back. State lives on disk so it survives process restarts and
// can be polled, which the MCP spec itself recommends for work that outlives a
// single tool request.
//
// Layout (per key):
//   <root>/<key>/status.json    derived snapshot, written atomically (temp+fsync+rename)
//   <root>/<key>/events.ndjson  append-only journal (source of truth / history)
//
// Determinism: percent is computed from a fixed, weighted phase list — never a
// wall clock. Phases move only forward (begin/advance/done on phase i completes
// every earlier pending/active phase), so repeated or skipped calls never regress.

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SCHEMA = "progress.v1";
export const PHASE_STATES = new Set(["pending", "active", "done", "failed", "skipped"]);
export const RUN_STATES = new Set(["running", "done", "failed", "cancelled"]);

/** Root directory holding one sub-directory per run key. */
export function progressRoot(env = process.env) {
  return env.SKYLINE_PROGRESS_DIR ?? path.join(os.homedir(), ".skycoder", "progress");
}

/** Keys come from untrusted ids; keep them to a safe single path segment. */
export function sanitizeKey(key) {
  const trimmed = String(key ?? "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 200);
}

/** Resolve the run key: explicit wins, then the chat task id, then the bot id. */
export function resolveKey(explicit, env = process.env) {
  return sanitizeKey(explicit || env.SKYLINE_TASK_ID || env.BOT_ID || "");
}

export function keyDir(key, env = process.env) {
  return path.join(progressRoot(env), sanitizeKey(key));
}

export function statusPath(key, env = process.env) {
  return path.join(keyDir(key, env), "status.json");
}

export function eventsPath(key, env = process.env) {
  return path.join(keyDir(key, env), "events.ndjson");
}

/** Write JSON atomically: same-dir temp, fsync, then rename over the target. */
export function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`);
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}

/**
 * Read a status snapshot. Tolerates the brief window where a reader hits the
 * directory between a producer's temp-write and rename by retrying a few times.
 */
export function readStatus(key, env = process.env) {
  const file = statusPath(key, env);
  for (let attempt = 0; attempt < 5; attempt++) {
    let raw;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") return null;
      // transient (e.g. mid-rename): back off briefly and retry
      sleepMs(10);
      continue;
    }
    try {
      return JSON.parse(raw);
    } catch {
      sleepMs(10);
    }
  }
  return null;
}

function sleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* tiny spin; only used on the rare torn-read retry path */
  }
}

/** Parse "id:Label:weight,id2:Label2" (label/weight optional) into phase stubs. */
export function parsePhaseSpec(spec) {
  if (!spec) return [];
  return String(spec)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [id, label, weight] = part.split(":");
      return makePhase(id?.trim(), label?.trim(), Number(weight));
    })
    .filter((phase) => phase.id);
}

function labelize(id) {
  return String(id ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function makePhase(id, label, weight) {
  return {
    id: String(id ?? "").trim(),
    label: label || labelize(id),
    weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
    state: "pending",
    fraction: 0,
  };
}

/** Fresh status object for a brand-new run. */
export function createStatus(key, { runId, title, phases } = {}) {
  const now = Date.now();
  return {
    schema: SCHEMA,
    key: sanitizeKey(key),
    runId: runId || `run-${now.toString(36)}`,
    title: title || "",
    status: "running",
    phases: (phases && phases.length ? phases : []).map((p) => ({ ...p })),
    percent: 0,
    stage: "",
    message: "",
    startedAt: now,
    updatedAt: now,
    seq: 0,
    artifacts: [],
  };
}

function findPhase(status, id) {
  return status.phases.find((p) => p.id === id);
}

/** Add a phase on first reference so producers need not declare everything up front. */
function ensurePhase(status, id) {
  let phase = findPhase(status, id);
  if (!phase) {
    phase = makePhase(id);
    status.phases.push(phase);
  }
  return phase;
}

/** Complete every pending/active phase before the given index (monotonic forward move). */
function completeEarlier(status, index) {
  for (let i = 0; i < index; i++) {
    const p = status.phases[i];
    if (p.state === "pending" || p.state === "active") {
      p.state = "done";
      p.fraction = 1;
    }
  }
}

export function recompute(status) {
  const total = status.phases.reduce((sum, p) => sum + (p.weight || 1), 0);
  let acc = 0;
  for (const p of status.phases) {
    const w = p.weight || 1;
    if (p.state === "done") acc += w;
    else if (p.state === "active" || p.state === "failed") acc += w * clamp01(p.fraction);
  }
  let percent = total > 0 ? Math.round((acc / total) * 100) : 0;
  if (status.status === "done") percent = 100;
  status.percent = Math.max(0, Math.min(100, percent));

  const active = [...status.phases].reverse().find((p) => p.state === "active");
  const failed = status.phases.find((p) => p.state === "failed");
  const pending = status.phases.find((p) => p.state === "pending");
  if (status.status === "done") status.stage = "Done";
  else if (status.status === "cancelled") status.stage = "Cancelled";
  else if (failed) status.stage = `Failed: ${failed.label}`;
  else if (active) status.stage = active.label;
  else if (pending) status.stage = pending.label;
  else status.stage = status.phases.length ? "Done" : "";
  status.updatedAt = Date.now();
  return status;
}

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/** Apply one transition to a phase (begin/advance/done/fail/skip). */
export function transition(status, { phase, state, fraction, message }) {
  const index = status.phases.findIndex((p) => p.id === phase);
  const target = index >= 0 ? status.phases[index] : ensurePhase(status, phase);
  const at = status.phases.indexOf(target);

  if (state === "active" || state === "done") completeEarlier(status, at);

  if (state === "active") {
    target.state = "active";
    target.fraction = fraction === undefined ? target.fraction : clamp01(fraction);
    status.status = "running";
  } else if (state === "done") {
    target.state = "done";
    target.fraction = 1;
  } else if (state === "failed") {
    target.state = "failed";
    target.fraction = fraction === undefined ? target.fraction : clamp01(fraction);
    status.status = "failed";
  } else if (state === "skipped") {
    target.state = "skipped";
  }
  if (message !== undefined) status.message = message;
  return recompute(status);
}

export function markCancelled(status, message) {
  status.status = "cancelled";
  if (message !== undefined) status.message = message;
  return recompute(status);
}

export function markFinished(status, message) {
  for (const p of status.phases) {
    if (p.state !== "failed" && p.state !== "skipped") {
      p.state = "done";
      p.fraction = 1;
    }
  }
  status.status = "done";
  if (message !== undefined) status.message = message;
  return recompute(status);
}

export function sha256File(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    return { sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length };
  } catch {
    return { sha256: null, bytes: null };
  }
}

export function addArtifact(status, { label, path: artifactPath }) {
  const { sha256, bytes } = sha256File(artifactPath);
  status.artifacts.push({ label: label || path.basename(artifactPath), path: artifactPath, sha256, bytes });
  status.updatedAt = Date.now();
  return status;
}

/** Append one journal line; best-effort (history, not the authoritative snapshot). */
export function appendEvent(key, event, env = process.env) {
  try {
    const dir = keyDir(key, env);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(eventsPath(key, env), `${JSON.stringify(event)}\n`);
  } catch {
    /* journal is advisory; never fail a producer because history could not be written */
  }
}

/** What a consumer with no file for this key should see. */
export function idleStatus(key) {
  return {
    schema: SCHEMA,
    key: sanitizeKey(key),
    status: "idle",
    percent: 0,
    stage: "No run recorded for this task yet.",
    phases: [],
    message: "",
    artifacts: [],
  };
}

/** Seconds since the last update; lets a consumer flag a stalled run. */
export function staleSeconds(status, now = Date.now()) {
  if (!status || !status.updatedAt) return null;
  return Math.max(0, Math.round((now - status.updatedAt) / 1000));
}
