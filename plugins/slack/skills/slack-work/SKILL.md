---
name: slack-work
description: Read and post in the signed-in Slack workspace through the Slack MCP server. Load when the person asks about Slack channels, messages, threads, or people.
---

# Slack

The `slack` server is Slack's hosted MCP endpoint. Sign-in is OAuth from the Capabilities panel. Do not ask for a bot token, and do not write a token into a file.

If a Slack tool fails because the server is not signed in, stop and tell them to connect the `slack` server.

## What you may do

Read when they ask: search, channel history, a thread, a person.

Post, reply, react, or upload only when they asked for that message in this conversation. Quote the channel and the text you will send before sending it. Do not announce work to a channel on your own.

## How to answer

Use the channel name the person used. If a tool needs an id, resolve it from a list or a search first. Do not guess an id. If the search is empty, say so.
