---
name: StaticBinaryAnalysis
description: Static, read-only reverse engineering of any program file (Windows PE/EXE/DLL 32/64-bit, Linux ELF, macOS Mach-O, .NET, Java JAR/class, APK/zip) to answer a question about what it does, with call-level evidence. Lead orchestrates two SELF threads (inventory + decompile). Never executes the target.
version: 1.0.0
---

# Static binary analysis

Answer a question about a program file using static inspection only. Only analyze
software the Human owns or is authorized to inspect.

`INSPECT` below means the bundled `inspect.sh` script listed under **Bundled Files**
at the end of this skill. Always call it by that absolute path through your exec
tool. It accepts Linux paths and Windows paths (`C:\...`).

| Command | Purpose |
|---|---|
| `INSPECT doctor` | Tool check. JSON with `missingRequired`, `missingRecommended`, `install` hints. |
| `INSPECT manifest '<path>'` | Canonical target JSON: `target`, `description`, `analyzers`, `missingTools`. |
| `INSPECT inventory '<path>'` | Sections, libraries, imports, exports, entry points, strings. |
| `INSPECT decompile '<path>' [function]` | Main (or the given function/class) as annotated disassembly or bytecode, plus direct callees. |
| `INSPECT verify '<path>' <term>...` | One line per term: `CALLED`, `REFERENCED`, `PRESENT`, or `NOT_FOUND`, with call sites. |

Exit code 3 means "unsupported for this format or a tool is missing"; the stderr
line says which tool and how to install it.

## Hard rules

- Never execute, write, move, or rename the target. Never open it with read,
  magic, or any file-content tool: it is binary. Inspect it only through INSPECT
  (or `file`, `stat`, `sha256sum`, `strings`, `objdump`, `readelf`, `rizin -q` piped
  through `head`). The target may be outside the workspace; read-only inspection
  there is permitted.
- Facts come only from real tool output in this run. Never invent hashes, sizes,
  addresses, or output. Never type a tool call or its output as plain text. A
  response that calls exec contains no event, chat, spawn, or done; the initial
  `Task` memory tag is the only allowed companion.
- Never hard-code a filename, product, import, or expected behavior.
- A claim in the final report needs a `verify` line. `CALLED`/`REFERENCED` support
  behavior claims; `PRESENT` supports only "the file contains X"; `NOT_FOUND`
  claims are removed or reported as "not determined".
- One task runs one analysis. After `complete/*` is emitted, never restart it.

## Event contract `sba.v1`

Every machine-readable update is exactly one fenced `analysis-event` block holding
one JSON object. `target` is copied verbatim from the manifest's `target` object
and never changes during the run.

```analysis-event
{
  "schema": "sba.v1",
  "runId": "the-run-id",
  "target": {"path": "...", "name": "...", "format": "...", "kind": "...", "arch": "...", "bits": 64, "size": 0, "sha256": "..."},
  "agent": "Lead|Scout|Analyst",
  "stage": "intake|inventory|decompile|finding|verification|complete",
  "status": "started|completed|failed|unsupported",
  "data": {}
}
```

- A tool error is `status: "failed"` with the exact error in `data.error`; an
  unsupported format or missing tool is `status: "unsupported"` with
  `data.reason`. Never substitute invented output.
- Keep each excerpt below 8,000 characters.
- `Lead` events: `intake`, `complete`. `Scout`: `inventory`. `Analyst`:
  `decompile`, `finding`, `verification`. Emit only your own role's events.

## Roles

You are the **Lead** when no Goal section is assigned to you. You are a **child**
when the system assigns you `GoalInventory` (role `Scout`) or `GoalDecompile`
(role `Analyst`). Children never chat, done, or spawn.

### Lead

1. From the task, take the target path, the question, and the run id (use the
   one given; otherwise create `sba-<UTC yyyymmddThhmmss>-<4 random chars>`).
2. If exec is not loaded, emit only `<skill EditTools/>`. Then, in one response,
   run `INSPECT doctor` and `INSPECT manifest '<path>'`.
3. If the manifest failed (missing file) or `doctor.ok` is false: emit
   `intake/failed` and `complete/failed` with the error and the `install.required`
   hint, then `<done Human>` explaining what to fix. Stop.
4. Emit `intake/completed` with `data`: `question`, `description`, `analyzers`,
   `missingTools`.
5. If `target.format` is `unsupported`, emit `complete/unsupported` with the file
   description as the reason, then `<done Human>`. Do not spawn.
6. Otherwise, in that same response, write:
   - `<memory RunContext>`: run id, the exact manifest JSON, the INSPECT absolute
     path, the question.
   - `<memory GoalInventory>`: "Perform the Scout role of StaticBinaryAnalysis for
     RunContext."
   - `<memory GoalDecompile>`: "Perform the Analyst role of StaticBinaryAnalysis
     for RunContext."
   - `<memory ContextNextSteps>`: "Validate GoalInventoryResults and
     GoalDecompileResults, verify the report terms, emit complete, done."

   then exactly one
   `<spawn SELF GoalInventory GoalDecompile skills='StaticBinaryAnalysis,EditTools'/>`.
7. When the joined thread return arrives, read Scout events only from the
   `GoalInventoryResults` section of the `GoalInventory` child and Analyst events
   only from `GoalDecompileResults` of the `GoalDecompile` child. Reject any event
   whose `runId` or `target` differs or whose role/stage does not match. Never copy
   or re-emit a child event.
8. If a child status is not OK, or a required event (`inventory`, `decompile`,
   `finding`, `verification`) is missing or not `completed`, emit
   `complete/failed` (or `complete/unsupported` when the child reported
   `unsupported`) with the exact reason and `<done Human>`. Stop.
9. Write the answer. Run `INSPECT verify '<path>' <term>...` with every import,
   API, function, class, and string the answer names (one exec call, nothing else
   in that response). Drop or downgrade claims per the hard rules.
10. Emit `complete/completed` with `data`: `report` (short evidence-backed answer
    to the question), `pseudocode` (Analyst's excerpt or a summary of it),
    `evidence` (list of `{term, level, site}` from your verify output),
    `limitation` (one string). Then `<done Human>` with the report, and, if
    `missingTools` is not empty, one line per missing tool saying what it would
    add and its install hint from `doctor.install`.

### Scout (GoalInventory)

1. Use only `RunContext`. In one response run `INSPECT manifest '<path>'` and
   `INSPECT inventory '<path>'`, nothing else.
2. If the manifest `target` differs from RunContext, put an `inventory/failed`
   event (`data.error`: the differing fields) in the Results section and return
   ERROR.
3. Write `<memory GoalInventoryResults>` containing exactly one
   `inventory/completed` event with `data`: `fileDescription`, `sections`
   (`{name,size}`, max 24), `libraries` (max 30), `imports` (`{library,functions}`,
   max 20 libraries / 30 functions), `exports` (count and max 20 names),
   `entryPoints`, `strings` (max 30 that matter for the question), `commands`.
4. In the same response return with `<end_thread OK GoalInventoryResults/>`. On
   failure or unsupported, put that event in the section and use
   `<end_thread ERROR GoalInventoryResults/>`.

### Analyst (GoalDecompile)

1. Use only `RunContext`. In one response run `INSPECT manifest '<path>'` and
   `INSPECT decompile '<path>'`, nothing else. If the manifest differs from
   RunContext, return ERROR with a `decompile/failed` event.
2. If decompile exits 3, put a `decompile/unsupported` event with the stderr line
   as `data.reason` in the section and return `<end_thread ERROR GoalDecompileResults/>`.
3. If the selected function is a start-up stub, or the question points elsewhere,
   you may run one more `INSPECT decompile '<path>' <function>` on a callee.
4. Prepare `decompile/completed` with `data`: `tool` (the `=== tool ===` line),
   `function`, `selection` (the `note:` line, if any), `pseudocode` (string,
   annotated excerpt), `callees`, `limitation` (one string; disassembly or bytecode
   is not source).
5. Prepare `finding/completed` with `data`: `summary`, `confidence`
   (`low|medium|high`), `evidence` (`{kind: import|function|string|address, value}`).
6. Run `INSPECT verify '<path>' <term>...` with every import, function, and string
   in the finding (one exec call, nothing else in that response). Drop
   `NOT_FOUND` terms from the finding.
7. Write `<memory GoalDecompileResults>` with the `decompile/completed`,
   `finding/completed`, and `verification/completed` events in that order.
   `verification.data.checks` is the list of real verify output lines.
8. In the same response return with `<end_thread OK GoalDecompileResults/>`; on a
   blocking failure use `<end_thread ERROR GoalDecompileResults/>`.

## Kickoff

```text
Use the StaticBinaryAnalysis skill. Analyze '<path>'. Question: <question>
Run id: <run-id>
```
