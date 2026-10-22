# Local Claude MCP bridge

Requires Node.js 24+. Install and run:

```sh
cd bridge
npm install
npm start
```

Configure your Secure MCP Tunnel's stdio launch command as `node /absolute/path/to/bridge/server.js`.
The tunnel makes the outbound connection; the bridge only uses stdio and creates no network listener.
Stdout is reserved for MCP. Diagnostics belong on stderr and must never include messages, file contents, or environment values.

Configuration:

| Environment variable | Default |
| --- | --- |
| `BRIDGE_PROJECT_ROOT` | Real path of the parent of `bridge/` |
| `BRIDGE_STATE_DIR` | `~/.claude-chatgpt-bridge/amazon-ads-automation` |
| `BRIDGE_CLAUDE_BIN` | `~/.local/bin/claude` (must be absolute) |
| `BRIDGE_JOB_TIMEOUT_MS` | `1800000` (30 minutes) |

The state directory is created with mode 0700; state and subprocess output files are private. Keep it outside the project. It contains the durable session id, exclusive session lock, job JSON records, and stdout/stderr captures. Jobs and captures persist until manually removed by the local owner; tool responses never expose raw captures.

## Tools

Every result is JSON text. Tool failures set `isError: true`.

| Tool | Inputs / behavior |
| --- | --- |
| `bridge_health` | No inputs. Version, paths, Node, Claude availability/version, filtered auth (`loggedIn`, `authMethod`), session, busy job and job counts. Runs only `--version` and `auth status`, each with a 5 second timeout. |
| `claude_submit` | `message` (1–20,000 characters), `detail` (`concise` or `detailed`). Immediately returns a job id; rejects overlapping requests with the busy job id. |
| `claude_job_status` | `job_id`, `wait_seconds` (0–60). Timestamps, status, response up to 50,000 characters, truncation flag, error and reported cost. |
| `claude_list_jobs` | `limit` (1–50, default 10). Recent metadata and first 120 characters of messages; no responses. |
| `project_list_files` | `path` (`.`), `recursive` (false), `max_entries` (500, at most 2000). Protected entries hidden. |
| `project_read_file` | `path`, optional 1-based `start_line`, `max_lines`. Content and total line count; text up to 1 MiB. |
| `project_search` | Literal `query`, optional `path`, `max_results` (100, at most 500). `file:line: text` strings; skips protected paths, binary files and files over 1 MiB. Output is also bounded below the tunnel's 10 MiB limit. |
| `project_write_file` | `path`, `content` (up to 2 MiB UTF-8), `create_dirs` (false). Atomic create or overwrite. |
| `project_list_checks` | No inputs. Returns each check’s name, description, cwd and timeout in seconds. |
| `project_run_check` | `name` only. Runs an allowlisted check synchronously; returns exit code, signal, timeout status, duration and redacted stdout/stderr tails. |
| `project_edit_file` | `path`, nonempty `old_string`, `new_string`, `replace_all` (false). Exact match, error on missing/ambiguous matches; atomic write. |

## Security and sessions

Both lexical paths and resolved filesystem paths must stay inside the project's real path. Existing symlinks and the nearest existing ancestor of new paths are checked. Relative and absolute paths are accepted; empty and NUL-containing paths are rejected. Checks apply to both the requested name and the resolved target, preventing aliases from exposing protected files.

Protected paths (case insensitive): `.git`, secret environment files (except `.env.example` / `.env.sample`), private key extensions (`pem`, `key`, `p12`, `pfx`, `keystore`, `jks`), `id_rsa*`, `id_ecdsa*`, `id_ed25519*`, `.npmrc`, `.netrc`, `.pypirc`, `.aws`, `.ssh`, `.gnupg`, `.codex`, `.docker/config.json`, `auth.json`, any segment containing `credential`, `secret`, or `token`, and the configured state directory. `node_modules` is hidden from listings/search and cannot be written. Writes also reject `bridge/`, `.claude/`, and `CLAUDE.md`. Binary reads are rejected when the first 8 KiB contains NUL. The bridge exposes no free-form shell, deletion, move, or chmod tool.

A UUID v4 is created once in `session.json` and is never automatically regenerated. The first valid run uses `--session-id <id>`; subsequent runs use `--resume <id>`. Session-id mismatches fail without updating session state. Requests never overlap: an atomic exclusive lock works across bridge processes. A dead runner's stale lock is recovered and its job marked failed. A detached runner survives the submitting server's exit and releases its lock in its final cleanup.

Messages are sent exclusively through stdin. Claude runs with the project's working directory, `shell: false`, JSON output and `--permission-prompts none`. The user's normal settings and login remain in effect: no permission-mode override, allowed-tools override, bypass, extra directory, alternate settings or bare mode is passed. Concise replies request about 150 words unless explicitly asked for more; detailed replies request complete answers without filler.

Both runner and Claude environments remove `CONTROL_PLANE_API_KEY` and all names beginning `OPENAI_` or `TUNNEL_`. Failed jobs return only a short stderr tail: entire lines mentioning key, token, secret, password, authorization or bearer (case insensitive) are replaced with `[redacted]`. Timeout sends SIGINT, then SIGTERM after 10 seconds if still running.

## Tests

```sh
cd bridge
npm test
```

Tests use temporary project/state directories and the executable `test/fixtures/fake-claude.js`; they never run a real Claude model. The fixture records argv, stdin and environment **names only**, and supports delayed, failed, malformed and wrong-session responses. The integration test uses the SDK's stdio client. Timeout escalation deliberately adds about 10 seconds to the suite. No real Claude CLI invocation is needed to develop or test this bridge.

As with other local file tools, the project filesystem and state directory must be controlled by the local user; these checks are not an OS sandbox against a malicious local process changing filesystem components concurrently.

## Start / stop

The scripts in `bridge/scripts/` manage the tunnel separately from Claude job runners:

```sh
bridge/scripts/store-tunnel-key.sh
bridge/scripts/set-tunnel-id.sh tunnel_YOURID
bridge/scripts/start-bridge.sh --dry-run
bridge/scripts/start-bridge.sh
bridge/scripts/status-bridge.sh
bridge/scripts/stop-bridge.sh
```

Copy the OpenAI key to the macOS clipboard, then run `store-tunnel-key.sh`. It reads the clipboard with `pbpaste`, strips surrounding whitespace, and requires an `sk-` prefix and at least 40 characters. Invalid input produces an error without printing the value. It stores the item under service `openai-tunnel-amazon-ads-bridge` for `$USER`, clears the clipboard after storage, and prints only `Stored key (<N> characters)`. This avoids the interactive Keychain prompt's 128-character input limit. Do not pass the key as an argument or environment variable. Start reads that item and supplies `CONTROL_PLANE_API_KEY` only to the tunnel process; it never prints the key. Dry-run prints the command with `<from-keychain>` and does not read Keychain or start a process.

The tunnel executable defaults to `~/.local/opt/tunnel-client/v0.0.16/tunnel-client-runtime`; override it with `BRIDGE_TUNNEL_BIN`. All scripts use `BRIDGE_STATE_DIR` (default `~/.claude-chatgpt-bridge/amazon-ads-automation`) for the private tunnel ID, `tunnel.pid`, `tunnel.log`, and `tunnel-health.sock`. Start resolves Node and `bridge/server.js` to absolute paths, waits up to 15 seconds for the tunnel PID, and reports the log path. A live recorded PID makes start a no-op.

Health uses a Unix socket and opens no TCP port. Status checks `/healthz` and `/readyz` with five-second timeouts, then prints the last 20 log lines, replacing lines containing key, token, secret, authorization, or bearer (case-insensitive) with `[redacted]`. Stop signals only the recorded tunnel PID, waits up to ten seconds after SIGTERM, and uses SIGKILL if needed. Repeated stops are safe; detached Claude job runners keep running.

If an initial Claude run reports that the dedicated session ID is already in use, the job fails with `Session already existed; resubmit to resume it`. The bridge atomically marks that same session started, so the next submit uses `--resume` with the original ID.

## Adding a check

Edit `bridge/checks.json` locally to add a named check. Each entry has a name matching
`^[a-z0-9-]+$`, a project-relative `cwd`, an `argv` array starting with an absolute,
executable binary path, a `timeout_seconds` integer from 1 to 100, and a description.
The bridge validates the allowlist at startup and applies its existing path policy
to working directories. Remote file tools cannot modify `bridge/`, including this
allowlist. `BRIDGE_CHECKS_FILE` overrides the allowlist file for local tests.

Then restart from `bridge/`:

```sh
scripts/stop-bridge.sh && scripts/start-bridge.sh
```

Checks run without a shell or stdin, using the same environment scrubbing as Claude.
An exclusive `check.lock` in the state directory rejects overlapping checks across
bridge processes and recovers dead owners. Timeout sends SIGTERM to the detached
process group, then SIGKILL after three seconds, including surviving descendants.
A check call takes at most its configured timeout plus three seconds of cleanup
(normally at most 103 seconds), within the 120 second tunnel deadline. Each output
tail retains at most 20,000 characters; sensitive lines use the same redaction as
Claude stderr. Checks are trusted local programs, not an OS sandbox.
