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
} from "./index.ts";

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

test("isSessionControlRequested accepts only intray flags", () => {
	const noFlags = () => undefined;
	assert.equal(isSessionControlRequested(noFlags, ["--intray"]), true);
	assert.equal(isSessionControlRequested(noFlags, ["--in"]), true);
	assert.equal(isSessionControlRequested((name) => name === "intray", []), true);
	assert.equal(isSessionControlRequested((name) => name === "in", []), true);
	assert.equal(isSessionControlRequested(noFlags, ["--pi-intray"]), false);
	assert.equal(isSessionControlRequested(noFlags, ["--session-control"]), false);
	assert.equal(isSessionControlRequested(noFlags, ["--sc"]), false);
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
		error: "Unknown intray action: restart. Use start|stop|status.",
	});
	assert.deepEqual(parseSessionControlAction("start now"), {
		error: "Too many arguments. Use /intray start|stop|status.",
	});
});
