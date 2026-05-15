import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";

import { createRpcServer } from "../src/infra/rpc-server.ts";
import type { RpcCommand } from "../src/domain/index.ts";

async function withSocketServer(run: (socketPath: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(path.join(tmpdir(), "pi-intray-rpc-server-"));
	try {
		await run(path.join(dir, "server.sock"));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

async function sendLine(socketPath: string, line: string): Promise<string> {
	return await new Promise((resolve, reject) => {
		const socket = net.createConnection(socketPath);
		socket.setEncoding("utf8");
		let buffer = "";
		socket.on("connect", () => socket.write(`${line}\n`));
		socket.on("data", (chunk) => {
			buffer += chunk;
			const newlineIndex = buffer.indexOf("\n");
			if (newlineIndex === -1) return;
			const response = buffer.slice(0, newlineIndex);
			socket.end();
			resolve(response);
		});
		socket.on("error", reject);
	});
}

test("createRpcServer dispatches parsed commands to handler", async () => {
	await withSocketServer(async (socketPath) => {
		let received: RpcCommand | undefined;
		const server = await createRpcServer(socketPath, (command, socket) => {
			received = command;
			socket.write(`${JSON.stringify({ type: "response", command: command.type, success: true })}\n`);
		});
		try {
			const response = await sendLine(socketPath, JSON.stringify({ type: "get_message" }));

			assert.deepEqual(received, { type: "get_message" });
			assert.deepEqual(JSON.parse(response), { type: "response", command: "get_message", success: true });
		} finally {
			server.close();
		}
	});
});

test("createRpcServer returns parse errors without dispatching invalid commands", async () => {
	await withSocketServer(async (socketPath) => {
		let dispatched = false;
		let parseErrorObserved = false;
		const server = await createRpcServer(
			socketPath,
			() => {
				dispatched = true;
			},
			() => {
				parseErrorObserved = true;
			},
		);
		try {
			const response = await sendLine(socketPath, "{ nope");

			assert.equal(dispatched, false);
			assert.equal(parseErrorObserved, true);
			assert.equal(JSON.parse(response).success, false);
			assert.equal(JSON.parse(response).command, "parse");
		} finally {
			server.close();
		}
	});
});
