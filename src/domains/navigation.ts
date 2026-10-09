import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult, NavigationState, NavigationDomain } from '../utils/types.js';
import { logger } from '../utils/logger.js';
import { getRequestContext, freshNavigationState } from '../utils/request-context.js';

// Per-request navigation state.
//
// In HTTP/gateway mode the state lives on the request's AsyncLocalStorage
// context, so each request's navigation choices are scoped to that
// request only. In stdio mode there is no per-request context, so we
// fall back to a module-level state (single-tenant by design).
const stdioNavigationState: NavigationState = freshNavigationState();

function activeState(): NavigationState {
  const ctx = getRequestContext();
  return ctx ? ctx.navigationState : stdioNavigationState;
}

export function getNavigationState(): NavigationState {
  return { ...activeState() };
}

export function setCurrentDomain(domain: NavigationDomain | null): void {
  activeState().currentDomain = domain;
  logger.info('Navigation state changed', { currentDomain: domain });
}

function getTools(): Tool[] {
  const tools: Tool[] = [
    {
      name: 'blackpoint_navigate',
      description: 'Navigate to a specific CompassOne domain to access its tools',
      inputSchema: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            enum: activeState().availableDomains,
            description: 'Domain to navigate to',
          },
        },
        required: ['domain'],
      },
    },
    {
      name: 'blackpoint_status',
      description: 'Show current navigation state and available domains',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ];

  // Add back tool if we're in a domain
  if (activeState().currentDomain) {
    tools.push({
      name: 'blackpoint_back',
      description: 'Return to the main navigation menu',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    });
  }

  return tools;
}

async function handleCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  switch (toolName) {
    case 'blackpoint_navigate': {
      const domain = args.domain as NavigationDomain;
      if (!activeState().availableDomains.includes(domain)) {
        return {
          content: [
            {
              type: 'text',
              text: `Invalid domain "${domain}". Available domains: ${activeState().availableDomains.join(', ')}`,
            },
          ],
          isError: true,
        };
      }

      setCurrentDomain(domain);
      return {
        content: [
          {
            type: 'text',
            text: `Navigated to ${domain} domain. Use tools/list to see available operations, or blackpoint_back to return to navigation.`,
          },
        ],
      };
    }

    case 'blackpoint_status': {
      const domainDescriptions: Record<NavigationDomain, string> = {
        partners: 'Partner accounts and management',
        tenants: 'Customer tenants and configuration',
        assets: 'Endpoint and server inventory',
        alerts: 'Security alerts and alert groups (placeholder - API not yet available)',
        detections: 'Alert groups (OPEN/RESOLVED), listed from GET /alert-groups',
        tickets: 'Incident tickets and workflow (placeholder - API not yet available)',
        cloud_security: 'Cloud MDR (M365, Google, Cisco onboarding)',
        vulnerabilities: 'Vulnerability scans, dark web monitoring, external exposure',
        threat_intel: 'Threat intelligence and indicators',
        notifications: 'Contact groups and notification channels',
      };

      const statusText = [
        `Current domain: ${activeState().currentDomain || 'Navigation menu'}`,
        '',
        'Available domains:',
        ...activeState().availableDomains.map(domain =>
          `• ${domain}: ${domainDescriptions[domain as NavigationDomain] || 'Unknown domain'}`
        ),
        '',
        'Use blackpoint_navigate to enter a domain, or blackpoint_back to return to navigation.',
      ].join('\n');

      return {
        content: [
          {
            type: 'text',
            text: statusText,
          },
        ],
      };
    }

    case 'blackpoint_back': {
      setCurrentDomain(null);
      return {
        content: [
          {
            type: 'text',
            text: 'Returned to navigation menu. Use blackpoint_status to see available domains.',
          },
        ],
      };
    }

    default:
      return {
        content: [
          {
            type: 'text',
            text: `Unknown navigation tool: ${toolName}`,
          },
        ],
        isError: true,
      };
  }
}

export const navigationHandler: DomainHandler = { getTools, handleCall };