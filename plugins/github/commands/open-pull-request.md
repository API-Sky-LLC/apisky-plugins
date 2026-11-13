---
description: Open a pull request from a branch that already exists on GitHub
---

# /open-pull-request

Open one pull request from an existing head branch. Do not create commits from this command.

1. Load `github-pull-requests`.
2. Confirm `owner/repo`, the head branch, and the base branch. Read the head with `list_commits` if the person did not name the range.
3. `search_pull_requests` for an open pull request from that head. If one exists, return it and stop.
4. `create_pull_request` with a title, a body that lists what changed, and `draft` true only if they asked for a draft.
5. Reply with the pull request number. Do not merge it and do not request a review they did not name.
