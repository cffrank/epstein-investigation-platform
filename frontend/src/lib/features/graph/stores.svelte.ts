interface CytoscapeElement {
	data: {
		id: string;
		label: string;
		type: string;
		connections?: number;
	};
}

interface CytoscapeEdge {
	data: {
		id: string;
		source: string;
		target: string;
		label: string;
	};
}

interface GraphResponse {
	nodes: CytoscapeElement[];
	edges: CytoscapeEdge[];
	error?: string;
}

let elements = $state<Array<CytoscapeElement | CytoscapeEdge>>([]);
let expandedNodes = $state<Set<string>>(new Set());
let selectedNode = $state<string | null>(null);
let loading = $state(false);
let error = $state<string | null>(null);

async function callGraphApi(action: string, params: Record<string, unknown>): Promise<GraphResponse> {
	const response = await fetch('/api/graph', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action, ...params })
	});

	if (!response.ok) {
		const data = await response.json();
		throw new Error(data.error || 'Graph API request failed');
	}

	return response.json();
}

export function searchEntities(query: string) {
	loading = true;
	error = null;

	callGraphApi('search', { query })
		.then((data) => {
			if (data.error) {
				error = data.error;
				return;
			}
			// Clear existing and set new nodes
			elements = [...data.nodes];
			expandedNodes.clear();
			selectedNode = null;
		})
		.catch((err) => {
			error = err.message;
			console.error('Search error:', err);
		})
		.finally(() => {
			loading = false;
		});
}

export function expandNode(nodeId: string) {
	if (expandedNodes.has(nodeId)) return;

	loading = true;
	error = null;

	callGraphApi('neighbors', { nodeId })
		.then((data) => {
			if (data.error) {
				error = data.error;
				return;
			}

			// Mark as expanded
			expandedNodes.add(nodeId);

			// Merge new nodes and edges, avoiding duplicates
			const existingIds = new Set(elements.map((el) => el.data.id));

			const newNodes = data.nodes.filter((node) => !existingIds.has(node.data.id));
			const newEdges = data.edges.filter((edge) => !existingIds.has(edge.data.id));

			elements = [...elements, ...newNodes, ...newEdges];
		})
		.catch((err) => {
			error = err.message;
			console.error('Expand error:', err);
		})
		.finally(() => {
			loading = false;
		});
}

export function findPath(from: string, to: string) {
	loading = true;
	error = null;

	callGraphApi('path', { from, to })
		.then((data) => {
			if (data.error) {
				error = data.error;
				return;
			}

			// Replace graph with path
			elements = [...data.nodes, ...data.edges];
			expandedNodes.clear();
			selectedNode = null;
		})
		.catch((err) => {
			error = err.message;
			console.error('Path error:', err);
		})
		.finally(() => {
			loading = false;
		});
}

export function resetGraph() {
	elements = [];
	expandedNodes.clear();
	selectedNode = null;
	error = null;
}

export function selectNode(nodeId: string | null) {
	selectedNode = nodeId;
}

export function getElements() {
	return elements;
}

export function getSelectedNode() {
	return selectedNode;
}

export function getLoading() {
	return loading;
}

export function getError() {
	return error;
}

export function getStats() {
	const nodes = elements.filter((el) => !('source' in el.data));
	const edges = elements.filter((el) => 'source' in el.data);
	return {
		nodeCount: nodes.length,
		edgeCount: edges.length
	};
}
