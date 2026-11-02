---
name: graph-build
description: Install the Graphify CLI and build or refresh the knowledge graph of the current repository. Load when graphify-out is missing, when the graph is stale after big changes, or when the MCP server has no graph to serve.
---

# Build the graph

## Prerequisites

- Python 3.10 or newer. `uv` installs it for you.
- `uv` (recommended) or `pipx`:

```bash
brew install uv            # macOS
curl -LsSf https://astral.sh/uv/install.sh | sh   # Linux
uv --version
```

## Install the CLI (once per machine)

The PyPI package is **`graphifyy`** (double `y`); the command is `graphify`. Other `graphify*` packages on PyPI are unrelated.

```bash
uv tool install graphifyy             # CLI only
uv tool install "graphifyy[mcp]"      # + the MCP server this pack requires
```

If `graphify` is not found afterwards: `uv tool update-shell`, then open a new shell. With `pipx`, run `pipx ensurepath`.

Register the assistant skill only when the person asked for it — inside a repository use `--project` so the registration is reviewable:

```bash
graphify install --project
```

## Build

```bash
graphify .
```

(or `/graphify .` from an assistant where the skill is registered). Output lands in `graphify-out/`:

- `graph.json` — full graph, including `schema_version` and the Graphify release that produced it;
- `GRAPH_REPORT.md` — god nodes, communities, surprising connections, suggested questions;
- `graph.html` — the same graph, clickable in a browser.

Code is parsed locally with tree-sitter; no model is called for the code pass. Docs, PDFs and images need an extra
(`"graphifyy[pdf]"`, `"graphifyy[office]"`) and a configured backend — do not turn that on silently, it changes what
leaves the machine.

## When to rebuild

- the graph is older than the last commit that touched code the person is asking about;
- a query returns a symbol that no longer exists, or misses one that clearly does;
- the repository grew a new top-level directory that should be part of the map.

Rebuilding is cheap and local: prefer a rebuild over trusting a stale edge.

## What to commit

`graphify-out/graph.json` is a build artifact — commit it only if the repository already tracks generated files and
the person wants shared answers. `graph.html` is a viewer, not a deliverable. Never commit a graph that contains
paths or content from a checkout you should not publish.
