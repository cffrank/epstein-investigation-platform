// R2 Sync script - lists all R2 objects and outputs as JSON
export async function listAllR2Objects(bucket: R2Bucket): Promise<string[]> {
	const allKeys: string[] = [];
	let cursor: string | undefined;
	let batch = 0;

	do {
		const listed = await bucket.list({ cursor, limit: 1000 });
		for (const obj of listed.objects) {
			allKeys.push(obj.key);
		}
		cursor = listed.truncated ? listed.cursor : undefined;
		batch++;
		if (batch % 100 === 0) {
			console.log(`Listed ${allKeys.length} objects...`);
		}
	} while (cursor);

	return allKeys;
}
