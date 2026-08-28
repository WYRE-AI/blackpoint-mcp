# blackpoint-mcp

Model Context Protocol (MCP) server for Blackpoint Cyber CompassOne - Managed Detection and Response (MDR) platform.

## Features

This MCP server provides access to CompassOne's security capabilities through a decision-tree navigation interface:

### Available Domains

- **🏢 Tenants**: Customer tenant management
- **💻 Assets**: Endpoint and server inventory (endpoint, server, network, cloud, mobile, iot)  
- **🔍 Detections**: Security detections and telemetry
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
| `BLACKPOINT_API_TOKEN` | CompassOne API token | Yes |
| `BLACKPOINT_BASE_URL` | API base URL (may vary by region/partner) | No |
| `MCP_TRANSPORT` | Transport mode: `stdio` or `http` | No (default: stdio) |
| `MCP_HTTP_PORT` | HTTP port for gateway mode | No (default: 8080) |
| `AUTH_MODE` | Set to `gateway` for header-based auth | No |
| `LOG_LEVEL` | Logging level: debug, info, warn, error | No (default: info) |

### Gateway Mode

When `AUTH_MODE=gateway`, the server reads credentials from HTTP headers:

- `X-Blackpoint-API-Token` → `BLACKPOINT_API_TOKEN`

This enables per-request authentication for multi-tenant gateways.

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

blackpoint-mcp
```

### Example Tool Calls

```typescript
// Start by checking available domains
await tools.call("blackpoint_status");

// Navigate to assets domain
await tools.call("blackpoint_navigate", { domain: "assets" });

// List endpoint assets
await tools.call("blackpoint_assets_list", { 
  class: "endpoint",
  pageSize: 10 
});

// Get specific asset details
await tools.call("blackpoint_assets_get", { 
  id: "asset_12345" 
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
| **detections** | `list`, `get` | Security detections and telemetry |
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
- **Authentication**: Invalid or expired API token
- **Rate Limiting**: Automatic retry with exponential backoff
- **Not Found**: Requested resource doesn't exist
- **Validation**: Invalid parameters or missing required fields

## Rate Limiting

The underlying SDK implements automatic rate limiting:

- **Default**: 60 requests per minute (1 per second)
- **429 Handling**: Honors `Retry-After` headers
- **Backoff**: Exponential backoff for subsequent requests

## Docker

```bash
# Build
docker build -t blackpoint-mcp .

# Run in gateway mode
docker run -p 8080:8080 \
  -e AUTH_MODE=gateway \
  -e MCP_TRANSPORT=http \
  -e MCP_HTTP_PORT=8080 \
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
- Check HTTP headers are passed correctly
- Confirm container networking allows connections

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

```bash
# Test basic connectivity
curl -X POST http://localhost:8080/ \
  -H "Content-Type: application/json" \
  -H "X-Blackpoint-API-Token: your-token" \
  -d '{"jsonrpc": "2.0", "method": "tools/list", "id": 1}'
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