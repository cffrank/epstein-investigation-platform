<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type cytoscape from 'cytoscape';

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

	let {
		elements = $bindable([]),
		onNodeTap,
		selectedNode = null
	}: {
		elements: Array<CytoscapeElement | CytoscapeEdge>;
		onNodeTap?: (nodeId: string) => void;
		selectedNode?: string | null;
	} = $props();

	let container: HTMLDivElement;
	let cy: cytoscape.Core | null = null;
	let Cytoscape: typeof cytoscape | null = null;

	onMount(async () => {
		// Dynamic import for browser-only code
		const module = await import('cytoscape');
		Cytoscape = module.default;

		if (!container || !Cytoscape) return;

		cy = Cytoscape({
			container,
			elements: [],
			style: [
				{
					selector: 'node',
					style: {
						'background-color': (ele: cytoscape.NodeSingular) => {
							const type = ele.data('type');
							switch (type) {
								case 'Person':
									return '#3b82f6'; // blue-500
								case 'Organization':
									return '#22c55e'; // green-500
								case 'Location':
									return '#f97316'; // orange-500
								default:
									return '#71717a'; // zinc-500
							}
						},
						label: 'data(label)',
						color: '#ffffff',
						'text-valign': 'center',
						'text-halign': 'center',
						'font-size': '10px',
						'font-weight': 'bold',
						'text-wrap': 'wrap',
						'text-max-width': '80px',
						width: (ele: cytoscape.NodeSingular) => {
							const connections = ele.data('connections') || ele.degree();
							return Math.max(20, Math.min(60, 20 + connections * 2));
						},
						height: (ele: cytoscape.NodeSingular) => {
							const connections = ele.data('connections') || ele.degree();
							return Math.max(20, Math.min(60, 20 + connections * 2));
						},
						shape: (ele: cytoscape.NodeSingular) => {
							const type = ele.data('type');
							switch (type) {
								case 'Person':
									return 'ellipse';
								case 'Organization':
									return 'diamond';
								case 'Location':
									return 'triangle';
								default:
									return 'ellipse';
							}
						}
					}
				},
				{
					selector: 'node:selected',
					style: {
						'border-width': '3px',
						'border-color': '#facc15' // yellow-400
					}
				},
				{
					selector: 'edge',
					style: {
						width: 2,
						'line-color': '#52525b', // zinc-600
						'target-arrow-color': '#52525b',
						'target-arrow-shape': 'triangle',
						'curve-style': 'bezier',
						label: 'data(label)',
						'font-size': '8px',
						color: '#71717a', // zinc-500
						'text-rotation': 'autorotate',
						'text-margin-y': -10
					}
				}
			],
			layout: {
				name: 'cose',
				animate: true,
				animationDuration: 500,
				animationEasing: 'ease-out',
				nodeRepulsion: 8000,
				idealEdgeLength: 100,
				edgeElasticity: 100,
				nestingFactor: 1.2,
				gravity: 1,
				numIter: 1000,
				randomize: false,
				componentSpacing: 100,
				nodeOverlap: 20
			},
			minZoom: 0.3,
			maxZoom: 3,
			wheelSensitivity: 0.2
		});

		// Handle node clicks
		cy.on('tap', 'node', (evt) => {
			const node = evt.target;
			onNodeTap?.(node.id());
		});
	});

	// Watch for element changes and update graph
	$effect(() => {
		if (!cy || !Cytoscape || elements.length === 0) return;

		const existingIds = new Set(cy.nodes().map((n) => n.id()));
		const newElements = elements.filter(
			(el) => !existingIds.has(el.data.id) && !existingIds.has(el.data.id)
		);

		if (newElements.length > 0) {
			cy.add(newElements);
			cy.layout({
				name: 'cose',
				animate: true,
				animationDuration: 500,
				fit: false,
				nodeRepulsion: 8000,
				idealEdgeLength: 100,
				edgeElasticity: 100
			}).run();
		} else if (elements.length > 0 && cy.nodes().length === 0) {
			// Initial load
			cy.add(elements);
			cy.layout({
				name: 'cose',
				animate: true,
				animationDuration: 500,
				fit: true,
				nodeRepulsion: 8000,
				idealEdgeLength: 100,
				edgeElasticity: 100
			}).run();
		}
	});

	// Watch for selected node changes
	$effect(() => {
		if (!cy) return;
		cy.nodes().unselect();
		if (selectedNode) {
			const node = cy.getElementById(selectedNode);
			if (node.length > 0) {
				node.select();
			}
		}
	});

	// Expose methods for controls
	export function fit() {
		cy?.fit(undefined, 50);
	}

	export function zoomIn() {
		const zoom = cy?.zoom();
		if (zoom) {
			cy?.zoom(zoom * 1.2);
		}
	}

	export function zoomOut() {
		const zoom = cy?.zoom();
		if (zoom) {
			cy?.zoom(zoom * 0.8);
		}
	}

	export function reset() {
		cy?.elements().remove();
	}

	onDestroy(() => {
		cy?.destroy();
	});
</script>

<div bind:this={container} class="h-full w-full bg-background"></div>
