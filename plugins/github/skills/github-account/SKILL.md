---
name: github-account
description: Signed-in GitHub identity, teams, users, orgs, and the notification inbox. Load when the person says "my repos", "who am I", a username, a team, or their notifications.
---

# Account, people, notifications

The server is `https://api.githubcopilot.com/mcp/x/all`. Sign-in is OAuth on the `github` server.

Start here whenever `owner` is not already known.

| Need | Tool |
|---|---|
| Signed-in login, name, and id | `get_me` (no arguments) |
| Teams the user belongs to | `get_teams`. Members of one team: `get_team_members` with `org` and `team_slug` |
| A person by name or login | `search_users` |
| An organization by name | `search_orgs` |
| Labels, assignees, milestones, branches, reviewers for a picker | `ui_get` with `method`, plus `owner` and `repo` when the method needs them |

## Notifications

| Need | Tool |
|---|---|
| Inbox | `list_notifications` |
| One thread | `get_notification_details` |
| Mark one done | `dismiss_notification` |
| Mark the whole inbox read | `mark_all_notifications_read` |
| Watch or ignore a thread | `manage_notification_subscription` |
| Watch or ignore a repository | `manage_repository_notification_subscription` |

`mark_all_notifications_read` clears the inbox. Do it only when the person asked to mark notifications read.

Report the login from `get_me` before you talk about "my" repositories. A team slug is not a display name: take it from `get_teams`.
