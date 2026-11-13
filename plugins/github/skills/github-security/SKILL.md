---
name: github-security
description: Read GitHub code scanning, code quality, Dependabot, secret scanning, and security advisories for a repository. Load when the person asks about vulnerabilities, leaked secrets, or dependency alerts.
---

# Security alerts

These tools read GitHub's alert records. They do not scan the working tree. Say that when you report.

| Need | Tool |
|---|---|
| Code scanning alerts. Filter with `state`, `severity`, `tool_name` | `list_code_scanning_alerts`, then `get_code_scanning_alert` |
| One code quality finding | `get_code_quality_finding` |
| Dependabot alerts | `list_dependabot_alerts`, then `get_dependabot_alert` |
| Secret scanning alerts | `list_secret_scanning_alerts`, then `get_secret_scanning_alert` |
| A published advisory | `list_global_security_advisories`, `get_global_security_advisory` |
| Advisories filed on this repository | `list_repository_security_advisories` |
| Advisories across an organization's repositories | `list_org_repository_security_advisories` |

Default `state` for code scanning is open. Say the state you filtered on.

For each alert you report, keep the number GitHub returned, the state, the severity, and the file or dependency it names. Do not upgrade a dismissed alert into an open one. Do not claim a secret value. The alert's path and type are enough. If the list is empty, say the filter returned nothing, not that the repository is safe.
