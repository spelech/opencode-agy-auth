#!/usr/bin/env node
/**
 * Automates syncing spelech/opencode-agy-auth with upstream (anthonyhaussman/opencode-agy-auth):
 * 1. Fetches upstream/main and tags
 * 2. Merges upstream/main, automatically resolving models.json and AGY_API_VERSION conflicts
 * 3. Runs npm install, npm run models:refresh, npm run typecheck, npm test, npm run build, npm run smoke:node-import
 * 4. Commits and pushes to origin/main (unless --no-push is passed)
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const noPush = process.argv.includes('--no-push');

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: opts.stdio || 'inherit',
    ...opts,
  });
}

function runCapture(cmd, args) {
  return execFileSync(cmd, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function resolveFetchModelsConflict(upstreamVersion) {
  const filePath = join(repoRoot, 'scripts/fetch-models.mjs');
  let content = readFileSync(filePath, 'utf8');
  if (content.includes('<<<<<<<')) {
    // Keep our dynamic CLI discovery block while updating AGY_API_VERSION to upstream's version
    content = content.replace(
      /<<<<<<< HEAD\n([\s\S]*?)=======\nconst AGY_API_VERSION = '([^']+)';\n>>>>>>> [^\n]+\n/g,
      (_match, ours, theirVer) => {
        const ver = theirVer || upstreamVersion;
        if (ours.includes('AGY_API_VERSION')) {
          return ours.replace(/const AGY_API_VERSION = '[^']+';/, `const AGY_API_VERSION = '${ver}';`);
        }
        return `const AGY_API_VERSION = '${ver}';\n${ours}`;
      },
    );
  }
  if (upstreamVersion) {
    content = content.replace(/const AGY_API_VERSION = '[^']+';/, `const AGY_API_VERSION = '${upstreamVersion}';`);
  }
  writeFileSync(filePath, content, 'utf8');
}

function main() {
  console.log('[sync-upstream] Fetching origin and upstream...');
  run('git', ['fetch', 'origin']);
  run('git', ['fetch', 'upstream', '--tags', '--force']);

  const behindCount = Number(runCapture('git', ['rev-list', '--count', 'HEAD..upstream/main']) || '0');
  const upstreamPkg = JSON.parse(runCapture('git', ['show', 'upstream/main:package.json']));
  const upstreamVersion = upstreamPkg.version;

  if (behindCount === 0) {
    console.log(`[sync-upstream] Already up to date with upstream/main (v${upstreamVersion}). Refreshing models & build...`);
  } else {
    console.log(`[sync-upstream] Merging ${behindCount} commit(s) from upstream/main (v${upstreamVersion})...`);
    try {
      run('git', ['merge', 'upstream/main', '--no-commit']);
    } catch {
      console.log('[sync-upstream] Auto-resolving expected conflicts (models.json, scripts/fetch-models.mjs)...');
      run('git', ['checkout', '--theirs', 'models.json']);
      resolveFetchModelsConflict(upstreamVersion);
      run('git', ['add', 'models.json', 'scripts/fetch-models.mjs']);
    }
  }

  console.log('[sync-upstream] Installing dependencies & refreshing models...');
  run('npm', ['install']);
  run('npm', ['run', 'models:refresh']);

  console.log('[sync-upstream] Running typecheck, tests, build, and smoke check...');
  run('npm', ['run', 'typecheck']);
  run('npm', ['test']);
  run('npm', ['run', 'build']);
  run('npm', ['run', 'smoke:node-import']);

  const statusOut = runCapture('git', ['status', '--porcelain']);
  if (statusOut) {
    run('git', ['add', 'models.json', 'scripts/fetch-models.mjs', 'src/sdk/agy-cli-version.ts', 'package.json', 'package-lock.json']);
    const staged = runCapture('git', ['diff', '--cached', '--name-only']);
    if (staged) {
      const msg = behindCount > 0
        ? `Merge remote-tracking branch 'upstream/main' (v${upstreamVersion})`
        : `chore(models): refresh models catalog (v${upstreamVersion})`;
      run('git', ['commit', '-m', msg]);
    }
  }

  if (!noPush) {
    const aheadCount = Number(runCapture('git', ['rev-list', '--count', 'origin/main..HEAD']) || '0');
    if (aheadCount > 0) {
      console.log(`[sync-upstream] Pushing ${aheadCount} commit(s) to origin/main...`);
      run('git', ['push', 'origin', 'main']);
    } else {
      console.log('[sync-upstream] origin/main is already up to date.');
    }
  }
}

main();
