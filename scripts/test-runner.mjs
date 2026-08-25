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
  const rolldownSrc = path.join(repoRoot, 'node_modules', '@rolldown', 'binding-win32-x64-msvc', 'rolldown-binding.win32-x64-msvc.node');
  if (fs.existsSync(rolldownSrc)) {
    const rolldownDst = path.join(os.tmpdir(), 'rolldown-binding.win32-x64-msvc.node');
    try {
      fs.copyFileSync(rolldownSrc, rolldownDst);
      env.NAPI_RS_NATIVE_LIBRARY_PATH = rolldownDst;
    } catch {}
  }

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

const args = process.argv.slice(2);
const res = cp.spawnSync('npx', ['vitest', ...args], {
  cwd: repoRoot,
  env,
  stdio: 'inherit',
  shell: true
});

process.exit(res.status ?? 0);
