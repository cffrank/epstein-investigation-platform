export interface SSEEvent {
	event: string;
	data: string;
}

export async function* parseSSE(
	stream: ReadableStream<Uint8Array>
): AsyncGenerator<SSEEvent> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n\n');
			buffer = lines.pop() || '';

			for (const chunk of lines) {
				if (!chunk.trim()) continue;

				const eventLines = chunk.split('\n');
				let event = 'message';
				let data = '';

				for (const line of eventLines) {
					if (line.startsWith('event:')) {
						event = line.slice(6).trim();
					} else if (line.startsWith('data:')) {
						data += line.slice(5).trim();
					}
				}

				if (data) {
					yield { event, data };
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}
