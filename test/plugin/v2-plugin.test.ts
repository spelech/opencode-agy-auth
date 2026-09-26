import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setupAgyPlugin,
  getStoredAgyAuth,
  readStoredAgyAuthFromFile,
  _resetPluginStateForTest,
  _setLatestAgyAuthResolverForTest
} from '../../src/plugin';
import { AGY_PROVIDER_ID } from '../../src/constants';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as authPlugin from '../../src/plugin/auth';
import * as tokenPlugin from '../../src/plugin/token';

describe('OpenCode V2 Plugin Setup and Features', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _resetPluginStateForTest();
  });

  describe('readStoredAgyAuthFromFile & getStoredAgyAuth', () => {
    it('returns auth from custom file if exists', () => {
      const mockAuth = {
        type: 'oauth',
        access: 'stored-access',
        refresh: 'stored-refresh|project|managed',
        expires: Date.now() + 3600000
      };
      const tmpDir = os.tmpdir();
      const tmpAuthFile = path.join(tmpDir, `opencode-test-auth-${Date.now()}.json`);
      fs.writeFileSync(tmpAuthFile, JSON.stringify({ [AGY_PROVIDER_ID]: mockAuth }));

      try {
        const resFromFile = readStoredAgyAuthFromFile(tmpAuthFile);
        expect(resFromFile).toEqual(mockAuth);
      } finally {
        try { fs.unlinkSync(tmpAuthFile); } catch {}
      }
    });

    it('returns undefined if file does not exist or has invalid json', () => {
      const res = readStoredAgyAuthFromFile('/non/existent/path/auth.json');
      expect(res).toBeUndefined();

      const tmpDir = os.tmpdir();
      const tmpCorrupt = path.join(tmpDir, `opencode-test-corrupt-${Date.now()}.json`);
      fs.writeFileSync(tmpCorrupt, '{ invalid json');
      try {
        const resCorrupt = readStoredAgyAuthFromFile(tmpCorrupt);
        expect(resCorrupt).toBeUndefined();
      } finally {
        try { fs.unlinkSync(tmpCorrupt); } catch {}
      }
    });

    it('getStoredAgyAuth resolves from custom resolver if provided', async () => {
      const mockAuth = {
        type: 'oauth',
        access: 'resolved-access',
        refresh: 'resolved-refresh|p|m',
        expires: Date.now() + 3600000
      };
      _setLatestAgyAuthResolverForTest(async () => mockAuth as any);
      const res = await getStoredAgyAuth();
      expect(res).toEqual(mockAuth);

      // When resolver throws, falls back to file
      _setLatestAgyAuthResolverForTest(async () => {
        throw new Error('resolver failed');
      });
      const resFallback = await getStoredAgyAuth('/non/existent/path');
      expect(resFallback).toBeUndefined();
    });
  });

  describe('setupAgyPlugin', () => {
    it('registers tools, commands, provider, and http session hook', async () => {
      const toolAdds: any[] = [];
      const commandAdds: any[] = [];
      const providerAdds: any[] = [];
      let registeredHookName = '';
      let registeredHookFn: any = null;

      const mockCtx: any = {
        tool: {
          transform: vi.fn(async (callback) => {
            const editor = {
              add: vi.fn((tool) => toolAdds.push(tool))
            };
            await callback(editor);
          })
        },
        command: {
          transform: vi.fn(async (callback) => {
            const editor = {
              add: vi.fn((cmd) => commandAdds.push(cmd))
            };
            await callback(editor);
          })
        },
        provider: {
          transform: vi.fn(async (callback) => {
            const editor = {
              add: vi.fn((prov) => providerAdds.push(prov))
            };
            await callback(editor);
          })
        },
        session: {
          prompt: vi.fn(async () => {}),
          hook: vi.fn(async (name, fn) => {
            registeredHookName = name;
            registeredHookFn = fn;
          })
        }
      };

      await setupAgyPlugin(mockCtx);

      // Verify tools registration
      expect(mockCtx.tool.transform).toHaveBeenCalled();
      const toolNames = toolAdds.map((t) => t.name);
      expect(toolNames).toContain('agy_quota');
      expect(toolNames).toContain('agy_quota_summary');
      expect(toolNames).toContain('agy_status');
      expect(toolNames).toContain('agy_models');
      expect(toolNames).toContain('agy_reset');

      // Mock resolver so tools can execute
      _setLatestAgyAuthResolverForTest(async () => ({
        type: 'oauth',
        access: 'test-tok',
        refresh: 'ref|proj|m',
        expires: Date.now() + 3600000
      }));

      // Execute each tool
      for (const tool of toolAdds) {
        const result = await tool.execute({});
        expect(result).toHaveProperty('content');
      }

      // Verify commands registration
      expect(mockCtx.command.transform).toHaveBeenCalled();
      const cmdNames = commandAdds.map((c) => c.name);
      expect(cmdNames).toContain('agyquota');
      expect(cmdNames).toContain('agyquotasummary');
      expect(cmdNames).toContain('agystatus');
      expect(cmdNames).toContain('agymodels');
      expect(cmdNames).toContain('agyreset');

      // Execute each command with session prompt
      for (const cmd of commandAdds) {
        await cmd.execute({ sessionID: 'sess-test' });
        expect(mockCtx.session.prompt).toHaveBeenCalledWith(expect.objectContaining({
          sessionID: 'sess-test'
        }));
      }

      // Execute command when session prompt is not available
      const noSessionCtx: any = {
        tool: mockCtx.tool,
        command: {
          transform: vi.fn(async (callback) => {
            const cmds: any[] = [];
            const editor = { add: (c: any) => cmds.push(c) };
            await callback(editor);
            for (const c of cmds) {
              await c.execute({ sessionID: 'sess-test-no-prompt' });
            }
          })
        }
      };
      await setupAgyPlugin(noSessionCtx);

      // Verify provider registration
      expect(mockCtx.provider.transform).toHaveBeenCalled();
      expect(providerAdds.length).toBe(1);
      expect(providerAdds[0].info.name).toBe('Antigravity CLI');
      expect(providerAdds[0].models.length).toBeGreaterThan(0);

      // Verify session hook registration
      expect(registeredHookName).toBe('http.request');
      expect(typeof registeredHookFn).toBe('function');

      // Hook: non-Agy request ignores
      const nonAgyEvent = {
        model: { providerID: 'anthropic', id: 'claude-3-5' },
        request: new Request('https://api.anthropic.com/v1/messages')
      };
      await registeredHookFn(nonAgyEvent);
      expect(nonAgyEvent.request.headers.get('Authorization')).toBeNull();

      // Hook: no stored auth ignores
      _setLatestAgyAuthResolverForTest(async () => {
        throw new Error('no auth');
      });
      // Mock homedir so it finds nothing on disk
      vi.spyOn(os, 'homedir').mockReturnValue('/non/existent/home/dir');
      const agyEventNoAuth = {
        model: { providerID: AGY_PROVIDER_ID, id: 'gemini-3.7-flash' },
        request: new Request('https://generativelanguage.googleapis.com/v1beta/models')
      };
      await registeredHookFn(agyEventNoAuth);
      expect(agyEventNoAuth.request.headers.get('Authorization')).toBeNull();

      // Hook: valid stored auth injects headers
      const validAuth = {
        type: 'oauth' as const,
        access: 'valid-test-access-token',
        refresh: 'valid-refresh|proj|m',
        expires: Date.now() + 3600000
      };
      _setLatestAgyAuthResolverForTest(async () => validAuth);

      const agyEventValid = {
        model: { providerID: AGY_PROVIDER_ID, id: 'gemini-3.7-flash' },
        request: new Request('https://generativelanguage.googleapis.com/v1beta/models')
      };
      await registeredHookFn(agyEventValid);
      expect(agyEventValid.request.headers.get('Authorization')).toBe(`Bearer ${validAuth.access}`);
      expect(agyEventValid.request.headers.get('User-Agent')).toContain('antigravity');
      expect(agyEventValid.request.headers.get('X-Goog-Api-Client')).toContain('antigravity');

      // Hook: expired token triggers refresh
      vi.spyOn(authPlugin, 'accessTokenExpired').mockReturnValue(true);
      vi.spyOn(tokenPlugin, 'refreshAccessToken').mockResolvedValue({
        ...validAuth,
        access: 'refreshed-token-v2',
        expires: Date.now() + 3600000
      });

      const agyEventExpired = {
        model: { providerID: AGY_PROVIDER_ID, id: 'gemini-3.7-flash' },
        request: new Request('https://generativelanguage.googleapis.com/v1beta/models')
      };
      await registeredHookFn(agyEventExpired);
      expect(agyEventExpired.request.headers.get('Authorization')).toBe('Bearer refreshed-token-v2');
    });

    it('handles initialization warnings when caches fail to init', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const brokenCtx: any = {};
      await setupAgyPlugin(brokenCtx);
    });
  });
});
