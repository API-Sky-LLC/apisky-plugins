---
name: github-actions
description: List GitHub Actions workflows, runs, jobs, and artifacts, read logs, and dispatch a workflow. Load when the person asks why CI failed or to re-run a workflow.
---

# Actions

All three list and get tools take `owner`, `repo`, and `method`. `resource_id` changes meaning with the method.

## List (`actions_list`)

| method | resource_id |
|---|---|
| `list_workflows` | omit it |
| `list_workflow_runs` | a workflow id or file name such as `ci.yml`, or omit it to list every run. Filter with `workflow_runs_filter` |
| `list_workflow_jobs` | the run id. Filter with `workflow_jobs_filter` |
| `list_workflow_run_artifacts` | the run id |

## Read (`actions_get`)

| method | resource_id |
|---|---|
| `get_workflow` | workflow id or file name |
| `get_workflow_run`, `get_workflow_run_usage`, `get_workflow_run_logs_url` | the run id |
| `get_workflow_job` | the job id |
| `download_workflow_run_artifact` | the artifact id |

## Logs

`get_job_logs` returns one job when `job_id` is set. `failed_only` true with `run_id` returns every failed job in that run. `return_content` true returns the text. `tail_lines` keeps the end of a long log. Read the tail before you paste a log into the answer.

## Dispatch

`actions_run_trigger` method `run_workflow` needs `workflow_id` (id or file name) and `ref` (branch or tag). `inputs` is the workflow's input map. Other methods on this tool act on an existing `run_id`. Dispatch only when the person asked to run that workflow.

A red pull request check is often enough from `pull_request_read` method `get_check_runs`. Open Actions tools when they want the log or a re-run, not for a one-line status.
