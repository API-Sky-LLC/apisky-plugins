---
name: github-repos
description: Find repositories, read files and history, branch, commit, release, fork, and manage gists on the signed-in GitHub account. Load for code search, file contents, commits, branches, tags, or releases.
---

# Repositories, files, history

Name every repository as `owner/repo`. Take `owner` from the person or from `get_me`.

## Find and read

| Need | Tool |
|---|---|
| Repositories by name or description | `search_repositories` |
| Code across files | `search_code` |
| Commits by message or author | `search_commits` |
| One file or a directory listing | `get_file_contents`. For a directory, set `fields` to `name` and `type` unless you need more |
| A tree without file bodies | `get_repository_tree` |
| One commit. `detail` is `none`, `stats`, or `full_patch` | `get_commit` |
| History | `list_commits` |
| Branches, tags | `list_branches`, `list_tags`, `get_tag` |
| Latest release, a tag's release, all releases | `get_latest_release`, `get_release_by_tag`, `list_releases` |
| Who has access | `list_repository_collaborators` |
| Starred repos, star, unstar | `list_starred_repositories`, `star_repository`, `unstar_repository` |

`ref` on `get_file_contents` accepts `refs/heads/<branch>`, `refs/tags/<tag>`, and `refs/pull/<number>/head`. `sha` wins over `ref` when both are set. `full_patch` on `get_commit` is large. Use `stats` unless the person asked for the diff.

## Write

| Need | Tool |
|---|---|
| New branch off the default, or off `from_branch` | `create_branch` |
| One file. Content is plain text, not base64 | `create_or_update_file` with `branch`, `path`, `content`, `message`. If the file exists, pass `sha` from `get_file_contents` on that same branch |
| Several files in one commit | `push_files` |
| Remove a file | `delete_file` with `branch`, `path`, `message` |
| New repository. Omitted `private` means private | `create_repository` |
| Fork. `organization` forks into that org | `fork_repository` |
| Delete the repository | `delete_repository` |

`create_or_update_file` and `delete_file` need the `workflow` scope when the path is under `.github/workflows`. Say so if the call is rejected for scope, and do not retry with a different path to sneak the same change in.

Do not call `delete_file` or `delete_repository` unless the person asked to delete that path or that repository.

## Gists

`list_gists`, `get_gist`, `create_gist`, `update_gist`. A gist is not a repository. Do not use gist tools for `owner/repo` files.
