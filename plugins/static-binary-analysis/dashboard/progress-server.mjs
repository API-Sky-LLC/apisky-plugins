#!/usr/bin/env node
// Universal progress dashboard MCP server. Domain-agnostic: it renders whatever a
// producer wrote to the progress store for the current chat task. Any plugin can
// drop this file in (next to progress-core.mjs) and declare a dashboard pointing at
// its `ui://` resource.
//
// Tools:
//   get_progress({ taskId })  read-only snapshot for a run key
//   cancel_run({ taskId })    destructive; left off the whitelist so it needs approval
//
// Configurable via env: PROGRESS_SERVER_NAME, PROGRESS_TITLE, PROGRESS_RESOURCE_URI,
// PROGRESS_POLL_MS, PROGRESS_STALE_S.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  idleStatus,
  markCancelled,
  readStatus,
  staleSeconds,
  statusPath,
  writeJsonAtomic,
} from "./progress-core.mjs";

const SERVER_NAME = process.env.PROGRESS_SERVER_NAME || "progress";
const TITLE = process.env.PROGRESS_TITLE || "Progress";
const RESOURCE_URI = process.env.PROGRESS_RESOURCE_URI || "ui://progress";
const MIME = "text/html;profile=mcp-app";
const pollMs = Math.max(250, Number.parseInt(process.env.PROGRESS_POLL_MS || "2000", 10) || 2000);
const staleAfter = Math.max(5, Number.parseInt(process.env.PROGRESS_STALE_S || "30", 10) || 30);
const EMPTY_CSP = { connectDomains: [], resourceDomains: [], frameDomains: [] };

function snapshotFor(taskId) {
  const key = taskId || "";
  if (!key) {
    return { ...idleStatus(""), status: "no-task", stage: "Open a chat task to track progress.", staleSeconds: null };
  }
  const status = readStatus(key);
  if (!status) return { ...idleStatus(key), staleSeconds: null };
  return { ...status, staleSeconds: staleSeconds(status) };
}

function rpcScript(body) {
  return `(() => {
    let seq = 0;
    const waiting = new Map();
    const call = (method, params) => new Promise((resolve, reject) => {
      const id = ++seq;
      waiting.set(id, { resolve, reject });
      parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    });
    addEventListener("message", (event) => {
      const message = event.data;
      if (!message || message.jsonrpc !== "2.0" || !waiting.has(message.id)) return;
      const waiter = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message || "Request failed"));
      else waiter.resolve(message.result);
    });
    const postSize = () => parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: document.documentElement.scrollHeight } }, "*");
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(postSize).observe(document.documentElement);
    requestAnimationFrame(postSize);
    ${body}
  })();`;
}

function dashboardHtml() {
  const script = rpcScript(`
    let taskId = null;
    const status = document.getElementById("status");
    const stateIcon = (s) => s === "done" ? "\u2713" : s === "failed" ? "\u2717" : s === "active" ? "\u2699" : s === "skipped" ? "\u2013" : "\u25CB";
    const render = (result) => {
      const data = result.structuredContent || {};
      const pct = Math.max(0, Math.min(100, Number(data.percent) || 0));
      document.getElementById("percent").textContent = String(pct);
      document.getElementById("fill").style.width = pct + "%";
      document.getElementById("fill").className = "fill " + (data.status || "");
      document.getElementById("stage").textContent = data.stage || "\u2014";
      document.getElementById("message").textContent = data.message || "";
      status.textContent = data.status || "ready";
      const phases = document.getElementById("phases");
      phases.replaceChildren(...(data.phases || []).map((p) => {
        const row = document.createElement("div");
        row.className = "phase " + (p.state || "pending");
        const pctText = p.state === "active" && p.fraction ? " (" + Math.round(p.fraction * 100) + "%)" : "";
        row.textContent = stateIcon(p.state) + "  " + (p.label || p.id) + pctText;
        return row;
      }));
      const arts = document.getElementById("artifacts");
      arts.replaceChildren(...(data.artifacts || []).map((a) => {
        const li = document.createElement("li");
        const size = a.bytes != null ? " (" + a.bytes + " bytes)" : "";
        li.textContent = (a.label || "artifact") + ": " + a.path + size;
        return li;
      }));
      const stale = document.getElementById("stale");
      if (data.status === "running" && data.staleSeconds != null && data.staleSeconds > ${staleAfter}) {
        stale.textContent = "stale: no update for " + data.staleSeconds + "s";
        stale.style.display = "inline";
      } else {
        stale.style.display = "none";
      }
    };
    const failed = (error) => { status.textContent = /approval/i.test(error.message) ? "needs approval" : "error: " + error.message; };
    const refresh = () => call("tools/call", { name: "get_progress", arguments: { taskId } }).then(render, failed);
    document.getElementById("cancel").addEventListener("click", () =>
      call("tools/call", { name: "cancel_run", arguments: { taskId } }).then(render, failed));
    call("ui/initialize", { appInfo: { name: "${SERVER_NAME}", version: "1.0.0" }, appCapabilities: { availableDisplayModes: ["inline"] } })
      .then((result) => {
        taskId = result?.hostContext?.taskId || null;
        document.getElementById("task").textContent = taskId || "(none)";
        parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/initialized" }, "*");
        refresh(); setInterval(refresh, ${pollMs});
      }, failed);
  `);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${TITLE}</title><style>
  body{font:14px system-ui;margin:0;padding:18px;color:#d4d4d4;background:#1e1e1e}
  header{display:flex;align-items:center;justify-content:space-between;gap:12px}
  #bar{height:14px;background:#333;border-radius:7px;overflow:hidden;margin:16px 0 8px}
  .fill{height:100%;width:0;background:#4ec9b0;transition:width .3s}
  .fill.failed{background:#f14c4c}.fill.cancelled{background:#c586c0}.fill.done{background:#4ec9b0}
  #phases{margin:14px 0;display:flex;flex-direction:column;gap:6px}
  .phase{padding:4px 8px;border-radius:5px;background:#252526}
  .phase.active{background:#264f78;color:#fff}.phase.done{color:#4ec9b0}.phase.failed{color:#f14c4c}.phase.skipped{color:#888}
  #stale{display:none;color:#e5c07b;font-size:12px}
  ul{margin:8px 0;padding-left:18px}li{color:#9cdcfe;font-size:12px;word-break:break-all}
  button{font:inherit;padding:6px 10px}code{color:#9cdcfe}.muted{color:#888}</style></head><body>
  <header><strong>${TITLE}</strong><span data-testid="progress-status" id="status">connecting</span></header>
  <p class="muted">Task <code data-testid="progress-task" id="task">?</code> <span data-testid="progress-stale" id="stale"></span></p>
  <div id="bar"><div class="fill" data-testid="progress-fill" id="fill"></div></div>
  <p><code data-testid="progress-percent" id="percent">0</code>% \u2014 <span data-testid="progress-stage" id="stage">\u2014</span></p>
  <div data-testid="progress-phases" id="phases" aria-label="Phases"></div>
  <p class="muted" data-testid="progress-message" id="message"></p>
  <ul data-testid="progress-artifacts" id="artifacts" aria-label="Artifacts"></ul>
  <button data-testid="progress-cancel" id="cancel" type="button">Cancel run (requires approval)</button>
  <script>${script}</script></body></html>`;
}

const server = new McpServer({ name: SERVER_NAME, version: "1.0.0" });

server.registerResource(
  "progress",
  RESOURCE_URI,
  {
    title: TITLE,
    description: "Deterministic, phase-based progress for the current chat task.",
    mimeType: MIME,
    _meta: { ui: { prefersBorder: true, csp: EMPTY_CSP } },
  },
  async () => ({
    contents: [{ uri: RESOURCE_URI, mimeType: MIME, text: dashboardHtml(), _meta: { ui: { prefersBorder: true, csp: EMPTY_CSP } } }],
  }),
);

function toolResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}

server.registerTool(
  "get_progress",
  {
    title: "Read progress",
    description: "Return deterministic phase progress for a chat task.",
    inputSchema: { taskId: z.string().nullable().optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ taskId }) => toolResult(snapshotFor(taskId || null)),
);

server.registerTool(
  "cancel_run",
  {
    title: "Cancel run",
    description: "Mark the current run cancelled for a chat task.",
    inputSchema: { taskId: z.string().nullable().optional() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ taskId }) => {
    const key = taskId || "";
    const status = key ? readStatus(key) : null;
    if (status) {
      markCancelled(status, "Cancelled from the dashboard.");
      writeJsonAtomic(statusPath(key), status);
    }
    return toolResult(snapshotFor(key || null));
  },
);

await server.connect(new StdioServerTransport());
