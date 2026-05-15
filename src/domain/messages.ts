export interface ExtractedMessage {
	role: "user" | "assistant";
	content: string;
	timestamp: number;
}
