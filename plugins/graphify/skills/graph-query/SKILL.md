---
name: graph-query
description: Answer architecture and code questions from the Graphify knowledge graph instead of grepping. Load when the question is about how things connect, who calls what, or where a concept lives across many files.
---

# Query the graph, do not re-read the tree

`graphify` parses the repository with tree-sitter (deterministic, no model) and writes three artifacts:

```
graphify-out/
├── graph.json          the graph itself — query it, never load it whole
├── GRAPH_REPORT.md     god nodes, communities, surprising connections
└── graph.html          the same graph as a clickable page
```

If `graphify-out/graph.json` does not exist, build it first — see the `graph-build` skill.

## Pick the cheapest tool that answers the question

| Question shape | Use | Cost |
|---|---|---|
| "where does X live", "what is X connected to" | `graphify explain "X"` | one symbol |
| "how are A and B related", "why does this import that" | `graphify path "A" "B"` | one path |
| "how does auth work", "where is retry handled" | `graphify query "<question>"` | one scoped subgraph |
| "what does the project look like at all" | read `GRAPH_REPORT.md` first | one file |
| "which files matter for this change" | `graphify query` / report's god nodes | one call |

Only after a graph query comes back empty or clearly irrelevant do you fall back to `grep`, `glob` and reading files. Say so when you do: "the graph has no node for X, grepping instead".

## Read the confidence tag before you trust an edge

Every edge is tagged:

- **EXTRACTED** — explicit in the source (import, call, inheritance, `mix_in`). Treat as fact.
- **INFERRED** — resolved by Graphify heuristics across files. Treat as a lead: confirm the file and line the node reports before asserting it to the user.

When you report a relationship, carry the tag with it. Turning an INFERRED edge into a flat statement is how an architecture answer becomes wrong.

## What the graph does and does not know

- **Knows**: symbols, files, cross-file calls and imports, detected communities, `# NOTE:` / `# WHY:` comments and ADR/RFC citations linked to the code they explain.
- **Does not know**: runtime behaviour, feature flags, database state, anything outside the parsed tree
  (generated code is parsed as text), and it is a **snapshot**: a graph built before the last commit describes
  the code as it was. If the answer contradicts what is on disk, the graph is stale — rebuild it (see
  `graph-build`) rather than bending the code to the graph.

## Answering

1. Quote the node's source location (`path` and line) — that is the evidence the person can check.
2. Prefer a short ordered list of hops over prose: `handler --calls--> service --imports--> repo`.
3. When the graph gives you a community, name it: "all of this lives in the `auth` cluster", which is usually the answer a person actually wanted.
4. If the question spans several repositories, the local graph cannot answer it — say so instead of guessing.
