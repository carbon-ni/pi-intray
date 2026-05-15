import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getLiveSessions } from "../infra/control-store.ts";
import { isSessionControlRequested, parseSessionControlAction, type SessionControlAction } from "../domain/index.ts";

type ControlState = {
	server: unknown | null;
	socketPath: string | null;
	alias: string | null;
};

type ControlCommandDeps = {
	enableControlServer(pi: ExtensionAPI, state: ControlState, ctx: ExtensionContext): Promise<void>;
	disableControlServer(state: ControlState, ctx: ExtensionContext | null): Promise<void>;
};

export function registerSessionControlCommand(pi: ExtensionAPI, state: ControlState, deps: ControlCommandDeps): void {
	pi.registerCommand("session-control", {
		description: "Start, stop, or show status for the current session control socket",
		getArgumentCompletions: (prefix) => {
			const actions: SessionControlAction[] = ["start", "stop", "status"];
			const matches = actions.filter((action) => action.startsWith(prefix.trim()));
			return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const parsed = parseSessionControlAction(args);
			if (!parsed.action) {
				if (ctx.hasUI) ctx.ui.notify(parsed.error ?? "Invalid session-control action", "error");
				return;
			}

			if (parsed.action === "start") {
				await deps.enableControlServer(pi, state, ctx);
				const label = state.alias ? ` (${state.alias})` : "";
				if (ctx.hasUI) ctx.ui.notify(`Session control started: ${ctx.sessionManager.getSessionId()}${label}`, "info");
				return;
			}

			if (parsed.action === "stop") {
				await deps.disableControlServer(state, ctx);
				if (ctx.hasUI) ctx.ui.notify("Session control stopped", "info");
				return;
			}

			const sessionId = ctx.sessionManager.getSessionId();
			const status = state.server && state.socketPath
				? `Session control is running for ${sessionId}\nSocket: ${state.socketPath}`
				: "Session control is stopped. Use /session-control start to expose this session.";
			pi.sendMessage(
				{
					customType: "session-control-status",
					content: status,
					display: true,
				},
				{ triggerTurn: false },
			);
		},
	});
}

export function registerControlSessionsCommand(pi: ExtensionAPI, state: ControlState): void {
	pi.registerCommand("control-sessions", {
		description: "List controllable sessions (from session-control sockets)",
		handler: async (_args, ctx) => {
			if (!isSessionControlRequested((name) => pi.getFlag(name)) && !state.server) {
				if (ctx.hasUI) {
					ctx.ui.notify("Session control not enabled (use /session-control start or --session-control)", "warning");
				}
				return;
			}

			const sessions = await getLiveSessions();
			const currentSessionId = ctx.sessionManager.getSessionId();
			const lines = sessions.map((session) => {
				const name = session.name ? ` (${session.name})` : "";
				const current = session.sessionId === currentSessionId ? " (current)" : "";
				return `- ${session.sessionId}${name}${current}`;
			});
			const content = sessions.length === 0
				? "No live sessions found."
				: `Controllable sessions:\n${lines.join("\n")}`;

			pi.sendMessage(
				{
					customType: "control-sessions",
					content,
					display: true,
				},
				{ triggerTurn: false },
			);
		},
	});
}
