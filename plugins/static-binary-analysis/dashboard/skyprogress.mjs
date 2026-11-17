#!/usr/bin/env node
// skyprogress — the universal progress emitter. Any plugin's scripts call this to
// report deterministic, phase-based progress for a run. State is written to disk
// (see progress-core.mjs) keyed by the chat task id, which the dashboard reads back.
//
// Usage:
//   skyprogress init    [--key K] [--run-id R] [--title T] --phases "id:Label:weight,..."
//   skyprogress ensure  [--key K] [--run-id R] [--title T] --phases "..."   (only if absent)
//   skyprogress begin   <phase> [--message M]
//   skyprogress advance <phase> [--fraction 0..1 | --index i --total n] [--message M]
//   skyprogress done    <phase> [--message M]
//   skyprogress fail    <phase> [--fraction f] [--message M]
//   skyprogress skip    <phase> [--message M]
//   skyprogress artifact --label L --path P
//   skyprogress finish  [--message M]
//   skyprogress cancel  [--message M]
//   skyprogress status  [--key K]           (prints status.json)
//
// Key resolution: --key, else $SKYLINE_TASK_ID, else $BOT_ID. Exit 2 on usage error.

import { parseArgs } from "node:util";

import {
  addArtifact,
  appendEvent,
  createStatus,
  markCancelled,
  markFinished,
  parsePhaseSpec,
  readStatus,
  resolveKey,
  statusPath,
  transition,
  writeJsonAtomic,
} from "./progress-core.mjs";

function fail(message) {
  console.error(message);
  process.exit(2);
}

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    key: { type: "string" },
    "run-id": { type: "string" },
    title: { type: "string" },
    phases: { type: "string" },
    fraction: { type: "string" },
    index: { type: "string" },
    total: { type: "string" },
    message: { type: "string" },
    label: { type: "string" },
    path: { type: "string" },
  },
});

const command = positionals[0];
if (!command) fail("skyprogress: missing command (init|ensure|begin|advance|done|fail|skip|artifact|finish|cancel|status)");

const key = resolveKey(opts.key);
if (!key) fail("skyprogress: no run key (pass --key, or set SKYLINE_TASK_ID / BOT_ID)");

function load() {
  return readStatus(key);
}

function save(status) {
  writeJsonAtomic(statusPath(key), status);
}

function fractionFromOpts(current) {
  if (opts.index !== undefined && opts.total !== undefined) {
    const total = Number(opts.total);
    const index = Number(opts.index);
    if (total > 0) return Math.max(0, Math.min(1, index / total));
  }
  if (opts.fraction !== undefined) return Number(opts.fraction);
  return current;
}

function record(status, event) {
  status.seq = (status.seq ?? 0) + 1;
  appendEvent(key, { ts: Date.now(), seq: status.seq, ...event });
  save(status);
}

function requirePhase() {
  const phase = positionals[1];
  if (!phase) fail(`skyprogress ${command}: missing <phase>`);
  return phase;
}

switch (command) {
  case "init": {
    const status = createStatus(key, {
      runId: opts["run-id"],
      title: opts.title,
      phases: parsePhaseSpec(opts.phases),
    });
    record(status, { cmd: "init", phases: status.phases.map((p) => p.id) });
    break;
  }
  case "ensure": {
    let status = load();
    if (!status) {
      status = createStatus(key, {
        runId: opts["run-id"],
        title: opts.title,
        phases: parsePhaseSpec(opts.phases),
      });
      record(status, { cmd: "ensure", phases: status.phases.map((p) => p.id) });
    }
    break;
  }
  case "begin":
  case "advance":
  case "done":
  case "fail":
  case "skip": {
    const phase = requirePhase();
    const status = load() ?? createStatus(key, { runId: opts["run-id"], title: opts.title });
    const stateByCmd = { begin: "active", advance: "active", done: "done", fail: "failed", skip: "skipped" };
    const target = status.phases.find((p) => p.id === phase);
    const fraction = command === "begin" ? 0 : fractionFromOpts(target ? target.fraction : 0);
    transition(status, { phase, state: stateByCmd[command], fraction, message: opts.message });
    record(status, { cmd: command, phase, fraction, message: opts.message });
    break;
  }
  case "artifact": {
    if (!opts.path) fail("skyprogress artifact: --path is required");
    const status = load() ?? createStatus(key);
    addArtifact(status, { label: opts.label, path: opts.path });
    record(status, { cmd: "artifact", label: opts.label, path: opts.path });
    break;
  }
  case "finish": {
    const status = load() ?? createStatus(key);
    markFinished(status, opts.message);
    record(status, { cmd: "finish", message: opts.message });
    break;
  }
  case "cancel": {
    const status = load() ?? createStatus(key);
    markCancelled(status, opts.message);
    record(status, { cmd: "cancel", message: opts.message });
    break;
  }
  case "status": {
    const status = load();
    if (!status) {
      console.log(JSON.stringify({ key, status: "idle" }, null, 2));
    } else {
      console.log(JSON.stringify(status, null, 2));
    }
    break;
  }
  default:
    fail(`skyprogress: unknown command "${command}"`);
}
