import test from "node:test";
import assert from "node:assert/strict";

import { updateSessionEnvValue } from "../src/infra/session-env.ts";

test("updateSessionEnvValue sets session id when enabled", () => {
	const env: Record<string, string | undefined> = {};

	updateSessionEnvValue(env, true, "session-1");

	assert.equal(env.PI_SESSION_ID, "session-1");
});

test("updateSessionEnvValue removes session id when disabled", () => {
	const env: Record<string, string | undefined> = { PI_SESSION_ID: "session-1" };

	updateSessionEnvValue(env, false, "session-1");

	assert.equal("PI_SESSION_ID" in env, false);
});

test("updateSessionEnvValue leaves env unchanged when enabled without session id", () => {
	const env: Record<string, string | undefined> = {};

	updateSessionEnvValue(env, true);

	assert.deepEqual(env, {});
});
