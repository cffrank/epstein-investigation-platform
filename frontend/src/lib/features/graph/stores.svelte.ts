interface AlgorithmResult {
	id: string;
	type: string;
	name: string;
	pagerank: number | null;
	communityId: number | null;
	betweenness: number | null;
	connections: number;
}

interface HiddenConnectionPair {
	personAId: string;
	personAName: string;
	personBId: string;
	personBName: string;
	sharedCount: number;
	topSharedNeighbors: Array<{ id: string; name: string; type: string }>;
}

interface CommunitySizeEntry {
	communityId: number;
	size: number;
}

interface CytoscapeElement {
	data: {
		id: string;
		label: string;
		type: string;
		connections?: number;
		pagerank?: number;
		communityId?: number;
		betweenness?: number;
	};
}

interface CytoscapeEdge {
	data: {
		id: string;
		source: string;
		target: string;
		label: string;
		lineStyle?: string;
	};
}

interface GraphResponse {
	nodes: CytoscapeElement[];
	edges: CytoscapeEdge[];
	error?: string;
	results?: AlgorithmResult[];
	communitySizes?: CommunitySizeEntry[];
	pairs?: HiddenConnectionPair[];
	lastComputed?: string | null;
	nodeCount?: number;
	success?: boolean;
	timestamp?: string;
}

// Existing core state
let elements = $state<Array<CytoscapeElement | CytoscapeEdge>>([]);
const expandedNodes = $state<Set<string>>(new Set());
let selectedNode = $state<string | null>(null);
let loading = $state(false);
let error = $state<string | null>(null);

// Algorithm state
let colorMode = $state<"type" | "community">("type");
let pagerankResults = $state<AlgorithmResult[]>([]);
let communityResults = $state<AlgorithmResult[]>([]);
let communitySizes = $state<CommunitySizeEntry[]>([]);
let bridgeResults = $state<AlgorithmResult[]>([]);
let hiddenConnections = $state<HiddenConnectionPair[]>([]);
let algorithmStatus = $state<{ lastComputed: string | null; nodeCount: number }>({
	lastComputed: null,
	nodeCount: 0,
});
let computing = $state(false);
let activeAlgorithm = $state<string | null>(null);

async function callGraphApi(
	action: string,
	params: Record<string, unknown>,
): Promise<GraphResponse> {
	const response = await fetch("/api/graph", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ action, ...params }),
	});

	if (!response.ok) {
		const data = await response.json();
		throw new Error(data.error || "Graph API request failed");
	}

	return response.json();
}

// --- Existing functions (unchanged) ---

export function searchEntities(query: string) {
	loading = true;
	error = null;

	callGraphApi("search", { query })
		.then((data) => {
			if (data.error) {
				error = data.error;
				return;
			}
			elements = [...data.nodes];
			expandedNodes.clear();
			selectedNode = null;
		})
		.catch((err) => {
			error = err.message;
			console.error("Search error:", err);
		})
		.finally(() => {
			loading = false;
		});
}

export function expandNode(nodeId: string) {
	if (expandedNodes.has(nodeId)) return;

	loading = true;
	error = null;

	callGraphApi("neighbors", { nodeId })
		.then((data) => {
			if (data.error) {
				error = data.error;
				return;
			}

			expandedNodes.add(nodeId);

			const existingIds = new Set(elements.map((el) => el.data.id));
			const newNodes = data.nodes.filter((node) => !existingIds.has(node.data.id));
			const newEdges = data.edges.filter((edge) => !existingIds.has(edge.data.id));

			elements = [...elements, ...newNodes, ...newEdges];
		})
		.catch((err) => {
			error = err.message;
			console.error("Expand error:", err);
		})
		.finally(() => {
			loading = false;
		});
}

export function findPath(from: string, to: string) {
	loading = true;
	error = null;

	callGraphApi("path", { from, to })
		.then((data) => {
			if (data.error) {
				error = data.error;
				return;
			}

			elements = [...data.nodes, ...data.edges];
			expandedNodes.clear();
			selectedNode = null;
		})
		.catch((err) => {
			error = err.message;
			console.error("Path error:", err);
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

// --- Existing getters ---

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
	const nodes = elements.filter((el) => !("source" in el.data));
	const edges = elements.filter((el) => "source" in el.data);
	return {
		nodeCount: nodes.length,
		edgeCount: edges.length,
	};
}

// --- Algorithm functions ---

function loadAlgorithmEntities(results: AlgorithmResult[]) {
	const top20 = results.slice(0, 20);
	const nodes: CytoscapeElement[] = top20.map((r) => ({
		data: {
			id: r.id,
			label: r.name,
			type: r.type,
			connections: r.connections,
			...(r.pagerank != null ? { pagerank: r.pagerank } : {}),
			...(r.communityId != null ? { communityId: r.communityId } : {}),
			...(r.betweenness != null ? { betweenness: r.betweenness } : {}),
		},
	}));
	elements = nodes;
	expandedNodes.clear();
	selectedNode = null;
}

export function loadAlgorithmStatus() {
	callGraphApi("algorithm-status", {})
		.then((data) => {
			algorithmStatus = {
				lastComputed: data.lastComputed ?? null,
				nodeCount: data.nodeCount ?? 0,
			};
		})
		.catch((err) => {
			console.error("Algorithm status error:", err);
		});
}

export function loadPageRank(limit = 25) {
	loading = true;
	error = null;
	activeAlgorithm = "pagerank";

	callGraphApi("pagerank", { limit })
		.then((data) => {
			if (data.error) {
				error = data.error;
				return;
			}
			pagerankResults = data.results ?? [];
			loadAlgorithmEntities(pagerankResults);
		})
		.catch((err) => {
			error = err.message;
			console.error("PageRank error:", err);
		})
		.finally(() => {
			loading = false;
		});
}

export function loadCommunities(limit = 25) {
	loading = true;
	error = null;
	activeAlgorithm = "communities";

	callGraphApi("communities", { limit })
		.then((data) => {
			if (data.error) {
				error = data.error;
				return;
			}
			communityResults = data.results ?? [];
			communitySizes = data.communitySizes ?? [];
			loadAlgorithmEntities(communityResults);
		})
		.catch((err) => {
			error = err.message;
			console.error("Communities error:", err);
		})
		.finally(() => {
			loading = false;
		});
}

export function loadBridges(limit = 25) {
	loading = true;
	error = null;
	activeAlgorithm = "bridges";

	callGraphApi("bridges", { limit })
		.then((data) => {
			if (data.error) {
				error = data.error;
				return;
			}
			bridgeResults = data.results ?? [];
			loadAlgorithmEntities(bridgeResults);
		})
		.catch((err) => {
			error = err.message;
			console.error("Bridges error:", err);
		})
		.finally(() => {
			loading = false;
		});
}

export function loadHiddenConnections() {
	loading = true;
	error = null;
	activeAlgorithm = "hidden-connections";

	callGraphApi("hidden-connections", {})
		.then((data) => {
			if (data.error) {
				error = data.error;
				return;
			}
			hiddenConnections = data.pairs ?? [];
		})
		.catch((err) => {
			error = err.message;
			console.error("Hidden connections error:", err);
		})
		.finally(() => {
			loading = false;
		});
}

export async function triggerComputation() {
	computing = true;
	error = null;

	try {
		const response = await fetch("/api/graph/compute", { method: "POST" });
		if (!response.ok) {
			const data = await response.json();
			throw new Error(data.error || "Computation failed");
		}
		loadAlgorithmStatus();
	} catch (err) {
		error = err instanceof Error ? err.message : "Computation failed";
		console.error("Computation error:", err);
	} finally {
		computing = false;
	}
}

export function loadHiddenConnectionPair(pair: HiddenConnectionPair) {
	loading = true;
	error = null;

	// Create nodes for both persons and shared neighbors
	const personANode: CytoscapeElement = {
		data: { id: pair.personAId, label: pair.personAName, type: "Person" },
	};
	const personBNode: CytoscapeElement = {
		data: { id: pair.personBId, label: pair.personBName, type: "Person" },
	};

	const sharedNodes: CytoscapeElement[] = pair.topSharedNeighbors.map((n) => ({
		data: { id: n.id, label: n.name, type: n.type },
	}));

	// Create edges from shared neighbors to each person
	const edges: CytoscapeEdge[] = [];
	for (const neighbor of pair.topSharedNeighbors) {
		edges.push({
			data: {
				id: `edge-${neighbor.id}-${pair.personAId}`,
				source: neighbor.id,
				target: pair.personAId,
				label: "shared",
			},
		});
		edges.push({
			data: {
				id: `edge-${neighbor.id}-${pair.personBId}`,
				source: neighbor.id,
				target: pair.personBId,
				label: "shared",
			},
		});
	}

	// Add the hidden/dashed edge between the pair
	edges.push({
		data: {
			id: `hidden-${pair.personAId}-${pair.personBId}`,
			source: pair.personAId,
			target: pair.personBId,
			label: "hidden",
			lineStyle: "dashed",
		},
	});

	elements = [personANode, personBNode, ...sharedNodes, ...edges];
	expandedNodes.clear();
	selectedNode = null;
	loading = false;
}

export function setColorMode(mode: "type" | "community") {
	colorMode = mode;
}

// --- Algorithm getters ---

export function getColorMode() {
	return colorMode;
}

export function getPagerankResults() {
	return pagerankResults;
}

export function getCommunityResults() {
	return communityResults;
}

export function getCommunitySizes() {
	return communitySizes;
}

export function getBridgeResults() {
	return bridgeResults;
}

export function getHiddenConnections() {
	return hiddenConnections;
}

export function getAlgorithmStatus() {
	return algorithmStatus;
}

export function getComputing() {
	return computing;
}

export function getActiveAlgorithm() {
	return activeAlgorithm;
}
