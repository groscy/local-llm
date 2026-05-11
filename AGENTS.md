# Agent Workflow Rules

All coding agents must follow this branching and merge workflow for every task:

1. Create or switch to a feature branch from `main` before making changes.
2. Never commit directly to `main`.
3. Use a descriptive feature branch name, for example: `feature/<short-task-name>` or `fix/<short-task-name>`.
4. Complete the task on that feature branch, then push the branch.
5. Open a merge request (pull request) targeting `main` when the task is finished.
6. Include a short summary and test notes in the merge request description.
