import { describe, it, expect } from 'vitest';
import { parseSSE, type SSEEvent } from './sse';

function createStream(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		}
	});
}

async function collectEvents(stream: ReadableStream<Uint8Array>): Promise<SSEEvent[]> {
	const events: SSEEvent[] = [];
	for await (const event of parseSSE(stream)) {
		events.push(event);
	}
	return events;
}

describe('parseSSE', () => {
	it('parses single event with data', async () => {
		const stream = createStream(['data: hello\n\n']);
		const events = await collectEvents(stream);
		expect(events).toHaveLength(1);
		expect(events[0].data).toBe('hello');
		expect(events[0].event).toBe('message');
	});

	it('parses multiple events', async () => {
		const stream = createStream(['data: first\n\ndata: second\n\n']);
		const events = await collectEvents(stream);
		expect(events).toHaveLength(2);
		expect(events[0].data).toBe('first');
		expect(events[1].data).toBe('second');
	});

	it('correctly parses event type field', async () => {
		const stream = createStream(['event: delta\ndata: content\n\n']);
		const events = await collectEvents(stream);
		expect(events).toHaveLength(1);
		expect(events[0].event).toBe('delta');
		expect(events[0].data).toBe('content');
	});

	it('handles partial chunks (buffering across calls)', async () => {
		const stream = createStream(['data: hel', 'lo\n\n']);
		const events = await collectEvents(stream);
		expect(events).toHaveLength(1);
		expect(events[0].data).toBe('hello');
	});

	it('skips empty chunks', async () => {
		const stream = createStream(['\n\ndata: valid\n\n']);
		const events = await collectEvents(stream);
		expect(events).toHaveLength(1);
		expect(events[0].data).toBe('valid');
	});
});
