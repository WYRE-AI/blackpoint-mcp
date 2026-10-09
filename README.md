# blackpoint-mcp

Model Context Protocol (MCP) server for Blackpoint Cyber CompassOne - Managed Detection and Response (MDR) platform.

## Features

This MCP server provides access to CompassOne's security capabilities through a decision-tree navigation interface:

### Available Domains

- **🏢 Tenants**: Customer tenant management
- **💻 Assets**: Inventory by documented class (`CONTAINER`, `DEVICE`, `FRAMEWORK`, `NETSTAT`, `PERSON`, `PROCESS`, `SERVICE`, `SOFTWARE`, `SOURCE`, `SURVEY`, `USER`). `CLOUD` is not an asset class.
- **🔍 Detections**: Alert groups from `GET /alert-groups` (`OPEN` / `RESOLVED`, `skip` / `take`)
- **🛡️ Vulnerabilities**: Vulnerability management, dark web monitoring, external exposure scanning

### Domain Structure

All implemented tools are listed together in a single `tools/list` call — no
navigation step required. `blackpoint_status` reports current health and
available domains, and `blackpoint_navigate`/`blackpoint_back` remain for
clients that like a guided menu, but they're optional: every domain tool
(`blackpoint_tenants_*`, `blackpoint_assets_*`, `blackpoint_detections_*`,
`blackpoint_vulnerabilities_*`) is callable directly from the start.

(Earlier versions gated domain tools behind a `blackpoint_navigate` call.
That doesn't work behind the Conduit gateway — Conduit suppresses
`_navigate`/`_back` from every vendor's tool list for security reasons, which
made every domain tool unreachable through it. The list is flat now so it
works the same everywhere.)

### Tool Naming Convention

All tools follow the pattern: `blackpoint_{domain}_{action}`

Examples:
- `blackpoint_assets_list` - List assets by class
- `blackpoint_detections_list` - List security detections
- `blackpoint_vulnerabilities_scans_list` - List vulnerability scans

## Installation

```bash
npm install blackpoint-mcp
```

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `BLACKPOINT_API_TOKEN` | CompassOne API token | Yes for stdio |
| `BLACKPOINT_BASE_URL` | API base URL. Defaults to `https://api.blackpointcyber.com/v1`. A value with or without `/v1`, or the legacy `api.compassone.blackpointcyber.com` host, is normalized to that URL. Other hosts keep their origin and gain a single `/v1` suffix. | No |
| `MCP_TRANSPORT` | Transport mode: `stdio` or `http` | No (default: stdio) |
| `MCP_HTTP_PORT` | HTTP port for gateway mode | No (default: 8080) |
| `MCP_HTTP_HOST` | HTTP bind address. Unset binds to `127.0.0.1`. The container image sets `0.0.0.0`. | No (default: `127.0.0.1`) |
| `CONDUIT_S2S_SECRET` | Service-to-service secret for HTTP. `/mcp` requires a valid `X-Gateway-S2S` header. The HTTP server exits non-zero when this is empty. | Yes for HTTP |
| `MCP_ALLOW_INSECURE_DEV` | Set to `1` to start HTTP without `CONDUIT_S2S_SECRET`. Logs a warning and skips S2S checks. Local development only. | No |
| `AUTH_MODE` | Set to `gateway` for header-based auth | No |
| `LOG_LEVEL` | Logging level: debug, info, warn, error | No (default: info) |

### Gateway Mode

When `AUTH_MODE=gateway`, the server reads credentials from HTTP headers and does not fall back to `process.env`:

- `X-Blackpoint-API-Token` → API token (required; missing header is HTTP 401)
- `X-Blackpoint-Base-Url` → base URL for that request (normalized the same way as `BLACKPOINT_BASE_URL`). When the header is absent, the process environment is not used.

This enables per-request authentication for multi-tenant gateways.

HTTP also requires `CONDUIT_S2S_SECRET`. Every `/mcp` request must carry a valid `X-Gateway-S2S` header for that secret. A missing or invalid header is HTTP 401, before vendor credentials are read. If `CONDUIT_S2S_SECRET` is empty, the process logs an error and exits non-zero instead of serving `/mcp`. `MCP_ALLOW_INSECURE_DEV=1` starts anyway and logs a warning; do not use it outside local development. The secret is never written to logs.

`GET /`, `GET /health`, and `GET /healthz` stay unauthenticated liveness checks and do not read credentials. The stdio transport does not use the S2S secret.

## Usage

### Standalone Mode (stdio)

```bash
# Set credentials
export BLACKPOINT_API_TOKEN="your-api-token"

# Run the server
blackpoint-mcp
```

### Gateway Mode (HTTP)

```bash
export AUTH_MODE=gateway
export MCP_TRANSPORT=http
export MCP_HTTP_PORT=8080
export CONDUIT_S2S_SECRET="your-s2s-secret"
# Optional. Unset binds to 127.0.0.1.
# export MCP_HTTP_HOST=127.0.0.1

blackpoint-mcp
```

Local development without a secret (insecure; logs a warning):

```bash
export MCP_TRANSPORT=http
export MCP_ALLOW_INSECURE_DEV=1

blackpoint-mcp
```

### Example Tool Calls

```typescript
// Start by checking available domains
await tools.call("blackpoint_status");

// Navigate to assets domain
await tools.call("blackpoint_navigate", { domain: "assets" });

// List device assets for one tenant (tenantId is sent as x-tenant-id)
await tools.call("blackpoint_assets_list", { 
  class: "DEVICE",
  tenantId: "tenant_123",
  pageSize: 10 
});

// Get specific asset details
await tools.call("blackpoint_assets_get", { 
  id: "asset_12345",
  tenantId: "tenant_123"
});

// Return to navigation
await tools.call("blackpoint_back");
```

## API Coverage

### ✅ Implemented

| Domain | Tools | Description |
|--------|-------|-------------|
| **tenants** | `list`, `get` | Customer tenant management |
| **assets** | `list`, `get`, `relationships`, `search` | Asset inventory and relationships |
| **detections** | `list`, `get` | Alert groups (`GET /alert-groups`, skip/take, status OPEN or RESOLVED). Tool names are unchanged. |
| **vulnerabilities** | `list`, `scans_list`, `darkweb_list`, `external_list` | Vuln management, dark web, external exposure |

### 📋 Planned

| Domain | Status | Notes |
|--------|--------|--------|
| **partners** | SDK ready | Account management - ready to implement |
| **alerts** | Models only | API handlers not available in CompassOne wrapper |
| **tickets** | Models only | API handlers not available in CompassOne wrapper |
| **cloud_security** | SDK ready | M365/Google/Cisco onboarding - ready to implement |
| **notifications** | SDK ready | Contact groups and channels - ready to implement |

## Partner vs Tenant Scoping

CompassOne uses hierarchical scoping: **Partner → Tenants → Assets**

- **Partner tokens** can access all associated tenants
- **Tenant-scoped tokens** are limited to specific customers
- Always specify `tenantId` parameters to avoid cross-tenant operations

## Error Handling

The server provides structured error responses:

```json
{
  "content": [{ 
    "type": "text", 
    "text": "Failed to list assets: Authentication failed" 
  }],
  "isError": true
}
```

Common error scenarios:
- **401 / 403**: The API key is invalid, or the account is not entitled to that resource
- **404**: The base URL or path is wrong (the live API is `https://api.blackpointcyber.com/v1`)
- **Rate Limiting**: Automatic retry with exponential backoff
- **Validation**: Invalid parameters or missing required fields (`class`, `tenantId`)

Failures are logged with HTTP status, method, path, and response body. The bearer token is redacted.

## Rate Limiting

The underlying SDK implements automatic rate limiting:

- **Default**: 2000 requests per 15 minutes per API key
- **429 Handling**: Honors `Retry-After` headers
- **Backoff**: Exponential backoff for subsequent requests

## Docker

```bash
# Build
docker build -t blackpoint-mcp .

# Run in gateway mode. The image sets MCP_HTTP_HOST=0.0.0.0 and refuses to
# start until CONDUIT_S2S_SECRET is set. Publish the port on loopback.
docker run -p 127.0.0.1:8080:8080 \
  -e AUTH_MODE=gateway \
  -e MCP_TRANSPORT=http \
  -e MCP_HTTP_PORT=8080 \
  -e CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" \
  blackpoint-mcp
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build
npm run build

# Test
npm test

# Lint
npm run lint
```

## Security Considerations

### API Access Requirements

- **CompassOne Partner Agreement** required for API access
- **Partner-tier credentials** needed for multi-tenant operations
- **Scoped tokens** recommended for tenant-specific access

### Destructive Operations

The following operations require confirmation (when implemented):

- Asset isolation/response actions
- Ticket status changes with actions
- Alert acknowledgment/closure
- Remediation workflows

These use the `elicitConfirmation` pattern to prevent accidental execution.

## Troubleshooting

### Common Issues

**No tools showing**:
- Check `BLACKPOINT_API_TOKEN` is set
- Verify token has correct scopes
- Check network connectivity to CompassOne API

**Gateway mode not working**:
- Verify `AUTH_MODE=gateway` is set
- Verify `CONDUIT_S2S_SECRET` is set (HTTP exits if it is empty, unless `MCP_ALLOW_INSECURE_DEV=1`)
- Check `X-Gateway-S2S` and `X-Blackpoint-API-Token` are passed
- Confirm the client can reach the bind address (`127.0.0.1` by default)

**Rate limiting**:
- Monitor logs for 429 responses
- Consider reducing request frequency
- Verify token isn't shared across instances

### Debug Logging

```bash
export LOG_LEVEL=debug
blackpoint-mcp
```

### Health Check

`GET /`, `GET /health`, and `GET /healthz` are unauthenticated and do not read credentials:

```bash
curl -f http://127.0.0.1:8080/health
```

### Authenticated MCP call

`/mcp` requires `X-Gateway-S2S` when `CONDUIT_S2S_SECRET` is set. In gateway mode it also requires `X-Blackpoint-API-Token`:

```bash
curl -X POST http://127.0.0.1:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-Gateway-S2S: <gateway-signed header>" \
  -H "X-Blackpoint-API-Token: your-token" \
  -d '{"jsonrpc": "2.0", "method": "initialize", "id": 1, "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "curl", "version": "0.0.0"}}}'
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes and add tests
4. Follow the domain handler pattern for new capabilities
5. Submit a pull request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

## License

Apache-2.0 - see [LICENSE](LICENSE) for details.