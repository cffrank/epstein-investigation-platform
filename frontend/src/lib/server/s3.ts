import { createHmac } from 'node:crypto';

/**
 * Generate a pre-signed URL for an R2 object.
 * Uses S3-compatible V4 signing (simplified for GET requests).
 */
export function getPresignedUrl(
	platform: App.Platform,
	key: string,
	expiresIn = 3600
): string {
	const bucketUrl = platform.env.R2_BUCKET_URL;
	const accessKeyId = platform.env.R2_ACCESS_KEY_ID;
	const secretAccessKey = platform.env.R2_SECRET_ACCESS_KEY;

	const now = new Date();
	const dateStamp = now.toISOString().replace(/[-:]/g, '').slice(0, 8);
	const amzDate = dateStamp + 'T' + now.toISOString().replace(/[-:]/g, '').slice(9, 15) + 'Z';
	const region = 'auto';
	const service = 's3';
	const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

	const canonicalQueryString = [
		`X-Amz-Algorithm=AWS4-HMAC-SHA256`,
		`X-Amz-Credential=${encodeURIComponent(`${accessKeyId}/${credentialScope}`)}`,
		`X-Amz-Date=${amzDate}`,
		`X-Amz-Expires=${expiresIn}`,
		`X-Amz-SignedHeaders=host`
	]
		.sort()
		.join('&');

	const url = new URL(`/${key}`, bucketUrl);
	const canonicalRequest = [
		'GET',
		url.pathname,
		canonicalQueryString,
		`host:${url.host}\n`,
		'host',
		'UNSIGNED-PAYLOAD'
	].join('\n');

	const stringToSign = [
		'AWS4-HMAC-SHA256',
		amzDate,
		credentialScope,
		sha256(canonicalRequest)
	].join('\n');

	const signingKey = getSignatureKey(secretAccessKey, dateStamp, region, service);
	const signature = hmacHex(signingKey, stringToSign);

	return `${url.origin}${url.pathname}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

function sha256(data: string): string {
	return createHmac('sha256', '').update(data).digest('hex');
}

function hmac(key: string | Buffer, data: string): Buffer {
	return createHmac('sha256', key).update(data).digest();
}

function hmacHex(key: Buffer, data: string): string {
	return createHmac('sha256', key).update(data).digest('hex');
}

function getSignatureKey(
	key: string,
	dateStamp: string,
	region: string,
	service: string
): Buffer {
	const kDate = hmac(`AWS4${key}`, dateStamp);
	const kRegion = hmac(kDate, region);
	const kService = hmac(kRegion, service);
	return hmac(kService, 'aws4_request');
}
