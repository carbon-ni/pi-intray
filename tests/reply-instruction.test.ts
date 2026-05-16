import test from "node:test";
import assert from "node:assert/strict";

import { appendReplyInstruction } from "../src/domain/index.ts";

test("appendReplyInstruction leaves message unchanged without sender info", () => {
	assert.equal(appendReplyInstruction("hello", null), "hello");
	assert.equal(appendReplyInstruction("hello", { sessionId: "" }), "hello");
});

test("appendReplyInstruction adds reply instruction and sender info", () => {
	const result = appendReplyInstruction("please inspect this", {
		sessionId: "session-123",
		sessionName: "main",
	});

	assert.match(result, /^please inspect this/);
	assert.match(result, /<reply_instruction>When responding, reply directly to the sender by calling send_to_session/);
	assert.match(result, /<sender_info>/);
	assert.match(result, /"sessionId":"session-123"/);
	assert.match(result, /"sessionName":"main"/);
});
