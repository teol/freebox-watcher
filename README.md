# Freebox Watcher

A monitoring service for Freebox Delta that tracks uptime and alerts on downtime events.

## Overview

Freebox Watcher is a Node.js-based monitoring solution that receives HTTP heartbeat requests from [teol/freebox-heartbeat](https://github.com/teol/freebox-heartbeat) to track the availability and health of a Freebox Delta. The service stores heartbeat data in a MariaDB database and provides alerting capabilities when downtime is detected.

## Features

- 📡 HTTP heartbeat endpoint for receiving status updates
- 🔒 Simple authentication mechanism to secure the API
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
- `API_KEY`: Authentication key for securing the heartbeat endpoint
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

```bash
yarn dlx pm2@latest start ecosystem.config.js
yarn dlx pm2@latest save
```

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

## Related Projects

- [teol/freebox-heartbeat](https://github.com/teol/freebox-heartbeat) - The companion project that sends heartbeat requests to this service
