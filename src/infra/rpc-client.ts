import * as net from "node:net";
import type { ExtractedMessage, RpcCommand, RpcResponse, RpcSubscribeCommand } from "../domain/index.ts";

export interface RpcClientOptions {
	timeout?: number;
	waitForEvent?: "turn_end";
}

export async function sendRpcCommand(
	socketPath: string,
	command: RpcCommand,
	options: RpcClientOptions = {},
): Promise<{ response: RpcResponse; event?: { message?: ExtractedMessage; turnIndex?: number } }> {
	const { timeout = 5000, waitForEvent } = options;

	return new Promise((resolve, reject) => {
		const socket = net.createConnection(socketPath);
		socket.setEncoding("utf8");

		const timeoutHandle = setTimeout(() => {
			socket.destroy(new Error("timeout"));
		}, timeout);

		let buffer = "";
		let response: RpcResponse | null = null;

		const cleanup = () => {
			clearTimeout(timeoutHandle);
			socket.removeAllListeners();
		};

		socket.on("connect", () => {
			socket.write(`${JSON.stringify(command)}\n`);

			// If waiting for turn_end, also subscribe
			if (waitForEvent === "turn_end") {
				const subscribeCmd: RpcSubscribeCommand = { type: "subscribe", event: "turn_end" };
				socket.write(`${JSON.stringify(subscribeCmd)}\n`);
			}
		});

		socket.on("data", (chunk) => {
			buffer += chunk;
			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				newlineIndex = buffer.indexOf("\n");
				if (!line) continue;

				try {
					const msg = JSON.parse(line);

					// Handle response
					if (msg.type === "response") {
						if (msg.command === command.type) {
							response = msg;
							// If not waiting for event, we're done
							if (!waitForEvent) {
								cleanup();
								socket.end();
								resolve({ response: response! });
								return;
							}
						}
						// Ignore subscribe response
						continue;
					}

					// Handle turn_end event
					if (msg.type === "event" && msg.event === "turn_end" && waitForEvent === "turn_end") {
						cleanup();
						socket.end();
						if (!response) {
							reject(new Error("Received event before response"));
							return;
						}
						resolve({ response: response!, event: msg.data || {} });
						return;
					}
				} catch {
					// Ignore parse errors, keep waiting
				}
			}
		});

		socket.on("error", (error) => {
			cleanup();
			reject(error);
		});
	});
}

