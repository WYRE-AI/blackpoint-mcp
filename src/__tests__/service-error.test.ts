import { describe, expect, it } from 'vitest';
import { ServiceError } from '@wyre-ai/node-blackpoint';
import { toolFailureText } from '../utils/service-error.js';

describe('toolFailureText', () => {
  it.each([400, 409, 422, 429, 500, 503])(
    'reports HTTP %s with method and path but never the vendor body',
    status => {
      const error = new ServiceError(
        'vendor failure',
        status,
        { message: 'internal stack at db-07', detail: 'secret-tenant-hint' },
        '/v1/assets',
        'GET'
      );

      const text = toolFailureText('Failed to list assets', error);

      expect(text).toBe(`Failed to list assets: HTTP ${status} GET /v1/assets.`);
      expect(text).not.toMatch(/Body/);
      expect(text).not.toContain('db-07');
      expect(text).not.toContain('secret-tenant-hint');
    }
  );

  it('keeps only the status and method when the error has no path', () => {
    // The SDK defaults method to GET when none is given.
    const error = new ServiceError('vendor failure', 500, { message: 'leak' });
    const text = toolFailureText('Failed', error);
    expect(text).toBe('Failed: HTTP 500 GET.');
    expect(text).not.toContain('leak');
  });
});
