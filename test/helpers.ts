import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Shared test helpers for authentication testing
 */

/**
 * Helper function to compute HMAC signature
 * @param method HTTP method (GET, POST, etc.)
 * @param path Request path
 * @param timestamp Unix timestamp as string
 * @param nonce Random nonce
 * @param body Request body as string (empty string for GET requests)
 * @param secret API secret for HMAC computation
 * @returns HMAC signature in base64url format
 */
export function computeHmac(
    method: string,
    path: string,
    timestamp: string,
    nonce: string,
    body: string = '',
    secret: string
): string {
    // Hash the body with SHA256 for inclusion in canonical message
    const bodyHash = createHash('sha256').update(body).digest('base64url');
    const message = `method=${method.toUpperCase()};path=${path};ts=${timestamp};nonce=${nonce};body_sha256=${bodyHash}`;
    return createHmac('sha256', secret).update(message).digest('base64url');
}

/**
 * Helper function to get current Unix timestamp
 * @returns Unix timestamp in seconds as string
 */
export function getCurrentTimestamp(): string {
    return Math.floor(Date.now() / 1000).toString();
}

/**
 * Helper function to generate a random nonce
 * @returns Random hex string (32 characters)
 */
export function generateNonce(): string {
    return randomBytes(16).toString('hex');
}
