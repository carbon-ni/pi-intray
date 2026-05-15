/**
 * Session Control Extension
 *
 * Enables inter-session communication via Unix domain sockets.  When enabled with
 * the `--session-control` flag, each pi session creates a control socket at
 * `~/.pi/session-control/<session-id>.sock` that accepts JSON-RPC commands.
 *
 * Features:
 * - Send messages to other running pi sessions (steer or follow-up mode)
 *   via tool (`send_to_session`) or startup CLI flags (`--control-session`, `--send-session-message`)
 * - Retrieve the last assistant message from a session
 * - Get AI-generated summaries of session activity
 * - Clear/rewind sessions to their initial state
 * - Subscribe to turn_end events for async coordination
 *
 * Once loaded the extension registers a `send_to_session` tool that allows the AI to
 * communicate with other pi sessions programmatically.
 *
 * Usage:
 *   pi --session-control
 *
 * One-shot startup send:
 *   pi -p --session-control --control-session <session-name|session-id> --send-session-message <text>
 *     [--send-session-mode steer|follow_up] [--send-session-wait turn_end|message_processed]
 *     [--send-session-include-sender-info]
 *   (startup send is one-way by default; use --send-session-wait turn_end to capture response on stdout)
 *
 * Environment:
 *   Sets PI_SESSION_ID when enabled, allowing child processes to discover
 *   the current session.
 *
 * RPC Protocol:
 *   Commands are newline-delimited JSON objects with a `type` field:
 *   - { type: "send", message: "...", mode?: "steer"|"follow_up" }
 *   - { type: "get_message" }
 *   - { type: "get_summary" }
 *   - { type: "clear", summarize?: boolean }
 *   - { type: "abort" }
 *   - { type: "subscribe", event: "turn_end" }
 *
 *   Responses are JSON objects with { type: "response", command, success, data?, error? }
 *   Events are JSON objects with { type: "event", event, data?, subscriptionId? }
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	TurnEndEvent,
} from "@mariozechner/pi-coding-agent";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { getSocketPath } from "./infra/session-control-paths.ts";
import { createAliasSymlink, ensureControlDir, getLiveSessions, isSocketAlive, removeAliasesForSocket, removeSocket, resolveSessionIdFromAlias } from "./infra/control-store.ts";
import { sendRpcCommand } from "./infra/rpc-client.ts";
import { closeRpcServer, createRpcServer, writeEvent, writeResponse, type RpcServer, type RpcSocket } from "./infra/rpc-server.ts";
import { updateProcessSessionEnv } from "./infra/session-env.ts";
import { selectSummarizationModel, summarizeConversation } from "./infra/summarizer.ts";
import { renderSessionMessage } from "./pi/message-renderer.ts";
import { registerListSessionsTool } from "./pi/list-sessions-tool.ts";
import { maybeHandleStartupControlSend } from "./pi/startup-send.ts";
import { registerControlSessionsCommand, registerSessionControlCommand } from "./pi/control-commands.ts";
import { CONTROL_FLAG, CONTROL_SHORT_FLAG, getFirstEntryId, getLastAssistantMessage, getMessagesSinceLastPrompt, isSafeAlias, isSafeSessionId, isSessionControlRequested, normalizeMode, normalizeWaitUntil, parseSessionControlAction, type SessionControlAction, type RpcCommand, type RpcSendCommand, type ExtractedMessage } from "./domain/index.ts";
export { isSafeAlias, isSafeSessionId, isSessionControlRequested, normalizeMode, normalizeWaitUntil, parseCommand, parseSessionControlAction } from "./domain/index.ts";

const CONTROL_TARGET_FLAG = "control-session";
const CONTROL_SEND_MESSAGE_FLAG = "send-session-message";
const CONTROL_SEND_MODE_FLAG = "send-session-mode";
const CONTROL_SEND_WAIT_FLAG = "send-session-wait";
const CONTROL_SEND_INCLUDE_SENDER_FLAG = "send-session-include-sender-info";
const SESSION_MESSAGE_TYPE = "session-message";

// ============================================================================
// Subscription Management
// ============================================================================

interface TurnEndSubscription {
	socket: RpcSocket;
	subscriptionId: string;
}

interface SocketState {
	server: RpcServer | null;
	socketPath: string | null;
	context: ExtensionContext | null;
	alias: string | null;
	aliasTimer: ReturnType<typeof setInterval> | null;
	turnEndSubscriptions: TurnEndSubscription[];
}

// ============================================================================
// Summarization
// ============================================================================

// ============================================================================
// Utilities
// ============================================================================

const STATUS_KEY = "session-control";

function getSessionAlias(ctx: ExtensionContext): string | null {
	const sessionName = ctx.sessionManager.getSessionName();
	const alias = sessionName ? sessionName.trim() : "";
	if (!alias || !isSafeAlias(alias)) return null;
	return alias;
}

async function syncAlias(state: SocketState, ctx: ExtensionContext): Promise<void> {
	if (!state.server || !state.socketPath) return;
	const alias = getSessionAlias(ctx);
	if (alias && alias !== state.alias) {
		await removeAliasesForSocket(state.socketPath);
		await createAliasSymlink(ctx.sessionManager.getSessionId(), alias);
		state.alias = alias;
		return;
	}
	if (!alias && state.alias) {
		await removeAliasesForSocket(state.socketPath);
		state.alias = null;
	}
}

// ============================================================================
// Command Handlers
// ============================================================================

async function handleCommand(
	pi: ExtensionAPI,
	state: SocketState,
	command: RpcCommand,
	socket: RpcSocket,
): Promise<void> {
	const id = "id" in command && typeof command.id === "string" ? command.id : undefined;
	const respond = (success: boolean, commandName: string, data?: unknown, error?: string) => {
		if (state.context) {
			void syncAlias(state, state.context);
		}
		writeResponse(socket, { type: "response", command: commandName, success, data, error, id });
	};

	const ctx = state.context;
	if (!ctx) {
		respond(false, command.type, undefined, "Session not ready");
		return;
	}

	void syncAlias(state, ctx);

	// Abort
	if (command.type === "abort") {
		ctx.abort();
		respond(true, "abort");
		return;
	}

	// Subscribe to turn_end
	if (command.type === "subscribe") {
		if (command.event === "turn_end") {
			const subscriptionId = id ?? `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
			state.turnEndSubscriptions.push({ socket, subscriptionId });

			const cleanup = () => {
				const idx = state.turnEndSubscriptions.findIndex((s) => s.subscriptionId === subscriptionId);
				if (idx !== -1) state.turnEndSubscriptions.splice(idx, 1);
			};
			socket.once("close", cleanup);
			socket.once("error", cleanup);

			respond(true, "subscribe", { subscriptionId, event: "turn_end" });
			return;
		}
		respond(false, "subscribe", undefined, `Unknown event type: ${command.event}`);
		return;
	}

	// Get last message
	if (command.type === "get_message") {
		const message = getLastAssistantMessage(ctx.sessionManager.getBranch());
		if (!message) {
			respond(true, "get_message", { message: null });
			return;
		}
		respond(true, "get_message", { message });
		return;
	}

	// Get summary
	if (command.type === "get_summary") {
		const messages = getMessagesSinceLastPrompt(ctx.sessionManager.getBranch());
		if (messages.length === 0) {
			respond(false, "get_summary", undefined, "No messages to summarize");
			return;
		}

		const model = await selectSummarizationModel(ctx.model, ctx.modelRegistry);
		if (!model) {
			respond(false, "get_summary", undefined, "No model available for summarization");
			return;
		}

		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok) {
			respond(false, "get_summary", undefined, "Missing API key for summarization model");
			return;
		}

		try {
			respond(true, "get_summary", await summarizeConversation(messages, model, auth));
		} catch (error) {
			respond(false, "get_summary", undefined, error instanceof Error ? error.message : "Summarization failed");
		}
		return;
	}

	// Clear session
	if (command.type === "clear") {
		if (!ctx.isIdle()) {
			respond(false, "clear", undefined, "Session is busy - wait for turn to complete");
			return;
		}

		const firstEntryId = getFirstEntryId(ctx.sessionManager.getEntries());
		if (!firstEntryId) {
			respond(false, "clear", undefined, "No entries in session");
			return;
		}

		const currentLeafId = ctx.sessionManager.getLeafId();
		if (currentLeafId === firstEntryId) {
			respond(true, "clear", { cleared: true, alreadyAtRoot: true });
			return;
		}

		if (command.summarize) {
			// Summarization requires navigateTree which we don't have direct access to
			// Return an error for now - the caller should clear without summarize
			// or use a different approach
			respond(false, "clear", undefined, "Clear with summarization not supported via RPC - use summarize=false");
			return;
		}

		// Access internal session manager to rewind (type assertion to access non-readonly methods)
		try {
			const sessionManager = ctx.sessionManager as unknown as { rewindTo(id: string): void };
			sessionManager.rewindTo(firstEntryId);
			respond(true, "clear", { cleared: true, targetId: firstEntryId });
		} catch (error) {
			respond(false, "clear", undefined, error instanceof Error ? error.message : "Clear failed");
		}
		return;
	}

	// Send message
	if (command.type === "send") {
		const message = command.message;
		if (typeof message !== "string" || message.trim().length === 0) {
			respond(false, "send", undefined, "Missing message");
			return;
		}

		const mode = command.mode ?? "steer";
		const isIdle = ctx.isIdle();
		const customMessage = {
			customType: SESSION_MESSAGE_TYPE,
			content: message,
			display: true,
		};

		if (isIdle) {
			pi.sendMessage(customMessage, { triggerTurn: true });
		} else {
			pi.sendMessage(customMessage, {
				triggerTurn: true,
				deliverAs: mode === "follow_up" ? "followUp" : "steer",
			});
		}

		respond(true, "send", { delivered: true, mode: isIdle ? "direct" : mode });
		return;
	}

	respond(false, "unsupported", undefined, "Unsupported command");
}

// ============================================================================
// Server Management
// ============================================================================

async function startControlServer(pi: ExtensionAPI, state: SocketState, ctx: ExtensionContext): Promise<void> {
	await ensureControlDir();
	const sessionId = ctx.sessionManager.getSessionId();
	const socketPath = getSocketPath(sessionId);

	if (state.socketPath === socketPath && state.server) {
		state.context = ctx;
		await syncAlias(state, ctx);
		return;
	}

	await stopControlServer(state);
	await removeSocket(socketPath);

	state.context = ctx;
	state.socketPath = socketPath;
	state.server = await createRpcServer(
		socketPath,
		(command, socket) => handleCommand(pi, state, command, socket),
		() => {
			if (state.context) void syncAlias(state, state.context);
		},
	);
	state.alias = null;
	await syncAlias(state, ctx);
}

async function stopControlServer(state: SocketState): Promise<void> {
	if (!state.server) {
		await removeAliasesForSocket(state.socketPath);
		await removeSocket(state.socketPath);
		state.socketPath = null;
		state.alias = null;
		return;
	}

	const socketPath = state.socketPath;
	state.socketPath = null;
	state.turnEndSubscriptions = [];
	await closeRpcServer(state.server);
	state.server = null;
	await removeAliasesForSocket(socketPath);
	await removeSocket(socketPath);
	state.alias = null;
}

function startAliasTimer(state: SocketState): void {
	if (state.aliasTimer) return;
	state.aliasTimer = setInterval(() => {
		if (!state.context) return;
		void syncAlias(state, state.context);
	}, 1000);
}

function stopAliasTimer(state: SocketState): void {
	if (!state.aliasTimer) return;
	clearInterval(state.aliasTimer);
	state.aliasTimer = null;
}

async function enableControlServer(pi: ExtensionAPI, state: SocketState, ctx: ExtensionContext): Promise<void> {
	await startControlServer(pi, state, ctx);
	startAliasTimer(state);
	updateStatus(ctx, true);
	updateSessionEnv(ctx, true);
}

async function disableControlServer(state: SocketState, ctx: ExtensionContext | null): Promise<void> {
	stopAliasTimer(state);
	updateStatus(ctx, false);
	updateSessionEnv(ctx, false);
	await stopControlServer(state);
}

function updateStatus(ctx: ExtensionContext | null, enabled: boolean): void {
	if (!ctx?.hasUI) return;
	if (!enabled) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	const sessionId = ctx.sessionManager.getSessionId();
	ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", `session ${sessionId}`));
}

function updateSessionEnv(ctx: ExtensionContext | null, enabled: boolean): void {
	updateProcessSessionEnv(enabled, ctx?.sessionManager.getSessionId());
}

// Extension factories run before extension flag values are hydrated into runtime.flagValues,
// so we inspect argv directly when deciding whether to register tools at load time.
function shouldRegisterControlTools(pi: ExtensionAPI): boolean {
	return isSessionControlRequested((name) => pi.getFlag(name));
}

// ============================================================================
// Extension Export
// ============================================================================

export default function (pi: ExtensionAPI) {
	pi.registerFlag(CONTROL_FLAG, {
		description: "Enable per-session control socket under ~/.pi/session-control",
		type: "boolean",
	});
	pi.registerFlag(CONTROL_SHORT_FLAG, {
		description: "Alias for --session-control",
		type: "boolean",
	});
	pi.registerFlag(CONTROL_TARGET_FLAG, {
		description: "Target session name or session id for startup control send",
		type: "string",
	});
	pi.registerFlag(CONTROL_SEND_MESSAGE_FLAG, {
		description: "Message to send to --control-session at startup",
		type: "string",
	});
	pi.registerFlag(CONTROL_SEND_MODE_FLAG, {
		description: "Startup send mode: steer or follow_up",
		type: "string",
		default: "steer",
	});
	pi.registerFlag(CONTROL_SEND_WAIT_FLAG, {
		description: "Startup send wait mode: turn_end or message_processed",
		type: "string",
	});
	pi.registerFlag(CONTROL_SEND_INCLUDE_SENDER_FLAG, {
		description: "Include <sender_info> in startup messages (advanced; default: false)",
		type: "boolean",
	});

	let cliSendHandled = false;

	const state: SocketState = {
		server: null,
		socketPath: null,
		context: null,
		alias: null,
		aliasTimer: null,
		turnEndSubscriptions: [],
	};

	pi.registerMessageRenderer(SESSION_MESSAGE_TYPE, renderSessionMessage);

	if (shouldRegisterControlTools(pi)) {
		registerSessionTool(pi, state);
		registerListSessionsTool(pi);
	}
	registerSessionControlCommand(pi, state, { enableControlServer, disableControlServer });
	registerControlSessionsCommand(pi, state);

	const refreshServer = async (ctx: ExtensionContext) => {
		if (!isSessionControlRequested((name) => pi.getFlag(name))) {
			await disableControlServer(state, ctx);
			return;
		}
		await enableControlServer(pi, state, ctx);
	};

	pi.on("session_start", async (_event, ctx) => {
		await refreshServer(ctx);
		if (!cliSendHandled) {
			cliSendHandled = true;
			await maybeHandleStartupControlSend(pi, ctx, {
				target: CONTROL_TARGET_FLAG,
				message: CONTROL_SEND_MESSAGE_FLAG,
				mode: CONTROL_SEND_MODE_FLAG,
				wait: CONTROL_SEND_WAIT_FLAG,
				includeSender: CONTROL_SEND_INCLUDE_SENDER_FLAG,
			});
		}
	});

	pi.on("session_shutdown", async () => {
		await disableControlServer(state, state.context);
	});

	// Fire turn_end events to subscribers
	pi.on("turn_end", (event: TurnEndEvent, ctx: ExtensionContext) => {
		if (state.turnEndSubscriptions.length === 0) return;

		void syncAlias(state, ctx);
		const lastMessage = getLastAssistantMessage(ctx.sessionManager.getBranch());
		const eventData = { message: lastMessage, turnIndex: event.turnIndex };

		// Fire to all subscribers (one-shot)
		const subscriptions = [...state.turnEndSubscriptions];
		state.turnEndSubscriptions = [];

		for (const sub of subscriptions) {
			writeEvent(sub.socket, {
				type: "event",
				event: "turn_end",
				data: eventData,
				subscriptionId: sub.subscriptionId,
			});
		}
	});
}

// ============================================================================
// Tool: send_to_session
// ============================================================================

function registerSessionTool(pi: ExtensionAPI, state: SocketState): void {
	pi.registerTool({
		name: "send_to_session",
		label: "Send To Session",
		description: `Interact with another running pi session via its control socket.

Actions:
- send: Send a message (default). Requires 'message' parameter.
- get_message: Get the most recent assistant message.
- get_summary: Get a summary of activity since the last user prompt.
- clear: Rewind session to initial state.

Target selection:
- sessionId: UUID of the session.
- sessionName: session name (alias from /name).

Wait behavior (only for action=send):
- wait_until=turn_end: Wait for the turn to complete, returns last assistant message.
- wait_until=message_processed: Returns immediately after message is queued.

CLI bridge (for shell scripts/background jobs):
- Current session id is available in shell/bash as $PI_SESSION_ID (set when --session-control is enabled).
- Use $PI_SESSION_ID when you need the current session; do not call list_sessions just to discover your own id.
- Target session must be running with --session-control.
- One-shot startup send is available via extension flags:
  --session-control
  --control-session <session-name|session-id>
  --send-session-message <text>
  --send-session-mode <steer|follow_up> (optional, default: steer)
  --send-session-wait <turn_end|message_processed> (optional)
  --send-session-include-sender-info (optional, advanced; default: off)
- Startup sends are one-way by default (no sender_info), which avoids reply attempts to short-lived 'pi -p' sender sessions.
- If a script needs a response, use --send-session-wait turn_end and read stdout.
- Example script usage (one-way):
  pi -p --session-control --control-session "$PI_SESSION_ID" --send-session-message "Background task finished" --send-session-mode follow_up --send-session-wait message_processed
- Example request/response usage:
  pi -p --session-control --control-session "$PI_SESSION_ID" --send-session-message "What is the current time?" --send-session-wait turn_end

Note: If you ask the target session to reply back via sender_info, do not use wait_until; waiting is redundant and can duplicate responses.

Messages automatically include sender session info for replies. When you want a response, instruct the target session to reply directly to the sender by calling send_to_session with the sender_info reference (do not poll get_message).`,
		parameters: Type.Object({
			sessionId: Type.Optional(Type.String({ description: "Target session id (UUID)" })),
			sessionName: Type.Optional(Type.String({ description: "Target session name (alias)" })),
			action: Type.Optional(
				Type.Union([Type.Literal("send"), Type.Literal("get_message"), Type.Literal("get_summary"), Type.Literal("clear")], {
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
				Type.Union([Type.Literal("turn_end"), Type.Literal("message_processed")], {
					description: "Wait behavior for send action",
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

				if (action === "get_summary") {
					const result = await sendRpcCommand(socketPath, { type: "get_summary" }, { timeout: 60000 });
					if (!result.response.success) {
						return {
							content: [{ type: "text", text: `Failed: ${result.response.error ?? "unknown error"}` }],
							isError: true,
							details: result,
						};
					}
					const data = result.response.data as { summary?: string; model?: string };
					if (!data?.summary) {
						return {
							content: [{ type: "text", text: "No summary generated" }],
							details: result,
						};
					}
					return {
						content: [{ type: "text", text: `Summary (via ${data.model}):\n\n${data.summary}` }],
						details: { summary: data.summary, model: data.model },
					};
				}

				if (action === "clear") {
					const result = await sendRpcCommand(socketPath, { type: "clear", summarize: false }, { timeout: 10000 });
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
				const senderInfo = senderSessionId
					? `\n\n<sender_info>${JSON.stringify({
						sessionId: senderSessionId,
						sessionName: senderSessionName || undefined,
					})}</sender_info>`
					: "";

				const sendCommand: RpcSendCommand = {
					type: "send",
					message: params.message + senderInfo,
					mode: params.mode ?? "steer",
				};

				// Determine wait behavior
				if (params.wait_until === "message_processed") {
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

				if (params.wait_until === "turn_end") {
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
				const wait = args.wait_until;
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
			const hasSummary = details && "summary" in details;
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

			// get_summary result
			if (hasSummary) {
				const summary = details.summary as string;
				const model = details.model as string | undefined;
				const icon = theme.fg("success", "✓");

				if (expanded) {
					const container = new Container();
					let header = icon + theme.fg("muted", " Summary");
					if (model) header += theme.fg("dim", ` via ${model}`);
					container.addChild(new Text(header, 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Markdown(summary, 0, 0, getMarkdownTheme()));
					return container;
				}

				const preview = summary.length > 200 ? summary.slice(0, 200) + "..." : summary;
				const lines = preview.split("\n").slice(0, 5);
				let text = icon + theme.fg("muted", " Summary");
				if (model) text += theme.fg("dim", ` via ${model}`);
				text += "\n" + theme.fg("toolOutput", lines.join("\n"));
				if (summary.split("\n").length > 5 || summary.length > 200) {
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

