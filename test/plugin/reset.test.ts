import { describe, it, expect, vi } from 'vitest';
import { createAgyResetTool, AGY_RESET_TOOL_NAME } from '../../src/plugin/reset';
import * as cachePlugin from '../../src/plugin/cache';
import * as turnStateSdk from '../../src/sdk/request/turn-state-tracker';
import * as retrySdk from '../../src/sdk/retry';

describe('createAgyResetTool', () => {
  it('has expected tool name', () => {
    expect(AGY_RESET_TOOL_NAME).toBe('agy_reset');
  });

  it('resets cooldowns, turn states, and caches', async () => {
    const resetRetrySpy = vi.spyOn(retrySdk, 'resetRetryCooldowns').mockImplementation(() => {});
    const clearSignatureSpy = vi.spyOn(cachePlugin, 'clearAllSignatureCaches').mockImplementation(() => {});
    const mockTracker = { clearAll: vi.fn() };
    vi.spyOn(turnStateSdk, 'getTurnStateTracker').mockReturnValue(mockTracker as any);

    const resetTool = createAgyResetTool();
    const result = await resetTool.execute({});

    expect(resetRetrySpy).toHaveBeenCalled();
    expect(mockTracker.clearAll).toHaveBeenCalled();
    expect(clearSignatureSpy).toHaveBeenCalled();
    expect(result).toContain('Antigravity (Agy) runtime caches, rate-limit cooldowns, and reasoning turn states have been reset successfully');
  });

  it('handles errors gracefully without throwing', async () => {
    vi.spyOn(retrySdk, 'resetRetryCooldowns').mockImplementation(() => {
      throw new Error('reset error');
    });
    vi.spyOn(turnStateSdk, 'getTurnStateTracker').mockImplementation(() => {
      throw new Error('tracker error');
    });
    vi.spyOn(cachePlugin, 'clearAllSignatureCaches').mockImplementation(() => {
      throw new Error('cache error');
    });

    const resetTool = createAgyResetTool();
    const result = await resetTool.execute({});

    expect(result).toContain('Antigravity (Agy) runtime caches, rate-limit cooldowns, and reasoning turn states have been reset successfully');
  });
});
