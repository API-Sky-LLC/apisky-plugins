---
description: Post one Slack message the person already worded, in a channel or thread they named
---

# /post-to-slack

Send one message. Do not also create a canvas or a list.

1. Load `slack-search` and resolve the channel id. A DM uses the user id from `slack_search_users`.
2. Load `slack-messages`. If they named a thread, use the parent `ts` from `slack-read`.
3. Show the channel and the exact text.
4. `slack_send_message` once, with `thread_ts` only when they asked to reply in the thread. Leave `reply_broadcast` false unless they asked the channel to see the reply.
5. Reply with the channel and the timestamp the tool returned. Do not send a second message.
