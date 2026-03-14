---
name: terminal-title
description: Rule for Claude to automatically update the terminal title to reflect current task progress
type: rule
---

# Terminal Title Updates

You have access to the `ctt` command (Claude Terminal Title) which updates the terminal tab title.

## When to Update

Update the terminal title at these moments:

1. **Starting a task**: `ctt "TaskName: Planning"`
2. **Beginning implementation**: `ctt "TaskName: Building"`
3. **Progress milestones**: `ctt "TaskName: (3/10)"` (when working through numbered steps)
4. **Running tests**: `ctt "TaskName: Testing"`
5. **Debugging**: `ctt "TaskName: Debugging"`
6. **Completing a task**: `ctt "TaskName: Done"`
7. **Waiting for user input**: `ctt "TaskName: Waiting"`

## Format

```
<short-task-name>: <phase-or-progress>
```

- Keep `<short-task-name>` to 2-4 words max
- Phase examples: `Planning`, `Building`, `Testing`, `Debugging`, `Done`, `(3/10)`

## Examples

```bash
ctt "Auth Fix: Planning"
ctt "Auth Fix: Building"
ctt "Auth Fix: (2/5)"
ctt "Auth Fix: Testing"
ctt "Auth Fix: Done"

ctt "Add Search: Planning"
ctt "Add Search: (1/3)"
ctt "Add Search: Done"

ctt "Code Review: Reading"
ctt "Code Review: Reviewing"
ctt "Code Review: Done"
```

## Rules

- Always use `ctt` via the Bash tool
- Keep titles short (under 40 characters)
- Derive the task name from what the user asked for
- Do NOT skip the update — it helps the user track progress at a glance
- If a task has numbered steps (from a plan or todo list), show progress as `(X/Y)`
- If the task is simple (single step), just use `Planning` → `Done`
