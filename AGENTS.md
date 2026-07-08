# Agent Index

Use this file as the project map. Read the closest `AGENTS.md` before editing a folder.

## Architectural intent

Keep extension code easy to navigate by separating responsibilities:

- `src/domain/` — pure business rules. No runtime APIs, no IO, no infra imports.
- `src/infra/` — external dependencies and mock boundaries.
- `src/pi/` — Pi extension integration and runtime glue.
- `src/tools/` — registered tool modules. This folder should make available tools discoverable.
- `tests/` — deterministic tests around behavior and seams.

## Rules for future changes

1. Add or change tools in `src/tools/`.
2. Put pure parsing, validation, formatting, and data shaping in `src/domain/`.
3. Put any dependency you would mock in tests in `src/infra/`.
4. Keep `src/extension.ts` as composition only: register flags, tools, commands, renderers, and hooks.
5. Run before committing:
   - `npm run lint`
   - `npm test`
   - `npm run test:coverage`

## Domain concepts

### RPC protocol (`src/domain/protocol.ts`)

Newline-delimited JSON over Unix domain sockets. Three message types:

- **Commands** (client → server): `send`, `get_message`, `clear`, `abort`, `subscribe`
- **Responses** (server → client): `{ type: "response", command, success, data?, error?, id? }`
- **Events** (server → client): `{ type: "event", event, data?, subscriptionId? }`

Only one event type currently: `turn_end` — emitted once per `subscribe` subscription. Subscriptions are one-shot: consumed on first emission then removed.

Commands carry an optional `id` which is echoed back in the response. The `subscribe` command repurposes `id` as `subscriptionId`.

### Socket lifecycle (`src/pi/control-runtime.ts`)

1. **Start**: create Unix socket at `~/.pi/intray/<session-id>.sock`, set `PI_SESSION_ID` env var, create alias symlinks
2. **Alias sync**: runs every 1s. Creates up to two aliases: session name (from `/name`) and git branch alias (e.g., `intra-<project>-branch-<branch>-N`). Sequential numbering avoids collisions.
3. **Stop**: close socket, remove socket file, remove alias symlinks, clear `PI_SESSION_ID`

The `SocketState` object holds server reference, socket path, context, aliases, alias timer, and turn-end subscriptions. It's created in `extension.ts` and threaded through all control functions.

### Send-to-session tool (`src/tools/send-to-session.ts`)

Three actions: `send`, `get_message`, `clear`. Key behaviors:

- Target identified by `sessionId` (UUID) or `sessionName` (alias from `/name` or branch alias)
- Alias resolution: symlink at `~/.pi/intray/<alias>.alias` → `~/.pi/intray/<session-id>.sock`
- `reply_behavior="allow_reply"` (default): appends `<reply_instruction>` and `<sender_info>` XML tags so the recipient can reply via its own `send_to_session`
- `reply_behavior="end_conversation"`: no reply capability attached
- `wait_until=turn_end`: subscribes to `turn_end` event and blocks until the target completes its turn
- `wait_until=message_processed`: returns after message is queued
- `wait_until=off`: returns after send command acknowledged

### Startup CLI send (`src/pi/startup-send.ts`)

One-shot messaging for shell scripts. Uses flags: `--intray`, `--control-session`, `--send-session-message`, `--send-session-mode`, `--send-session-wait`, `--send-session-include-sender-info`. By default, sender info is NOT included (to prevent reply attempts to short-lived `pi -p` sessions).

### Message rendering (`src/pi/message-renderer.ts`)

Parses `<sender_info>` XML blocks (JSON inside) from session messages. Displays `[session-message] from <name> (<id>)` header. Strips sender info from displayed content. Supports both collapsed (5 lines) and expanded (full markdown) rendering.

### Alias system (`src/domain/branch-alias.ts`)

Aliases are symlinks in `~/.pi/intray/`:
- Session name alias: e.g., `my-helper.alias` → `./<session-id>.sock`
- Branch alias: e.g., `intra-pi-intray-branch-main-1.alias` → `./<session-id>.sock`

Sequential numbering prevents collisions when multiple sessions share same project+branch.

## Key failure modes

- **Stale context**: Extension contexts can become stale after session restarts. Handled by `isStaleContextError()` checks.
- **Socket not alive**: `isSocketAlive()` probes with a 300ms connect timeout before listing sessions.
- **Session busy**: `clear` command rejects if session is not idle.
- **Missing target**: Startup send reports errors to UI (or console if no UI).

## Reports

Write task reports under `.tmp/reports/<dd-mm-yy>/` if `$AGENT_WORKSPACE` is not set.
