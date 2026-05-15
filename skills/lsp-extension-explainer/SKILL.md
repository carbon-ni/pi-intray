---
name: lsp-extension-explainer
description: >
  Explain what a Pi extension does and how to use it through LSP-first codebase exploration.
  Use when user asks chat-style questions like "what is this extension about?", "how do I use this extension?", "explore this extension", or "help me understand this Pi extension".
  Do NOT use for code edits, CI debugging, commits, or generic non-extension repo summaries.
---

# LSP Extension Explainer

## Objective
Answer: what the extension does, where behavior lives, and how a user runs it.

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
   - key files for maintainers
   - limitations/unknowns if any
6. Write a short report under `.tmp/reports/<dd-mm-yy>/` when working in a repo.

## Guardrails
- Prefer LSP tools before grep/read exploration.
- Do not dump large code blocks.
- Verify usage against README/package/entrypoint, not assumptions.
- Keep final answer user-facing; keep implementation map short.

## Trigger examples
Should trigger:
- "Explore this extension with LSP; what is it about and how do I use it?"
- "What does this Pi extension do?"
- "Help me understand this extension"
- "How do I run this extension?"

Should not trigger:
- "Fix this extension bug"
- "Review this PR"
- "Commit these changes"
- "Debug CI for this repo"
