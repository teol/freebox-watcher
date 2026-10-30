import { createHash, timingSafeEqual } from 'node:crypto';
import { type FastifyReply, type preParsingHookHandler } from 'fastify';

/**
 * Length of a SHA-256 digest in bytes
 */
const SHA256_LENGTH = 32;

/**
 * Maximum accepted token length, to avoid hashing arbitrarily large header values
 */
const MAX_TOKEN_LENGTH = 512;

/**
 * Hashes a token with SHA-256
 * Tokens are high-entropy random values (256 bits), so a fast unsalted hash is
 * sufficient: brute-forcing the hash is as hard as brute-forcing the token itself.
 * @param token The plain token
 * @returns The SHA-256 digest
 */
export function hashToken(token: string): Buffer {
    return createHash('sha256').update(token, 'utf8').digest();
}

/**
 * Parses the configured SHA-256 token hash
 * @param hash The hash as a 64-character hexadecimal string
 * @returns The hash as a buffer
 * @throws Error if the hash is missing or malformed
 */
export function parseTokenHash(hash: string | undefined): Buffer {
    const normalizedHash = hash?.trim().toLowerCase() ?? '';

    if (!/^[0-9a-f]{64}$/.test(normalizedHash)) {
        throw new Error('Token hash must be a 64-character hexadecimal SHA-256 digest');
    }

    return Buffer.from(normalizedHash, 'hex');
}

/**
 * Sends a generic 401 response without revealing why authentication failed
 */
function rejectRequest(reply: FastifyReply): void {
    void reply.code(401).header('WWW-Authenticate', 'Bearer').send({
        error: 'Unauthorized',
        message: 'Authentication failed',
    });
}

/**
 * Checks an Authorization header against the expected token hash
 * The provided token is hashed and compared in constant time (both digests are 32 bytes).
 * @param authHeader The Authorization header value
 * @param expectedHash The SHA-256 digest of the valid token
 * @returns true if the header carries the valid Bearer token
 */
export function isAuthorized(
    authHeader: string | string[] | undefined,
    expectedHash: Buffer
): boolean {
    // Reject missing headers and headers sent multiple times
    if (typeof authHeader !== 'string') {
        return false;
    }

    const token = /^Bearer ([\x21-\x7e]+)$/i.exec(authHeader)?.[1];
    if (!token || token.length > MAX_TOKEN_LENGTH) {
        return false;
    }

    return timingSafeEqual(hashToken(token), expectedHash);
}

/**
 * Creates a Bearer token authentication hook
 *
 * Only the SHA-256 hash of the token is kept server-side, so leaking the configuration
 * does not leak a usable token. The token is only accepted from the Authorization header
 * (never from the query string).
 *
 * This is a preParsing hook so that it runs after the onRequest rate limiter (failed
 * attempts are rate limited) but before the body is parsed.
 *
 * @param expectedHash The SHA-256 digest of the valid token
 * @returns A Fastify preParsing hook
 */
export function createBearerAuth(expectedHash: Buffer): preParsingHookHandler {
    if (expectedHash.length !== SHA256_LENGTH) {
        throw new Error('Expected token hash must be a 32-byte SHA-256 digest');
    }

    return (request, reply, payload, done): void => {
        if (!isAuthorized(request.headers.authorization, expectedHash)) {
            rejectRequest(reply);
            return;
        }

        done(null, payload);
    };
}
