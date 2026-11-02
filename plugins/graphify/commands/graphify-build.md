---
description: Build the code knowledge graph for the current repository and report what it found
---

# /graphify-build

Build (or refresh) the Graphify knowledge graph for this repository and answer from it.

1. Check `graphify-out/graph.json`. If it is missing or older than the newest source change, rebuild it with
   `graphify .` (install the CLI first — see the `graph-build` skill).
2. Read `graphify-out/GRAPH_REPORT.md` and report, in this order:
   - the god nodes (the concepts everything flows through),
   - the communities, one line each, with what they hold,
   - the connections it flagged as surprising.
3. Do not paste the whole report. Summarize it and point at the file: `graphify-out/GRAPH_REPORT.md`, and at
   `graphify-out/graph.html` for the interactive view.
4. If the person asked a question with the command, answer it with `graphify query "<question>"` and cite the
   source location of every node you use, with its `EXTRACTED` / `INFERRED` tag.
5. Close with one line on freshness: the graph was built now, or it is N commits behind and can be rebuilt.
