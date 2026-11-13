---
description: Search Slack and answer from the messages, with the channel and time
---

# /find-in-slack

Answer one question from Slack. Do not post anything.

1. Load `slack-search`. If the person named a channel, add `in:#that-channel` to the query.
2. Use `slack_search_public` when they said the conversation is public. Otherwise use `slack_search_public_and_private`.
3. If a hit is only a title, load `slack-read` and read the thread or the canvas before you answer.
4. Reply with the channel, who wrote it, and the time, then the part that answers the question. If nothing matched, say the query and that it returned nothing.
