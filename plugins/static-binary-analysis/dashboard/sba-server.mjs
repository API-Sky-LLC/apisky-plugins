#!/usr/bin/env node
// Static-binary-analysis dashboard MCP server (plugin-owned, rich).
//
// Serves an IDA/Ghidra-style view of the current chat task's analysis document
// (sba-analysis-core) with the deterministic progress strip folded in from the
// universal progress kit. Reads only; `cancel_run` is destructive and kept off
// the whitelist so it needs approval.
//
// Tools:
//   get_analysis({ taskId })  read-only: { ...analysisDoc, progress, staleSeconds }
//   cancel_run({ taskId })    destructive
//
// Env: SBA_SERVER_NAME, SBA_TITLE, SBA_RESOURCE_URI (ui://analysis),
//      SBA_POLL_MS, SBA_STALE_S.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  markCancelled,
  readStatus,
  staleSeconds,
  statusPath,
  writeJsonAtomic,
} from "./progress-core.mjs";
import { idleDoc, readAnalysis } from "./sba-analysis-core.mjs";

const SERVER_NAME = process.env.SBA_SERVER_NAME || process.env.PROGRESS_SERVER_NAME || "sba";
const TITLE = process.env.SBA_TITLE || "Static binary analysis";
const RESOURCE_URI = process.env.SBA_RESOURCE_URI || "ui://analysis";
const MIME = "text/html;profile=mcp-app";
const pollMs = Math.max(250, Number.parseInt(process.env.SBA_POLL_MS || process.env.PROGRESS_POLL_MS || "2000", 10) || 2000);
const staleAfter = Math.max(5, Number.parseInt(process.env.SBA_STALE_S || process.env.PROGRESS_STALE_S || "45", 10) || 45);
const EMPTY_CSP = { connectDomains: [], resourceDomains: [], frameDomains: [] };

function progressOf(key) {
  const status = key ? readStatus(key) : null;
  if (!status) return { status: "idle", percent: 0, stage: "", phases: [] };
  return {
    status: status.status,
    percent: status.percent,
    stage: status.stage,
    phases: status.phases || [],
    message: status.message || "",
  };
}

function snapshotFor(taskId) {
  const key = taskId || "";
  if (!key) {
    return { ...idleDoc(""), status: "no-task", progress: { status: "no-task", percent: 0, stage: "", phases: [] }, staleSeconds: null };
  }
  const doc = readAnalysis(key) || idleDoc(key);
  const progress = progressOf(key);
  return { ...doc, status: doc.status || (progress.status === "idle" ? "idle" : "active"), progress, staleSeconds: doc.updatedAt ? staleSeconds(doc) : null };
}

function rpcScript(body) {
  return `(() => {
    let seq = 0; const waiting = new Map(); const notifications = new Map();
    const onNotification = (method, handler) => {
      const handlers = notifications.get(method) || [];
      handlers.push(handler);
      notifications.set(method, handlers);
    };
    const call = (method, params, timeoutMs) => new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = timeoutMs ? setTimeout(() => {
        if (!waiting.has(id)) return;
        waiting.delete(id);
        reject(new Error("timeout"));
      }, timeoutMs) : null;
      waiting.set(id, {
        resolve: (value) => { if (timer) clearTimeout(timer); resolve(value); },
        reject: (error) => { if (timer) clearTimeout(timer); reject(error); },
      });
      parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    });
    addEventListener("message", (event) => {
      const m = event.data;
      if (!m || m.jsonrpc !== "2.0") return;
      if (typeof m.method === "string" && m.id === undefined) {
        for (const handler of notifications.get(m.method) || []) handler(m.params || {});
        return;
      }
      if (!waiting.has(m.id)) return;
      const w = waiting.get(m.id); waiting.delete(m.id);
      if (m.error) w.reject(new Error(m.error.message || "Request failed")); else w.resolve(m.result);
    });
    const postSize = () => {
      if (document.documentElement.dataset.ready !== "1") return;
      parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: document.documentElement.scrollHeight } }, "*");
    };
    const markReady = () => {
      if (document.documentElement.dataset.ready === "1") return;
      document.documentElement.dataset.ready = "1";
      requestAnimationFrame(postSize);
    };
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(postSize).observe(document.documentElement);
    ${body}
  })();`;
}

function clientScript() {
  return rpcScript(`
    let taskId = null;
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;" }[c]));
    const human = (n) => { n = Number(n)||0; if (n < 1024) return n + " B"; if (n < 1048576) return (n/1024).toFixed(1) + " KB"; return (n/1048576).toFixed(2) + " MB"; };
    const levelClass = (l) => ({ CALLED:"lvl-called", REFERENCED:"lvl-ref", PRESENT:"lvl-present", NOT_FOUND:"lvl-nf" }[l] || "lvl-nf");
    const classifyLine = (t) => {
      const s = String(t||"");
      if (s.trim().startsWith('"') || s.includes('; "')) return "s-str";
      if (/\\bcall\\b/.test(s)) return "s-call";
      if (/^[A-Za-z_][\\w ]*\\b(arg_|var_|lp|hwnd|dw|Reg|Event|Provider|Callback|Information|UserData|Activity)/i.test(s)) return "s-arg";
      return "";
    };
    let openState = null; // Set of open section titles; null until first render
    let lastDocKey = null; // guards heavy body rebuild to real doc changes
    const section = (title, count, bodyHtml, defaultOpen) => {
      const open = openState ? openState.has(title) : defaultOpen;
      const c = count == null ? "" : '<span class="count">' + count + '</span>';
      return '<details class="sec" data-sec="' + esc(title) + '"' + (open ? " open" : "") + '><summary>' + esc(title) + c + '</summary><div class="secbody">' + bodyHtml + '</div></details>';
    };

    const renderInventoryImports = (inv) => {
      if (!inv || !Array.isArray(inv.imports) || !inv.imports.length) return "";
      const libs = inv.imports.map((g) =>
        '<div class="implib"><div class="libname">' + esc(g.lib) + ' <span class="muted">(' + (g.count||0) + ')</span></div>' +
        '<div class="chips">' + (g.functions||[]).map((f) => '<span class="chip">' + esc(f) + '</span>').join("") + '</div></div>'
      ).join("");
      return libs;
    };
    const renderSections = (inv) => {
      if (!inv || !Array.isArray(inv.sections) || !inv.sections.length) return "";
      const max = Math.max(1, ...inv.sections.map((s) => Number(s.vsize)||0));
      const rows = inv.sections.map((s) => {
        const w = Math.round(((Number(s.vsize)||0)/max)*100);
        return '<tr><td class="mono">' + esc(s.name) + '</td><td class="mono perm">' + esc(s.perm) + '</td><td class="mono r">' + human(s.size) +
          '</td><td class="barcell"><div class="minibar"><div class="minifill" style="width:' + w + '%"></div></div></td></tr>';
      }).join("");
      return '<table class="tbl"><thead><tr><th>section</th><th>perm</th><th>size</th><th>vsize</th></tr></thead><tbody>' + rows + '</tbody></table>';
    };
    const renderFunction = (dec) => {
      if (!dec) return "";
      const fn = dec.function || {};
      const meta = '<div class="fnmeta">' +
        (fn.signature ? '<code class="sig">' + esc(fn.signature) + '</code>' : '') +
        '<div class="muted small">' + ['name=' + esc(fn.name||"?"), 'offset=' + esc(fn.offset||"?"), 'size=' + (fn.size==null?"?":fn.size), 'blocks=' + (fn.blocks==null?"?":fn.blocks)].join("  ·  ") +
        (dec.functionsCount!=null ? '  ·  functions=' + dec.functionsCount : '') + '</div></div>';
      const summary = Array.isArray(dec.summary) && dec.summary.length
        ? '<div class="summary">' + dec.summary.map((r) =>
            '<div class="srow ' + classifyLine(r.text) + '"><span class="addr">' + esc(r.addr) + '</span><span class="stext">' + esc(r.text) + '</span></div>'
          ).join("") + '</div>'
        : "";
      const disasm = dec.disassembly
        ? '<details class="sub"><summary>disassembly</summary><pre class="asm">' +
            esc(dec.disassembly).split("\\n").map((l) => /\\bcall\\b/.test(l) ? '<span class="a-call">' + l + '</span>' : (/; "/.test(l) ? '<span class="a-str">' + l + '</span>' : l)).join("\\n") +
          '</pre></details>'
        : "";
      const pseudo = dec.pseudocode ? '<details class="sub"><summary>agent pseudocode</summary><pre class="asm">' + esc(dec.pseudocode) + '</pre></details>' : "";
      return meta + summary + pseudo + disasm;
    };
    const renderEvidence = (rows) => {
      if (!Array.isArray(rows) || !rows.length) return "";
      return '<div class="evlist">' + rows.map((r) =>
        '<div class="evrow"><span class="lvl ' + levelClass(r.level) + '">' + esc(r.level) + '</span>' +
        '<span class="term mono">' + esc(r.term) + '</span>' + (r.site ? '<span class="site muted">' + esc(r.site) + '</span>' : '') + '</div>'
      ).join("") + '</div>';
    };

    const render = (result) => {
      const d = result.structuredContent || {};
      const t = d.target || {};
      const run = d.progress || {};
      $("status").textContent = (d.status === "no-task" ? "no task" : (run.status && run.status !== "idle" ? run.status : (d.source && (d.source.manifest||d.source.agent) ? "ready" : "idle")));
      // header
      $("fname").textContent = t.name || "(no target yet)";
      const chips = [];
      if (t.format) chips.push(t.format);
      if (t.arch) chips.push(t.arch + (t.bits ? "/" + t.bits : ""));
      if (t.kind) chips.push(t.kind);
      if (t.size != null) chips.push(human(t.size));
      $("chips").innerHTML = chips.map((c) => '<span class="idchip">' + esc(c) + '</span>').join("");
      $("sha").textContent = t.sha256 ? ("sha256 " + t.sha256) : "";
      $("desc").textContent = d.description || "";
      $("question").textContent = d.question ? ("Q: " + d.question) : "";
      // progress strip
      const pct = Math.max(0, Math.min(100, Number(run.percent) || 0));
      $("pfill").style.width = pct + "%";
      $("pfill").className = "pfill " + (run.status || "");
      $("pstage").textContent = (run.stage || "") + (pct ? "  ·  " + pct + "%" : "");
      $("pdots").innerHTML = (run.phases || []).map((p) =>
        '<span class="dot ' + (p.state||"pending") + '" title="' + esc(p.label||p.id) + '"></span>').join("");
      const stale = $("stale");
      if (run.status === "running" && d.staleSeconds != null && d.staleSeconds > ${staleAfter}) {
        stale.textContent = "stale " + d.staleSeconds + "s"; stale.style.display = "inline";
      } else stale.style.display = "none";
      // verdict
      const v = d.verdict;
      $("verdict").innerHTML = v && (v.report || v.limitation)
        ? '<div class="vcard"><div class="vtitle">Verdict' + (v.status ? ' <span class="muted small">(' + esc(v.status) + ')</span>' : '') + '</div>' +
          (v.report ? '<p class="vreport">' + esc(v.report) + '</p>' : '') +
          (v.limitation ? '<p class="muted small">Limitation: ' + esc(v.limitation) + '</p>' : '') + '</div>'
        : "";
      // body sections — rebuild only when the doc actually changed, preserving
      // the user's expand/collapse state and scroll position across polls.
      const docKey = String(d.updatedAt || "") + "|" + JSON.stringify(d.source || {}) + "|" + (d.status || "");
      if (docKey === lastDocKey) return;
      const bodyEl = $("body");
      openState = lastDocKey === null ? null
        : new Set([].slice.call(bodyEl.querySelectorAll('details.sec[open]')).map((s) => s.getAttribute("data-sec")));
      lastDocKey = docKey;
      const inv = d.inventory || null;
      const dec = d.decompile || null;
      let html = "";
      if (dec) html += section("Function", null, renderFunction(dec), true);
      if (Array.isArray(d.verify) && d.verify.length) html += section("Evidence", d.verify.length, renderEvidence(d.verify), true);
      if (inv && inv.imports && inv.imports.length) html += section("Imports", inv.imports.reduce((n,g)=>n+(g.count||0),0), renderInventoryImports(inv), false);
      if (inv && inv.sections && inv.sections.length) html += section("Sections", inv.sections.length, renderSections(inv), false);
      if (inv && Array.isArray(inv.libraries) && inv.libraries.length) html += section("Libraries", inv.libraries.length, '<div class="chips">' + inv.libraries.map((l)=>'<span class="chip">'+esc(l)+'</span>').join("") + '</div>', false);
      if (inv && inv.entryPoints && inv.entryPoints.length) html += section("Entry points", inv.entryPoints.length, '<div class="summary">' + inv.entryPoints.map((e)=>'<div class="srow"><span class="addr">'+esc(e.addr)+'</span><span class="stext">'+esc(e.label)+'</span></div>').join("") + '</div>', false);
      if (inv && inv.info && Object.keys(inv.info).length) html += section("File info", null, '<table class="tbl"><tbody>' + Object.entries(inv.info).map(([k,val])=>'<tr><td class="mono">'+esc(k)+'</td><td class="mono">'+esc(String(val))+'</td></tr>').join("") + '</tbody></table>', false);
      if (!html) html = '<p class="muted" data-testid="sba-empty">No analysis recorded for this task yet. Run INSPECT (doctor → manifest → inventory → decompile → verify) for this task.</p>';
      $("body").innerHTML = html;
      markReady();
    };
    const failed = (e) => {
      $("status").textContent = /approval/i.test(e.message) ? "needs approval" : "error: " + e.message;
      markReady();
    };
    const refresh = () => call("tools/call", { name: "get_analysis", arguments: { taskId } }).then(render, failed);
    let started = false;
    const startPolling = () => { if (started) return; started = true; refresh(); setInterval(refresh, ${pollMs}); };
    const showTask = () => { $("task").textContent = taskId || "(none)"; };
    onNotification("ui/notifications/tool-input", (params) => {
      const next = params?.arguments?.taskId;
      if (typeof next === "string" && next) { taskId = next; showTask(); startPolling(); }
    });
    $("cancel").addEventListener("click", () => call("tools/call", { name: "cancel_run", arguments: { taskId } }).then(refresh, failed));
    const boot = () => call("ui/initialize", { appInfo: { name: "${SERVER_NAME}", version: "1.0.0" }, appCapabilities: { availableDisplayModes: ["inline"] } }, 400).then((r) => {
      taskId = r?.hostContext?.taskId || taskId;
      showTask();
      parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/initialized" }, "*");
      startPolling();
    }, (e) => { if (e.message === "timeout") boot(); else failed(e); });
    boot();
  `);
}

function dashboardHtml() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${TITLE}</title><style>
  :root{--bg:#1e1e1e;--panel:#252526;--fg:#d4d4d4;--muted:#858585;--teal:#4ec9b0;--blue:#569cd6;--lblue:#9cdcfe;--orange:#ce9178;--yellow:#dcdcaa;--red:#f14c4c;--sel:#264f78;--border:#333}
  *{box-sizing:border-box}
  body{font:13px system-ui,-apple-system,Segoe UI,sans-serif;margin:0;padding:12px;color:var(--fg);background:var(--bg)}
  html:not([data-ready]) body{visibility:hidden}
  .mono{font-family:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace}
  .muted{color:var(--muted)} .small{font-size:11px} .r{text-align:right}
  header{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
  #fname{font-size:15px;font-weight:700} #status{font-size:11px;color:var(--muted)}
  #chips{margin:6px 0;display:flex;flex-wrap:wrap;gap:5px}
  .idchip{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:1px 8px;font-size:11px;color:var(--lblue)}
  #sha{font-family:ui-monospace,monospace;font-size:10px;color:var(--muted);word-break:break-all}
  #desc{margin:4px 0 0;font-size:12px} #question{margin:2px 0 0;color:var(--yellow);font-size:12px}
  .strip{margin:10px 0;display:flex;align-items:center;gap:8px}
  #pbar{flex:1;height:8px;background:var(--border);border-radius:4px;overflow:hidden}
  .pfill{height:100%;width:0;background:var(--teal);transition:width .3s}
  .pfill.failed{background:var(--red)}.pfill.cancelled{background:#c586c0}.pfill.done{background:var(--teal)}
  #pdots{display:flex;gap:3px}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--border)}
  .dot.active{background:var(--blue)}.dot.done{background:var(--teal)}.dot.failed{background:var(--red)}.dot.skipped{background:#555}
  #pstage{font-size:11px;color:var(--muted)} #stale{display:none;color:var(--yellow);font-size:11px}
  .vcard{background:var(--panel);border-left:3px solid var(--teal);border-radius:4px;padding:8px 10px;margin:8px 0}
  .vtitle{font-weight:700;color:var(--teal)} .vreport{margin:4px 0;white-space:pre-wrap}
  details.sec{border:1px solid var(--border);border-radius:5px;margin:7px 0;background:var(--panel)}
  details.sec>summary{cursor:pointer;padding:7px 10px;font-weight:600;list-style:none;display:flex;align-items:center;gap:8px}
  details.sec>summary::-webkit-details-marker{display:none}
  details.sec>summary::before{content:"\\25B8";color:var(--muted);font-size:10px}
  details.sec[open]>summary::before{content:"\\25BE"}
  .count{background:var(--bg);border:1px solid var(--border);border-radius:9px;padding:0 7px;font-size:10px;color:var(--lblue);font-weight:400}
  .secbody{padding:4px 10px 10px}
  .fnmeta .sig{display:block;color:var(--yellow);font-family:ui-monospace,monospace;font-size:12px;margin-bottom:3px}
  .summary{font-family:ui-monospace,monospace;font-size:11px;margin-top:6px;max-height:300px;overflow:auto}
  .srow{display:flex;gap:8px;padding:1px 0} .srow .addr{color:var(--muted);min-width:82px}
  .srow.s-call .stext{color:var(--teal)} .srow.s-str .stext{color:var(--orange)} .srow.s-arg .stext{color:var(--lblue)}
  pre.asm{background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:8px;overflow:auto;font-size:11px;line-height:1.45;max-height:340px;white-space:pre}
  .a-call{color:var(--teal)} .a-str{color:var(--orange)}
  details.sub{margin-top:6px} details.sub>summary{cursor:pointer;color:var(--muted);font-size:11px}
  .evlist{display:flex;flex-direction:column;gap:4px}
  .evrow{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
  .lvl{font-size:10px;font-weight:700;border-radius:3px;padding:1px 6px}
  .lvl-called{background:rgba(78,201,176,.15);color:var(--teal)} .lvl-ref{background:rgba(86,156,214,.15);color:var(--blue)}
  .lvl-present{background:rgba(220,220,170,.15);color:var(--yellow)} .lvl-nf{background:rgba(133,133,133,.15);color:var(--muted)}
  .term{color:var(--lblue)} .site{font-size:11px}
  .chips{display:flex;flex-wrap:wrap;gap:4px} .chip{background:var(--bg);border:1px solid var(--border);border-radius:3px;padding:1px 6px;font-size:11px;font-family:ui-monospace,monospace;color:var(--fg)}
  .implib{margin:5px 0} .libname{font-family:ui-monospace,monospace;font-size:11px;color:var(--blue);margin-bottom:3px}
  table.tbl{width:100%;border-collapse:collapse;font-size:11px} .tbl th{text-align:left;color:var(--muted);font-weight:500;border-bottom:1px solid var(--border);padding:3px 6px}
  .tbl td{padding:2px 6px;border-bottom:1px solid #2a2a2a} .tbl .perm{color:var(--yellow)}
  .barcell{width:70px} .minibar{height:7px;background:var(--border);border-radius:3px;overflow:hidden} .minifill{height:100%;background:var(--blue)}
  button{font:inherit;padding:6px 10px;margin-top:10px;background:var(--panel);color:var(--fg);border:1px solid var(--border);border-radius:4px;cursor:pointer}
  </style></head><body>
  <header><span id="fname" data-testid="sba-fname">\u2026</span><span id="status" data-testid="sba-status">connecting</span></header>
  <div id="chips" data-testid="sba-chips"></div>
  <div id="sha" data-testid="sba-sha"></div>
  <div id="desc" data-testid="sba-desc"></div>
  <div id="question"></div>
  <div class="strip"><div id="pbar"><div class="pfill" id="pfill" data-testid="sba-pfill"></div></div><span id="pdots" data-testid="sba-pdots"></span><span id="pstage" data-testid="sba-pstage"></span><span id="stale"></span></div>
  <p class="muted small">Task <span class="mono" id="task" data-testid="sba-task">?</span></p>
  <div id="verdict" data-testid="sba-verdict"></div>
  <div id="body" data-testid="sba-body"></div>
  <button id="cancel" data-testid="sba-cancel" type="button">Cancel run (requires approval)</button>
  <script>${clientScript()}</script></body></html>`;
}

const server = new McpServer({ name: SERVER_NAME, version: "1.0.0" });

server.registerResource(
  "analysis",
  RESOURCE_URI,
  {
    title: TITLE,
    description: "IDA/Ghidra-style view of the current chat task's static binary analysis.",
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
  "get_analysis",
  {
    title: "Read analysis",
    description: "Return the static-binary-analysis document for a chat task.",
    inputSchema: { taskId: z.string().nullable().optional() },
    _meta: { ui: { resourceUri: RESOURCE_URI } },
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
