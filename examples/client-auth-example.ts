import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Example TypeScript client for authenticating with the Freebox Watcher API
 *
 * This demonstrates the correct way to send authenticated heartbeat requests.
 */

interface HeartbeatData {
    connection_state: string;
    timestamp: string;
    ipv4?: string;
    ipv6?: string;
    media_state?: string;
    connection_type?: string;
    bandwidth_down?: number;
    bandwidth_up?: number;
    rate_down?: number;
    rate_up?: number;
    bytes_down?: number;
    bytes_up?: number;
}

/**
 * Computes HMAC-SHA256 signature for the given message
 */
function computeHmac(message: string, secret: string): string {
    return createHmac('sha256', secret).update(message).digest('base64url');
}

/**
 * Builds the canonical message for HMAC signature
 * Format: method=POST;path=/heartbeat;ts=1733144872;nonce=89af77e23a;body_sha256=...
 */
function buildCanonicalMessage(
    method: string,
    path: string,
    timestamp: string,
    nonce: string,
    body: string
): string {
    // Hash the body with SHA256 for inclusion in canonical message
    const bodyHash = createHash('sha256').update(body).digest('base64url');
    return `method=${method.toUpperCase()};path=${path};ts=${timestamp};nonce=${nonce};body_sha256=${bodyHash}`;
}

/**
 * Generates a random nonce
 */
function generateNonce(): string {
    return randomBytes(8).toString('hex');
}

/**
 * Sends an authenticated heartbeat to the API
 */
async function sendHeartbeat(
    apiUrl: string,
    apiSecret: string,
    heartbeatData: HeartbeatData
): Promise<void> {
    // 1. Prepare the request
    const method = 'POST';
    const path = '/heartbeat'; // Important: without /api prefix
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = generateNonce();

    // 2. Serialize the body (must be identical to what will be sent)
    const body = JSON.stringify(heartbeatData);

    // 3. Build the canonical message
    const canonicalMessage = buildCanonicalMessage(method, path, timestamp, nonce, body);

    console.log('Debug info:');
    console.log('  Method:', method);
    console.log('  Path:', path);
    console.log('  Timestamp:', timestamp);
    console.log('  Nonce:', nonce);
    console.log('  Body length:', body.length);
    console.log('  Canonical message:', canonicalMessage);

    // 4. Compute the HMAC signature
    const signature = computeHmac(canonicalMessage, apiSecret);

    console.log('  Signature:', signature);

    // 5. Send the request with authentication headers
    const response = await fetch(`${apiUrl}/api/heartbeat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${signature}`,
            'Signature-Timestamp': timestamp,
            'Signature-Nonce': nonce,
        },
        body: body,
    });

    // 6. Handle the response
    const responseData = await response.json();

    if (!response.ok) {
        console.error('Request failed:', response.status, responseData);
        throw new Error(`HTTP ${response.status}: ${JSON.stringify(responseData)}`);
    }

    console.log('Success:', responseData);
}

// Example usage
async function main(): Promise<void> {
    // Configuration - MUST match server configuration
    const API_URL = process.env.API_URL || 'http://localhost:3001';
    const API_SECRET = process.env.API_SECRET;

    if (!API_SECRET) {
        throw new Error('API_SECRET environment variable is required');
    }

    // Example heartbeat data
    const heartbeatData: HeartbeatData = {
        connection_state: 'up',
        timestamp: new Date().toISOString(),
        ipv4: '192.168.1.100',
        connection_type: 'ethernet',
        bandwidth_down: 1000000,
        bandwidth_up: 500000,
    };

    try {
        await sendHeartbeat(API_URL, API_SECRET, heartbeatData);
    } catch (error) {
        console.error('Failed to send heartbeat:', error);
        process.exit(1);
    }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export { sendHeartbeat, buildCanonicalMessage, computeHmac, generateNonce };
