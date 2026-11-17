#!/usr/bin/env node
// CLI that folds static-binary-analysis facts into a task-keyed analysis.json.
//
// Scripts (inspect.sh) pipe raw INSPECT output here; the agent pipes sba.v1
// events here. Everything merges into one document the dashboard renders.
//
// Usage (key defaults to $SKYLINE_TASK_ID, then $BOT_ID):
//   inspect.sh manifest  X | node sba-analysis.mjs ingest manifest   [--key K]
//   inspect.sh inventory X | node sba-analysis.mjs ingest inventory  [--key K]
//   inspect.sh decompile X | node sba-analysis.mjs ingest decompile  [--key K]
//   inspect.sh verify X a b | node sba-analysis.mjs ingest verify     [--key K]
//   echo '<sba.v1 json>'    | node sba-analysis.mjs event             [--key K]
//   node sba-analysis.mjs set --title "..." --run-id "..."            [--key K]
//   node sba-analysis.mjs show                                        [--key K]
//
// Exit codes: 0 ok, 2 usage error. Ingest never throws on malformed input —
// best-effort parse so a producer is never broken by the dashboard layer.

import fs from "node:fs";
import { parseArgs } from "node:util";
import { resolveKey } from "./progress-core.mjs";
import {
  loadOrInit,
  mergeDecompile,
  mergeEvent,
  mergeInventory,
  mergeManifest,
  mergeVerify,
  parseDecompile,
  parseInventory,
  parseManifest,
  parseVerify,
  saveAnalysis,
} from "./sba-analysis-core.mjs";

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function fail(msg) {
  process.stderr.write(`sba-analysis: ${msg}\n`);
  process.exit(2);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    key: { type: "string" },
    "run-id": { type: "string" },
    title: { type: "string" },
  },
});

const command = positionals[0];
if (!command) fail("missing command (ingest|event|set|show)");

const key = resolveKey(values.key);
if (!key) fail("no run key (pass --key or set SKYLINE_TASK_ID / BOT_ID)");

const doc = loadOrInit(key);
if (values.title) doc.title = values.title;
if (values["run-id"]) doc.runId = values["run-id"];

function ingest(kind, text) {
  try {
    if (kind === "manifest") mergeManifest(doc, parseManifest(text));
    else if (kind === "inventory") mergeInventory(doc, parseInventory(text));
    else if (kind === "decompile") mergeDecompile(doc, parseDecompile(text));
    else if (kind === "verify") mergeVerify(doc, parseVerify(text));
    else fail(`unknown ingest kind: ${kind}`);
  } catch (error) {
    // tolerant: record nothing on parse failure but do not break the producer
    process.stderr.write(`sba-analysis: ignored malformed ${kind}: ${error?.message || error}\n`);
  }
}

switch (command) {
  case "ingest": {
    const kind = positionals[1];
    if (!kind) fail("ingest needs a kind (manifest|inventory|decompile|verify)");
    ingest(kind, readStdin());
    break;
  }
  case "event": {
    const raw = readStdin().trim();
    if (raw) {
      try {
        mergeEvent(doc, JSON.parse(raw));
      } catch (error) {
        process.stderr.write(`sba-analysis: ignored malformed event: ${error?.message || error}\n`);
      }
    }
    break;
  }
  case "set":
    // title/run-id already applied above
    break;
  case "show":
    saveAnalysis(doc);
    process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
    process.exit(0);
    break;
  default:
    fail(`unknown command: ${command}`);
}

saveAnalysis(doc);
