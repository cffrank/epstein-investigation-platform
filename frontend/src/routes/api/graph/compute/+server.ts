import { neo4jClient } from "$lib/server/neo4j";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ platform }) => {
	if (!platform) {
		return json({ error: "Platform not available" }, { status: 500 });
	}

	const client = neo4jClient(platform);

	async function dropProjection() {
		try {
			await client.query(
				`CALL gds.graph.list() YIELD graphName
				 WHERE graphName = 'entity-analysis'
				 CALL gds.graph.drop(graphName) YIELD graphName AS dropped
				 RETURN dropped`,
			);
		} catch {
			// Projection may not exist, ignore errors
		}
	}

	try {
		// Clean up any stale projection
		await dropProjection();

		// Project the entity subgraph
		await client.query(
			`CALL gds.graph.project(
				'entity-analysis',
				['Person', 'Organization', 'Location'],
				{ ALL: { type: '*', orientation: 'UNDIRECTED' } }
			)`,
		);

		// Run PageRank
		await client.query(
			`CALL gds.pageRank.write('entity-analysis', {
				writeProperty: 'pagerank',
				maxIterations: 20,
				dampingFactor: 0.85
			})`,
		);

		// Run Louvain community detection
		await client.query(
			`CALL gds.louvain.write('entity-analysis', {
				writeProperty: 'communityId'
			})`,
		);

		// Run Betweenness centrality with sampling
		await client.query(
			`CALL gds.betweenness.write('entity-analysis', {
				writeProperty: 'betweenness',
				samplingSize: 1000,
				samplingSeed: 42
			})`,
		);

		// Drop the projection after successful computation
		await client.query(`CALL gds.graph.drop('entity-analysis')`);

		// Store computation timestamp
		await client.query(
			`MERGE (m:Metadata {key: 'algorithm_last_computed'})
			 SET m.value = toString(datetime())`,
		);

		const now = new Date().toISOString();
		return json({ success: true, timestamp: now });
	} catch (error) {
		console.error("Graph computation error:", error);
		return json(
			{ error: error instanceof Error ? error.message : "Computation failed" },
			{ status: 500 },
		);
	} finally {
		// Ensure projection is cleaned up even on error
		await dropProjection();
	}
};
