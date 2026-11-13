---
name: github-projects
description: Read and update GitHub Projects, and read or comment on Discussions. Load for a project board, a project item, or a discussion thread.
---

# Projects and discussions

## Projects

| Need | Tool |
|---|---|
| Boards for a user or org | `projects_list` |
| One project, its fields, items, or a view | `projects_get` |
| Create a project, add or update items, set a field, write a status update | `projects_write` |

`projects_write` updates a field with `{"name": "Status", "value": "..."}` or `{"id": 123, "value": ...}`. A null value clears the field. On a single-select field, the name form takes the option's name. The id form takes the option id. Read the field with `projects_get` before you invent an option name.

A status update uses `projects_write` method `create_project_status_update` with `status`, optional `target_date` (`YYYY-MM-DD`), and a title when the method requires one. Do not post a status the person did not ask to publish.

## Discussions

| Need | Tool |
|---|---|
| Categories in the repo | `list_discussion_categories` |
| Threads | `list_discussions`, then `get_discussion` |
| Comments on one thread | `get_discussion_comments` |
| Add or edit a comment | `discussion_comment_write` |

Pick a category from `list_discussion_categories`. Do not invent a category name. Comment only when the person asked to post in that discussion.
