import { describe, expect, it } from 'vitest';
import { DEFAULT_BASE_URL } from '@wyre-ai/node-blackpoint';
import { normalizeBlackpointBaseUrl } from '../utils/base-url.js';

const LIVE = 'https://api.blackpointcyber.com/v1';

describe('normalizeBlackpointBaseUrl', () => {
  it('defaults to the live CompassOne host', () => {
    expect(DEFAULT_BASE_URL).toBe(LIVE);
    expect(normalizeBlackpointBaseUrl()).toBe(LIVE);
    expect(normalizeBlackpointBaseUrl('   ')).toBe(LIVE);
  });

  it('accepts the live host with or without /v1 and does not double the suffix', () => {
    expect(normalizeBlackpointBaseUrl('https://api.blackpointcyber.com')).toBe(LIVE);
    expect(normalizeBlackpointBaseUrl('https://api.blackpointcyber.com/')).toBe(LIVE);
    expect(normalizeBlackpointBaseUrl('https://api.blackpointcyber.com/v1')).toBe(LIVE);
    expect(normalizeBlackpointBaseUrl('https://api.blackpointcyber.com/v1/')).toBe(LIVE);
  });

  it('rewrites the legacy CompassOne host, with or without /v1, onto the live host', () => {
    expect(normalizeBlackpointBaseUrl('https://api.compassone.blackpointcyber.com')).toBe(LIVE);
    expect(normalizeBlackpointBaseUrl('https://api.compassone.blackpointcyber.com/')).toBe(LIVE);
    expect(normalizeBlackpointBaseUrl('https://api.compassone.blackpointcyber.com/v1')).toBe(LIVE);
    expect(normalizeBlackpointBaseUrl('https://api.compassone.blackpointcyber.com/v1/')).toBe(LIVE);
    expect(normalizeBlackpointBaseUrl('https://API.CompassOne.BlackpointCyber.com')).toBe(LIVE);
  });

  it('keeps a non-Blackpoint host and still normalizes /v1', () => {
    expect(normalizeBlackpointBaseUrl('https://proxy.example/blackpoint')).toBe(
      'https://proxy.example/blackpoint/v1'
    );
    expect(normalizeBlackpointBaseUrl('https://proxy.example/blackpoint/v1')).toBe(
      'https://proxy.example/blackpoint/v1'
    );
    expect(normalizeBlackpointBaseUrl('https://customer-instance.blackpointcyber.com')).toBe(
      'https://customer-instance.blackpointcyber.com/v1'
    );
  });

  it('rejects a value that is not a URL', () => {
    expect(() => normalizeBlackpointBaseUrl('not a url')).toThrow(/Invalid base URL/);
  });
});
