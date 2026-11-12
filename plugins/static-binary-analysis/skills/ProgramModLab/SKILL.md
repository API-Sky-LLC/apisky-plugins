---
name: ProgramModLab
description: Change what an existing program does — copy it into the workspace, understand it with static analysis, then patch the copy and/or build companion code, and run the result to check it. Works on copies only; the original is never modified or executed. Windows programs build with csc.exe and run through WSL interop.
version: 1.0.0
---

# Program modification lab

Use this when the Human wants an existing program to behave differently. Only
modify software the Human owns or is authorized to change, and only for their own
local use.

`LAB` means the bundled `labtool.sh` listed under **Bundled Files** below.
`INSPECT` means the `inspect.sh` of the `StaticBinaryAnalysis` skill: it is the
sibling file `../StaticBinaryAnalysis/inspect.sh` next to this skill's folder.
Call both by absolute path through the real `exec` tool.

**Precondition: you need `exec`.** Every `LAB` and `INSPECT` command runs through the
`exec` tool, which the `EditTools` skill provides. If you do not already have `exec`,
your first action is to emit `<skill EditTools/>` and nothing else, then proceed. If a
command fails with a message about a missing or disabled exec/shell plugin (for example
`mcp-shell-exec`), the fix is still `<skill EditTools/>` — never substitute a shell MCP,
a hunter, `browser_run_code_unsafe`, or any other code-execution path, and never write
memory-only turns while blocked. If you truly cannot get `exec`, `<chat>` the Human.

| Command | Purpose |
|---|---|
| `LAB doctor` | Work root, WSL interop, `csc.exe`, `dotnet`, `mingw`. |
| `LAB copy '<original>' <name>` | Copy into `work/<name>/` (writes `ORIGIN.json`). The only way to obtain a modifiable file. |
| `LAB patch-string <file> <old> <new> [auto\|utf16\|ascii]` | In-place string patch: exactly one occurrence, new not longer than old, NUL-padded. Keeps `<file>.orig`. |
| `LAB patch-bytes <file> 0x<offset> <new-hex> <expected-old-hex>` | Raw patch; refuses unless the current bytes equal the expected ones. |
| `LAB diff <file>` | Every changed byte versus `.orig`. |
| `LAB build-cs <out.exe> [--winexe] <src.cs>...` | Compile C# with the .NET Framework 4 compiler (C# 5 syntax). |
| `LAB decompile-net <assembly> work/<name>/src` | Decompile a managed (.NET) assembly to a compilable C# project with ilspycmd. |
| `LAB dotnet <args...>` | Run the .NET SDK (`dotnet build`/`run`) on a project under `work/`. |
| `LAB run <exe> [args]` | Run a console program in its folder with a timeout; prints exit code, stdout, stderr. |
| `LAB wait-file <path> [seconds]` | Poll for a side-effect marker (for the end-to-end test); fails if it never appears. |
| `LAB launch <exe> [args]` | Start a GUI program on the Windows desktop and return immediately. |
| `INSPECT manifest\|inventory\|decompile\|verify ...` | Read-only analysis (see the StaticBinaryAnalysis skill). |

## Definition of done (read first)

The deliverable is **the Human's own program, modified**: after your change, running
the copy of the *original file* must itself produce the new behavior. Shipping a
separate new program that the Human runs *instead* of the original does NOT satisfy
the request, even if that program is correct and well tested.

- The modified copy of the original (`work/<name>/<originalfilename>`) **must differ
  from the original** — `LAB diff` must show at least one changed byte, or the copy
  must have been recompiled from recovered/edited sources. A byte-identical copy is
  an automatic failure.
- You MUST prove it end to end: **run the patched copy of the original** (not a
  companion) and observe the new behavior through a side effect you can check with
  `LAB wait-file` or `LAB run` output. A companion's own `--selftest` is necessary
  but never sufficient.
- If you conclude the requested change is not achievable this way, stop and tell the
  Human why, with evidence, and propose options. Do not silently substitute a
  lookalike.
- You are **not done** until (a) the modified copy ran and the marker proved it, and
  (b) a fresh `reports/<name>.md` for *this* target exists. Stopping right after a
  successful rebuild, with no run-proof and no report, is an incomplete task.

## Rules

- **Originals are read-only.** Never modify, move, rename, or execute a file
  outside `work/`. `LAB` enforces this for its own commands. Do not bypass it with
  `cp`, `dd`, `sed`, editors, or by running originals directly.
- Write new source files only under `work/<name>/`.
- Facts about the program come from INSPECT output. If the program does not contain
  the logic to change (for example a launcher stub), say so with evidence, then
  change what it *does* contain so the program's own behavior changes (see below).
- A patch is not done until INSPECT confirms it on the copy: the manifest still
  parses, and `verify`/`decompile` shows the code now uses the new data.
- Never type tool output you have not seen. If a command fails, report the exact
  error and fix the cause. Run all `LAB` commands from the workspace root and give
  paths relative to it (e.g. `work/<name>/file`); the work root is fixed by the
  workspace, so do not `cd` into `work/` to shorten paths. Outputs always go under
  `work/`.

## Strategies by program type

Read `kind` from the manifest and follow that row. A native binary (C, C++, or any
other compiled PE/ELF/Mach-O whose `kind` is `native`) is a normal target. Never
tell the Human this lab only supports .NET, and never run `LAB decompile-net`,
`ilspycmd`, or `dotnet` unless `kind` is `dotnet`.

- **Native program** (`kind` is `native`): the change is a patch of the copy, not a
  rebuild from recovered C++. `INSPECT decompile` (rizin) finds the function,
  string, or branch; `LAB patch-string` or `LAB patch-bytes` changes it. These
  tools do not produce a compilable C++ project. If a byte patch cannot express
  the requested change, stop and say so with the decompile evidence. Do not
  substitute a .NET program.
- **Logic is in the binary** (native function, constant, string, branch): patch it
  in place with `LAB patch-string`/`patch-bytes`. The patched copy carries the
  new behavior directly.
- **Launcher / thin stub** (its job is to start or call something else — e.g. a
  `ShellExecuteW`/`CreateProcess`/`exec` of a URI, path, or command): build a
  companion that performs the new behavior, then **patch the stub's target in the
  copy** so the copy launches your companion instead of the original target. Running
  the patched copy must now reach the companion. This is the only sanctioned use of a
  companion: as the payload the modified original now invokes — never as a replacement
  the Human runs themselves.
  - The patched target string cannot be longer than the original (in-place limit), and
    an absolute path almost never fits. So name the companion to fit the budget (for a
    14-byte target, `RomanCalc.exe` is 13), put it in the **same folder as the patched
    copy**, and patch the stub to that **bare relative filename**. A bare name resolves
    against the launcher's working directory, which is its own folder on double-click.
    Never patch to a path that does not exist (e.g. a truncated `C:\Temp\...`); verify
    with `INSPECT verify`/`decompile` that the copy now references the real name.
- **Managed .NET program** (`kind` is `dotnet`): this is the cleanest "change the
  real logic" route, and recompiling is the goal — do NOT fall back to a companion or a
  lookalike for a managed program that decompiles. Concrete recipe:
  1. `LAB decompile-net <copy> work/<name>/src` produces a compilable C# project.
  2. Edit the recovered source to change the behavior.
  3. **Inject a startup side-effect marker into the recovered source** before you
     rebuild (see the marker bullet below) — the rebuilt program is now a program you
     build, so it gets a marker just like a companion would. For GUI put it on form
     load / in `Main` before `Application.Run`; for console put it at the top of `Main`.
  4. Rebuild over the copy's own filename (`work/<name>/<originalfilename>`) so the
     deliverable is the original, recompiled: single-file → `LAB build-cs`
     (`--winexe` for GUI), otherwise `LAB dotnet build work/<name>/src`.
  5. **Prove it**: `LAB launch` (GUI) or `LAB run` (console) the rebuilt copy, then
     `LAB wait-file` the marker. No marker appearing means no proof — fix it, do not
     report success. Then `LAB launch` once more and ask the Human what they see.
  This genuinely modifies the program's own code, not a stub redirect. Note: a
  decompiled real-world app may need its original references/resources to rebuild or to
  run standalone; if the rebuild or run fails on missing dependencies, report exactly
  what is missing rather than faking success — never quietly downgrade to a companion.
- **Match the original's modality.** Check the original's subsystem from `INSPECT`
  (`subsys` / `kind`). If the original is a **GUI** program, the companion must also be
  a GUI program so the Human gets a window, not a console. A console companion for a GUI
  original is a failure. For Windows GUI companions build with
  `LAB build-cs <out> --winexe <src.cs> -- /reference:System.Windows.Forms.dll /reference:System.Drawing.dll`
  and drive it with WinForms (`Application.Run(form)`), not `Console.*`. Build a console
  companion only when the original was itself a console program.
- Give any program you build an observable **startup side effect** written next to its
  own executable (use the program's own module directory, e.g. WinForms
  `Application.StartupPath`, not the current directory) — for example a `started.marker`
  file written on form load — so the end-to-end test can confirm it was reached. This
  applies to **any program you compile: a companion you author AND a decompiled program
  you edit and recompile** (add the marker to the recovered source before rebuilding).
  GUI programs never exit on their own: test them with `LAB launch` (not `LAB run`)
  followed by `LAB wait-file` on that marker.

## Workflow

1. **Plan.** Restate the behavior change and name the end-to-end check that will
   prove the *patched original* shows it.
2. **Copy.** `LAB doctor`, then `LAB copy '<original>' <name>`.
3. **Understand.** On the copy: `INSPECT manifest`, `inventory`, `decompile`,
   `verify`. Locate exactly where behavior lives (function, call site, string, file
   offset) and decide the strategy above.
4. **Make the change** on the strategy that matches `kind` (all paths add a startup marker):
   - *Native* (`kind` is `native`, including C and C++): `LAB patch-string`/`patch-bytes`
     on the copy, or the launcher/companion path when it is only a stub. Never
     `decompile-net`.
   - *Managed .NET* (only when `kind` is `dotnet`): `LAB decompile-net`, edit the
     recovered source, inject the marker, then rebuild over the copy's own filename.
   - *Launcher / companion*: `LAB build-cs` the companion + `LAB run ... --selftest`,
     give it the marker, then patch the stub's target in the copy.
   Then `LAB diff` the copy (must be non-empty), and re-run INSPECT to confirm the copy
   parses and carries the change.
5. **Prove end to end.** Clear any old marker, then run the **modified copy of the
   original** itself (`LAB run` for console, `LAB launch` for GUI — never only a
   companion), then `LAB wait-file` the side-effect marker. If it never appears, the
   chain is broken — fix it; do not report success.
6. **Show the Human.** For GUI programs, after the end-to-end check passes, `LAB launch`
   the modified copy and ask what they see.
7. **Report, then finish.** You are not done until `reports/<name>.md` exists for *this*
   task. Write it in its own response (never reuse or leave a stale report from a
   different target — the report's name and original sha256 must match this run's
   `ORIGIN.json`), then `<done Human>`. It must cover:
   - the files in `work/<name>/` and the original's sha256 (from `ORIGIN.json`);
   - every byte change (`LAB diff`) — confirm it is non-empty, or note the copy was
     recompiled from edited sources;
   - the end-to-end `wait-file` result that proves the modified copy itself reached the
     new behavior (plus any companion self-test, which alone is not sufficient);
   - how to undo: delete `work/<name>/`; the original was never touched.
