import { jwtVerify, createRemoteJWKSet } from 'jose';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS(team: string) {
	if (!jwks) {
		const url = new URL(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`);
		jwks = createRemoteJWKSet(url);
	}
	return jwks;
}

interface CFAccessPayload {
	email: string;
	name?: string;
	sub: string;
	aud: string[];
	iss: string;
}

export async function validateCFAccessJWT(
	token: string,
	team: string
): Promise<CFAccessPayload | null> {
	try {
		const keySet = getJWKS(team);
		const { payload } = await jwtVerify(token, keySet, {
			issuer: `https://${team}.cloudflareaccess.com`
		});
		return payload as unknown as CFAccessPayload;
	} catch {
		return null;
	}
}
