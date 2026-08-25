#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const srcDir = path.join(repoRoot, 'node_modules', '@typescript', 'typescript-win32-x64', 'lib');

if (process.platform === 'win32' && fs.existsSync(srcDir)) {
  const dstDir = path.join(os.tmpdir(), 'ts-win32-lib-agy');
  if (!fs.existsSync(dstDir)) {
    fs.mkdirSync(dstDir, { recursive: true });
  }

  for (const f of fs.readdirSync(srcDir)) {
    const srcFile = path.join(srcDir, f);
    const dstFile = path.join(dstDir, f);
    try {
      if (!fs.existsSync(dstFile) || fs.statSync(srcFile).mtimeMs > fs.statSync(dstFile).mtimeMs) {
        fs.copyFileSync(srcFile, dstFile);
      }
    } catch {}
  }

  const exe = path.join(dstDir, 'tsc.exe');
  const res = cp.spawnSync(exe, process.argv.slice(2), {
    cwd: repoRoot,
    stdio: 'inherit'
  });
  process.exit(res.status ?? 0);
} else {
  const res = cp.spawnSync('npx', ['tsc', ...process.argv.slice(2)], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true
  });
  process.exit(res.status ?? 0);
}
