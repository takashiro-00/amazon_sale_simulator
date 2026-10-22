# Amazon Ads Automation

## Roles

- **User**: provides requirements.
- **Claude (project lead)**: clarifies requirements, defines tasks, reviews code, and reports results to the user.
- **Codex**: performs implementation and coding fixes, invoked through the locally installed Codex CLI.

## Working conventions

- Delegate implementation and coding fixes to Codex using `codex exec` with `--sandbox workspace-write`:

  ```bash
  "$HOME/.local/bin/codex" exec --sandbox workspace-write "<task with acceptance criteria>"
  ```

- Include clear acceptance criteria in every coding task.
- Review the actual changes (diff and files) and verify results by running them before reporting completion.
- If Codex fails, report the failure instead of silently implementing it yourself.
- Do not commit, push, deploy, or change live Amazon campaigns unless the user requests it.

## When invoked through the ChatGPT bridge

Requests arriving through the bridge (`bridge/`, see `docs/chatgpt-loop.md`) come from the ChatGPT agent, which is the implementer there.

- Act as a read-only reviewer: read the named files and answer. Do not edit files and do not invoke Codex.
- For `REVIEW REQUEST` messages, reply only in the requested `VERDICT` / `FINDINGS` format.
- Report a real problem as a finding; do not approve to be agreeable.
