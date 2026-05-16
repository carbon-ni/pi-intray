---
name: pi-intray
description: >
  Explain and operate the Pi intray extension: session discovery, send_to_session, list_sessions,
  branch aliases, and inter-agent communication through intray sockets.
  Use when user asks how to communicate with another Pi agent/session, find main/branch sessions,
  use intray, or understand this extension.
  Do NOT use for unrelated Pi extensions, CI debugging, commits, or generic repo summaries.
---

# Pi Intray

## Objective
Answer: how Pi agents discover each other, target sessions, and exchange messages through intray.

## Workflow
1. Start broad with LSP:
   - `code_document_symbols` on `src/extension.ts` or main entrypoint.
   - `code_public_api` on entrypoint and nearby exported modules.
   - `code_workspace_symbols` for obvious domain words from package/README.
2. Read only grounding docs/files:
   - `README.md`
   - `package.json`
   - extension entrypoint
   - key tool/command/runtime files found via LSP
3. Map extension surface:
   - registered flags
   - registered tools
   - session targeting aliases, including `/name` aliases and project+branch aliases such as `intra-pi-intray-branch-main-1`
   - lifecycle hooks/events
   - external protocols or storage paths
4. Trace important symbols with LSP before explaining:
   - `code_symbol_info` for registrations and core functions.
   - `code_call_graph` outgoing depth 1-2 for entrypoint behavior.
   - `code_references` only when ownership/usage is unclear.
5. Produce concise answer:
   - one-line purpose
   - user-facing capabilities
   - exact usage commands
   - how another agent discovers and targets sessions with `list_sessions` + `send_to_session`
   - key files for maintainers
   - limitations/unknowns if any
6. Write a short report under `.tmp/reports/<dd-mm-yy>/` when working in a repo.

## Agent-to-agent usage
- Discover targets first: `list_sessions()`.
- Ask a synchronous question with `send_to_session({ sessionName, message, wait_until: "turn_end" })`.
- Ask asynchronously with `mode: "follow_up"` and `wait_until: "message_processed"`; later fetch via `action: "get_message"`.
- Prefer session names/aliases over raw IDs when available.
- If the target should answer back later, mention that sender info is attached and ask it to reply to sender.

## Guardrails
- Prefer LSP tools before grep/read exploration.
- Do not dump large code blocks.
- Verify usage against README/package/entrypoint, not assumptions.
- Keep final answer user-facing; keep implementation map short.

## Trigger examples
Should trigger:
- "How do I send a message to another Pi session?"
- "Find the main agent session"
- "Use intray to communicate with intra-pi-intray-branch-main-1"
- "Explore this extension with LSP; what is it about and how do I use it?"
- "What does this Pi extension do?"
- "Help me understand this extension"
- "How do I run this extension?"

Should not trigger:
- "Fix this extension bug"
- "Review this PR"
- "Commit these changes"
- "Debug CI for this repo"
