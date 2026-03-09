import type { ChatMessage, ModelKey, NativeCitation } from "$lib/types";
import { parseSSE } from "./sse";

// Model selection persists in localStorage
function getStoredModel(): ModelKey {
	if (typeof window === "undefined") return "sonnet-4.6";
	return (localStorage.getItem("chat-model") as ModelKey) || "sonnet-4.6";
}

let messages = $state<ChatMessage[]>([]);
let isStreaming = $state(false);
let input = $state("");
let selectedModel = $state<ModelKey>(getStoredModel());

export const chatStore = {
	get messages() {
		return messages;
	},
	get isStreaming() {
		return isStreaming;
	},
	get input() {
		return input;
	},
	set input(value: string) {
		input = value;
	},
	get selectedModel() {
		return selectedModel;
	},
	set selectedModel(value: ModelKey) {
		selectedModel = value;
		if (typeof window !== "undefined") localStorage.setItem("chat-model", value);
	},

	async sendMessage(content: string) {
		if (!content.trim() || isStreaming) return;

		const userMessage: ChatMessage = { role: "user", content: content.trim() };
		messages.push(userMessage);
		input = "";
		isStreaming = true;

		const assistantMessage: ChatMessage = {
			role: "assistant",
			content: "",
			toolCalls: [],
			citations: [],
		};
		messages.push(assistantMessage);

		try {
			const response = await fetch("/api/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					messages: messages
						.filter((m) => m.role === "user" || m.role === "assistant")
						.map((m) => ({ role: m.role, content: m.content })),
					model: selectedModel,
				}),
			});

			if (!response.ok) {
				throw new Error(`Chat API error: ${response.status}`);
			}

			if (!response.body) {
				throw new Error("No response body");
			}

			for await (const event of parseSSE(response.body)) {
				switch (event.event) {
					case "tool_call": {
						const data = JSON.parse(event.data) as {
							id: string;
							name: string;
							input?: Record<string, unknown>;
						};
						assistantMessage.toolCalls = [
							...(assistantMessage.toolCalls || []),
							{
								id: data.id,
								name: data.name,
								input: data.input,
								status: "running" as const,
							},
						];
						messages = [...messages];
						break;
					}
					case "tool_result": {
						const data = JSON.parse(event.data) as {
							id: string;
							status: string;
							resultCount?: number;
						};
						const tc = assistantMessage.toolCalls?.find((t) => t.id === data.id);
						if (tc) {
							tc.status = (data.status as "complete" | "error") || "complete";
							tc.resultCount = data.resultCount;
						}
						messages = [...messages];
						break;
					}
					case "text_delta": {
						const data = JSON.parse(event.data) as { text: string };
						assistantMessage.content += data.text;
						messages = [...messages];
						break;
					}
					case "citations_delta": {
						const data = JSON.parse(event.data) as { citation: NativeCitation };
						assistantMessage.citations = [...(assistantMessage.citations || []), data.citation];
						messages = [...messages];
						break;
					}
					case "error": {
						const data = JSON.parse(event.data) as { message: string };
						assistantMessage.content += `\n\n[Error: ${data.message}]`;
						messages = [...messages];
						break;
					}
					case "done":
						break;
					default:
						// Handle legacy 'delta' events for backward compat
						if (event.event === "delta") {
							const data = JSON.parse(event.data) as { content?: string };
							if (data.content) assistantMessage.content += data.content;
							messages = [...messages];
						}
				}
			}
		} catch (error) {
			console.error("Chat error:", error);
			assistantMessage.content =
				assistantMessage.content || "Sorry, an error occurred while processing your request.";
			messages = [...messages];
		} finally {
			isStreaming = false;
		}
	},

	clearChat() {
		messages = [];
		input = "";
	},
};
