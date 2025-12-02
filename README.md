# Freebox Watcher

A monitoring service for Freebox Delta that tracks uptime and alerts on downtime events.

## Overview

Freebox Watcher is a Node.js-based monitoring solution that receives HTTP heartbeat requests from [teol/freebox-heartbeat](https://github.com/teol/freebox-heartbeat) to track the availability and health of a Freebox Delta. The service stores heartbeat data in a MariaDB database and provides alerting capabilities when downtime is detected.

## Features

- 📡 HTTP heartbeat endpoint for receiving status updates
- 🔒 Secure Bearer token authentication with timing-attack protection
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
API_KEY=your-secure-api-key-here

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
- `API_KEY`: Authentication key for securing the heartbeat endpoint (minimum 16 characters)
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

### Generating a Secure API Key

The API key must be at least 16 characters long. Generate a secure random key using one of these methods:

**Using OpenSSL (Linux/macOS):**

```bash
openssl rand -base64 32
```

**Using Node.js (any platform):**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Example output:**

```
xK9mP2vL8nR4tQ6wY1zB5cA7dF3gH0jS9kN8mL6pO4qR=
```

Copy the generated key and set it as the `API_KEY` value in your `.env` file.

## Database Schema

The service uses the following tables:

- `heartbeats`: Stores all received heartbeat signals
- `downtime_events`: Tracks detected downtime periods

Run migrations to create the schema:

```bash
yarn db:migrate
```

## API Authentication

The API uses **Bearer token authentication** for securing all endpoints. All requests must include an `Authorization` header with a valid API token.

### Authentication Header Format

```
Authorization: Bearer <your-api-key>
```

### How Clients Should Authenticate

All API requests must include the Bearer token in the `Authorization` header. The token value is the same as the `API_KEY` configured in your `.env` file.

#### Example with cURL

```bash
curl -X POST https://monitor.example.com/heartbeat \
  -H "Authorization: Bearer xK9mP2vL8nR4tQ6wY1zB5cA7dF3gH0jS9kN8mL6pO4qR=" \
  -H "Content-Type: application/json" \
  -d '{
    "connection_state": "up",
    "timestamp": "2025-01-15T10:30:00.000Z",
    "ipv4": "192.168.1.100"
  }'
```

#### Example with JavaScript/TypeScript (fetch)

```javascript
const response = await fetch('https://monitor.example.com/heartbeat', {
    method: 'POST',
    headers: {
        Authorization: 'Bearer xK9mP2vL8nR4tQ6wY1zB5cA7dF3gH0jS9kN8mL6pO4qR=',
        'Content-Type': 'application/json',
    },
    body: JSON.stringify({
        connection_state: 'up',
        timestamp: new Date().toISOString(),
        ipv4: '192.168.1.100',
    }),
});

const data = await response.json();
console.log(data);
```

#### Example with Node.js (axios)

```javascript
const axios = require('axios');

const response = await axios.post(
    'https://monitor.example.com/heartbeat',
    {
        connection_state: 'up',
        timestamp: new Date().toISOString(),
        ipv4: '192.168.1.100',
    },
    {
        headers: {
            Authorization: 'Bearer xK9mP2vL8nR4tQ6wY1zB5cA7dF3gH0jS9kN8mL6pO4qR=',
        },
    }
);

console.log(response.data);
```

#### Example with Python (requests)

```python
import requests
from datetime import datetime

response = requests.post(
    'https://monitor.example.com/heartbeat',
    headers={
        'Authorization': 'Bearer xK9mP2vL8nR4tQ6wY1zB5cA7dF3gH0jS9kN8mL6pO4qR=',
        'Content-Type': 'application/json'
    },
    json={
        'connection_state': 'up',
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'ipv4': '192.168.1.100'
    }
)

print(response.json())
```

### Authentication Error Responses

The API returns HTTP status codes for authentication failures:

- **401 Unauthorized**: Authentication failed (missing, invalid, or malformed credentials)
- **500 Internal Server Error**: API key not configured on the server

For security reasons, all authentication failures return the same generic error response:

```json
{
    "error": "Unauthorized",
    "message": "Authentication failed"
}
```

This prevents potential attackers from determining whether:

- The authentication header is missing
- The token format is invalid
- The token value is incorrect

### Client Configuration Guide

To authenticate your client application:

1. **Generate a secure API key** (minimum 16 characters):

    ```bash
    openssl rand -base64 32
    # or
    node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
    ```

2. **Configure the key on the server** in your `.env` file:

    ```env
    API_KEY=your-generated-key-here
    ```

3. **Add the key to your client application**:
    - Store it in environment variables (recommended)
    - Never hardcode it in your source code
    - Example: `API_KEY=your-generated-key-here` in client's `.env`

4. **Use the key in all API requests**:
    - Add header: `Authorization: Bearer <your-api-key>`
    - The scheme name "Bearer" is case-insensitive (Bearer, bearer, BEARER all work)
    - Multiple spaces between "Bearer" and the token are supported

### Security Best Practices

1. **Keep your API key secret**: Never commit your `.env` file or expose the API key in public repositories
2. **Use HTTPS in production**: Always use a reverse proxy (Caddy/Nginx) with SSL/TLS certificates
3. **Rotate keys periodically**: Generate a new API key every few months for enhanced security
4. **Use environment variables**: Never hardcode API keys in your application code
5. **Minimum key length**: Ensure your API key is at least 16 characters long (32+ recommended)
6. **Monitor for unauthorized access**: Check logs regularly for 401 errors that might indicate attack attempts
7. **Use the same key on server and client**: The token you send must match the `API_KEY` configured on the server

### Backward Compatibility Note

For backward compatibility with older clients, the API also accepts the token in the request body as a `token` field. However, this method is **deprecated** and may be removed in future versions. **Always use the `Authorization: Bearer` header for new implementations.**

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
