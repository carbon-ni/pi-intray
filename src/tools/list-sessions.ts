import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getLiveSessions } from "../infra/control-store.ts";

export function registerListSessionsTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "list_sessions",
		label: "List Sessions",
		description: "List live sessions that expose an intray socket, including session-name and git-branch aliases when available. Use this for discovery only; for the current session id in shell/bash use $PI_SESSION_ID.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			const sessions = await getLiveSessions();

			if (sessions.length === 0) {
				return {
					content: [{ type: "text", text: "No live sessions found." }],
					details: { sessions: [] },
				};
			}

			const lines = sessions.map((session) => {
				const aliases = session.aliases.length > 0 ? ` (${session.aliases.join(", ")})` : "";
				return `- ${session.sessionId}${aliases}`;
			});

			return {
				content: [{ type: "text", text: `Live sessions:\n${lines.join("\n")}` }],
				details: { sessions },
			};
		},
	});
}
