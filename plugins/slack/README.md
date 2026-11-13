# Slack

Sign in to Slack, then search, read, and post in the workspace.

The pack points at Slack's hosted MCP server (`https://mcp.slack.com/mcp`). Connect the `slack` server from Capabilities. SkyCoder opens the Slack consent page and stores the token outside the plugin.

```text
Use the slack-work skill. What did the team say in #general today?
```

A message is sent only when you ask for that message. Slack allows this endpoint for a Marketplace app or an internal app, and it does not support dynamic client registration. If Connect cannot finish, the Slack app behind SkyCoder still has to be approved for that workspace.
