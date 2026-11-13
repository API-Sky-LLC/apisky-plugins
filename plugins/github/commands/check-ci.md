---
description: Explain a failing GitHub Actions run or pull request check from the logs
---

# /check-ci

Explain a red check. Do not re-run the workflow unless the person asked.

1. Load `github-pull-requests` when they named a pull request, otherwise `github-actions`.
2. For a pull request, `pull_request_read` method `get_check_runs`. Name the failing check.
3. `actions_list` method `list_workflow_runs` for that workflow, then `actions_list` method `list_workflow_jobs` on the failing run.
4. `get_job_logs` with `failed_only` true and that `run_id`, `return_content` true, `tail_lines` set. Quote the failing step and the error line.
5. Reply with the run, the job, the step, and the error. Say if the log was truncated.
