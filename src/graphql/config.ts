import { timingSafeEqual } from 'node:crypto';
import { hashToken, parseTokenHash } from '../middleware/bearerAuth.js';

/**
 * Default maximum number of requests per minute on the GraphQL endpoint
 */
const DEFAULT_RATE_LIMIT = 60;

export interface GraphqlConfig {
    /** SHA-256 digest of the Bearer token */
    tokenHash: Buffer;
    /** Maximum number of requests per minute */
    rateLimitMax: number;
}

/**
 * Returns true when the GraphQL API is enabled (disabled unless GRAPHQL_ENABLED is 'true')
 */
export function isGraphqlEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.GRAPHQL_ENABLED === 'true';
}

/**
 * Loads and validates the GraphQL API configuration
 * Fails closed: an enabled API with a missing or invalid configuration prevents startup.
 * @param env Environment variables
 * @returns The GraphQL configuration
 * @throws Error if the configuration is invalid
 */
export function loadGraphqlConfig(env: NodeJS.ProcessEnv = process.env): GraphqlConfig {
    let tokenHash: Buffer;
    try {
        tokenHash = parseTokenHash(env.GRAPHQL_API_TOKEN_HASH);
    } catch {
        throw new Error(
            'GRAPHQL_API_TOKEN_HASH must be a 64-character hexadecimal SHA-256 digest when GRAPHQL_ENABLED is true (generate one with "yarn graphql:token")'
        );
    }

    const apiSecret = env.API_SECRET?.trim();
    if (apiSecret && timingSafeEqual(hashToken(apiSecret), tokenHash)) {
        throw new Error('GraphQL API token must differ from API_SECRET');
    }

    const rawRateLimit = env.GRAPHQL_RATE_LIMIT?.trim();
    const rateLimitMax = rawRateLimit ? Number(rawRateLimit) : DEFAULT_RATE_LIMIT;
    if (!Number.isInteger(rateLimitMax) || rateLimitMax < 1 || rateLimitMax > 10000) {
        throw new Error('GRAPHQL_RATE_LIMIT must be an integer between 1 and 10000');
    }

    return { tokenHash, rateLimitMax };
}
