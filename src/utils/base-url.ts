import { DEFAULT_BASE_URL, resolveBaseUrl } from '@wyre-ai/node-blackpoint';

/**
 * Host the previous SDK defaulted to. It does not resolve; the live API is
 * `api.blackpointcyber.com`.
 */
const LEGACY_COMPASSONE_HOST = 'api.compassone.blackpointcyber.com';

export { DEFAULT_BASE_URL };

/**
 * Normalize a CompassOne base URL before it is handed to the SDK.
 *
 * `resolveBaseUrl` (SDK) appends `/v1` once and does not double it. This
 * wrapper also rewrites the legacy CompassOne host, which customers still
 * have stored, onto `https://api.blackpointcyber.com/v1`. Any other host is
 * left in place so a regional or proxy base URL still works; only the
 * version suffix is normalized.
 */
export function normalizeBlackpointBaseUrl(input?: string): string {
  const trimmed = input?.trim() ?? '';
  if (!trimmed) {
    return resolveBaseUrl();
  }

  let candidate = trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname.toLowerCase() === LEGACY_COMPASSONE_HOST) {
      url.hostname = 'api.blackpointcyber.com';
      candidate = url.toString();
    }
  } catch {
    return resolveBaseUrl(trimmed);
  }

  return resolveBaseUrl(candidate);
}
