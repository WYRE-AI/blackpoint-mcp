import type { DomainHandler } from '../utils/types.js';
import { navigationHandler } from './navigation.js';
import { assetsHandler } from './assets.js';
import { tenantsHandler } from './tenants.js';
import { detectionsHandler } from './detections.js';
import { vulnerabilitiesHandler } from './vulnerabilities.js';

// Every tool this server actually implements, always listed together.
//
// Earlier versions gated domain tools behind a `blackpoint_navigate` call
// (tools/list returned only navigation tools until the client "entered" a
// domain). That decision-tree pattern doesn't survive the Conduit gateway:
// Conduit suppresses `_navigate`/`_back` tools from every vendor's tools/list
// and refuses to execute them (they'd advertise a tool catalog the caller's
// access tier may not permit — see wyre-mcp-gateway-platform's
// discovery-tools.ts), leaving `blackpoint_navigate` unreachable and every
// domain tool behind it unreachable with it. Flattening the list — the same
// fix already applied to other MCP vendors on the fleet (e.g. scalepad,
// sherweb) — makes every real tool visible and callable regardless of
// transport. `blackpoint_navigate`/`_status`/`_back` stay for stdio users
// who still want the menu; they're just no longer load-bearing for
// visibility.
const IMPLEMENTED_HANDLERS: DomainHandler[] = [
  navigationHandler,
  tenantsHandler,
  assetsHandler,
  detectionsHandler,
  vulnerabilitiesHandler,
];

export function getAllTools() {
  return IMPLEMENTED_HANDLERS.flatMap((handler) => handler.getTools());
}

export function getHandlerForTool(toolName: string): DomainHandler | null {
  return (
    IMPLEMENTED_HANDLERS.find((handler) =>
      handler.getTools().some((tool) => tool.name === toolName)
    ) || null
  );
}