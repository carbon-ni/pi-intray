export interface SenderInfo {
	sessionId: string;
	sessionName?: string;
}

export function appendReplyInstruction(message: string, senderInfo?: SenderInfo | null): string {
	if (!senderInfo?.sessionId) {
		return message;
	}

	const senderInfoPayload = JSON.stringify({
		sessionId: senderInfo.sessionId,
		sessionName: senderInfo.sessionName || undefined,
	});

	return `${message}\n\n<reply_instruction>When responding, reply directly to the sender by calling send_to_session with the sessionId from sender_info. Do not use get_message polling.</reply_instruction>\n\n<sender_info>${senderInfoPayload}</sender_info>`;
}
