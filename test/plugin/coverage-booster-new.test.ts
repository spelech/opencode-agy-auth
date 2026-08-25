import { describe, it, expect, vi } from 'vitest';
import { getModelCatalogEntries, AgyCLIOAuthPlugin } from '../../src/plugin';
import { resetRetryCooldowns, shutdownRetryCooldowns } from '../../src/sdk/retry';
import {
  initTurnStateTracker,
  getTurnStateTracker,
  shutdownTurnStateTracker,
  TurnStateTracker
} from '../../src/sdk/request/turn-state-tracker';
import { clearAllSignatureCaches } from '../../src/plugin/cache';
import { createAgyStatusTool } from '../../src/plugin/status';
import * as authPlugin from '../../src/plugin/auth';
import * as tokenPlugin from '../../src/plugin/token';

describe('New Features Coverage Booster', () => {
  it('covers getModelCatalogEntries catalog mapping directly', () => {
    const entries = getModelCatalogEntries();
    expect(entries.length).toBeGreaterThan(0);
    const flash = entries.find((e) => e.id === 'gemini-3.7-flash');
    expect(flash).toBeDefined();
    expect(flash?.name).toBe('Gemini 3.7 Flash');
    expect(flash?.tiers).toBeDefined();
  });

  it('covers resetRetryCooldowns and shutdownRetryCooldowns', () => {
    resetRetryCooldowns();
    shutdownRetryCooldowns();
  });

  it('covers TurnStateTracker clearAll and shutdownTurnStateTracker', () => {
    const tracker = new TurnStateTracker(false);
    tracker.updateAfterResponse('sess-1', {
      inToolLoop: true,
      turnHasThinking: true,
      lastModelHasThinking: true,
      lastModelHasToolCalls: true
    });
    expect(tracker.getState('sess-1')).toBeDefined();
    tracker.clearAll();
    expect(tracker.getState('sess-1')).toBeUndefined();

    initTurnStateTracker();
    expect(getTurnStateTracker()).not.toBeNull();
    shutdownTurnStateTracker();
    expect(getTurnStateTracker()).toBeNull();
  });

  it('covers clearAllSignatureCaches', () => {
    clearAllSignatureCaches();
  });

  it('covers status tool expired access token without refreshed access', async () => {
    vi.spyOn(authPlugin, 'accessTokenExpired').mockReturnValue(true);
    vi.spyOn(tokenPlugin, 'refreshAccessToken').mockResolvedValue({
      type: 'oauth',
      access: '',
      refresh: 'ref|p|m',
      expires: 0
    });

    const statusTool = createAgyStatusTool({
      client: {} as any,
      getAuthResolver: () => async () => ({
        type: 'oauth',
        access: 'old',
        refresh: 'ref|p|m',
        expires: 0
      }) as any,
      getConfiguredProjectId: () => 'p',
      getUserAgentModel: () => 'model'
    });

    const result = await statusTool.execute({});
    expect(result).toContain('Antigravity access token is expired and could not be refreshed automatically');
  });

  it('covers plugin tool execution directly via plugin result', async () => {
    const mockClient: any = {
      config: {
        get: vi.fn(async () => ({ data: {} }))
      },
      tui: {
        showToast: vi.fn()
      }
    };

    const plugin = await AgyCLIOAuthPlugin({ client: mockClient });
    const modelsTool = plugin.tool?.['agy_models'] as any;
    const resetTool = plugin.tool?.['agy_reset'] as any;

    expect(modelsTool).toBeDefined();
    expect(resetTool).toBeDefined();

    const modelsRes = await modelsTool.execute({});
    expect(modelsRes).toContain('### Antigravity (Agy) Available Models');

    const resetRes = await resetTool.execute({});
    expect(resetRes).toContain('Antigravity (Agy) runtime caches, rate-limit cooldowns');
  });
});
