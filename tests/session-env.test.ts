import test from "node:test";
import assert from "node:assert/strict";

import { getSessionEnvValue } from "../src/infra/session-env.ts";

test("getSessionEnvValue returns session id when enabled", () => {
	assert.equal(getSessionEnvValue(true, "session-1"), "session-1");
});

test("getSessionEnvValue returns undefined when disabled", () => {
	assert.equal(getSessionEnvValue(false, "session-1"), undefined);
});

test("getSessionEnvValue returns undefined when enabled without session id", () => {
	assert.equal(getSessionEnvValue(true), undefined);
});
