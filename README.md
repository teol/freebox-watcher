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
- **Web Framework**: Fastify
- **Database**: MariaDB
- **Query Builder**: Knex.js with mysql2 driver
- **Logging**: Pino
- **Configuration**: dotenv
- **Reverse Proxy**: Caddy/Nginx (for production deployment)

## Prerequisites

- Node.js 22 or higher
- MariaDB 10.5 or higher
- npm or yarn

## Installation

1. Clone the repository:

```bash
git clone https://github.com/teol/freebox-watcher.git
cd freebox-watcher
```

2. Install dependencies:

```bash
npm install
```

3. Configure environment variables:

```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Run database migrations:

```bash
npm run migrate
```

5. Start the service:

```bash
npm start
```

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

## API Endpoints

### POST /heartbeat

Receives a heartbeat signal from the monitored Freebox.

**Headers:**

- `Authorization`: Bearer {API_KEY}

**Request Body:**

```json
{
    "status": "online",
    "timestamp": "2025-11-26T12:00:00Z"
}
```

**Response:**

```json
{
    "success": true,
    "message": "Heartbeat recorded"
}
```

### GET /health

Health check endpoint.

**Response:**

```json
{
    "status": "ok",
    "uptime": 12345,
    "database": "connected"
}
```

## Database Schema

The service uses the following tables:

- `heartbeats`: Stores all received heartbeat signals
- `downtime_events`: Tracks detected downtime periods

Run migrations to create the schema:

```bash
npm run migrate
```

## Development

### Running in Development Mode

```bash
npm run dev
```

### Running Tests

```bash
npm test
```

### Code Formatting

This project uses Prettier for code formatting with the following configuration:

- 4-space indentation
- Semicolons required
- Single quotes for strings

Format your code before committing:

```bash
npx prettier -w .
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
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
```

## Contributing

Contributions are welcome! Please follow the guidelines in [AGENTS.md](./AGENTS.md).

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and format code
5. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

## Related Projects

- [teol/freebox-heartbeat](https://github.com/teol/freebox-heartbeat) - The companion project that sends heartbeat requests to this service

## Support

For issues and questions, please use the [GitHub Issues](https://github.com/teol/freebox-watcher/issues) page.
