import { describe, it, expect, afterEach } from 'vitest';
import { navigationHandler, setCurrentDomain, getNavigationState } from '../domains/navigation.js';

// navigationHandler has no test coverage at all prior to this file: getTools()
// (conditional back-tool, domain enum) and handleCall() (navigate/status/back
// business logic) were both completely untested. Run outside any
// AsyncLocalStorage request context, so activeState() falls back to the
// module-level stdio navigation state (see src/domains/navigation.ts) — reset
// it after every test so state doesn't leak between cases in this file.
describe('navigationHandler', () => {
  afterEach(() => {
    setCurrentDomain(null);
  });

  describe('getTools', () => {
    it('exposes navigate and status tools, with no back tool at the root menu', () => {
      const names = navigationHandler.getTools().map(t => t.name);
      expect(names).toContain('blackpoint_navigate');
      expect(names).toContain('blackpoint_status');
      expect(names).not.toContain('blackpoint_back');
    });

    it('adds the back tool once a domain is active', () => {
      setCurrentDomain('assets');
      const names = navigationHandler.getTools().map(t => t.name);
      expect(names).toContain('blackpoint_back');
    });

    it('lists real domains in the navigate tool schema enum', () => {
      const navigate = navigationHandler.getTools().find(t => t.name === 'blackpoint_navigate')!;
      const schema = navigate.inputSchema as { properties: { domain: { enum: string[] } } };
      expect(schema.properties.domain.enum).toEqual(
        expect.arrayContaining(['tenants', 'assets', 'detections', 'vulnerabilities'])
      );
    });
  });

  describe('handleCall: blackpoint_navigate', () => {
    it('navigates to a valid domain and persists the change in navigation state', async () => {
      const result = await navigationHandler.handleCall('blackpoint_navigate', { domain: 'tenants' });

      expect(result.isError).toBeFalsy();
      expect(result.content[0]).toMatchObject({ type: 'text' });
      expect((result.content[0] as { text: string }).text).toMatch(/Navigated to tenants domain/);
      expect(getNavigationState().currentDomain).toBe('tenants');
    });

    it('rejects a domain not in availableDomains and leaves state unchanged', async () => {
      const before = getNavigationState().currentDomain;

      const result = await navigationHandler.handleCall('blackpoint_navigate', {
        domain: 'not-a-real-domain',
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toMatch(/Invalid domain "not-a-real-domain"/);
      expect(getNavigationState().currentDomain).toBe(before);
    });
  });

  describe('handleCall: blackpoint_status', () => {
    it('reports the navigation menu when no domain is active', async () => {
      const result = await navigationHandler.handleCall('blackpoint_status', {});
      const text = (result.content[0] as { text: string }).text;

      expect(text).toMatch(/Current domain: Navigation menu/);
      expect(text).toMatch(/tenants: Customer tenants/);
    });

    it('reports the currently active domain', async () => {
      setCurrentDomain('vulnerabilities');

      const result = await navigationHandler.handleCall('blackpoint_status', {});
      const text = (result.content[0] as { text: string }).text;

      expect(text).toMatch(/Current domain: vulnerabilities/);
    });
  });

  describe('handleCall: blackpoint_back', () => {
    it('clears the current domain back to the root menu', async () => {
      setCurrentDomain('assets');

      const result = await navigationHandler.handleCall('blackpoint_back', {});

      expect(result.isError).toBeFalsy();
      expect(getNavigationState().currentDomain).toBeNull();
    });
  });

  describe('handleCall: unknown tool', () => {
    it('returns an isError result rather than throwing', async () => {
      const result = await navigationHandler.handleCall('blackpoint_bogus', {});

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toMatch(/Unknown navigation tool: blackpoint_bogus/);
    });
  });
});
