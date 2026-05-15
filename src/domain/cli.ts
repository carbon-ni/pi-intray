export const CONTROL_FLAG = "session-control";
export const CONTROL_SHORT_FLAG = "sc";

export type SessionControlAction = "start" | "stop" | "status";

export function parseSessionControlAction(args: string): { action?: SessionControlAction; error?: string } {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return { action: "status" };
	if (parts.length > 1) return { error: "Too many arguments. Use /session-control start|stop|status." };

	const action = parts[0] as SessionControlAction;
	if (action === "start" || action === "stop" || action === "status") {
		return { action };
	}
	return { error: `Unknown session-control action: ${parts[0]}. Use start|stop|status.` };
}

export function normalizeMode(raw: string): "steer" | "follow_up" | null {
	const value = raw.trim().toLowerCase();
	if (value === "steer") return "steer";
	if (value === "follow_up" || value === "follow-up" || value === "followup") return "follow_up";
	return null;
}

export function normalizeWaitUntil(raw: string): "turn_end" | "message_processed" | null {
	const value = raw.trim().toLowerCase();
	if (value === "turn_end" || value === "turn-end") return "turn_end";
	if (value === "message_processed" || value === "message-processed") return "message_processed";
	return null;
}

export function isSessionControlRequested(getFlag: (name: string) => unknown, argv = process.argv.slice(2)): boolean {
	return getFlag(CONTROL_FLAG) === true || getFlag(CONTROL_SHORT_FLAG) === true || argv.includes(`--${CONTROL_FLAG}`) || argv.includes(`--${CONTROL_SHORT_FLAG}`);
}
