---
description: Open a GitHub issue in a repository the person names, from the signed-in account
---

# /open-issue

Open one issue. Do not also open a pull request.

1. Load `github-account` if `owner` is not known, then `github-issues`.
2. Confirm `owner/repo` and the title. If the person did not give a title, ask. Do not invent a repository.
3. `list_issue_types` when the repository uses types. `search_issues` with the title words. If a close match is already open, show it and stop.
4. `issue_write` method `create` with the title, a body that states the problem and the expected result, and only labels that `list_label` already lists.
5. Reply with the issue number and URL from the tool. Do not close or assign anyone unless they asked.
