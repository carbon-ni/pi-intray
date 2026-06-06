---
name: pi-intray
description: >
  Use the pi-intray extension to chat with another running Pi session.
  Use when user asks to message, talk to, coordinate with, ping, or ask another Pi agent/session.
  Triggers: "send a message to another session", "ask the other agent", "talk to the other pi", "ping that session", "coordinate with another agent".
  Works with pi-intray tools and flags: list_sessions (optionally filtered by search), send_to_session, and pi --in.
  Do NOT use for generic chat, non-Pi messaging, or explaining unrelated Pi extensions.
---

# Pi Intray Chat

Objective: communicate with another running Pi session through the pi-intray extension.

## Required setup

1. Receiver session must be running with intray enabled:
   ```bash
   pi --in
   # same as: pi --intray
   ```
2. If current session needs to receive replies, it also must run with `--in`.

## Discover sessions

Prefer built-in discovery before guessing targets:

1. As an agent, call `list_sessions`.
   - Use `search` when the user gives part of a session name/id/alias or when many sessions are live:
     ```json
     { "search": "pi-intray" }
     ```
2. In Pi UI, use `/intray-sessions` or `/intray-sessions <search>`.
3. Target by one of:
   - `sessionId`
   - configured session alias
   - project/branch alias shown by discovery, e.g. `intra-pi-intray-branch-main-1`

Inside shell commands, current session id is available as:

```bash
$PI_SESSION_ID
```

Use it for the current session; do not call `list_sessions` only to discover yourself.

Search is case-insensitive and matches session id, session name, and aliases.

## Send as agent

Use `send_to_session`:

```json
{
  "sessionName": "<alias-or-branch-alias>",
  "message": "<message>",
  "mode": "steer"
}
```

Wait for a response when needed:

```json
{
  "sessionName": "<target>",
  "message": "Please summarize your current task.",
  "wait_until": "turn_end"
}
```

Use default `reply_behavior: "allow_reply"` for continuous agent-to-agent chat. This appends `<sender_info>` and a reply instruction so the recipient can answer by calling `send_to_session` back to the sender.

Use `reply_behavior: "end_conversation"` for final acknowledgements to avoid reply loops.

## Continuous chat pattern

1. Both sessions start with `pi --in`.
2. First agent discovers peers with `list_sessions`.
3. First agent sends with default `reply_behavior` or explicit `"allow_reply"`.
4. Recipient sees `<sender_info>{"sessionId":"..."}</sender_info>` in the message.
5. Recipient replies by calling `send_to_session` with that `sessionId`.
6. Continue until done; final reply should set `reply_behavior: "end_conversation"`.

Example first message:

```json
{
  "sessionName": "worker",
  "message": "Can you inspect the failing test and tell me what you find?",
  "mode": "steer",
  "reply_behavior": "allow_reply"
}
```

Example reply from recipient:

```json
{
  "sessionId": "<sender_info.sessionId>",
  "message": "I found the failing assertion. It expects alias sorting, but output preserves creation order.",
  "mode": "follow_up",
  "reply_behavior": "allow_reply"
}
```

Final acknowledgement:

```json
{
  "sessionId": "<sender_info.sessionId>",
  "message": "Done, thanks.",
  "reply_behavior": "end_conversation"
}
```

## Send from CLI

One-way message:

```bash
pi -p --in \
  --control-session "<target>" \
  --send-session-message "hello" \
  --send-session-mode follow_up \
  --send-session-wait message_processed
```

Request/response:

```bash
pi -p --in \
  --control-session "<target>" \
  --send-session-message "please summarize your state" \
  --send-session-wait turn_end
```

## Guardrails

- Do not assume a session is available; discover first.
- If discovery returns none, tell user target sessions must start with `pi --in`.
- Use `follow_up` for non-urgent updates; use `steer` for immediate interruption.
- Avoid both `wait_until` and explicit reply instructions unless necessary; it can duplicate responses.
