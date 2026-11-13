---
name: slack-read
description: Read a Slack channel, thread, canvas, file, list, or profile after the id is known. Load when the person wants the contents, not just a search hit.
---

# Read

Search first if you only have a name. Then read.

| Need | Tool |
|---|---|
| Recent messages in a channel | `slack_read_channel` with the channel id |
| One thread | `slack_read_thread` with the channel id and the parent message timestamp |
| A canvas body | `slack_read_canvas` |
| A file | `slack_read_file` |
| A list and its records | `slack_read_list` |
| A person's profile | `slack_read_user_profile` |
| Who is in a channel | `slack_list_channel_members` |
| Channels the signed-in user is in | `slack_list_user_channels` |
| Reactions on a message | `slack_get_reactions` |

A thread timestamp is the parent message `ts` from search or from `slack_read_channel`. Do not invent one.

When you answer from a channel, name the channel and the message time. Quote the part that answers the question. Do not dump the whole history.

`slack_read_canvas` fails on a message. A canvas has its own id from search. `slack_read_file` is the file contents. An upload uses the message skill.
