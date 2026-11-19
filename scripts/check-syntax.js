import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['src', 'test', 'scripts'];
const files = [];
async function walk(dir) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(target);
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(target);
  }
}
for (const root of roots) await walk(root);
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`${file}\n${result.stderr}`);
  }
}
if (failed) process.exit(1);
process.stdout.write(`Syntax OK: ${files.length} JavaScript files checked.\n`);
