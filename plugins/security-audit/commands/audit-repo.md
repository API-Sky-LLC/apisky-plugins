---
description: Run a security audit over a repository and report ranked findings
---

# /audit-repo

Audit the repository the human names (a path in the workspace, or a URL they have cloned).

1. Load the `repo-analysis` skill and map the repository first: entry points, trust boundaries, stack.
2. Apply the `compliance-check` rule across the code that handles untrusted input. Read the actual
   handlers, not just the file list.
3. Check secrets properly: committed `.env` files, keys in source, credentials in CI config, and
   whether any secret is reachable from a client bundle.
4. Check dependencies: advisories for the pinned versions, and whether a lockfile exists and matches
   the manifest.
5. For every finding, trace the input from its entry point to the sink, so the report says whether it
   is reachable or only latent.

Report a table ordered by severity — `severity`, `file:line`, `category`, `what an attacker gets`,
`the fix`. Then a short list of what you could not verify. Never report a pattern as a vulnerability
without the path that reaches it.
