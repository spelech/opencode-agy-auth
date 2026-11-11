#!/usr/bin/env node
/**
 * Auto-Sync & Fleet Deployment Orchestrator for opencode-agy-auth:
 * 1. Checks if host `agy` CLI binary version changed or upstream remote has new commits.
 * 2. Checks if any online fleet targets (10.0.0.21, 10.0.0.22) are pending or behind.
 * 3. If updates needed, runs `sync:upstream` (merging, testing, building dist/, pushing to GitHub).
 * 4. Deploys updated dist/ and models.json instantly to online fleet machines via SSH & scp.
 * 5. Persists state in `.sync-state.json`.
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const statePath = join(repoRoot, '.sync-state.json');

const FLEET_TARGETS = [
  {
    name: 'GLORIUS',
    host: '10.0.0.21',
    user: 'Alias',
    targetPath: 'C:/Users/Alias/repos/opencode-agy-auth',
  },
  {
    name: 'probook',
    host: '10.0.0.22',
    user: 'Alias',
    targetPath: 'C:/Users/Alias/repos/opencode-agy-auth',
  },
];

const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

function stripAnsi(str) {
  return String(str || '').replace(ANSI_REGEX, '').trim();
}

function resolveAgyVersion() {
  const candidates = ['agy', join(homedir(), '.local/bin/agy')];
  for (const bin of candidates) {
    try {
      const out = execFileSync(bin, ['--version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      });
      const cleaned = stripAnsi(out);
      const m = cleaned.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
      if (m) return m[1];
    } catch {
      // try next
    }
  }
  return null;
}

function getUpstreamHeadCommit() {
  try {
    const out = execFileSync('git', ['ls-remote', 'upstream', 'refs/heads/main'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    }).trim();
    if (out) {
      return out.split(/\s+/)[0];
    }
  } catch (err) {
    console.warn(`[auto-sync] Warning: failed to query upstream git remote: ${err.message}`);
  }
  return null;
}

function getLocalHeadCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

function loadState() {
  if (existsSync(statePath)) {
    try {
      return JSON.parse(readFileSync(statePath, 'utf8'));
    } catch {
      // fallback
    }
  }
  return {
    lastAgyVersion: null,
    lastUpstreamCommit: null,
    lastBuiltCommit: null,
    fleetStatus: {},
  };
}

function saveState(state) {
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function isHostOnline(host, user) {
  try {
    execFileSync(
      'ssh',
      ['-o', 'ConnectTimeout=2', '-o', 'BatchMode=yes', `${user}@${host}`, 'echo ok'],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 3000 }
    );
    return true;
  } catch {
    return false;
  }
}

function deployToFleetTarget(target, localCommit) {
  const { name, host, user, targetPath } = target;
  console.log(`[fleet-deploy] Probing ${name} (${host})...`);

  if (!isHostOnline(host, user)) {
    console.log(`[fleet-deploy] ${name} (${host}) is OFFLINE. Marking pending.`);
    return { ok: false, offline: true };
  }

  console.log(`[fleet-deploy] ${name} is online. Syncing repository and artifacts...`);
  try {
    // 1. Git pull
    execFileSync(
      'ssh',
      [
        '-o', 'BatchMode=yes',
        `${user}@${host}`,
        `cmd.exe /c "git -C ${targetPath} pull origin main"`,
      ],
      { stdio: 'inherit', timeout: 30000 }
    );

    // 2. Direct scp dist/ and models.json
    const distSource = join(repoRoot, 'dist');
    const modelsSource = join(repoRoot, 'models.json');
    execFileSync('scp', ['-r', '-B', distSource, `${user}@${host}:${targetPath}/`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    });
    execFileSync('scp', ['-B', modelsSource, `${user}@${host}:${targetPath}/models.json`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    });

    console.log(`[fleet-deploy] Successfully synced ${name} to commit ${localCommit.slice(0, 7)}.`);
    return { ok: true, offline: false };
  } catch (err) {
    console.error(`[fleet-deploy] Error syncing ${name}: ${err.message}`);
    return { ok: false, offline: false, error: err.message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const fleetOnly = args.includes('--fleet-only');
  const dryRun = args.includes('--dry-run');

  const state = loadState();
  const currentAgyVer = resolveAgyVersion();
  const upstreamHead = getUpstreamHeadCommit();
  const currentHead = getLocalHeadCommit();

  console.log(`[auto-sync] Current agy CLI version: ${currentAgyVer || 'unknown'}`);
  console.log(`[auto-sync] Local HEAD commit: ${currentHead ? currentHead.slice(0, 7) : 'unknown'}`);
  console.log(`[auto-sync] Upstream main commit: ${upstreamHead ? upstreamHead.slice(0, 7) : 'unknown'}`);

  let needsBuild = false;

  if (force) {
    console.log('[auto-sync] Force flag set. Proceeding with full sync and deployment.');
    needsBuild = true;
  } else if (!fleetOnly) {
    if (currentAgyVer && currentAgyVer !== state.lastAgyVersion) {
      console.log(`[auto-sync] Detected agy CLI version change: ${state.lastAgyVersion} -> ${currentAgyVer}`);
      needsBuild = true;
    }
    if (upstreamHead && upstreamHead !== state.lastUpstreamCommit) {
      console.log(`[auto-sync] Detected upstream commit change: ${state.lastUpstreamCommit ? state.lastUpstreamCommit.slice(0, 7) : 'none'} -> ${upstreamHead.slice(0, 7)}`);
      needsBuild = true;
    }
  }

  // Check if any fleet machines are currently behind or pending
  let anyFleetBehind = false;
  for (const t of FLEET_TARGETS) {
    const fStatus = state.fleetStatus[t.host];
    if (!fStatus || fStatus.commit !== currentHead || fStatus.pending) {
      anyFleetBehind = true;
    }
  }

  if (!needsBuild && !anyFleetBehind && !force) {
    console.log('[auto-sync] All components and fleet machines up to date. Nothing to do.');
    return;
  }

  if (dryRun) {
    console.log('[auto-sync] Dry-run mode enabled. Exiting before build/deploy.');
    return;
  }

  if (needsBuild && !fleetOnly) {
    console.log('[auto-sync] Running upstream sync, conflict resolution & build...');
    try {
      execSync('npm run sync:upstream', {
        cwd: repoRoot,
        stdio: 'inherit',
      });
      state.lastAgyVersion = currentAgyVer;
      state.lastUpstreamCommit = upstreamHead;
      state.lastBuiltCommit = getLocalHeadCommit();
      saveState(state);
    } catch (err) {
      console.error(`[auto-sync] sync:upstream failed: ${err.message}`);
      process.exit(1);
    }
  }

  const activeCommit = getLocalHeadCommit();
  state.lastBuiltCommit = activeCommit;

  // Deploy to fleet
  console.log('[auto-sync] Synchronizing fleet targets...');
  for (const target of FLEET_TARGETS) {
    const fStatus = state.fleetStatus[target.host] || {};
    if (fStatus.commit === activeCommit && !fStatus.pending && !force) {
      console.log(`[auto-sync] ${target.name} (${target.host}) is already at latest commit ${activeCommit.slice(0, 7)}.`);
      continue;
    }

    const res = deployToFleetTarget(target, activeCommit);
    if (res.ok) {
      state.fleetStatus[target.host] = {
        name: target.name,
        commit: activeCommit,
        lastSyncedAt: new Date().toISOString(),
        pending: false,
      };
    } else {
      state.fleetStatus[target.host] = {
        name: target.name,
        commit: fStatus.commit || null,
        pending: true,
        lastAttemptAt: new Date().toISOString(),
      };
    }
    saveState(state);
  }

  console.log('[auto-sync] Run completed successfully.');
}

main().catch((err) => {
  console.error(`[auto-sync] Fatal error: ${err.message}`);
  process.exit(1);
});
