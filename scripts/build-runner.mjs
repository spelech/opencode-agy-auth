#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const preloadScript = path.join(__dirname, 'node-preload.cjs').replace(/\\/g, '/');

const env = { ...process.env };

if (process.platform === 'win32') {
  const esbuildSrc = path.join(repoRoot, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe');
  if (fs.existsSync(esbuildSrc)) {
    const esbuildDst = path.join(os.tmpdir(), 'esbuild-agy.exe');
    try {
      fs.copyFileSync(esbuildSrc, esbuildDst);
      env.ESBUILD_BINARY_PATH = esbuildDst;
    } catch {}
  }

  const existingNodeOptions = env.NODE_OPTIONS || '';
  env.NODE_OPTIONS = `${existingNodeOptions} --require "${preloadScript}"`.trim();
}

// 1. Run tsup bundle
const tsupRes = cp.spawnSync('npx', ['tsup'], {
  cwd: repoRoot,
  env,
  stdio: 'inherit',
  shell: true
});

if (tsupRes.status !== 0) {
  process.exit(tsupRes.status ?? 1);
}

// 2. Run declaration emit via tsc-runner
const tscRes = cp.spawnSync('node', [path.join(__dirname, 'tsc-runner.mjs'), '-p', 'tsconfig.build.json'], {
  cwd: repoRoot,
  env,
  stdio: 'inherit'
});

process.exit(tscRes.status ?? 0);
