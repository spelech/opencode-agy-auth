import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAgyStatusTool, AGY_STATUS_TOOL_NAME } from '../../src/plugin/status';
import * as authPlugin from '../../src/plugin/auth';
import * as tokenPlugin from '../../src/plugin/token';
import * as projectContextPlugin from '../../src/plugin/project/context';

describe('createAgyStatusTool', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('has expected tool name', () => {
    expect(AGY_STATUS_TOOL_NAME).toBe('agy_status');
  });

  it('handles undefined auth resolver', async () => {
    const statusTool = createAgyStatusTool({
      client: {} as any,
      getAuthResolver: () => undefined,
      getConfiguredProjectId: () => 'my-proj',
      getUserAgentModel: () => 'gemini-3.7-flash'
    });

    const result = await statusTool.execute({});
    expect(result).toContain('Antigravity auth status is unavailable before Google auth is initialized');
  });

  it('handles non-oauth auth', async () => {
    const statusTool = createAgyStatusTool({
      client: {} as any,
      getAuthResolver: () => async () => ({ type: 'api_key', key: '123' }) as any,
      getConfiguredProjectId: () => 'my-proj',
      getUserAgentModel: () => 'gemini-3.7-flash'
    });

    const result = await statusTool.execute({});
    expect(result).toContain('Antigravity requires OAuth with Google');
  });

  it('handles token refresh failure when expired', async () => {
    vi.spyOn(authPlugin, 'accessTokenExpired').mockReturnValue(true);
    vi.spyOn(tokenPlugin, 'refreshAccessToken').mockResolvedValue(undefined);

    const statusTool = createAgyStatusTool({
      client: {} as any,
      getAuthResolver: () => async () => ({
        type: 'oauth',
        access: 'old',
        refresh: 'ref|proj|man',
        expires: 0
      }) as any,
      getConfiguredProjectId: () => 'my-proj',
      getUserAgentModel: () => 'gemini-3.7-flash'
    });

    const result = await statusTool.execute({});
    expect(result).toContain('Antigravity access token is expired and could not be refreshed automatically');
  });

  it('formats status output successfully with project context', async () => {
    vi.spyOn(authPlugin, 'accessTokenExpired').mockReturnValue(false);
    vi.spyOn(projectContextPlugin, 'ensureProjectContext').mockResolvedValue({
      auth: {
        type: 'oauth',
        access: 'valid-access',
        refresh: 'ref|my-proj|citric-engine-123',
        expires: Date.now() + 3600000
      },
      effectiveProjectId: 'citric-engine-123'
    });

    const statusTool = createAgyStatusTool({
      client: {} as any,
      getAuthResolver: () => async () => ({
        type: 'oauth',
        access: 'valid-access',
        refresh: 'ref|my-proj|citric-engine-123',
        expires: Date.now() + 3600000
      }) as any,
      getConfiguredProjectId: () => 'my-proj',
      getUserAgentModel: () => 'gemini-3.7-flash'
    });

    const result = await statusTool.execute({});
    expect(result).toContain('### Antigravity (Agy) Auth Status');
    expect(result).toContain('Authenticated (OAuth 2.0)');
    expect(result).toContain('`my-proj`');
    expect(result).toContain('`citric-engine-123`');
  });

  it('handles automatic companion mode without configured project', async () => {
    vi.spyOn(authPlugin, 'accessTokenExpired').mockReturnValue(false);
    vi.spyOn(projectContextPlugin, 'ensureProjectContext').mockRejectedValue(new Error('no project'));

    const statusTool = createAgyStatusTool({
      client: {} as any,
      getAuthResolver: () => async () => ({
        type: 'oauth',
        access: 'valid-access',
        refresh: 'ref||citric-engine-123',
        expires: Date.now() + 1800000
      }) as any,
      getConfiguredProjectId: () => undefined,
      getUserAgentModel: () => undefined
    });

    const result = await statusTool.execute({});
    expect(result).toContain('None (Automatic Companion Mode)');
    expect(result).toContain('`citric-engine-123`');
  });
});
