import test from "node:test";
import assert from "node:assert/strict";

import { createSocketState, disableControlServer } from "./control-runtime.ts";

function createThrowingContext(message: string): unknown {
	return {
		get hasUI() {
			throw new Error(message);
		},
		get sessionManager() {
			throw new Error(message);
		},
	};
}

test("disableControlServer ignores stale extension contexts", async () => {
	const state = createSocketState();
	const staleContext = createThrowingContext("This extension ctx is stale after session replacement or reload");

	await assert.doesNotReject(disableControlServer(state, staleContext as never));
});

test("disableControlServer still reports unexpected context errors", async () => {
	const state = createSocketState();
	const brokenContext = createThrowingContext("unexpected failure");

	await assert.rejects(disableControlServer(state, brokenContext as never), /unexpected failure/);
});
