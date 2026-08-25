import { tool } from '@opencode-ai/plugin';
import { clearAllSignatureCaches } from './cache';
import { getTurnStateTracker } from '../sdk/request/turn-state-tracker';
import { resetRetryCooldowns } from '../sdk/retry';

export const AGY_RESET_TOOL_NAME = 'agy_reset';

export function createAgyResetTool() {
  return tool({
    description: 'Reset local Antigravity (Agy) rate-limit cooldowns, multi-turn reasoning states, and signature caches.',
    args: {},
    async execute() {
      // 1. Reset retry cooldowns
      try {
        resetRetryCooldowns();
      } catch (err) {
        console.warn(`[Agy Reset] Failed to reset retry cooldowns: ${err}`);
      }

      // 2. Reset turn state tracker
      try {
        const tracker = getTurnStateTracker();
        tracker?.clearAll();
      } catch (err) {
        console.warn(`[Agy Reset] Failed to clear turn state tracker: ${err}`);
      }

      // 3. Clear signature caches
      try {
        clearAllSignatureCaches();
      } catch (err) {
        console.warn(`[Agy Reset] Failed to clear signature caches: ${err}`);
      }

      return 'Antigravity (Agy) runtime caches, rate-limit cooldowns, and reasoning turn states have been reset successfully.';
    }
  });
}
