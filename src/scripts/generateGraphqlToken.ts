import { randomBytes } from 'node:crypto';
import { hashToken } from '../middleware/bearerAuth.js';

/**
 * Generates a random GraphQL API token (256 bits of entropy) and its SHA-256 hash.
 * Only the hash is stored on the server; the token is given to the API client.
 */
const token = `fbw_${randomBytes(32).toString('base64url')}`;
const tokenHash = hashToken(token).toString('hex');

console.log('GraphQL API token (give it to your client, it will not be shown again):');
console.log(`  ${token}`);
console.log('');
console.log("Add this line to the server's .env file:");
console.log(`  GRAPHQL_API_TOKEN_HASH=${tokenHash}`);
