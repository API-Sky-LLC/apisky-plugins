# Static Binary Analysis

Read-only reverse engineering of a program file, plus a lab that changes a copy of it.

`StaticBinaryAnalysis` is the Lead. It spawns two threads:

- **Scout** (`GoalInventory`) inventories the file.
- **Analyst** (`GoalDecompile`) disassembles the entry point and its callees, then verifies the finding.

`ProgramModLab` copies the program into `work/` and changes that copy. A native binary (C, C++, any PE/ELF/Mach-O that is not .NET) is patched in place. A managed .NET assembly can be decompiled and rebuilt. The original file is never executed or modified.

```text
Use the StaticBinaryAnalysis skill. Analyze '<path>'. Question: What does it do at startup?
```

`inspect.sh doctor` reports missing tools. `rizin` is recommended for native disassembly. .NET decompilation needs `ilspycmd`.
