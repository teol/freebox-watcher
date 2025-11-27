# Freebox Watcher

A monitoring service for Freebox Delta that tracks uptime and alerts on downtime events.

## Overview

Freebox Watcher is a Node.js-based monitoring solution that receives HTTP heartbeat requests from [teol/freebox-heartbeat](https://github.com/teol/freebox-heartbeat) to track the availability and health of a Freebox Delta. The service stores heartbeat data in a MariaDB database and provides alerting capabilities when downtime is detected.

## Features

- 📡 HTTP heartbeat endpoint for receiving status updates
- 🔒 Simple authentication mechanism to secure the API
- 📊 MariaDB storage for heartbeat history
- 🔔 Downtime detection and alerting
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
```

### Environment Variables

- `PORT`: Port number for the API server (default: 3001)
- `API_KEY`: Authentication key for securing the heartbeat endpoint
- `DB_HOST`: MariaDB host address
- `DB_PORT`: MariaDB port (default: 3306)
- `DB_USER`: Database user
- `DB_PASSWORD`: Database password
- `DB_NAME`: Database name
- `LOG_LEVEL`: Logging level (trace, debug, info, warn, error, fatal)
- `HEARTBEAT_TIMEOUT`: Time in milliseconds before considering a missed heartbeat (default: 5 minutes)

## Database Schema

The service uses the following tables:

- `heartbeats`: Stores all received heartbeat signals
- `downtime_events`: Tracks detected downtime periods

Run migrations to create the schema:

```bash
yarn db:migrate
```

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
