type SessionEnv = Record<string, string | undefined>;

export function updateSessionEnvValue(env: SessionEnv, enabled: boolean, sessionId?: string): void {
	if (!enabled) {
		delete env.PI_SESSION_ID;
		return;
	}
	if (!sessionId) return;
	env.PI_SESSION_ID = sessionId;
}

export function updateProcessSessionEnv(enabled: boolean, sessionId?: string): void {
	updateSessionEnvValue(process.env, enabled, sessionId);
}
