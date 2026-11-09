---
name: repo-analysis
description: Map an unfamiliar repository before auditing it — structure, stack, entry points and attack surface. Load before reviewing a codebase you have not seen.
---

# Repository recon before an audit

Scan the repository and produce the map an audit needs.

1. **Structure** — the top three levels of the tree; note generated, vendored and test directories so
   they can be excluded from findings.
2. **Stack** — primary languages, frameworks and the package manifests
   (`package.json`, `requirements.txt`, `go.mod`, `pom.xml`, `Gemfile`).
3. **Entry points** — HTTP routes, CLI commands, queue consumers, cron jobs, webhooks. These are the
   places untrusted input reaches the code.
4. **Trust boundaries** — where input crosses from outside to inside: request handlers, form parsers,
   file uploads, deserialisation, template rendering, shell calls.
5. **Secrets and configuration** — committed `.env` files, hardcoded keys, CI variables, and which
   config is loaded per environment.
6. **Existing controls** — auth middleware, validation layers, ORM usage, dependency scanning and
   lockfiles.

Output a short map with file paths, plus an explicit list of the entry points you found. When something
could not be established from the repository, say so instead of guessing.
