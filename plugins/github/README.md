# GitHub

Sign in to GitHub, then use the full hosted toolset.

The server is `https://api.githubcopilot.com/mcp/x/all` ([remote toolsets](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md)). Connect `github` from Capabilities. The token stays outside this pack.

| Skill | What it calls |
|---|---|
| `github-account` | `get_me`, teams, `search_users`, the notification inbox |
| `github-repos` | search, file contents, branches, commits, releases, gists |
| `github-issues` | list, search, read, create, comment, sub-issues, labels |
| `github-pull-requests` | diff, files, reviews, merge, Copilot review |
| `github-actions` | workflows, runs, jobs, logs, dispatch |
| `github-security` | code scanning, Dependabot, secret scanning, advisories |
| `github-projects` | Projects and Discussions |

`/open-issue`, `/open-pull-request`, and `/check-ci` run those flows. The `github-writes` rule blocks merge, delete, and closing unless you asked.

The tools come from GitHub's MIT-licensed server, [github/github-mcp-server](https://github.com/github/github-mcp-server). This pack does not vendor that code.
