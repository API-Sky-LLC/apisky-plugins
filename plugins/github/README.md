# GitHub

Sign in to GitHub, then read and change repositories, issues, pull requests, and Actions.

The pack points at GitHub's hosted MCP server (`https://api.githubcopilot.com/mcp/`). Connect the `github` server from Capabilities. SkyCoder opens the GitHub consent page and stores the token outside the plugin. No personal access token is required.

```text
Use the github-work skill. List my open pull requests.
```

Writes (a new issue, a comment, a push) happen only when you ask for that change. The server itself is GitHub's, under the MIT license at github/github-mcp-server. This pack does not vendor that code.
