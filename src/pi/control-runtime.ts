import type { ExtensionAPI, ExtensionContext, TurnEndEvent } from "@mariozechner/pi-coding-agent";
import { getSocketPath } from "../infra/intray-paths.ts";
import { createAliasSymlink, ensureControlDir, getAliasNames, removeAliasesForSocket, removeSocket } from "../infra/control-store.ts";
import { getCurrentGitBranch } from "../infra/git-branch.ts";
import { closeRpcServer, createRpcServer, writeEvent, writeResponse, type RpcServer, type RpcSocket } from "../infra/rpc-server.ts";
import { updateProcessSessionEnv } from "../infra/session-env.ts";
import { selectSummarizationModel, summarizeConversation } from "../infra/summarizer.ts";
import { createBranchAlias, createSequentialBranchAlias, getFirstEntryId, getLastAssistantMessage, getMessagesSinceLastPrompt, isSafeAlias, type RpcCommand, SESSION_MESSAGE_TYPE } from "../domain/index.ts";

// ============================================================================
// Subscription Management
// ============================================================================

interface TurnEndSubscription {
	socket: RpcSocket;
	subscriptionId: string;
}

export interface SocketState {
	server: RpcServer | null;
	socketPath: string | null;
	context: ExtensionContext | null;
	aliases: string[];
	aliasTimer: ReturnType<typeof setInterval> | null;
	turnEndSubscriptions: TurnEndSubscription[];
}

// ============================================================================
// Summarization
// ============================================================================

// ============================================================================
// Utilities
// ============================================================================

const STATUS_KEY = "intray";

function getSessionAlias(ctx: ExtensionContext): string | null {
	const sessionName = ctx.sessionManager.getSessionName();
	const alias = sessionName ? sessionName.trim() : "";
	if (!alias || !isSafeAlias(alias)) return null;
	return alias;
}

async function getBranchAlias(currentAliases: string[]): Promise<string | null> {
	const branch = await getCurrentGitBranch();
	const baseAlias = branch ? createBranchAlias(branch) : null;
	if (!branch || !baseAlias) return null;
	const currentAlias = currentAliases.find((alias) => alias.startsWith(`${baseAlias}-`));
	return createSequentialBranchAlias(branch, await getAliasNames(), currentAlias);
}

async function getSessionAliases(ctx: ExtensionContext, currentAliases: string[]): Promise<string[]> {
	const aliases = [getSessionAlias(ctx), await getBranchAlias(currentAliases)].filter((alias): alias is string => Boolean(alias));
	return Array.from(new Set(aliases));
}

async function syncAlias(state: SocketState, ctx: ExtensionContext): Promise<void> {
	if (!state.server || !state.socketPath) return;
	const aliases = await getSessionAliases(ctx, state.aliases);
	if (aliases.length === state.aliases.length && aliases.every((alias, index) => alias === state.aliases[index])) return;

	await removeAliasesForSocket(state.socketPath);
	for (const alias of aliases) {
		await createAliasSymlink(ctx.sessionManager.getSessionId(), alias);
	}
	state.aliases = aliases;
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
	state.aliases = [];
	await syncAlias(state, ctx);
}

async function stopControlServer(state: SocketState): Promise<void> {
	if (!state.server) {
		await removeAliasesForSocket(state.socketPath);
		await removeSocket(state.socketPath);
		state.socketPath = null;
		state.aliases = [];
		return;
	}

	const socketPath = state.socketPath;
	state.socketPath = null;
	state.turnEndSubscriptions = [];
	await closeRpcServer(state.server);
	state.server = null;
	await removeAliasesForSocket(socketPath);
	await removeSocket(socketPath);
	state.aliases = [];
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

export async function enableControlServer(pi: ExtensionAPI, state: SocketState, ctx: ExtensionContext): Promise<void> {
	await startControlServer(pi, state, ctx);
	startAliasTimer(state);
	updateStatus(ctx, true);
	updateSessionEnv(ctx, true);
}

export async function disableControlServer(state: SocketState, ctx: ExtensionContext | null): Promise<void> {
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

export function createSocketState(): SocketState {
	return {
		server: null,
		socketPath: null,
		context: null,
		aliases: [],
		aliasTimer: null,
		turnEndSubscriptions: [],
	};
}

export function emitTurnEnd(state: SocketState, event: TurnEndEvent, ctx: ExtensionContext): void {
	if (state.turnEndSubscriptions.length === 0) return;

	void syncAlias(state, ctx);
	const lastMessage = getLastAssistantMessage(ctx.sessionManager.getBranch());
	const eventData = { message: lastMessage, turnIndex: event.turnIndex };

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
}
