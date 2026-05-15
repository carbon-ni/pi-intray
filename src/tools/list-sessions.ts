import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getLiveSessions } from "../infra/control-store.ts";

export function registerListSessionsTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "list_sessions",
		label: "List Sessions",
		description: "List live sessions that expose a control socket (optionally with session names). Use this for discovery only; for the current session id in shell/bash use $PI_SESSION_ID.",
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
				const name = session.name ? ` (${session.name})` : "";
				return `- ${session.sessionId}${name}`;
			});

			return {
				content: [{ type: "text", text: `Live sessions:\n${lines.join("\n")}` }],
				details: { sessions },
			};
		},
	});
}
