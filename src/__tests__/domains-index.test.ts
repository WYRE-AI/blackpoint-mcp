import { describe, expect, it } from 'vitest';
import { getAllTools, getHandlerForTool } from '../domains/index.js';

// Regression coverage for the Conduit gateway bug: blackpoint-mcp used to
// gate domain tools behind a `blackpoint_navigate` call, but Conduit
// suppresses `_navigate`/`_back` from tools/list and refuses to execute
// them, so every domain tool behind that gate was unreachable — only
// `blackpoint_status` ever showed up. getAllTools() must list every real
// tool up front, with no navigation step required.
describe('getAllTools', () => {
  it('lists every implemented domain tool without navigating first', () => {
    const names = getAllTools().map((t) => t.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'blackpoint_status',
        'blackpoint_navigate',
        'blackpoint_tenants_list',
        'blackpoint_tenants_get',
        'blackpoint_assets_list',
        'blackpoint_assets_get',
        'blackpoint_assets_relationships',
        'blackpoint_assets_search',
        'blackpoint_detections_list',
        'blackpoint_detections_get',
        'blackpoint_vulnerabilities_list',
        'blackpoint_vulnerabilities_scans_list',
        'blackpoint_vulnerabilities_darkweb_list',
        'blackpoint_vulnerabilities_external_list',
      ])
    );
  });

  it('has no duplicate tool names across handlers', () => {
    const names = getAllTools().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('getHandlerForTool', () => {
  it('resolves a domain tool to its owning handler without any navigation state', () => {
    expect(getHandlerForTool('blackpoint_assets_list')).not.toBeNull();
    expect(getHandlerForTool('blackpoint_tenants_get')).not.toBeNull();
    expect(getHandlerForTool('blackpoint_vulnerabilities_darkweb_list')).not.toBeNull();
  });

  it('resolves navigation tools to the navigation handler', () => {
    expect(getHandlerForTool('blackpoint_status')).not.toBeNull();
    expect(getHandlerForTool('blackpoint_navigate')).not.toBeNull();
  });

  it('returns null for an unknown tool name', () => {
    expect(getHandlerForTool('blackpoint_does_not_exist')).toBeNull();
  });
});
