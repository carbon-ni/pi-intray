# intray

Pi extension inspired by `mitsuhiko/agent-stuff/extensions/control.ts`.

It exposes running Pi sessions through Unix sockets under `~/.pi/intray/`.

## Usage

```bash
pi --intray
# shorthand
pi --in
```

Or expose the current session after Pi is already running:

```text
/intray start
/intray status
/intray stop
```

One-shot send:

```bash
pi -p --in \
  --control-session <session-name-or-id-or-alias> \
  --send-session-message "please summarize your state" \
  --send-session-wait turn_end
```

Sessions are discoverable by aliases:

- `/name` session aliases, when set.
- git branch aliases, assigned sequentially per branch, e.g. `branch-main-1`, `branch-main-2`.

Use `list_sessions` or `/intray-sessions` to find the alias, then target it with `send_to_session.sessionName` or `--control-session`.

Inside Pi, the extension adds:

- `send_to_session` tool: send a message to another running session
- `list_sessions` tool: list live sessions exposing an intray socket
- `/intray` command: start, stop, or show status for this session's intray socket
- `/intray-sessions` command: show live sessions

## RPC

Newline-delimited JSON over the session socket:

- `{ "type": "send", "message": "...", "mode": "steer" | "follow_up" }`
- `{ "type": "get_message" }`
- `{ "type": "get_summary" }`
- `{ "type": "clear", "summarize": true }`
- `{ "type": "abort" }`
- `{ "type": "subscribe", "event": "turn_end" }`
