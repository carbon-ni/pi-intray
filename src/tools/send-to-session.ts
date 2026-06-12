import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { getSocketPath } from "../infra/intray-paths.ts";
import { resolveSessionIdFromAlias } from "../infra/control-store.ts";
import { sendRpcCommand } from "../infra/rpc-client.ts";
import { appendReplyInstruction, isSafeSessionId, type ExtractedMessage, type RpcSendCommand } from "../domain/index.ts";

export interface SessionToolState {
	context: ExtensionContext | null;
}

// ============================================================================
// Tool: send_to_session
// ============================================================================

export function registerSessionTool(pi: ExtensionAPI, state: SessionToolState): void {
	pi.registerTool({
		name: "send_to_session",
		label: "Send To Session",
		description: `Interact with another running session via its intray socket.

Actions:
- send: Send a message (default). Requires 'message' parameter.
- get_message: Get the most recent assistant message.
- clear: Rewind session to initial state.

Target selection:
- sessionId: UUID of the session.
- sessionName: session name (alias from /name) or project+branch alias shown by list_sessions, e.g. intra-pi-intray-branch-main-1.

Wait behavior (only for action=send):
- wait_until=turn_end: Wait for the turn to complete, returns last assistant message (default).
- wait_until=message_processed: Returns immediately after message is queued.
- wait_until=off: Do not wait for the target turn; only confirm delivery.

CLI bridge (for shell scripts/background jobs):
- Current session id is available in shell/bash as $PI_SESSION_ID (set when --intray is enabled).
- Use $PI_SESSION_ID when you need the current session; do not call list_sessions just to discover your own id.
- Target session must be running with --intray.
- One-shot startup send is available via extension flags:
  --intray
  --control-session <session-name|session-id>
  --send-session-message <text>
  --send-session-mode <steer|follow_up> (optional, default: steer)
  --send-session-wait <turn_end|message_processed> (optional)
  --send-session-include-sender-info (optional, advanced; default: off)
- Startup sends are one-way by default (no sender_info), which avoids reply attempts to short-lived 'pi -p' sender sessions.
- If a script needs a response, use --send-session-wait turn_end and read stdout.
- Example script usage (one-way):
  pi -p --intray --control-session "$PI_SESSION_ID" --send-session-message "Background task finished" --send-session-mode follow_up --send-session-wait message_processed
- Example request/response usage:
  pi -p --intray --control-session "$PI_SESSION_ID" --send-session-message "What is the current time?" --send-session-wait turn_end

Note: If you ask the target session to reply back via sender_info, do not use wait_until; waiting is redundant and can duplicate responses.

Messages use reply_behavior="allow_reply" by default. For final acknowledgements, set reply_behavior="end_conversation" so the recipient cannot reply back and the exchange ends. When you want a response, instruct the target session to reply directly to the sender by calling send_to_session with the sender_info reference (do not poll get_message).`,
		parameters: Type.Object({
			sessionId: Type.Optional(Type.String({ description: "Target session id (UUID)" })),
			sessionName: Type.Optional(Type.String({ description: "Target session name (alias)" })),
			action: Type.Optional(
				Type.Union([Type.Literal("send"), Type.Literal("get_message"), Type.Literal("clear")], {
					description: "Action to perform (default: send)",
					default: "send",
				}),
			),
			message: Type.Optional(Type.String({ description: "Message to send (required for action=send)" })),
			mode: Type.Optional(
				Type.Union([Type.Literal("steer"), Type.Literal("follow_up")], {
					description: "Delivery mode for send: steer (immediate) or follow_up (after task)",
					default: "steer",
				}),
			),
			wait_until: Type.Optional(
				Type.Union([Type.Literal("turn_end"), Type.Literal("message_processed"), Type.Literal("off")], {
					description: "Wait behavior for send action",
					default: "turn_end",
				}),
			),
			reply_behavior: Type.Optional(
				Type.Union([Type.Literal("allow_reply"), Type.Literal("end_conversation")], {
					description: "Whether this message should include reply instructions. Use end_conversation for final acknowledgements.",
					default: "allow_reply",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const action = params.action ?? "send";
			const sessionName = params.sessionName?.trim();
			const sessionId = params.sessionId?.trim();
			let targetSessionId: string | null = null;
			const displayTarget = sessionName || sessionId || "";

			if (sessionName) {
				targetSessionId = await resolveSessionIdFromAlias(sessionName);
				if (!targetSessionId) {
					return {
						content: [{ type: "text", text: "Unknown session name" }],
						isError: true,
						details: { error: "Unknown session name" },
					};
				}
			}

			if (sessionId) {
				if (!isSafeSessionId(sessionId)) {
					return {
						content: [{ type: "text", text: "Invalid session id" }],
						isError: true,
						details: { error: "Invalid session id" },
					};
				}
				if (targetSessionId && targetSessionId !== sessionId) {
					return {
						content: [{ type: "text", text: "Session name does not match session id" }],
						isError: true,
						details: { error: "Session name does not match session id" },
					};
				}
				targetSessionId = sessionId;
			}

			if (!targetSessionId) {
				return {
					content: [{ type: "text", text: "Missing session id or session name" }],
					isError: true,
					details: { error: "Missing session id or session name" },
				};
			}

			const socketPath = getSocketPath(targetSessionId);
			const senderSessionId = state.context?.sessionManager.getSessionId();

			try {
				// Handle each action
				if (action === "get_message") {
					const result = await sendRpcCommand(socketPath, { type: "get_message" });
					if (!result.response.success) {
						return {
							content: [{ type: "text", text: `Failed: ${result.response.error ?? "unknown error"}` }],
							isError: true,
							details: result,
						};
					}
					const data = result.response.data as { message?: ExtractedMessage };
					if (!data?.message) {
						return {
							content: [{ type: "text", text: "No assistant message found in session" }],
							details: result,
						};
					}
					return {
						content: [{ type: "text", text: data.message.content }],
						details: { message: data.message },
					};
				}

				if (action === "clear") {
					const result = await sendRpcCommand(socketPath, { type: "clear" }, { timeout: 10000 });
					if (!result.response.success) {
						return {
							content: [{ type: "text", text: `Failed to clear: ${result.response.error ?? "unknown error"}` }],
							isError: true,
							details: result,
						};
					}
					const data = result.response.data as { cleared?: boolean; alreadyAtRoot?: boolean };
					const msg = data?.alreadyAtRoot ? "Session already at root" : "Session cleared";
					return {
						content: [{ type: "text", text: msg }],
						details: data,
					};
				}

				// action === "send"
				if (!params.message || params.message.trim().length === 0) {
					return {
						content: [{ type: "text", text: "Missing message for send action" }],
						isError: true,
						details: { error: "Missing message" },
					};
				}

				const senderSessionName = state.context?.sessionManager.getSessionName()?.trim();
				const shouldAllowReply = params.reply_behavior !== "end_conversation";
				const message = appendReplyInstruction(
					params.message,
					shouldAllowReply && senderSessionId
						? {
							sessionId: senderSessionId,
							sessionName: senderSessionName || undefined,
						}
						: null,
				);

				const sendCommand: RpcSendCommand = {
					type: "send",
					message,
					mode: params.mode ?? "steer",
				};

				// Determine wait behavior
				const waitUntil = params.wait_until ?? "turn_end";
				if (waitUntil === "message_processed" || waitUntil === "off") {
					// Just send and confirm delivery
					const result = await sendRpcCommand(socketPath, sendCommand);
					if (!result.response.success) {
						return {
							content: [{ type: "text", text: `Failed: ${result.response.error ?? "unknown error"}` }],
							isError: true,
							details: result,
						};
					}
					return {
						content: [{ type: "text", text: "Message delivered to session" }],
						details: result.response.data,
					};
				}

				if (waitUntil === "turn_end") {
					// Send and wait for turn to complete
					const result = await sendRpcCommand(socketPath, sendCommand, {
						timeout: 300000, // 5 minutes
						waitForEvent: "turn_end",
					});

					if (!result.response.success) {
						return {
							content: [{ type: "text", text: `Failed: ${result.response.error ?? "unknown error"}` }],
							isError: true,
							details: result,
						};
					}

					const lastMessage = result.event?.message;
					if (!lastMessage) {
						return {
							content: [{ type: "text", text: "Turn completed but no assistant message found" }],
							details: { turnIndex: result.event?.turnIndex },
						};
					}

					return {
						content: [{ type: "text", text: lastMessage.content }],
						details: { message: lastMessage, turnIndex: result.event?.turnIndex },
					};
				}

				// No wait - just send
				const result = await sendRpcCommand(socketPath, sendCommand);
				if (!result.response.success) {
					return {
						content: [{ type: "text", text: `Failed: ${result.response.error ?? "unknown error"}` }],
						isError: true,
						details: result,
					};
				}

				return {
					content: [{ type: "text", text: `Message sent to session ${displayTarget || targetSessionId}` }],
					details: result.response.data,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error";
				return {
					content: [{ type: "text", text: `Failed: ${message}` }],
					isError: true,
					details: { error: message },
				};
			}
		},

		renderCall(args, theme) {
			const action = args.action ?? "send";
			const sessionRef = args.sessionName ?? args.sessionId ?? "...";
			const shortSessionRef = sessionRef.length > 12 ? sessionRef.slice(0, 8) + "..." : sessionRef;

			// Build the header line
			let header = theme.fg("toolTitle", theme.bold("→ session "));
			header += theme.fg("accent", shortSessionRef);

			// Add action-specific info
			if (action === "send") {
				const mode = args.mode ?? "steer";
				const wait = args.wait_until ?? "turn_end";
				let info = theme.fg("muted", ` (${mode}`);
				if (wait) info += theme.fg("dim", `, wait: ${wait}`);
				info += theme.fg("muted", ")");
				header += info;
			} else {
				header += theme.fg("muted", ` (${action})`);
			}

			// For send action, show the message
			if (action === "send" && args.message) {
				const msg = args.message;
				const preview = msg.length > 80 ? msg.slice(0, 80) + "..." : msg;
				// Handle multi-line messages
				const firstLine = preview.split("\n")[0];
				const hasMore = preview.includes("\n") || msg.length > 80;
				return new Text(
					header + "\n  " + theme.fg("dim", `"${firstLine}${hasMore ? "..." : ""}"`),
					0,
					0,
				);
			}

			return new Text(header, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as Record<string, unknown> | undefined;
			const isError = (result as { isError?: boolean }).isError === true;

			// Error case
			if (isError || details?.error) {
				const errorMsg = (details?.error as string) || result.content[0]?.type === "text" ? (result.content[0] as { type: "text"; text: string }).text : "Unknown error";
				return new Text(theme.fg("error", "✗ ") + theme.fg("error", errorMsg), 0, 0);
			}

			// Detect action from details structure
			const hasMessage = details && "message" in details && details.message;
			const hasCleared = details && "cleared" in details;
			const hasTurnIndex = details && "turnIndex" in details;

			// get_message or turn_end result with message
			if (hasMessage) {
				const message = details.message as ExtractedMessage;
				const icon = theme.fg("success", "✓");

				if (expanded) {
					const container = new Container();
					container.addChild(new Text(icon + theme.fg("muted", " Message received"), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Markdown(message.content, 0, 0, getMarkdownTheme()));
					if (hasTurnIndex) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", `Turn #${details.turnIndex}`), 0, 0));
					}
					return container;
				}

				// Collapsed view - show preview
				const preview = message.content.length > 200
					? message.content.slice(0, 200) + "..."
					: message.content;
				const lines = preview.split("\n").slice(0, 5);
				let text = icon + theme.fg("muted", " Message received");
				if (hasTurnIndex) text += theme.fg("dim", ` (turn #${details.turnIndex})`);
				text += "\n" + theme.fg("toolOutput", lines.join("\n"));
				if (message.content.split("\n").length > 5 || message.content.length > 200) {
					text += "\n" + theme.fg("dim", "(Ctrl+O to expand)");
				}
				return new Text(text, 0, 0);
			}

			// clear result
			if (hasCleared) {
				const alreadyAtRoot = details.alreadyAtRoot as boolean | undefined;
				const icon = theme.fg("success", "✓");
				const msg = alreadyAtRoot ? "Session already at root" : "Session cleared";
				return new Text(icon + " " + theme.fg("muted", msg), 0, 0);
			}

			// send result (no wait or message_processed)
			if (details && "delivered" in details) {
				const mode = details.mode as string | undefined;
				const icon = theme.fg("success", "✓");
				let text = icon + theme.fg("muted", " Message delivered");
				if (mode) text += theme.fg("dim", ` (${mode})`);
				return new Text(text, 0, 0);
			}

			// Fallback - just show the text content
			const text = result.content[0];
			const content = text?.type === "text" ? text.text : "(no output)";
			return new Text(theme.fg("success", "✓ ") + theme.fg("muted", content), 0, 0);
		},
	});
}

