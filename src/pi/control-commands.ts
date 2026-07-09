import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getLiveSessions } from "../infra/control-store.ts";
import { filterSessionsBySearch, isSessionControlRequested, parseSessionControlAction, type SessionControlAction } from "../domain/index.ts";

type ControlState = {
	server: unknown | null;
	socketPath: string | null;
	aliases: string[];
};

type ControlCommandDeps = {
	enableControlServer(pi: ExtensionAPI, state: ControlState, ctx: ExtensionContext): Promise<void>;
	disableControlServer(state: ControlState, ctx: ExtensionContext | null): Promise<void>;
};

export function registerSessionControlCommand(pi: ExtensionAPI, state: ControlState, deps: ControlCommandDeps): void {
	pi.registerCommand("intray", {
		description: "Start, stop, or show status for the current intray socket",
		getArgumentCompletions: (prefix) => {
			const actions: SessionControlAction[] = ["start", "stop", "status"];
			const matches = actions.filter((action) => action.startsWith(prefix.trim()));
			return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const parsed = parseSessionControlAction(args);
			if (!parsed.action) {
				if (ctx.hasUI) ctx.ui.notify(parsed.error ?? "Invalid intray action", "error");
				return;
			}

			if (parsed.action === "start") {
				await deps.enableControlServer(pi, state, ctx);
				const label = state.aliases.length > 0 ? ` (${state.aliases.join(", ")})` : "";
				if (ctx.hasUI) ctx.ui.notify(`Intray started: ${ctx.sessionManager.getSessionId()}${label}`, "info");
				return;
			}

			if (parsed.action === "stop") {
				await deps.disableControlServer(state, ctx);
				if (ctx.hasUI) ctx.ui.notify("Intray stopped", "info");
				return;
			}

			const sessionId = ctx.sessionManager.getSessionId();
			const status = state.server && state.socketPath
				? `Intray is running for ${sessionId}\nSocket: ${state.socketPath}`
				: "Intray is stopped. Use /intray start to expose this session.";
			pi.sendMessage(
				{
					customType: "intray-status",
					content: status,
					display: true,
				},
				{ triggerTurn: false },
			);
		},
	});
}

export function registerControlSessionsCommand(pi: ExtensionAPI, state: ControlState): void {
	pi.registerCommand("intray-sessions", {
		description: "List controllable sessions (from intray sockets). Optionally pass search text to filter by id, name, or alias.",
		handler: async (args, ctx) => {
			if (!isSessionControlRequested((name) => pi.getFlag(name)) && !state.server) {
				if (ctx.hasUI) {
					ctx.ui.notify("Intray not enabled (use /intray start or --intray)", "warning");
				}
				return;
			}

			const search = args.trim();
			const sessions = filterSessionsBySearch(await getLiveSessions(), search);
			const currentSessionId = ctx.sessionManager.getSessionId();
			const lines = sessions.map((session) => {
				const aliases = session.aliases.length > 0 ? ` (${session.aliases.join(", ")})` : "";
				const current = session.sessionId === currentSessionId ? " (current)" : "";
				return `- ${session.sessionId}${aliases}${current}`;
			});
			const content = sessions.length === 0
				? (search ? `No live sessions found matching "${search}".` : "No live sessions found.")
				: `${search ? `Controllable sessions matching "${search}"` : "Controllable sessions"}:\n${lines.join("\n")}`;

			pi.sendMessage(
				{
					customType: "intray-sessions",
					content,
					display: true,
				},
				{ triggerTurn: false },
			);
		},
	});
}
