# ChatGPT ↔ Claude Code Bridge — Implementation Spec

Owner: Claude (project lead). Implementer: Codex.

## Goal

A private, local MCP server that lets a ChatGPT workspace agent (connected through an
OpenAI **Secure MCP Tunnel**, `tunnel-client` launching this server over **stdio**) do two things:

1. Talk to one dedicated Claude Code session about this project, asynchronously.
2. Inspect and edit files in this project itself, within strict path rules.

There is **no network listener**. The only transport is stdio. `tunnel-client` makes the
outbound connection to OpenAI; nothing on this Mac accepts inbound connections.

Relevant platform limits (from the OpenAI Secure MCP Tunnel docs): each tool call must finish
within **120 seconds** including queue time, and each payload must stay under **10 MiB**.

## Layout

```
bridge/
  package.json        # "type": "module", deps: @modelcontextprotocol/sdk, zod; scripts: start, test
  server.js           # MCP server entry (stdio)
  lib/config.js       # paths, env, limits
  lib/paths.js        # project path policy (resolve + deny rules)
  lib/files.js        # file tool implementations
  lib/session.js      # dedicated session id + lock
  lib/jobs.js         # job store, submit, status
  runner.js           # detached per-job runner that spawns Claude and writes the result
  test/               # node:test tests + fixtures/fake-claude.js
  README.md           # how to run, test, and the security model
.gitignore            # node_modules/ (append, don't clobber)
```

Use Node.js (v24 is installed), ESM, `@modelcontextprotocol/sdk` (current 1.x) and `zod`.
No other runtime dependencies unless clearly justified.

## Configuration (lib/config.js)

| Setting | Source | Default |
|---|---|---|
| Project root | `BRIDGE_PROJECT_ROOT` | the parent dir of `bridge/` (resolved with realpath) |
| State dir | `BRIDGE_STATE_DIR` | `~/.claude-chatgpt-bridge/amazon-ads-automation` (outside the project) |
| Claude binary | `BRIDGE_CLAUDE_BIN` | `~/.local/bin/claude` (absolute; do not rely on PATH) |
| Job timeout | `BRIDGE_JOB_TIMEOUT_MS` | 1,800,000 (30 min) |

Create the state dir with mode 0700. Log only to **stderr** (stdout is the MCP protocol).
Never log message text, file contents, or environment values.

## Tools

All tools return JSON text content. Errors are returned as MCP tool errors (`isError: true`)
with a short, specific message. Give every tool a clear description and zod input schema.

### 1. `bridge_health`
No input. Returns: bridge version, project root, state dir, Node version, whether the Claude
binary exists and is executable, `claude --version` output (5 s timeout), Claude auth summary
from `claude auth status` limited to the **`loggedIn` and `authMethod` fields only** (5 s timeout;
never return any other field), the dedicated session id, whether that session is busy (and the
running job id), and counts of jobs by status. Must never invoke a Claude model.

### 2. `claude_submit`
Input: `message` (string, 1–20,000 chars), `detail` (`"concise"` | `"detailed"`, default `"concise"`).
Returns immediately (well under 1 s) with `{ job_id, session_id, status }`.

- Rejects with a clear error if the dedicated session already has a running job
  (include the running job id). Never queue or run overlapping requests on the session.
- Creates the job record, acquires the session lock, then launches `runner.js <job_id>` with
  `child_process.spawn(process.execPath, [runnerPath, jobId], { detached: true, stdio: 'ignore', shell: false, env })`
  and `unref()`s it, so the job survives the MCP server process exiting.

### 3. `claude_job_status`
Input: `job_id` (validated format), `wait_seconds` (integer 0–60, default 0).
If `wait_seconds > 0`, poll the job file until it reaches a terminal state or the wait elapses
(keep total well under the 120 s tunnel deadline). Returns: status
(`queued` | `running` | `succeeded` | `failed` | `timed_out`), created/started/finished timestamps,
session id, `response` (Claude's result text, truncated to 50,000 chars with a `truncated` flag),
`is_error`, `cost_usd` if reported, and a short error summary on failure
(last ≤2,000 chars of stderr, with any line containing `key`, `token`, `secret`, `password`,
`authorization` or `bearer` (case-insensitive) replaced by `[redacted]`).
If the job is `running` but its runner pid is no longer alive, mark it `failed`
("runner exited unexpectedly") and release the lock.

### 4. `claude_list_jobs`
Input: `limit` (1–50, default 10). Returns recent jobs (id, status, timestamps, first 120 chars of
the message). No response bodies.

### 5. File tools (project-scoped)
- `project_list_files` — `path` (default `.`), `recursive` (default false), `max_entries` (default 500, max 2000). Hides denied entries.
- `project_read_file` — `path`, optional `start_line` (1-based), `max_lines`. Text files only, max 1 MiB. Return content plus total line count.
- `project_search` — `query` (literal string), optional `path`, `max_results` (default 100, max 500). Returns `file:line: text`. Skips denied paths, binaries, files > 1 MiB.
- `project_write_file` — `path`, `content` (max 2 MiB), `create_dirs` (default false). Create or overwrite. Write atomically (temp file + rename in the same directory).
- `project_edit_file` — `path`, `old_string`, `new_string`, `replace_all` (default false). Exact string match; error if not found; error if found more than once and `replace_all` is false. Atomic write.

No delete, move, chmod, or shell-execution tools.

## Path policy (lib/paths.js) — security critical

- Accept relative paths (relative to project root) or absolute paths. Reject empty paths and NUL bytes.
- Resolve lexically, then `realpath` the target (or, for a not-yet-existing file, its nearest existing
  ancestor). Both the lexical and the real path must be inside the project root's realpath. This
  blocks `..` traversal and symlink escapes.
- Deny (case-insensitive, checked against every path segment / basename of the real path relative to root):
  - `.git` (anything inside it), `node_modules` (for writes; hide from listings and search)
  - `.env`, `.env.*` (except `.env.example` and `.env.sample`)
  - `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.keystore`, `*.jks`, `id_rsa*`, `id_ecdsa*`, `id_ed25519*`
  - `.npmrc`, `.netrc`, `.pypirc`, `.aws`, `.ssh`, `.gnupg`, `.codex`, `.docker/config.json`
  - basenames containing `credential`, `secret`, or `token` and the exact names `auth.json`
  - the bridge state dir (in case it is ever configured inside the project)
- Writes and edits are additionally denied under `bridge/` and `.claude/`, and to `CLAUDE.md`
  (the remote agent must not be able to weaken this bridge or Claude's permission settings).
- Reads of text only: reject files containing NUL bytes in the first 8 KiB.
- Error messages say *which rule* blocked the path, never the file contents.

## Dedicated Claude session (lib/session.js) — correctness critical

- State file `<stateDir>/session.json`: `{ "session_id": "<uuid v4>", "started": false }`.
  Create it once with `crypto.randomUUID()`; never regenerate it automatically.
- Session lock `<stateDir>/session.lock`, created with `fs.openSync(path, 'wx')` (atomic), containing
  `{ job_id, runner_pid, acquired_at }`. Works across multiple bridge processes. Released by the runner
  when it finishes. A lock whose runner pid is dead is stale: mark that job `failed` and remove the lock.
- Never use `--continue`, `--fork-session`, or a bare `--resume` without an id.

## Runner (runner.js) — how Claude is invoked

Spawn Claude with `child_process.spawn(claudeBin, args, { cwd: projectRoot, shell: false, ... })`. The
message is **written to Claude's stdin** (never placed in argv, never interpolated into a shell string),
so messages starting with `-` cannot become flags. Arguments:

```
-p
--output-format json
--session-id <uuid>        # first run, when session.json has started=false
--resume <uuid>            # every later run
--permission-prompts none  # unattended: anything that would prompt is denied
--append-system-prompt <concise-or-detailed instruction>
```

- Concise instruction: "You are answering a remote agent through a bridge. Reply concisely: at most about
  150 words, no preamble, unless the request explicitly asks for more detail." Detailed: "Reply completely
  but without filler."
- **Preserve existing permission controls:** do not pass `--permission-mode`, `--allowedTools`,
  `--dangerously-skip-permissions`, `--add-dir`, `--settings`, or `--bare`. Claude uses the user's
  normal settings and login.
- Child environment: copy `process.env`, then **delete `CONTROL_PLANE_API_KEY` and every variable whose
  name starts with `OPENAI_` or `TUNNEL_`**. Apply the same scrubbing to the runner's own env when spawned.
- Capture stdout and stderr to files in `<stateDir>/jobs/`. On exit, parse stdout as JSON
  (`result`, `session_id`, `is_error`, `total_cost_usd`).
  - If the reported `session_id` is not exactly the dedicated id → job `failed` ("session id mismatch"),
    do **not** update session.json.
  - On a run where the reported session id matches, set `started: true` in session.json (atomic write).
  - Non-zero exit or unparsable output → `failed` with redacted stderr summary.
- Enforce the job timeout: send SIGINT, then SIGTERM after 10 s → `timed_out`.
- Write job records atomically (`<stateDir>/jobs/<job_id>.json`, temp + rename). Always release the lock
  in a `finally` path.
- Job ids: `job_` + 16 random hex chars; validate this format on every tool input.

## Tests (`npm test`, node:test) — must not invoke a real Claude model

Use `test/fixtures/fake-claude.js` (executable) via `BRIDGE_CLAUDE_BIN`, and a temp `BRIDGE_STATE_DIR`
and temp `BRIDGE_PROJECT_ROOT` per test. The fake records its argv, stdin, and env (names only) to a file,
supports a configurable delay, failure, and wrong-session-id mode, and prints Claude-style JSON.

Required cases:
1. Path policy: `..` escape, absolute path outside root, symlink pointing outside root, `.git/config`,
   `.env`, `.env.example` allowed, `id_rsa`, `foo.pem`, `my-secret.txt`, write to `bridge/x.js` denied,
   write to `CLAUDE.md` denied, reading a binary file rejected.
2. Edit: unique replace works; missing string errors; duplicate string errors without `replace_all`; `replace_all` works.
3. Submit returns quickly; status moves to `succeeded` with the fake's response.
4. First run uses `--session-id <uuid>`; second run uses `--resume <same uuid>`; neither uses `--continue`.
5. A second submit while the first is running is rejected and names the running job.
6. Message `--dangerously-skip-permissions` arrives on stdin, not in argv; argv never contains it.
7. `CONTROL_PLANE_API_KEY` and `OPENAI_API_KEY` set in the parent are absent from the fake's env.
8. Wrong-session-id output → `failed`, session.json unchanged.
9. Stale lock (dead pid) is recovered.
10. Timeout → `timed_out`.
11. MCP integration: start `server.js` with the SDK's stdio client, list tools (exactly the tools above),
    call `bridge_health`, `project_list_files`, and a submit/status round trip against the fake.

## Acceptance criteria

- `cd bridge && npm install && npm test` passes with all cases above.
- `node bridge/server.js` speaks MCP over stdio and opens no network port.
- No real `claude -p` invocation happened during development (only the fake).
- No changes outside `bridge/`, `.gitignore`, and nothing under `.git`. Do not touch `CLAUDE.md`,
  `connection-test.js`, or `docs/`.
- No commits, no pushes, no network calls other than `npm install`.
- `bridge/README.md` documents tools, path policy, session behaviour, env scrubbing, and how to run tests.
