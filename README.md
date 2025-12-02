# Freebox Watcher

A monitoring service for Freebox Delta that tracks uptime and alerts on downtime events.

## Overview

Freebox Watcher is a Node.js-based monitoring solution that receives HTTP heartbeat requests from [teol/freebox-heartbeat](https://github.com/teol/freebox-heartbeat) to track the availability and health of a Freebox Delta. The service stores heartbeat data in a MariaDB database and provides alerting capabilities when downtime is detected.

## Features

- 📡 HTTP heartbeat endpoint for receiving status updates
- 🔒 Secure HMAC-SHA256 authentication with timing-attack protection and replay prevention
- 🛡️ Rate limiting (5 requests per minute)
- 📊 MariaDB storage for heartbeat history
- 🔔 Automatic downtime detection (5 minutes without heartbeat)
- 📲 Telegram notifications for downtime alerts and recovery
- 📝 Structured logging with Pino
- ⚡ High-performance API built with Fastify

## Tech Stack

- **Runtime**: Node.js 22
- **Language**: TypeScript
- **Web Framework**: Fastify
- **Database**: MariaDB
- **Query Builder**: Knex.js with mysql2 driver
- **Logging**: Pino
- **Configuration**: dotenv
- **Reverse Proxy**: Caddy/Nginx (for production deployment)

## Prerequisites

- Node.js 22 or higher
- MariaDB 10.5 or higher
- Yarn 4 (included via this repository)

## Installation

1. Clone the repository:

```bash
git clone https://github.com/teol/freebox-watcher.git
cd freebox-watcher
```

2. Enable Corepack to use the pinned Yarn 4 version:

```bash
corepack enable
```

3. Install dependencies with Yarn (immutable to respect the lockfile):

```bash
yarn install --immutable
```

4. Configure environment variables:

```bash
cp .env.example .env
# Edit .env with your configuration
```

5. Run database migrations:

```bash
yarn db:migrate
```

6. Build the service:

```bash
yarn build
```

7. Start the service (runs the compiled output at `dist/src/index.js`):

```bash
yarn start
```

## Useful Scripts

- `yarn dev` - Run the API directly with ts-node
- `yarn watch` - Run the API in watch mode with automatic reloads
- `yarn build` - Compile the TypeScript sources to `dist`
- `yarn test` - Execute the test suite with Node's test runner
- `yarn db:migrate` - Apply pending database migrations
- `yarn db:rollback` - Roll back the last batch of migrations
- `yarn db:status` - Check migration status
- `yarn db:make <name>` - Create a new migration file
- `yarn format` - Format the codebase with Prettier

## Configuration

Create a `.env` file in the project root with the following variables:

```env
# Server Configuration
PORT=3001
HOST=127.0.0.1
API_SECRET=your-secure-api-secret-here

# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_USER=freebox_watcher
DB_PASSWORD=your-database-password
DB_NAME=freebox_watcher

# Logging
LOG_LEVEL=info

# Monitoring
HEARTBEAT_TIMEOUT=300000
DOWNTIME_CHECK_INTERVAL=60000
DOWNTIME_CONFIRMATION_DELAY=1800000

# Telegram Notifications (optional)
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHAT_ID=your-telegram-chat-id
```

### Environment Variables

- `PORT`: Port number for the API server (default: 3001)
- `HOST`: Network interface for the API server (default: 127.0.0.1 for local-only access)
- `API_SECRET`: HMAC secret for authenticating API requests (minimum 32 characters required)
- `DB_HOST`: MariaDB host address
- `DB_PORT`: MariaDB port (default: 3306)
- `DB_USER`: Database user
- `DB_PASSWORD`: Database password
- `DB_NAME`: Database name
- `LOG_LEVEL`: Logging level (trace, debug, info, warn, error, fatal)
- `HEARTBEAT_TIMEOUT`: Time in milliseconds before considering a missed heartbeat (default: 300000 = 5 minutes)
- `DOWNTIME_CHECK_INTERVAL`: Interval in milliseconds for checking downtime conditions (default: 60000 = 1 minute)
- `DOWNTIME_CONFIRMATION_DELAY`: Time in milliseconds before sending a confirmation alert (default: 1800000 = 30 minutes)
- `TELEGRAM_BOT_TOKEN`: Telegram bot token for sending notifications (optional)
- `TELEGRAM_CHAT_ID`: Telegram chat ID to receive notifications (optional)

## Database Schema

The service uses the following tables:

- `heartbeats`: Stores all received heartbeat signals
- `downtime_events`: Tracks detected downtime periods

Run migrations to create the schema:

```bash
yarn db:migrate
```

## API Authentication

The API uses **HMAC-SHA256 signature** authentication for maximum security. Each request is signed with a shared secret and includes a timestamp to prevent replay attacks.

### Rate Limiting

The API is rate-limited to **5 requests per minute** per IP address. If you exceed this limit, you'll receive a `429 Too Many Requests` error.

### Generating a Secure API Secret

The API secret must be at least 32 characters long. Generate a secure random secret:

**Using OpenSSL (Linux/macOS):**

```bash
openssl rand -base64 48
```

**Using Node.js (any platform):**

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

**Example output:**

```
vK2pL9xW7mR4nQ8tY3zB6cD5eF1gH0jS4kN7mL2pO9qR5tW8yA3bC6dE9fG=
```

Copy the generated secret and set it as `API_SECRET` in your `.env` file on the server.

### How HMAC Authentication Works

1. **Client** has the shared secret (`API_SECRET`)
2. **Client** generates current Unix timestamp (seconds)
3. **Client** generates a random nonce (unique per request)
4. **Client** builds canonical message: `method=METHOD;path=PATH;ts=TIMESTAMP;nonce=NONCE;body=JSON_BODY`
5. **Client** computes HMAC-SHA256 signature of the canonical message
6. **Client** sends request with 3 headers:
    - `Authorization: Bearer <hmac_signature>`
    - `Signature-Timestamp: <unix_timestamp>`
    - `Signature-Nonce: <random_string>`
7. **Server** reconstructs the canonical message and verifies the signature
8. **Server** checks timestamp is not expired (max 60 seconds old)

### Required Headers

All API requests must include these three headers:

```
Authorization: Bearer <hmac_signature_in_base64url>
Signature-Timestamp: <unix_timestamp_in_seconds>
Signature-Nonce: <random_string>
```

### Canonical Message Format

The message to sign must be constructed exactly as:

```
method=METHOD;path=PATH;ts=TIMESTAMP;nonce=NONCE;body=JSON_BODY
```

**Example:**

```
method=POST;path=/heartbeat;ts=1733144872;nonce=89af77e23a;body={"connection_state":"up","timestamp":"2025-12-02T10:30:00.000Z"}
```

**Important:**

- `METHOD` must be uppercase (GET, POST, etc.)
- `PATH` is the full request path including query string
- `TIMESTAMP` is Unix timestamp in seconds (integer)
- `NONCE` can be any non-empty random string (recommended: 16+ random bytes in hex)
- `BODY` is the JSON stringified request body (empty string for GET requests)

### Client Implementation Examples

#### JavaScript/TypeScript (Node.js)

```typescript
import { createHmac, randomBytes } from 'crypto';

const API_SECRET = process.env.API_SECRET as string;
const API_URL = 'https://monitor.example.com';

interface RequestBody {
    [key: string]: unknown;
}

async function makeAuthenticatedRequest(
    method: string,
    path: string,
    body: RequestBody | null = null
): Promise<Response> {
    // Generate timestamp and nonce
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString('hex');

    // Stringify body (empty string for GET requests)
    const bodyString = body ? JSON.stringify(body) : '';

    // Build canonical message
    const canonicalMessage = `method=${method.toUpperCase()};path=${path};ts=${timestamp};nonce=${nonce};body=${bodyString}`;

    // Compute HMAC signature
    const signature = createHmac('sha256', API_SECRET).update(canonicalMessage).digest('base64url');

    // Make request
    return fetch(`${API_URL}${path}`, {
        method: method,
        headers: {
            Authorization: `Bearer ${signature}`,
            'Signature-Timestamp': timestamp,
            'Signature-Nonce': nonce,
            'Content-Type': 'application/json',
        },
        body: bodyString || undefined,
    });
}

// Example usage
const response = await makeAuthenticatedRequest('POST', '/heartbeat', {
    connection_state: 'up',
    timestamp: new Date().toISOString(),
});

if (response.ok) {
    const data = await response.json();
    console.log('Heartbeat sent successfully:', data);
} else {
    console.error('Failed to send heartbeat:', response.status, await response.text());
}
```

#### Python

```python
import os
import time
import hmac
import hashlib
import base64
import json
import secrets
import requests

API_SECRET = os.getenv('API_SECRET').encode('utf-8')
API_URL = 'https://monitor.example.com'

def make_authenticated_request(method, path, body=None):
    # Generate timestamp and nonce
    timestamp = str(int(time.time()))
    nonce = secrets.token_hex(16)

    # Stringify body (empty string for GET requests)
    body_string = json.dumps(body) if body else ''

    # Build canonical message
    canonical_message = f"method={method.upper()};path={path};ts={timestamp};nonce={nonce};body={body_string}"

    # Compute HMAC signature
    signature = hmac.new(
        API_SECRET,
        canonical_message.encode('utf-8'),
        hashlib.sha256
    ).digest()
    signature_b64url = base64.urlsafe_b64encode(signature).decode('utf-8').rstrip('=')

    # Make request
    headers = {
        'Authorization': f'Bearer {signature_b64url}',
        'Signature-Timestamp': timestamp,
        'Signature-Nonce': nonce,
        'Content-Type': 'application/json'
    }

    return requests.request(
        method=method,
        url=f"{API_URL}{path}",
        headers=headers,
        json=body
    )

# Example usage
response = make_authenticated_request('POST', '/heartbeat', {
    'connection_state': 'up',
    'timestamp': '2025-12-02T10:30:00.000Z'
})

if response.status_code == 200:
    print('Heartbeat sent successfully:', response.json())
else:
    print(f'Failed to send heartbeat: {response.status_code}', response.text)
```

#### Bash/cURL

```bash
#!/bin/bash

API_SECRET="your-api-secret-here"
API_URL="https://monitor.example.com"
METHOD="POST"
PATH="/heartbeat"

# Generate timestamp and nonce
TIMESTAMP=$(date +%s)
NONCE=$(openssl rand -hex 16)

# Request body
BODY='{"connection_state":"up","timestamp":"2025-12-02T10:30:00.000Z"}'

# Build canonical message (note: no spaces in JSON for consistency)
CANONICAL_MESSAGE="method=${METHOD};path=${PATH};ts=${TIMESTAMP};nonce=${NONCE};body=${BODY}"

# Compute HMAC signature (base64url encoding)
SIGNATURE=$(echo -n "$CANONICAL_MESSAGE" | openssl dgst -sha256 -hmac "$API_SECRET" -binary | base64 | tr '+/' '-_' | tr -d '=')

# Make request
curl -X "$METHOD" "${API_URL}${PATH}" \
  -H "Authorization: Bearer $SIGNATURE" \
  -H "Signature-Timestamp: $TIMESTAMP" \
  -H "Signature-Nonce: $NONCE" \
  -H "Content-Type: application/json" \
  -d "$BODY"
```

#### Go

```go
package main

import (
    "bytes"
    "crypto/hmac"
    "crypto/rand"
    "crypto/sha256"
    "encoding/base64"
    "encoding/hex"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "os"
    "strings"
    "time"
)

func generateNonce() string {
    bytes := make([]byte, 16)
    rand.Read(bytes)
    return hex.EncodeToString(bytes)
}

func computeSignature(method, path, timestamp, nonce, bodyString, secret string) string {
    message := fmt.Sprintf("method=%s;path=%s;ts=%s;nonce=%s;body=%s",
        strings.ToUpper(method), path, timestamp, nonce, bodyString)
    mac := hmac.New(sha256.New, []byte(secret))
    mac.Write([]byte(message))
    return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func makeAuthenticatedRequest(method, path string, body interface{}) (*http.Response, error) {
    apiSecret := os.Getenv("API_SECRET")
    apiURL := "https://monitor.example.com"

    // Generate timestamp and nonce
    timestamp := fmt.Sprintf("%d", time.Now().Unix())
    nonce := generateNonce()

    // Stringify body (empty string for GET requests)
    var bodyString string
    var bodyBytes []byte
    if body != nil {
        bodyBytes, _ = json.Marshal(body)
        bodyString = string(bodyBytes)
    } else {
        bodyString = ""
    }

    // Compute signature
    signature := computeSignature(method, path, timestamp, nonce, bodyString, apiSecret)

    // Create request
    var req *http.Request
    var err error
    if len(bodyBytes) > 0 {
        req, err = http.NewRequest(method, apiURL+path, bytes.NewReader(bodyBytes))
    } else {
        req, err = http.NewRequest(method, apiURL+path, nil)
    }
    if err != nil {
        return nil, err
    }

    // Add headers
    req.Header.Set("Authorization", "Bearer "+signature)
    req.Header.Set("Signature-Timestamp", timestamp)
    req.Header.Set("Signature-Nonce", nonce)
    req.Header.Set("Content-Type", "application/json")

    // Send request
    client := &http.Client{}
    return client.Do(req)
}

// Example usage
func main() {
    heartbeat := map[string]interface{}{
        "connection_state": "up",
        "timestamp":        "2025-12-02T10:30:00.000Z",
    }

    resp, err := makeAuthenticatedRequest("POST", "/heartbeat", heartbeat)
    if err != nil {
        fmt.Printf("Error: %v\n", err)
        return
    }
    defer resp.Body.Close()

    body, _ := io.ReadAll(resp.Body)
    if resp.StatusCode == 200 {
        fmt.Printf("Heartbeat sent successfully: %s\n", body)
    } else {
        fmt.Printf("Failed to send heartbeat: %d %s\n", resp.StatusCode, body)
    }
}
```

### Authentication Error Responses

All authentication failures return the same generic error to prevent information leakage:

**401 Unauthorized:**

```json
{
    "error": "Unauthorized",
    "message": "Authentication failed"
}
```

**429 Too Many Requests:**

```json
{
    "error": "Too Many Requests",
    "message": "Rate limit exceeded"
}
```

**500 Internal Server Error:**

```json
{
    "error": "Internal Server Error",
    "message": "API secret not configured"
}
```

### Security Features

1. **✅ HMAC-SHA256**: Cryptographically secure signature scheme
2. **✅ Timing-safe comparison**: Prevents timing attacks on signature validation
3. **✅ Timestamp expiration**: Requests expire after 60 seconds (prevents old replay attacks)
4. **✅ Nonce requirement**: Random nonce per request (prevents replay attacks within time window)
5. **✅ Generic error messages**: All auth failures return same message (prevents information leakage)
6. **✅ Rate limiting**: 5 requests/minute prevents brute-force attacks
7. **✅ Secret never transmitted**: API secret stays on client and server, never sent over network
8. **✅ Request-specific signatures**: Signature changes for different methods, paths, or times

### Security Best Practices

1. **Keep your API secret private**: Never commit `.env` files or hardcode secrets in source code
2. **Use HTTPS in production**: Always use TLS/SSL with a reverse proxy (Caddy/Nginx)
3. **Rotate secrets periodically**: Generate a new API secret every few months
4. **Use environment variables**: Store secrets in `.env` files or secure secret management systems
5. **Minimum secret length**: Ensure API secret is at least 32 characters (48+ recommended)
6. **Monitor for 401 errors**: Regular 401s might indicate attack attempts
7. **Synchronize clocks**: Ensure client and server clocks are synchronized (use NTP)
8. **Generate strong nonces**: Use cryptographically secure random generators

### Client Configuration Guide

**Server-side (Freebox Watcher):**

1. Generate API secret: `openssl rand -base64 48`
2. Add to server's `.env`: `API_SECRET=<your-secret>`
3. Restart server

**Client-side (Freebox Heartbeat or custom client):**

1. Use the **same** API secret from step 1
2. Add to client's `.env`: `API_SECRET=<same-secret>`
3. Implement HMAC signature generation (see examples above)
4. Send requests with all 3 required headers

### Troubleshooting

**"Authentication failed" - Check:**

- API secret matches on client and server
- Timestamp is current (within 60 seconds)
- Nonce is non-empty
- Canonical message format is correct: `method=METHOD;path=PATH;ts=TIMESTAMP;nonce=NONCE;body=BODY`
- METHOD is uppercase
- BODY is JSON stringified (empty string for GET requests, no extra spaces)
- Signature is base64url-encoded
- All 3 headers are present

**"Rate limit exceeded" - Solution:**

- Wait 1 minute before retrying
- Reduce request frequency to max 5 per minute
- Check for loops sending excessive requests

## Telegram Notifications Setup

Freebox Watcher can send downtime alerts via Telegram. This is optional but highly recommended for real-time monitoring.

### Creating a Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot` to BotFather
3. Follow the prompts to choose a name and username for your bot
4. BotFather will provide you with a bot token (e.g., `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
5. Copy this token and set it as `TELEGRAM_BOT_TOKEN` in your `.env` file

### Getting Your Chat ID

1. Start a conversation with your newly created bot by clicking the link provided by BotFather or searching for your bot's username
2. Send any message to your bot (e.g., "Hello")
3. Visit the following URL in your browser (replace `<YOUR_BOT_TOKEN>` with your actual bot token):
    ```
    https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
    ```
4. Look for the `chat` object in the JSON response and copy the `id` value (e.g., `123456789`)
5. Set this ID as `TELEGRAM_CHAT_ID` in your `.env` file

### Notification Types

The service sends three types of notifications:

- **🔴 Downtime Detected**: Sent immediately when no heartbeat is received for the configured timeout (default: 5 minutes)
- **⚠️ Downtime Confirmed**: Sent after the downtime has lasted for the configured confirmation delay (default: 30 minutes)
- **✅ Service Recovered**: Sent when a heartbeat is received after a downtime event

### Disabling Notifications

Telegram notifications are optional. If you don't configure `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, the service will log a warning at startup but will continue to function normally without sending notifications.

## Production Deployment

### Using Caddy

Example Caddyfile configuration:

```
monitor.example.com {
    reverse_proxy localhost:3001
}
```

### Using Nginx

Example Nginx configuration:

```nginx
server {
    listen 80;
    server_name monitor.example.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Running with PM2

For production deployments, PM2 is recommended for process management and automatic restarts.

#### Start the service

```bash
yarn dlx pm2@latest start ecosystem.config.js
```

#### Save the PM2 process list (auto-restart on reboot)

```bash
yarn dlx pm2@latest save
```

#### Other useful PM2 commands

```bash
# View process status
yarn dlx pm2@latest status

# View logs
yarn dlx pm2@latest logs freebox-watcher

# Restart the service
yarn dlx pm2@latest restart freebox-watcher

# Stop the service
yarn dlx pm2@latest stop freebox-watcher

# Monitor CPU and memory usage
yarn dlx pm2@latest monit
```

#### PM2 Configuration

The `ecosystem.config.js` file includes:

- Automatic restarts on crashes
- Source maps support for better error traces
- Memory limit (500MB) with automatic restart
- Crash loop protection (max 10 restarts)
- Structured logging with timestamps

#### Log Rotation

For long-running production deployments, it's recommended to set up log rotation to prevent PM2 log files from growing indefinitely.

Install the PM2 log rotation module:

```bash
yarn dlx pm2@latest install pm2-logrotate
```

Configure log rotation (optional, defaults are reasonable):

```bash
# Set max file size before rotation (default: 10MB)
yarn dlx pm2@latest set pm2-logrotate:max_size 10M

# Set number of rotated files to keep (default: 10)
yarn dlx pm2@latest set pm2-logrotate:retain 30

# Enable compression of rotated logs (default: false)
yarn dlx pm2@latest set pm2-logrotate:compress true

# Set rotation interval (default: none, size-based only)
yarn dlx pm2@latest set pm2-logrotate:rotateInterval '0 0 * * *'
```

Note: The application also maintains its own log files via Pino and rotating-file-stream, which handles rotation independently from PM2 logs.

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

## Related Projects

- [teol/freebox-heartbeat](https://github.com/teol/freebox-heartbeat) - The companion project that sends heartbeat requests to this service
