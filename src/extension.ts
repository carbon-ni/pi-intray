/**
 * Intray Extension
 *
 * Enables inter-session communication via Unix domain sockets. When enabled with
 * the `--intray` flag, each session creates an intray socket at
 * `~/.pi/intray/<session-id>.sock` that accepts JSON-RPC commands.
 *
 * Features:
 * - Send messages to other running pi sessions (steer or follow-up mode)
 *   via tool (`send_to_session`) or startup CLI flags (`--control-session`, `--send-session-message`)
 * - Retrieve the last assistant message from a session
 * - Clear/rewind sessions to their initial state
 * - Subscribe to turn_end events for async coordination
 *
 * Once loaded the extension registers a `send_to_session` tool that allows the AI to
 * communicate with other pi sessions programmatically.
 *
 * Usage:
 *   pi --intray
 *
 * One-shot startup send:
 *   pi -p --intray --control-session <session-name|session-id> --send-session-message <text>
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
 *   - { type: "clear" }
 *   - { type: "abort" }
 *   - { type: "subscribe", event: "turn_end" }
 *
 *   Responses are JSON objects with { type: "response", command, success, data?, error? }
 *   Events are JSON objects with { type: "event", event, data?, subscriptionId? }
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { renderSessionMessage } from "./pi/message-renderer.ts";
import { maybeHandleStartupControlSend } from "./pi/startup-send.ts";
import { registerControlSessionsCommand, registerSessionControlCommand } from "./pi/control-commands.ts";
import { registerListSessionsTool, registerSessionTool } from "./tools/index.ts";
import { createSocketState, disableControlServer, emitTurnEnd, enableControlServer } from "./pi/control-runtime.ts";
import { CONTROL_FLAG, CONTROL_SHORT_FLAG, isSafeAlias, isSafeSessionId, isSessionControlRequested, normalizeMode, normalizeWaitUntil, parseSessionControlAction, SESSION_MESSAGE_TYPE } from "./domain/index.ts";
export { isSafeAlias, isSafeSessionId, isSessionControlRequested, normalizeMode, normalizeWaitUntil, parseCommand, parseSessionControlAction } from "./domain/index.ts";

const CONTROL_TARGET_FLAG = "control-session";
const CONTROL_SEND_MESSAGE_FLAG = "send-session-message";
const CONTROL_SEND_MODE_FLAG = "send-session-mode";
const CONTROL_SEND_WAIT_FLAG = "send-session-wait";
const CONTROL_SEND_INCLUDE_SENDER_FLAG = "send-session-include-sender-info";
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
		description: "Enable an intray socket under ~/.pi/intray",
		type: "boolean",
	});
	pi.registerFlag(CONTROL_SHORT_FLAG, {
		description: "Alias for --intray",
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

	const state = createSocketState();

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

	pi.on("turn_end", (event, ctx) => emitTurnEnd(state, event, ctx));
}
