import test from "node:test";
import assert from "node:assert/strict";

import { selectSummarizationModel, summarizeConversation, type CompletionFn } from "../src/infra/summarizer.ts";

test("selectSummarizationModel prefers authenticated codex model", async () => {
	const currentModel = { id: "current" } as any;
	const codexModel = { id: "gpt-5.1-codex-mini" } as any;
	const haikuModel = { id: "claude-haiku-4-5" } as any;
	const registry = {
		find: (_provider: string, id: string) => id === codexModel.id ? codexModel : id === haikuModel.id ? haikuModel : undefined,
		getApiKeyAndHeaders: async (model: any) => ({ ok: model === codexModel, apiKey: "key", headers: {} }),
	} as any;

	assert.equal(await selectSummarizationModel(currentModel, registry), codexModel);
});

test("selectSummarizationModel falls back to current model when preferred models are unavailable", async () => {
	const currentModel = { id: "current" } as any;
	const registry = {
		find: () => undefined,
		getApiKeyAndHeaders: async () => ({ ok: false }),
	} as any;

	assert.equal(await selectSummarizationModel(currentModel, registry), currentModel);
});

test("summarizeConversation returns joined text content and model id", async () => {
	const model = { id: "summary-model" } as any;
	const completeFn: CompletionFn = async () => ({
		stopReason: "stop",
		content: [
			{ type: "text", text: "first" },
			{ type: "text", text: " second" },
		],
	} as any);

	const summary = await summarizeConversation(
		[
			{ role: "user", content: "Hi" },
			{ role: "assistant", content: "Hello" },
		],
		model,
		{ apiKey: "key", headers: {} },
		completeFn,
	);

	assert.deepEqual(summary, { summary: "first\n second", model: "summary-model" });
});

test("summarizeConversation reports model failures", async () => {
	const completeFn: CompletionFn = async () => ({ stopReason: "error", content: [] } as any);

	await assert.rejects(
		summarizeConversation([{ role: "user", content: "Hi" }], { id: "m" } as any, { apiKey: "key", headers: {} }, completeFn),
		/Summarization failed/,
	);
});
