# repo-analysis

Quick analysis of an unfamiliar repository: structure, stack, entry points.

This skill scans a code repository and produces:
- Directory tree (top 3 levels)
- Primary languages and frameworks detected
- Main entry points and configuration files
- Dependency listing (package.json, requirements.txt, etc.)
- Superficial security checklist (secrets, open TODOs, TODO markers)

Output is a concise summary suitable for including in a bot prompt or documentation.
