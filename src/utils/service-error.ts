import { ServiceError } from '@wyre-ai/node-blackpoint';
import { logger } from './logger.js';

const LIVE_BASE_URL = 'https://api.blackpointcyber.com/v1';

/**
 * Log a tool failure with status, path, and body.
 *
 * `JSON.stringify` on a bare `Error` is `{}` because `message` is not
 * enumerable. `ServiceError.toJSON()` is a plain object and redacts the
 * bearer token. Non-SDK errors are logged as `{ name, message }` so they
 * do not collapse the same way.
 */
export function logServiceFailure(
  message: string,
  error: unknown,
  extra?: Record<string, unknown>
): void {
  logger.error(message, failureContext(error, extra));
}

export function failureContext(
  error: unknown,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  if (error instanceof ServiceError) {
    return { ...extra, ...error.toJSON() };
  }
  if (error instanceof Error) {
    return { ...extra, name: error.name, message: error.message };
  }
  return { ...extra, error };
}

/**
 * Tool-facing text. 401/403 means the key is bad or the account is not
 * entitled. 404 means the base URL or path does not exist on the live API.
 */
export function toolFailureText(action: string, error: unknown): string {
  if (error instanceof ServiceError) {
    const location = [error.method, error.path].filter(part => part.length > 0).join(' ');
    const where = location.length > 0 ? ` ${location}` : '';
    if (error.status === 401 || error.status === 403) {
      return `${action}: the API key is invalid or this account is not entitled to the resource (HTTP ${error.status}${where}).`;
    }
    if (error.status === 404) {
      return `${action}: CompassOne returned HTTP 404${where}. The base URL or path is wrong; the live API is ${LIVE_BASE_URL}.`;
    }
    const body =
      error.body === undefined || error.body === null || error.body === ''
        ? ''
        : ` Body: ${JSON.stringify(error.body)}`;
    return `${action}: HTTP ${error.status}${where}.${body}`;
  }

  const detail = error instanceof Error ? error.message : String(error);
  return `${action}: ${detail}`;
}

export function toolFailure(action: string, error: unknown, extra?: Record<string, unknown>) {
  logServiceFailure(action, error, extra);
  return {
    content: [{ type: 'text' as const, text: toolFailureText(action, error) }],
    isError: true as const,
  };
}
