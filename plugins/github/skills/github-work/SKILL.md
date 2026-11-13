---
name: github-work
description: Work in the signed-in GitHub account through the GitHub MCP server. Load when the person asks about repositories, issues, pull requests, files, or Actions on GitHub.
---

# GitHub

The `github` server is GitHub's hosted MCP endpoint. Sign-in is OAuth from the Capabilities panel. Do not ask the person to paste a token into the chat, and do not write a token into a file.

If a GitHub tool fails because the server is not signed in, stop and tell them to connect the `github` server. Do not switch to the `gh` command or a browser.

## What you may do

Read when they ask a question: repositories, files, issues, pull requests, reviews, and Actions.

Write only when they asked for that change in this conversation: open or comment on an issue, open or update a pull request, or push a file. Say what you are about to change, then do it. Do not merge, close, or delete unless they said to.

## How to answer

Name the repository as `owner/name` and include the issue or pull request you touched. If a tool returns nothing, say so. Do not invent issue numbers or file contents.
