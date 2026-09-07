Delegate one bounded task to one named child: { agent, task }. Call { action: "list" } once per session for the managed roster; other management actions are status, interrupt, stop and steer.

- Every launch runs in the background under this session's policy and up to three children run at once: issue independent launches in the same turn, then continue independent work.
- Completion arrives as a native notification. Call bg_wait only when this turn cannot proceed without the result.
- Children start with fresh context: state objective, scope, files and output format in the task. Read-only roles cannot write.
- Not available here: workflowScript, workflowScriptPath, tasks, chain, and models outside the managed tiers.
