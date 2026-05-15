import { complete, type Api, type Model, type UserMessage } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { ExtractedMessage } from "../domain/index.ts";

const CODEX_MODEL_ID = "gpt-5.1-codex-mini";
const HAIKU_MODEL_ID = "claude-haiku-4-5";

const SUMMARIZATION_SYSTEM_PROMPT = `You are a conversation summarizer. Create concise, accurate summaries that preserve key information, decisions, and outcomes.`;

const TURN_SUMMARY_PROMPT = `Summarize what happened in this conversation since the last user prompt. Focus on:
- What was accomplished
- Any decisions made
- Files that were read, modified, or created
- Any errors or issues encountered
- Current state/next steps

Be concise but comprehensive. Preserve exact file paths, function names, and error messages.`;

export type CompletionFn = typeof complete;

export async function selectSummarizationModel(
	currentModel: Model<Api> | undefined,
	modelRegistry: ModelRegistry,
): Promise<Model<Api> | undefined> {
	const codexModel = modelRegistry.find("openai-codex", CODEX_MODEL_ID);
	if (codexModel) {
		const auth = await modelRegistry.getApiKeyAndHeaders(codexModel);
		if (auth.ok) return codexModel;
	}

	const haikuModel = modelRegistry.find("anthropic", HAIKU_MODEL_ID);
	if (haikuModel) {
		const auth = await modelRegistry.getApiKeyAndHeaders(haikuModel);
		if (auth.ok) return haikuModel;
	}

	return currentModel;
}

export async function summarizeConversation(
	messages: Pick<ExtractedMessage, "role" | "content">[],
	model: Model<Api>,
	auth: { apiKey?: string; headers?: Record<string, string> },
	completeFn: CompletionFn = complete,
): Promise<{ summary: string; model: string }> {
	const conversationText = messages
		.map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
		.join("\n\n");

	const userMessage: UserMessage = {
		role: "user",
		content: [{ type: "text", text: `<conversation>\n${conversationText}\n</conversation>\n\n${TURN_SUMMARY_PROMPT}` }],
		timestamp: Date.now(),
	};

	const response = await completeFn(
		model,
		{ systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: [userMessage] },
		{ apiKey: auth.apiKey, headers: auth.headers },
	);

	if (response.stopReason === "aborted" || response.stopReason === "error") {
		throw new Error("Summarization failed");
	}

	const summary = response.content
		.filter((content): content is { type: "text"; text: string } => content.type === "text")
		.map((content) => content.text)
		.join("\n");

	return { summary, model: model.id };
}
