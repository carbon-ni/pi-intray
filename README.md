# session-control

Pi extension inspired by `mitsuhiko/agent-stuff/extensions/control.ts`.

It exposes running Pi sessions through Unix sockets under `~/.pi/session-control/`.

## Usage

```bash
pi --session-control
# shorthand
pi --sc
```

Or expose the current session after Pi is already running:

```text
/session-control start
/session-control status
/session-control stop
```

One-shot send:

```bash
pi -p --sc \
  --control-session <session-name-or-id> \
  --send-session-message "please summarize your state" \
  --send-session-wait turn_end
```

Inside Pi, the extension adds:

- `send_to_session` tool: send a message to another running session
- `list_control_sessions` tool: list live controllable sessions
- `/session-control` command: start, stop, or show status for this session's control socket
- `/control-sessions` command: show live sessions

## RPC

Newline-delimited JSON over the session socket:

- `{ "type": "send", "message": "...", "mode": "steer" | "follow_up" }`
- `{ "type": "get_message" }`
- `{ "type": "get_summary" }`
- `{ "type": "clear", "summarize": true }`
- `{ "type": "abort" }`
- `{ "type": "subscribe", "event": "turn_end" }`
