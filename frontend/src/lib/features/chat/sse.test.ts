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

	it('parses tool_call events', async () => {
		const stream = createStream([
			'event: tool_call\ndata: {"id":"toolu_123","name":"search_documents"}\n\n',
		]);
		const events = await collectEvents(stream);
		expect(events).toHaveLength(1);
		expect(events[0].event).toBe('tool_call');
		const data = JSON.parse(events[0].data);
		expect(data.id).toBe('toolu_123');
		expect(data.name).toBe('search_documents');
	});

	it('parses tool_result events', async () => {
		const stream = createStream([
			'event: tool_result\ndata: {"id":"toolu_123","status":"complete","resultCount":5}\n\n',
		]);
		const events = await collectEvents(stream);
		expect(events).toHaveLength(1);
		expect(events[0].event).toBe('tool_result');
		const data = JSON.parse(events[0].data);
		expect(data.status).toBe('complete');
		expect(data.resultCount).toBe(5);
	});

	it('parses text_delta events', async () => {
		const stream = createStream([
			'event: text_delta\ndata: {"text":"Hello world"}\n\n',
		]);
		const events = await collectEvents(stream);
		expect(events).toHaveLength(1);
		expect(events[0].event).toBe('text_delta');
		expect(JSON.parse(events[0].data).text).toBe('Hello world');
	});

	it('parses citations_delta events', async () => {
		const citation = {
			type: 'char_location',
			cited_text: 'The document states...',
			document_index: 0,
			document_title: 'flight-log.pdf',
			source: '/documents/abc-123',
		};
		const stream = createStream([
			`event: citations_delta\ndata: {"citation":${JSON.stringify(citation)}}\n\n`,
		]);
		const events = await collectEvents(stream);
		expect(events).toHaveLength(1);
		expect(events[0].event).toBe('citations_delta');
		const data = JSON.parse(events[0].data);
		expect(data.citation.type).toBe('char_location');
		expect(data.citation.source).toBe('/documents/abc-123');
	});

	it('parses error events', async () => {
		const stream = createStream([
			'event: error\ndata: {"message":"API rate limited"}\n\n',
		]);
		const events = await collectEvents(stream);
		expect(events).toHaveLength(1);
		expect(events[0].event).toBe('error');
		expect(JSON.parse(events[0].data).message).toBe('API rate limited');
	});

	it('parses done events', async () => {
		const stream = createStream([
			'event: done\ndata: {"model":"claude-sonnet-4-6"}\n\n',
		]);
		const events = await collectEvents(stream);
		expect(events).toHaveLength(1);
		expect(events[0].event).toBe('done');
	});

	it('parses mixed event stream in correct order', async () => {
		const stream = createStream([
			'event: tool_call\ndata: {"id":"t1","name":"search_documents"}\n\n',
			'event: tool_result\ndata: {"id":"t1","status":"complete","resultCount":3}\n\n',
			'event: text_delta\ndata: {"text":"Based on "}\n\n',
			'event: text_delta\ndata: {"text":"the documents..."}\n\n',
			'event: citations_delta\ndata: {"citation":{"type":"char_location","cited_text":"test","document_index":0,"document_title":"doc.pdf","source":"/documents/x"}}\n\n',
			'event: done\ndata: {}\n\n',
		]);
		const events = await collectEvents(stream);
		expect(events).toHaveLength(6);
		expect(events[0].event).toBe('tool_call');
		expect(events[1].event).toBe('tool_result');
		expect(events[2].event).toBe('text_delta');
		expect(events[3].event).toBe('text_delta');
		expect(events[4].event).toBe('citations_delta');
		expect(events[5].event).toBe('done');
	});

	it('accumulates multiple text_delta events correctly', async () => {
		const stream = createStream([
			'event: text_delta\ndata: {"text":"Hello "}\n\n',
			'event: text_delta\ndata: {"text":"world"}\n\n',
			'event: text_delta\ndata: {"text":"!"}\n\n',
		]);
		const events = await collectEvents(stream);
		expect(events).toHaveLength(3);
		const fullText = events.map((e) => JSON.parse(e.data).text).join('');
		expect(fullText).toBe('Hello world!');
	});
});
