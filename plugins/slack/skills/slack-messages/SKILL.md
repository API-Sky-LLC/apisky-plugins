---
name: slack-messages
description: Send, draft, schedule, and react to Slack messages, and open a conversation. Load only when the person asked to post, reply, react, or DM.
---

# Messages

Resolve the channel id or user id before any send. See `slack-search`.

| Need | Tool |
|---|---|
| Post or reply | `slack_send_message` |
| Save a draft instead of sending | `slack_send_message_draft` |
| Send later | `slack_schedule_message` |
| Add an emoji | `slack_add_reaction` |
| Open a DM or a group DM | `slack_create_conversation` |

`slack_send_message` takes `channel_id` and `message`. `message` is markdown, at most 5000 characters. `thread_ts` replies in that thread. `reply_broadcast` also posts the reply in the channel. Leave it false unless they asked the channel to see it. `draft_id` deletes that draft after a successful send.

`slack_schedule_message` takes `post_at` as a Unix timestamp. It must be at least two minutes ahead and at most 120 days ahead. Say the clock time you scheduled, in the person's words, after the call returns.

`slack_add_reaction` needs the channel id, the message timestamp, and the emoji name without colons. Look the name up with `slack_search_emojis` when you are not sure it exists.

`slack_create_conversation` opens the conversation. It does not send the text. Send with `slack_send_message` afterwards, and only the text they asked to send.

Show the channel and the exact text, then call the tool once.
