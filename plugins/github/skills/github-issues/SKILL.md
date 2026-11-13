---
name: github-issues
description: List, search, read, create, and update GitHub issues, comments, sub-issues, and labels. Load when the person asks about an issue, a bug, a task on GitHub, or labels.
---

# Issues

`owner` and `repo` are required on every call below except `search_issues`, where they only narrow the query.

## Read

| Need | Tool and method |
|---|---|
| Issues in one repo. Filter with `state`, `labels`, `since` | `list_issues`. Omit `body` and `field_values` from `fields` when you only need titles |
| Issues by words, including across repos | `search_issues`. `query` is natural language, not GitHub search syntax. Do not join alternatives with `OR` |
| One issue | `issue_read` method `get`. Also returns parent and sub-issue flags |
| Comments | `issue_read` method `get_comments` |
| Child issues | `issue_read` method `get_sub_issues` |
| Parent issue | `issue_read` method `get_parent` |
| Labels on that issue | `issue_read` method `get_labels` |
| Types enabled for the repo | `list_issue_types` |
| Custom fields | `list_issue_fields` |
| One label definition, or all of them | `get_label`, `list_label` |

`list_issues` returns open and closed when `state` is omitted. Pass `state` when the person said "open".

## Write

`issue_write` method `create` opens an issue. `title` is required. Optional: `body`, `labels`, `assignees`, `milestone`, `type`, `issue_fields`. Set `parent_issue_number` to create it already attached to a parent. Do not combine `parent_issue_number` with `issue_fields`.

`issue_write` method `update` changes an existing issue. `issue_number` is required. `state` plus `state_reason` closes or reopens it. `duplicate_of` is required when `state_reason` is `duplicate`. Closing is a write the person has to ask for.

| Need | Tool |
|---|---|
| Comment, or a reaction when `body` is omitted | `add_issue_comment` |
| Edit a comment you can identify | `update_issue_comment` |
| Attach, detach, or reorder a sub-issue | `sub_issue_write` method `add`, `remove`, or `reprioritize` |
| Create or edit label definitions | `label_write` |

`sub_issue_write` takes `sub_issue_id`, which is not the issue number. Read the child with `issue_read` first. To move a child to a new parent, `add` with `replace_parent` true. There is no separate parent field.

`add_issue_comment` also comments on a pull request when you pass that number. For review comments on a diff, use the pull request skill instead.
