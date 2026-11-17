// Static-binary-analysis domain document ("sba.analysis.v1").
//
// This is the *plugin-owned, rich* layer that sits on top of the universal
// progress kit. The progress kit (progress-core.mjs) models run lifecycle and a
// deterministic percent; this models the actual reverse-engineering artifacts a
// run produces so the dashboard can render an IDA/Ghidra-style view instead of a
// bare progress bar.
//
// Two feeds, merged by task key, so the view is both trustworthy and alive:
//   1. Scripts (inspect.sh) — deterministic facts parsed from INSPECT output.
//   2. Agent (sba.v1 `analysis-event` blocks) — synthesis the scripts cannot
//      produce (chosen function, findings, the "what it does" verdict).
//
// Storage reuses the progress kit's task-keyed directory + atomic write so both
// layers live side by side:
//   <root>/<key>/analysis.json   derived snapshot (this module)
//   <root>/<key>/status.json     progress snapshot (progress-core)

import fs from "node:fs";
import path from "node:path";

import { keyDir, sanitizeKey, writeJsonAtomic } from "./progress-core.mjs";

export const SCHEMA = "sba.analysis.v1";
export const VERIFY_LEVELS = new Set(["CALLED", "REFERENCED", "PRESENT", "NOT_FOUND"]);

export function analysisPath(key, env = process.env) {
  return path.join(keyDir(key, env), "analysis.json");
}

/** Fresh, empty document for a run key. */
export function emptyDoc(key) {
  return {
    schema: SCHEMA,
    key: sanitizeKey(key),
    runId: null,
    title: "",
    question: "",
    updatedAt: Date.now(),
    target: null,
    description: "",
    analyzers: null,
    missingTools: [],
    inventory: null,
    decompile: null,
    verify: [],
    findings: [],
    verdict: null,
    events: [],
    // which feeds have contributed, for provenance badges in the UI
    source: { manifest: false, inventory: false, decompile: false, verify: false, agent: false },
  };
}

/** What a consumer with no document for this key should see. */
export function idleDoc(key) {
  return { ...emptyDoc(key), status: "idle" };
}

export function readAnalysis(key, env = process.env) {
  const file = analysisPath(key, env);
  for (let attempt = 0; attempt < 5; attempt++) {
    let raw;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") return null;
      spin(10);
      continue;
    }
    try {
      return JSON.parse(raw);
    } catch {
      spin(10);
    }
  }
  return null;
}

export function saveAnalysis(doc, env = process.env) {
  doc.updatedAt = Date.now();
  writeJsonAtomic(analysisPath(doc.key, env), doc);
  return doc;
}

/** Load the current doc for a key or start a fresh one. */
export function loadOrInit(key, env = process.env) {
  return readAnalysis(key, env) ?? emptyDoc(key);
}

function spin(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* rare torn-read retry */
  }
}

// ---------------------------------------------------------------------------
// Text-block helpers. INSPECT output is human-readable text grouped under
// `=== header ===` lines. Parsing is best-effort and tolerant: unknown blocks
// are ignored and malformed rows are skipped rather than throwing.
// ---------------------------------------------------------------------------

/** Split INSPECT text into [{ title, lines[] }] blocks keyed by `=== title ===`. */
export function splitBlocks(text) {
  const blocks = [];
  let current = null;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const header = rawLine.match(/^===\s*(.+?)\s*===$/);
    if (header) {
      current = { title: header[1].trim(), lines: [] };
      blocks.push(current);
    } else if (current) {
      current.lines.push(rawLine);
    }
  }
  return blocks;
}

function body(block) {
  // drop leading/trailing blank lines but keep interior spacing
  const lines = [...block.lines];
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines;
}

function nonEmpty(block) {
  return body(block).filter((l) => l.trim() !== "");
}

/**
 * Parse a "key=value key2=value2" line where VALUES MAY CONTAIN SPACES
 * (e.g. `subsys=Windows GUI`, `compiled=Mon Jul 18 02:17:23 1977 UTC+3`).
 * A token containing `=` opens a new key; tokens without `=` extend the
 * current value.
 */
export function parseKeyVals(line) {
  const out = {};
  let key = null;
  for (const token of String(line).trim().split(/\s+/)) {
    const eq = token.indexOf("=");
    if (eq > 0) {
      key = token.slice(0, eq);
      out[key] = token.slice(eq + 1);
    } else if (key) {
      out[key] = `${out[key]} ${token}`.trim();
    }
  }
  return out;
}

function coerce(v) {
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "unknown" || v === "" || v == null) return v;
  return v;
}

// ---------------------------------------------------------------------------
// Parsers (one per INSPECT subcommand).
// ---------------------------------------------------------------------------

/** `manifest` emits JSON already. */
export function parseManifest(input) {
  const json = typeof input === "string" ? JSON.parse(input) : input;
  return {
    target: json.target ?? null,
    description: json.description ?? "",
    analyzers: json.analyzers ?? null,
    missingTools: Array.isArray(json.missingTools) ? json.missingTools : [],
  };
}

/** `inventory` → structured sections/libraries/imports/exports/entry points. */
export function parseInventory(text) {
  const inv = {
    tool: "",
    file: "",
    info: {},
    sections: [],
    libraries: [],
    imports: [],
    exports: { count: 0, names: [] },
    entryPoints: [],
  };
  for (const block of splitBlocks(text)) {
    const title = block.title.toLowerCase();
    const lines = nonEmpty(block);
    if (title === "tool") {
      inv.tool = lines.join(" ").trim();
    } else if (title === "file") {
      inv.file = lines.join(" ").trim();
    } else if (title === "info") {
      const kv = parseKeyVals(lines.join(" "));
      for (const [k, v] of Object.entries(kv)) inv.info[k] = coerce(v);
    } else if (title.startsWith("sections")) {
      for (const line of lines) {
        const cols = line.split("\t").map((c) => c.trim());
        if (cols.length >= 1 && cols[0]) {
          inv.sections.push({
            name: cols[0],
            size: toNum(cols[1]),
            vsize: toNum(cols[2]),
            perm: cols[3] ?? "",
          });
        }
      }
    } else if (title === "libraries") {
      for (const line of lines) if (line.trim()) inv.libraries.push(line.trim());
    } else if (title.startsWith("imports")) {
      for (const line of lines) {
        const m = line.match(/^(.+?)\s*\[(\d+)\]:\s*(.*)$/);
        if (m) {
          inv.imports.push({
            lib: m[1].trim(),
            count: toNum(m[2]),
            functions: m[3].split(",").map((s) => s.trim()).filter(Boolean),
          });
        }
      }
    } else if (title.startsWith("exports")) {
      for (const line of lines) {
        const c = line.match(/count=(\d+)/);
        if (c) inv.exports.count = toNum(c[1]);
        else if (line.trim()) inv.exports.names.push(line.trim());
      }
    } else if (title.startsWith("entry")) {
      for (const line of lines) {
        const m = line.match(/^(\S+)\s+(0x[0-9a-fA-F]+)/);
        if (m) inv.entryPoints.push({ label: m[1], addr: m[2] });
      }
    }
  }
  return inv;
}

/** `decompile` → tool, analysis meta, selected function, call/string summary, raw asm. */
export function parseDecompile(text) {
  const dec = {
    tool: "",
    functionsCount: null,
    selected: "",
    cache: "",
    function: null,
    summary: [],
    disassembly: "",
  };
  for (const block of splitBlocks(text)) {
    const title = block.title.toLowerCase();
    const lines = nonEmpty(block);
    if (title === "tool") {
      dec.tool = lines.join(" ").trim();
    } else if (title === "analysis") {
      const kv = parseKeyVals(lines.join(" "));
      dec.functionsCount = kv.functions != null ? toNum(kv.functions) : null;
      dec.selected = kv.selected ?? "";
      dec.cache = kv.cache ?? "";
    } else if (title === "function") {
      const kv = parseKeyVals(lines.join(" "));
      dec.function = {
        name: kv.name ?? "",
        offset: kv.offset ?? "",
        size: kv.size != null ? toNum(kv.size) : null,
        blocks: kv.blocks != null ? toNum(kv.blocks) : null,
        signature: kv.signature ?? "",
      };
    } else if (title.startsWith("summary")) {
      for (const line of lines) {
        const m = line.match(/^(0x[0-9a-fA-F]+)\s+(.*)$/);
        if (m) dec.summary.push({ addr: m[1], text: m[2] });
      }
    } else if (title.startsWith("disassembly")) {
      dec.disassembly = body(block).join("\n");
    }
  }
  return dec;
}

/** `verify` → [{ term, level, site }]. */
export function parseVerify(text) {
  const rows = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = line.match(/^(CALLED|REFERENCED|PRESENT|NOT_FOUND)\s+(\S+)(?:\s+\((.*)\))?\s*$/);
    if (m) rows.push({ term: m[2], level: m[1], site: m[3] ?? "" });
  }
  return rows;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Merge: fold a parsed section (or an agent event) into the document.
// ---------------------------------------------------------------------------

export function mergeManifest(doc, parsed) {
  if (parsed.target) doc.target = parsed.target;
  if (parsed.description) doc.description = parsed.description;
  if (parsed.analyzers) doc.analyzers = parsed.analyzers;
  if (parsed.missingTools) doc.missingTools = parsed.missingTools;
  doc.source.manifest = true;
  return doc;
}

export function mergeInventory(doc, inv) {
  doc.inventory = inv;
  doc.source.inventory = true;
  return doc;
}

export function mergeDecompile(doc, dec) {
  doc.decompile = dec;
  doc.source.decompile = true;
  return doc;
}

export function mergeVerify(doc, rows) {
  doc.verify = rows;
  doc.source.verify = true;
  return doc;
}

/**
 * Merge one sba.v1 `analysis-event` object (the agent feed). We record it on the
 * timeline and promote the richer fields. Script-provided facts win for the
 * structured tables; the agent fills what only it can know (verdict, findings,
 * pseudocode, the chosen function narrative).
 */
export function mergeEvent(doc, event) {
  if (!event || typeof event !== "object") return doc;
  const { runId, target, agent, stage, status, data = {} } = event;
  if (runId && !doc.runId) doc.runId = runId;
  if (target && !doc.target) doc.target = target;
  doc.events.push({ agent: agent ?? "", stage: stage ?? "", status: status ?? "", at: Date.now() });
  doc.source.agent = true;

  if (stage === "intake" && status === "completed") {
    if (data.question) doc.question = data.question;
    if (data.description && !doc.description) doc.description = data.description;
    if (data.analyzers && !doc.analyzers) doc.analyzers = data.analyzers;
    if (Array.isArray(data.missingTools) && !doc.missingTools.length) doc.missingTools = data.missingTools;
  } else if (stage === "inventory" && status === "completed") {
    // keep script inventory if present; otherwise take the agent's structured data
    if (!doc.inventory && (data.sections || data.imports || data.fileDescription)) {
      doc.inventory = { agent: data };
      doc.source.inventory = true;
    } else if (doc.inventory) {
      doc.inventory.agent = data;
    }
  } else if (stage === "decompile" && status === "completed") {
    doc.decompile = doc.decompile || {};
    if (data.pseudocode) doc.decompile.pseudocode = data.pseudocode;
    if (data.tool && !doc.decompile.tool) doc.decompile.tool = data.tool;
    if (data.callees) doc.decompile.callees = data.callees;
    doc.source.decompile = true;
  } else if (stage === "finding") {
    doc.findings.push(data);
  } else if (stage === "verification" && status === "completed") {
    if (Array.isArray(data.evidence) && data.evidence.length) doc.verify = data.evidence;
  } else if (stage === "complete") {
    doc.verdict = {
      report: data.report ?? "",
      pseudocode: data.pseudocode ?? "",
      evidence: Array.isArray(data.evidence) ? data.evidence : [],
      limitation: data.limitation ?? "",
      status: status ?? "",
    };
    if (Array.isArray(data.evidence) && data.evidence.length && !doc.verify.length) {
      doc.verify = data.evidence;
    }
  }
  return doc;
}
