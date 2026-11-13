# Slack

Sign in to Slack, then search, read, and post with the hosted server's tools.

The server is `https://mcp.slack.com/mcp` ([Slack MCP server](https://docs.slack.dev/ai/slack-mcp-server/)). Connect `slack` from Capabilities. The token stays outside this pack.

| Skill | What it calls |
|---|---|
| `slack-search` | public and private search, channels, users, emoji |
| `slack-read` | channel history, threads, canvases, files, lists, profiles, reactions |
| `slack-messages` | send, draft, schedule, react, open a conversation |
| `slack-canvas` | create and edit canvases, upload files, edit list records |

`/find-in-slack` answers from search and does not post. `/post-to-slack` sends one message. The `slack-sends` rule refuses a send the person did not ask for.

Slack allows this endpoint for a Marketplace app or an internal app, and it does not support dynamic client registration. If Connect cannot finish, the Slack app behind SkyCoder still has to be approved for that workspace.
