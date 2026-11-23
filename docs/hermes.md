# Rounds for Hermes

How a note pinned on the canvas reaches the Hermes session that made the post, at once.

## How it works

1. A Hermes session posts with `rounds_post`. The `post_tool_call` hook (`hooks/hermes.mjs`) writes the
   session id, the profile and `agent: "hermes"` into `posts/<id>.json`.
2. You pin a note. The canvas writes `comments.json` and, with `"relay": "hermes"`, `inbox/<id>.json`.
3. The relay (`rounds relay`) sees the file, claims it (`sent/<id>.json` = `queued`, with its pid), and runs

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
| Two notes for one session | Sent one after the other (a session runs one turn at a time). |

A relay turn runs in the session while you may have it open in the desktop app. The turn is written to
the same `state.db`; whether the open chat shows the new rows without reopening it was not verified.

## Not Claude

`rounds init` prints the Hermes steps; `rounds init --claude` is the original Claude Code setup. The
`claude` topic sorter never runs unless the config says `"claudeTopics": true`. The daily GitHub update
check is off unless `"updates": true`. The Claude hooks and relay are kept as they were.
