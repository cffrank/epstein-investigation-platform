import type { ChatMessage, Citation } from '$lib/types';
import { parseSSE } from './sse';

let messages = $state<ChatMessage[]>([]);
let citations = $state<Citation[]>([]);
let isStreaming = $state(false);
let input = $state('');

export const chatStore = {
	get messages() {
		return messages;
	},
	get citations() {
		return citations;
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

	async sendMessage(content: string) {
		if (!content.trim() || isStreaming) return;

		const userMessage: ChatMessage = { role: 'user', content: content.trim() };
		messages.push(userMessage);
		input = '';
		isStreaming = true;

		const assistantMessage: ChatMessage = { role: 'assistant', content: '' };
		messages.push(assistantMessage);

		try {
			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ messages })
			});

			if (!response.ok) {
				throw new Error(`Chat API error: ${response.status}`);
			}

			if (!response.body) {
				throw new Error('No response body');
			}

			for await (const event of parseSSE(response.body)) {
				if (event.event === 'citations') {
					citations = JSON.parse(event.data);
				} else if (event.event === 'delta') {
					const delta = JSON.parse(event.data);
					if (delta.content) {
						assistantMessage.content += delta.content;
						messages = [...messages];
					}
				} else if (event.event === 'done') {
					break;
				}
			}
		} catch (error) {
			console.error('Chat error:', error);
			assistantMessage.content = 'Sorry, an error occurred while processing your request.';
			messages = [...messages];
		} finally {
			isStreaming = false;
		}
	},

	clearChat() {
		messages = [];
		citations = [];
		input = '';
	}
};
