# Rounds for Hermes

How a note pinned on the canvas reaches the Hermes session that made the post, at once.

## How it works

1. A Hermes session posts with `rounds_post`. The `post_tool_call` hook (`hooks/hermes.mjs`) writes the
   session id, the profile and `agent: "hermes"` into `posts/<id>.json`.
2. You pin a note. The canvas writes `comments.json` and, with `"relay": "hermes"`, `inbox/<id>.json`.
3. The relay (`rounds relay`) sees the file and first checks that the session is not mid-turn (see
   "A busy session" below). When it is idle, the relay claims it (`sent/<id>.json` = `queued`, with its pid), and runs

   ```
   hermes -p <profile> chat --resume <session> -Q -q "<message>"
   ```

   That is one turn in the stored session: the note is a user message in the same conversation (same
   session id, rows appended to that profile's `state.db`). The message has the shape of `relay/RELAY.md`,
   plus the note id and an instruction to answer with `rounds_reply`.
4. Exit 0: `sent/<id>.json` = `delivered` and the inbox file is removed; the canvas turns the pin into a check.
   Anything else: `sent/<id>.json` = `failed` with the reason, and the inbox file stays.

Why `hermes chat --resume`: it needs no Hermes config, runs under whichever profile owns the session, and
keeps the note in the real conversation. The desktop app's own socket (`/api/ws`) needs a per-launch token
Hermes does not hand out, and the API server (`/api/sessions/<id>/chat`) needs a gateway platform and key
set up in the Hermes config. See `mechanism.md` in the notes folder for the comparison.

## Wiring a profile

`node bin/rounds.mjs hermes snippet` prints, with this checkout's paths:

```yaml
mcp_servers:
  rounds:
    command: /opt/homebrew/bin/node
    args: [/path/to/rounds-hermes/bin/rounds.mjs, mcp]
    enabled: true
hooks:
  post_tool_call:
    - matcher: (mcp_+)?rounds_+rounds_(post|change)
      command: /opt/homebrew/bin/node /path/to/rounds-hermes/hooks/hermes.mjs
      timeout: 10
  pre_llm_call:
    - command: /opt/homebrew/bin/node /path/to/rounds-hermes/hooks/hermes.mjs
      timeout: 10
```

Things learned the hard way:

- **The hook matcher is a full match** on the tool name (`mcp__rounds__rounds_post`), not a search.
- **Consent.** Hermes skips a shell hook that is not on the profile's allowlist. Run
  `hermes -p <profile> --accept-hooks -z "OK"` once per profile after adding or changing a hook command
  (or approve at a CLI prompt), then check with `hermes -p <profile> hooks list`.
- **Changing only a hook's matcher** can leave the running gateway with the hook unregistered. Change the
  command too (for example an extra env var) or restart the gateway.
- **MCP servers** added to a profile are picked up by the running gateway on its own (it reconciles); the
  relay and the canvas read the same `ROUNDS_HOME`, so give the MCP server and the hooks the same one if you
  do not use `~/.rounds`.
- Every profile that should post needs the snippet. The relay needs nothing per profile: it reads the
  profile from the post.
- Debug a binding that did not happen: `touch ~/.rounds/hook-debug`, post again, read
  `~/.rounds/hook-debug.log` (keys and types of what Hermes sent, never contents).

## Running the relay

```bash
node bin/rounds.mjs relay                 # foreground
node bin/rounds.mjs relay launchd install # launchd agent dev.rounds.hermes-relay (RunAtLoad + KeepAlive)
node bin/rounds.mjs relay launchd remove
node bin/rounds.mjs relay status          # alive, pid, inbox size
node bin/rounds.mjs relay retry <id>      # send a failed note again
```

`relay.json` in the data folder is its heartbeat (every 5 s). One relay at a time: a second one exits.

## What happens when it goes wrong

| Case | Result |
| --- | --- |
| Session deleted, archived or unknown (`Session not found`) | `failed`, `permanent`, note stays in the inbox, pin says why. No retry loop. |
| Post never tied to a session (not posted from a hooked Hermes session) | `failed`, retried a few times with backoff in case the hook is about to bind it. |
| `hermes` errors or the turn does not finish in 10 minutes | `failed` with the last lines of output, retried with backoff (10 s, 30 s, 90 s, 5 min, 15 min), then left. |
| Relay stopped or killed while delivering | On restart the note is marked `failed` ("not sent again in case it arrived"), never re-sent on its own. `rounds relay retry <id>` sends it. |
| Relay not running | The note waits in the inbox. The fallback hook brings it in with the session's next message (once). |
| Relay restarted after delivery | Nothing is re-sent: the `delivered` record wins over any inbox file. |
| Session mid-turn (your open chat is answering, or another relay turn is running) | Not sent. `sent/<id>.json` = `waiting` with the reason, the pin says "Waiting for … to finish its current turn", the inbox file stays. Re-checked every 3 s; sent as soon as the turn ends. Uses no retry attempts. |
| Session still busy after 30 minutes | `failed`, `permanent` (no loop), reason says so; `rounds relay retry <id>` sends it. |
| Two notes for one session | One at a time, oldest first. The later one is `waiting` ("another note for this session is being delivered first") until the earlier turn is over. Not batched: each note keeps its own turn and its own `rounds_reply`. |
| Relay restarted while a note waits | Still `waiting` (nothing was sent, so nothing can be duplicated); the wait keeps its start time, so the 30 minute ceiling is honest. |

## A busy session

The relay asks Hermes itself, read-only (`server/busy.mjs`). Hermes keeps a durable per-conversation turn
lease in `state.db`, table `session_turn_leases` (`conversation_id`, `holder`, `acquired_at`, `expires_at`):
every turn (desktop, CLI resume, gateway) takes it before it loads the history and releases it after the
flush, and renews it every 60 s (TTL 300 s). Sources, Hermes 0.23.3: `agent/turn_facade_lease.py`
(`LEASE_TTL_SECONDS`), `persistence/sqlite/authority/coordination.py` (`try_acquire_turn_lease`),
`persistence/sqlite/conversation/_store/compression.py:620` (the key is the lineage root).

Busy means: an unexpired lease row on the session or one of its compression ancestors, whose `pid=<n>`
holder is not provably dead (the same rule Hermes uses to reclaim a lease). Read from the profile's
`state.db` and the default `~/.hermes/state.db`, opened read-only. Only if the table does not exist (older
Hermes) a conservative heuristic applies: newest message under 30 s old, or a user/tool row with no reply
under 120 s old. A database that exists but cannot be read counts as busy. A session that is not in the
database counts as idle: `hermes` answers "Session not found" itself.

Limit: the check and the start of `hermes chat` are not one atomic step. If you send a message in that
fraction of a second, Hermes' own lease makes the second turn wait for the first (it never interleaves), but
the relay's 10 minute turn timeout still applies. `ROUNDS_BUSY_RECHECK_MS` and `ROUNDS_BUSY_MAX_MS` override
the 3 s and 30 min (tests). `ROUNDS_HERMES_HOME` overrides `~/.hermes`.

A relay turn runs in the session while you may have it open in the desktop app. The turn is written to
the same `state.db`; whether the open chat shows the new rows without reopening it was not verified.

## Not Claude

`rounds init` prints the Hermes steps; `rounds init --claude` is the original Claude Code setup. The
`claude` topic sorter never runs unless the config says `"claudeTopics": true`. The daily GitHub update
check is off unless `"updates": true`. The Claude hooks and relay are kept as they were.
