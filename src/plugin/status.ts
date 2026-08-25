import { tool } from '@opencode-ai/plugin';
import { AGY_CODE_ASSIST_ENDPOINT } from '../constants';
import { accessTokenExpired, isOAuthAuth, parseRefreshParts } from './auth';
import { resolveCachedAuth } from './cache';
import { ensureProjectContext } from './project';
import { refreshAccessToken } from './token';
import type { GetAuth, PluginClient } from './types';

export const AGY_STATUS_TOOL_NAME = 'agy_status';

interface AgyStatusToolDependencies {
  client: PluginClient;
  getAuthResolver: () => GetAuth | undefined;
  getConfiguredProjectId: () => string | undefined;
  getUserAgentModel: () => string | undefined;
}

export function createAgyStatusTool({
  client,
  getAuthResolver,
  getConfiguredProjectId,
  getUserAgentModel
}: AgyStatusToolDependencies) {
  return tool({
    description: 'Retrieve current Antigravity (Agy) authentication, project, and session status.',
    args: {},
    async execute() {
      const getAuth = getAuthResolver();
      if (!getAuth) {
        return 'Antigravity auth status is unavailable before Google auth is initialized. Authenticate with the Google provider and retry.';
      }

      const auth = await getAuth();
      if (!isOAuthAuth(auth)) {
        return 'Antigravity requires OAuth with Google. Run `opencode auth login` and choose `Google OAuth (Antigravity CLI)` or `Google OAuth (Gemini CLI)`.';
      }

      let authRecord = resolveCachedAuth(auth);
      if (accessTokenExpired(authRecord)) {
        const refreshed = await refreshAccessToken(authRecord, client);
        if (!refreshed?.access) {
          return 'Antigravity access token is expired and could not be refreshed automatically. Run `opencode auth login` to re-authenticate.';
        }
        authRecord = refreshed;
      }

      const parts = parseRefreshParts(authRecord.refresh);
      let effectiveProjectId = parts.managedProjectId || parts.projectId || '';

      try {
        const projectContext = await ensureProjectContext(
          authRecord,
          client,
          getConfiguredProjectId(),
          getUserAgentModel()
        );
        if (projectContext.effectiveProjectId) {
          effectiveProjectId = projectContext.effectiveProjectId;
        }
      } catch {}

      const expiresInMs = typeof authRecord.expires === 'number' ? Math.max(0, authRecord.expires - Date.now()) : 0;
      const expiresInMinutes = Math.floor(expiresInMs / 60000);
      const expiresInSeconds = Math.floor((expiresInMs % 60000) / 1000);

      const configuredProject = getConfiguredProjectId() || parts.projectId || 'None (Automatic Companion Mode)';
      const managedProject = parts.managedProjectId || effectiveProjectId || 'Pending Resolution';

      const lines = [
        '### Antigravity (Agy) Auth Status',
        '',
        `- **Status**: Authenticated (OAuth 2.0)`,
        `- **Configured Project ID**: \`${configuredProject}\``,
        `- **Managed Companion Project ID**: \`${managedProject}\``,
        `- **Effective Active Project**: \`${effectiveProjectId || 'None'}\``,
        `- **Token Expiration**: in ~${expiresInMinutes}m ${expiresInSeconds}s (auto-refreshed)`,
        `- **Code Assist Endpoint**: \`${AGY_CODE_ASSIST_ENDPOINT}\``
      ];

      return lines.join('\n');
    }
  });
}
