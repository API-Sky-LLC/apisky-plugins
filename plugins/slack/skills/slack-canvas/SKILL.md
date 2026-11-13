---
name: slack-canvas
description: Create and update Slack canvases, upload files, and add or edit list records. Load when the person wants a canvas, a file in Slack, or a Slack list.
---

# Canvases, files, lists

## Canvases

| Need | Tool |
|---|---|
| Read | `slack_read_canvas` |
| Create from Markdown | `slack_create_canvas` with `title` and `content` |
| Change an existing canvas | `slack_update_canvas` |

Canvases cannot be created on a free Slack plan. If the call fails for that reason, say so and stop. Do not paste the canvas into a channel instead unless they ask.

Read the canvas before `slack_update_canvas`. Do not replace a canvas you have not read.

## Files

| Need | Tool |
|---|---|
| Read | `slack_read_file` |
| Start an upload | `slack_get_file_upload_url` |
| Finish an upload | `slack_complete_file_upload` |

Get the URL, upload the bytes to that URL, then complete. Do not mark the upload complete before the bytes are sent. Search for an existing file with `slack_search_public` or `slack_search_public_and_private` and `content_types` `files` before uploading a duplicate.

## Lists

| Need | Tool |
|---|---|
| Read a list | `slack_read_list` |
| Create | `slack_create_list` |
| Change the list | `slack_update_list` |
| Add a row | `slack_add_list_record` |
| Change a row | `slack_update_list_record` |

Read the list before you add or update a record, so the field names match the columns that exist. Do not invent a column.
