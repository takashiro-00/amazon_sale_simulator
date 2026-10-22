# ChatGPT-Driven Development Loop

Playbook for the ChatGPT agent working on this project through the **Claude Code Bridge** MCP plugin.

## Roles

| Who | Does |
|---|---|
| User | Gives requirements, approves anything risky. |
| ChatGPT agent (you) | Plans, implements, runs checks, fixes, reports. |
| Claude (via `claude_submit`) | Reviews your changes and answers project questions. Read-only reviewer. |

## The loop

1. **Start.** Call `bridge_health`. Stop and tell the user if `claude_executable` is false, `auth.loggedIn` is false, or `busy` is true with no job of yours running.
2. **Plan.** Restate the requirement as 2–5 acceptance criteria. Read the relevant files (`project_list_files`, `project_search`, `project_read_file`) before editing. Ask the user only if a requirement is genuinely ambiguous.
3. **Implement.** Use `project_write_file` / `project_edit_file`. Add or update tests under `test/` as `*.test.js` (Node's built-in `node:test`, no new dependencies unless the user approves).
4. **Check.** Call `project_list_checks`, then `project_run_check` (normally `project-tests`). Fix failures and rerun until green. Never weaken or delete a test to make it pass.
5. **Review.** Call `claude_submit` with `detail: "concise"` and a message in the review format below. Then call `claude_job_status` with `wait_seconds: 60`, repeating until the status is no longer `queued`/`running`.
6. **Address review.** If the verdict is `CHANGES_REQUESTED`, fix the findings, rerun checks, and request one more review. Stop after **3 review rounds** and report what is unresolved.
7. **Report** to the user: what changed (files), check results, Claude's final verdict, the job ids, and anything left open.

## Review request format

```
REVIEW REQUEST
Goal: <one sentence>
Acceptance criteria:
1. ...
Files changed: <path>, <path>
Checks: <check name> -> exit <code>
Reply in this format only:
VERDICT: APPROVE | CHANGES_REQUESTED
FINDINGS: numbered list of "<file>:<line> – <problem> – <fix>", or "none"
```

## Rules

- One Claude job at a time; never submit while a job is running.
- Do not commit, push, deploy, or call Amazon Advertising APIs or change live campaigns unless the user explicitly asks in this chat.
- Never put credentials in files, messages, or tool inputs. Protected paths (`.env`, keys, `.git`, `bridge/`, `.claude/`, `CLAUDE.md`) are blocked by design — do not try to work around them.
- Keep Claude messages short and specific; it replies concisely by default.
- If a bridge tool errors, report the exact error to the user instead of guessing.
