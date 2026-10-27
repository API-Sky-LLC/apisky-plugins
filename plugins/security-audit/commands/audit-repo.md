# audit-repo

Run a security audit on a code repository.

## Usage

\`\`\`bash
security-audit <repository-path-or-url>
\`\`\`

## What it checks

- Hardcoded secrets (API keys, passwords, tokens) using regex patterns
- SQL injection risks (raw string concatenation in SQL queries)
- OWASP Top 10 compliance (see compliance-check rule)
- Common vulnerability patterns (XSS, path traversal, insecure headers)
- Dependency vulnerability signals (outdated lock files)

## Output

A structured report with:
- Severity-ranked findings
- File locations and line numbers
- Remediation suggestions
- OWASP category for each finding
