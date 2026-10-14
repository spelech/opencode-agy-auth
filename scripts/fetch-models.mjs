#!/usr/bin/env node
/**
 * Refreshes models.json from a fresh fetchAvailableModels API call.
 *
 * Reads the OAuth refresh token from the opencode plugin's auth storage
 * (~/.local/share/opencode/auth.json under the "google-agy" key), refreshes
 * the access token, then calls the Antigravity Code Assist endpoint to get
 * the current internal model catalog and writes it to models.json.
 *
 * Usage:
 *   node scripts/fetch-models.mjs [--endpoint <url>] [--output <path>] [--verbose]
 *
 * Flags:
 *   --endpoint <url>   Override the Code Assist endpoint
 *                      (default: https://daily-cloudcode-pa.googleapis.com)
 *   --output <path>    Write to a different file (default: <repo>/models.json)
 *   --verbose          Emit progress to stderr
 *
 * Exit codes:
 *   0  Success
 *   1  Token refresh failed
 *   2  API response not OK
 *   3  Fetch / I/O error
 *
 * Requires Node >= 18 (uses built-in fetch with HTTP/2).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AGY_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const AGY_CLIENT_SECRET = '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';
const DEFAULT_ENDPOINT = 'https://daily-cloudcode-pa.googleapis.com';
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

function stripAnsi(str) {
  return String(str || '').replace(ANSI_REGEX, '');
}

function resolveAgyBinary() {
  const candidates = ['agy', join(homedir(), '.local/bin/agy')];
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['--version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      });
      return bin;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function readCurrentCliVersion(versionFilePath) {
  try {
    const content = readFileSync(versionFilePath, 'utf8');
    const match = content.match(/AGY_CLI_VERSION\s*=\s*['"]([^'"]+)['"]/);
    if (match && match[1]) {
      return match[1];
    }
  } catch {
    // ignore
  }
  return '1.3.4';
}

function detectAndSyncCliVersion(repoRoot, args) {
  const versionFilePath = join(repoRoot, 'src/sdk/agy-cli-version.ts');
  const currentVersion = readCurrentCliVersion(versionFilePath);
  const agyBin = resolveAgyBinary();
  if (!agyBin) {
    logVerbose(args, `[fetch-models] agy binary not found on PATH; using fallback version ${currentVersion}`);
    return { version: currentVersion, agyBin: null };
  }

  try {
    const rawOut = execFileSync(agyBin, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });
    const cleaned = stripAnsi(rawOut).trim();
    const semverMatch = cleaned.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
    const detectedVersion = semverMatch ? semverMatch[1] : currentVersion;
    if (detectedVersion !== currentVersion) {
      writeFileSync(versionFilePath, `export const AGY_CLI_VERSION = '${detectedVersion}';\n`, 'utf8');
      console.log(`Updated src/sdk/agy-cli-version.ts: ${currentVersion} -> ${detectedVersion}`);
    } else {
      logVerbose(args, `[fetch-models] AGY_CLI_VERSION already up to date (${detectedVersion})`);
    }
    return { version: detectedVersion, agyBin };
  } catch (err) {
    logVerbose(args, `[fetch-models] failed to run agy --version: ${err.message}; using ${currentVersion}`);
    return { version: currentVersion, agyBin };
  }
}

function parseAgyCliModels(agyBin, args) {
  if (!agyBin) return {};
  try {
    const rawOut = execFileSync(agyBin, ['models'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    });
    const cleaned = stripAnsi(rawOut);
    const discovered = {};
    for (const rawLine of cleaned.split(/\r?\n/)) {
      // Remove carriage-return spinner segments on the same line
      const segments = rawLine.split('\r');
      const line = (segments[segments.length - 1] || '').trim();
      if (!line || line.includes('Fetching available models')) continue;
      const match = line.match(/^([a-z0-9][a-z0-9._-]*)\s{2,}(.+)$/i);
      if (match) {
        const modelId = match[1].trim();
        const displayName = match[2].trim();
        discovered[modelId] = displayName;
      }
    }
    logVerbose(args, `[fetch-models] parsed ${Object.keys(discovered).length} models from 'agy models'`);
    return discovered;
  } catch (err) {
    logVerbose(args, `[fetch-models] failed to run 'agy models': ${err.message}`);
    return {};
  }
}

function mergeCliModelsIntoCatalog(data, cliModels) {
  if (!data || typeof data !== 'object') {
    data = {};
  }
  if (!data.models || typeof data.models !== 'object') {
    data.models = {};
  }
  const cliIds = Object.keys(cliModels);
  if (cliIds.length === 0) {
    return data;
  }

  for (const [modelId, displayName] of Object.entries(cliModels)) {
    if (!data.models[modelId]) {
      const lower = modelId.toLowerCase();
      const isClaude = lower.startsWith('claude-');
      const isGpt = lower.startsWith('gpt-');
      data.models[modelId] = {
        apiProvider: isClaude
          ? 'API_PROVIDER_ANTHROPIC_VERTEX'
          : isGpt
            ? 'API_PROVIDER_OPENAI_VERTEX'
            : 'API_PROVIDER_GOOGLE_GEMINI',
        displayName,
        maxOutputTokens: isClaude ? 128000 : isGpt ? 32768 : 65536,
        maxTokens: isClaude ? 1000000 : isGpt ? 131072 : 1048576,
        modelProvider: isClaude
          ? 'MODEL_PROVIDER_ANTHROPIC'
          : isGpt
            ? 'MODEL_PROVIDER_OPENAI'
            : 'MODEL_PROVIDER_GOOGLE',
        recommended: true,
        supportsImages: !isGpt,
        supportsThinking: true,
      };
    } else if (!data.models[modelId].displayName) {
      data.models[modelId].displayName = displayName;
    }
  }

  if (
    Array.isArray(data.agentModelSorts) &&
    data.agentModelSorts[0]?.groups?.[0] &&
    Array.isArray(data.agentModelSorts[0].groups[0].modelIds)
  ) {
    const existingIds = data.agentModelSorts[0].groups[0].modelIds;
    for (const id of cliIds) {
      if (!existingIds.includes(id)) {
        existingIds.push(id);
      }
    }
  } else {
    data.agentModelSorts = [
      {
        displayName: 'Recommended',
        groups: [{ modelIds: cliIds }],
      },
    ];
  }

  return data;
}

function parseArgs(argv) {
  const args = { endpoint: null, output: null, verbose: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--endpoint') {
      args.endpoint = argv[++i];
    } else if (arg === '--output') {
      args.output = argv[++i];
    } else if (arg === '--verbose') {
      args.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/fetch-models.mjs [--endpoint <url>] [--output <path>] [--verbose]');
      process.exit(0);
    } else {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    }
  }
  return args;
}

function findRepoRoot(startDir) {
  let dir = startDir;
  for (let depth = 0; depth < 20; depth++) {
    try {
      readFileSync(join(dir, 'package.json'), 'utf8');
      return dir;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return startDir;
}

function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = canonicalize(value[key]);
  }
  return sorted;
}

function logVerbose(args, ...msg) {
  if (args.verbose) console.error(...msg);
}

async function main() {
  const args = parseArgs(process.argv);
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(scriptDir);
  const endpoint = args.endpoint || DEFAULT_ENDPOINT;
  const outputPath = args.output ? resolve(args.output) : join(repoRoot, 'models.json');

  const { version: agyVersion, agyBin } = detectAndSyncCliVersion(repoRoot, args);
  const cliModels = parseAgyCliModels(agyBin, args);

  const userAgent = `antigravity/cli/${agyVersion} linux/${process.arch === 'x64' ? 'amd64' : process.arch}`;

  const authPath = join(homedir(), '.local/share/opencode/auth.json');
  logVerbose(args, `[fetch-models] reading auth from ${authPath}`);

  let auth;
  try {
    auth = JSON.parse(readFileSync(authPath, 'utf8'));
  } catch (err) {
    if (Object.keys(cliModels).length > 0 && existsSync(outputPath)) {
      logVerbose(args, `[fetch-models] auth.json unavailable; merging 'agy models' into existing ${outputPath}`);
      const existingData = JSON.parse(readFileSync(outputPath, 'utf8'));
      const merged = mergeCliModelsIntoCatalog(existingData, cliModels);
      writeFileSync(outputPath, JSON.stringify(canonicalize(merged), null, 2) + '\n', 'utf8');
      console.log(`Wrote ${Object.keys(merged.models || {}).length} models to ${outputPath} (from agy CLI)`);
      return;
    }
    console.error(`Failed to read auth.json at ${authPath}: ${err.message}`);
    process.exit(3);
  }

  const agyAuth = auth['google-agy'];
  if (!agyAuth || !agyAuth.refresh) {
    console.error('No google-agy OAuth refresh token found in auth.json');
    process.exit(1);
  }

  const refreshRaw = agyAuth.refresh;
  const [refreshToken, projectId, managedProjectId] = refreshRaw.split('|');

  if (!refreshToken) {
    console.error('Refresh token is empty');
    process.exit(1);
  }
  if (!managedProjectId) {
    console.error('managedProjectId (third pipe-separated field of refresh) is missing');
    process.exit(1);
  }

  logVerbose(args, `[fetch-models] refreshToken: ${refreshToken.substring(0, 10)}...`);
  logVerbose(args, `[fetch-models] projectId: ${projectId}`);
  logVerbose(args, `[fetch-models] managedProjectId: ${managedProjectId}`);
  logVerbose(args, `[fetch-models] endpoint: ${endpoint}`);
  logVerbose(args, `[fetch-models] output: ${outputPath}`);
  logVerbose(args, `[fetch-models] userAgent: ${userAgent}`);

  logVerbose(args, '[fetch-models] refreshing access token...');
  const refreshBody = new URLSearchParams({
    client_id: AGY_CLIENT_ID,
    client_secret: AGY_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  let token;
  try {
    const refreshResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: refreshBody.toString(),
    });
    if (!refreshResp.ok) {
      const errText = await refreshResp.text();
      console.error(`Token refresh failed (${refreshResp.status} ${refreshResp.statusText}): ${errText}`);
      process.exit(1);
    }
    token = await refreshResp.json();
  } catch (err) {
    console.error(`Token refresh fetch error: ${err.message}`);
    process.exit(3);
  }

  if (!token.access_token) {
    console.error(`Token refresh returned no access_token: ${JSON.stringify(token)}`);
    process.exit(1);
  }

  const accessToken = token.access_token;
  logVerbose(args, `[fetch-models] got access token: ${accessToken.substring(0, 10)}...`);

  const url = `${endpoint}/v1internal:fetchAvailableModels`;
  const body = JSON.stringify({ project: managedProjectId });
  logVerbose(args, `[fetch-models] calling ${url} with body: ${body}`);

  let data;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': userAgent,
        'Content-Type': 'application/json',
      },
      body,
    });
    logVerbose(args, `[fetch-models] response status: ${resp.status} ${resp.statusText}`);
    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`fetchAvailableModels failed (${resp.status} ${resp.statusText}): ${errText.substring(0, 1000)}`);
      process.exit(2);
    }
    data = await resp.json();
  } catch (err) {
    console.error(`fetchAvailableModels fetch error: ${err.message}`);
    process.exit(3);
  }

  data = mergeCliModelsIntoCatalog(data, cliModels);

  const modelCount = data.models ? Object.keys(data.models).length : 0;
  logVerbose(args, `[fetch-models] received ${modelCount} models, writing to ${outputPath}`);

  try {
    writeFileSync(outputPath, JSON.stringify(canonicalize(data), null, 2) + '\n', 'utf8');
  } catch (err) {
    console.error(`Failed to write ${outputPath}: ${err.message}`);
    process.exit(3);
  }

  console.log(`Wrote ${modelCount} models to ${outputPath} (agy CLI v${agyVersion})`);
}

main().catch((err) => {
  console.error(`Unexpected error: ${err.stack || err.message || err}`);
  process.exit(3);
});
