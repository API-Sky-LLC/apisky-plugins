---
name: slack-search
description: Search Slack messages, files, channels, people, and emoji. Load when the person asks what was said, who owns a channel, or to find a person in Slack.
---

# Search

Search is the way in. Do not guess a channel id or a user id.

| Need | Tool |
|---|---|
| Public channels only | `slack_search_public` |
| Public, private, DMs, and group DMs the user can see | `slack_search_public_and_private` |
| A channel by name or description | `slack_search_channels` |
| A person | `slack_search_users` |
| An emoji name | `slack_search_emojis` |

`query` takes Slack search modifiers: `in:#channel`, `from:@user`, `before:`, `after:`. Put the person's words in the query. Do not drop the channel they named.

`slack_search_public_and_private` accepts `channel_types`: `public_channel`, `private_channel`, `mpim`, `im`. Leave it unset to search all of them. Use the public tool when they said the conversation is public, so a private hit does not leak into the answer by accident.

`limit` defaults to 20 and stops at 20. Pass `cursor` for the next page. `sort` is `score` or `timestamp`. `content_types` is `messages`, `files`, or both.

Meaning search needs Slack AI Search (Business+ or Enterprise+). On other plans the same tools run keyword search. If the result is empty, say the query matched nothing. Do not widen into private channels unless they asked.

`include_bots` defaults to false. Turn it on only when they asked about a bot.
