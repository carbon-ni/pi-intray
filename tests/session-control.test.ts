import test from "node:test";
import assert from "node:assert/strict";

import {
	isSafeAlias,
	isSafeSessionId,
	normalizeMode,
	normalizeWaitUntil,
	isSessionControlRequested,
	parseCommand,
	parseSessionControlAction,
} from "../src/domain/index.ts";

test("parseCommand accepts valid send command", () => {
	const result = parseCommand(JSON.stringify({ type: "send", message: "hello", mode: "steer" }));

	assert.equal(result.error, undefined);
	assert.deepEqual(result.command, { type: "send", message: "hello", mode: "steer" });
});

test("parseCommand rejects malformed JSON", () => {
	const result = parseCommand("{ nope");

	assert.equal(result.command, undefined);
	assert.match(result.error ?? "", /JSON|property|parse|Expected/i);
});

test("parseCommand rejects missing command type", () => {
	const result = parseCommand(JSON.stringify({ message: "hello" }));

	assert.equal(result.command, undefined);
	assert.equal(result.error, "Missing command type");
});

test("parseCommand rejects non-object JSON values", () => {
	assert.deepEqual(parseCommand("null"), { error: "Invalid command" });
	assert.deepEqual(parseCommand('"send"'), { error: "Invalid command" });
});

test("session ids and aliases reject path traversal", () => {
	assert.equal(isSafeSessionId("abc-123"), true);
	assert.equal(isSafeSessionId(""), false);
	assert.equal(isSafeSessionId("../abc"), false);
	assert.equal(isSafeSessionId("a/b"), false);
	assert.equal(isSafeSessionId("a\\b"), false);

	assert.equal(isSafeAlias("main-session"), true);
	assert.equal(isSafeAlias(""), false);
	assert.equal(isSafeAlias("../main"), false);
	assert.equal(isSafeAlias("main/session"), false);
	assert.equal(isSafeAlias("main\\session"), false);
});

test("normalizeMode accepts documented aliases", () => {
	assert.equal(normalizeMode("steer"), "steer");
	assert.equal(normalizeMode(" follow-up "), "follow_up");
	assert.equal(normalizeMode("followup"), "follow_up");
	assert.equal(normalizeMode("follow_up"), "follow_up");
	assert.equal(normalizeMode("later"), null);
});

test("normalizeWaitUntil accepts documented aliases", () => {
	assert.equal(normalizeWaitUntil("turn_end"), "turn_end");
	assert.equal(normalizeWaitUntil("turn-end"), "turn_end");
	assert.equal(normalizeWaitUntil(" message-processed "), "message_processed");
	assert.equal(normalizeWaitUntil("message_processed"), "message_processed");
	assert.equal(normalizeWaitUntil("done"), null);
});

test("isSessionControlRequested accepts long and shorthand flags", () => {
	const noFlags = () => undefined;
	assert.equal(isSessionControlRequested(noFlags, ["--session-control"]), true);
	assert.equal(isSessionControlRequested(noFlags, ["--sc"]), true);
	assert.equal(isSessionControlRequested((name) => name === "session-control", []), true);
	assert.equal(isSessionControlRequested((name) => name === "sc", []), true);
	assert.equal(isSessionControlRequested(noFlags, []), false);
});

test("parseSessionControlAction accepts runtime control actions", () => {
	assert.deepEqual(parseSessionControlAction(""), { action: "status" });
	assert.deepEqual(parseSessionControlAction(" start "), { action: "start" });
	assert.deepEqual(parseSessionControlAction("stop"), { action: "stop" });
	assert.deepEqual(parseSessionControlAction("status"), { action: "status" });
});

test("parseSessionControlAction rejects unknown or extra arguments", () => {
	assert.deepEqual(parseSessionControlAction("restart"), {
		error: "Unknown session-control action: restart. Use start|stop|status.",
	});
	assert.deepEqual(parseSessionControlAction("start now"), {
		error: "Too many arguments. Use /session-control start|stop|status.",
	});
});
