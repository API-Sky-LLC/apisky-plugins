---
name: repo-analysis
description: Work through an unfamiliar repository — structure, stack, entry points. Load before answering questions about an unfamiliar codebase.
---

# Repository analysis

1. Read `README`, the package manifest and the scripts (`Makefile`, `package.json`, `pyproject.toml`).
2. Find the entry points: `main`, `index`, `bin`, the framework config, docker-compose.
3. Map the modules: what imports what, where the cycles are, where the layer boundaries sit.
4. List what the repository does not have: tests, migrations, CI, a linter.

Answer with files and paths (`src/app/main.ts:12`), not with a retelling of the code.
