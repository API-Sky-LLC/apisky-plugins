---
name: github-pull-requests
description: List, read, open, review, and merge GitHub pull requests, including Copilot review. Load for a pull request, a diff, review comments, or merge readiness.
---

# Pull requests

## Read

`pull_request_read` takes `owner`, `repo`, `pullNumber`, and `method`:

| method | Returns |
|---|---|
| `get` | The pull request itself |
| `get_diff` | The diff |
| `get_files` | Files changed. Paginate |
| `get_commits` | Commits on the pull request |
| `get_status` | Combined status of the head commit |
| `get_check_runs` | Individual CI jobs on the head |
| `get_comments` | Conversation comments, not review threads |
| `get_reviews` | Reviews and their state |
| `get_review_comments` | Review threads. Thread ids look like `PRRT_...`. Paginate with `after` |

`list_pull_requests` filters with `state`, `base`, `head`, `sort`. Omit `body` from `fields` for a list.

`search_pull_requests` uses GitHub pull request search syntax in `query`, not the natural-language query that `search_issues` uses.

Read `get` and `get_check_runs` before you say a pull request is mergeable.

## Write

| Need | Tool |
|---|---|
| Open one. `title`, `head`, `base` are required. `draft` true leaves it draft | `create_pull_request` |
| Edit title, body, base, draft state, or reviewers | `update_pull_request` |
| Bring the branch up to date with base | `update_pull_request_branch` |
| Merge. `merge_method` is `merge`, `squash`, or `rebase`. Pass `expectedHeadSha` from `get` | `merge_pull_request` |
| A line comment on a pending review | `add_comment_to_pending_review` with `path`, `body`, `subjectType` |
| Reply or react to a review comment. `commentId` is the numeric id from a `#discussion_r` anchor, not the `PRRT_` thread id | `add_reply_to_pull_request_comment` |
| Create, submit, or delete a review, or resolve a thread | `pull_request_review_write` |

`pull_request_review_write` method `resolve_thread` and `unresolve_thread` need `threadId` from `get_review_comments`. For other review methods, use the method the tool lists. `event` is the review action: comment, approve, or request changes. Do not approve or request changes unless the person asked for that verdict.

Do not call `merge_pull_request` unless the person asked to merge that pull request.

## Copilot on a pull request

`request_copilot_review` asks Copilot to review. `create_pull_request_with_copilot` hands an issue to the Copilot coding agent, which opens its own pull request. Both are remote-server tools. Use them only when the person asked for Copilot, and say which one you called.
