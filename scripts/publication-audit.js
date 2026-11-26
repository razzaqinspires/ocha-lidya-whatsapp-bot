import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { auditPublicationPaths, hasPrivateSourceFingerprint, scanSecrets } from '../src/core/publication-policy.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function runGit(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', x => (out += x));
    child.stderr.setEncoding('utf8').on('data', x => (err += x));
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `git exited ${code}`))));
  });
}

async function walkFiles(directory, relative = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (
        [
          '.git',
          '.release',
          'node_modules',
          'sessions',
          'data',
          'logs',
          'coverage',
          'dist',
          'build',
          'contributions',
          'adapters',
          'generated-commands',
          'runtime-workspaces',
          'incoming',
        ].includes(entry.name)
      )
        continue;
      files.push(...(await walkFiles(path.join(directory, entry.name), rel)));
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return files;
}

let tracked;
let inventoryMode = 'git';
try {
  tracked = (await runGit(['ls-files', '-co', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
} catch {
  inventoryMode = 'filesystem-fallback';
  tracked = await walkFiles(root);
}
const audit = auditPublicationPaths(tracked);
const secretFindings = [];
const sourceFingerprintFindings = [];
for (const file of audit.eligiblePaths) {
  const absolute = path.resolve(root, file);
  if (!absolute.startsWith(`${root}${path.sep}`)) continue;
  let bytes;
  try {
    bytes = await fs.readFile(absolute);
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }
  if (hasPrivateSourceFingerprint(bytes)) sourceFingerprintFindings.push(file);
}
for (const file of audit.eligiblePaths) {
  const absolute = path.resolve(root, file);
  if (!absolute.startsWith(`${root}${path.sep}`)) continue;
  let content;
  try {
    content = await fs.readFile(absolute, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }
  for (const finding of scanSecrets(content)) secretFindings.push(`${file}:${finding.line} [${finding.rule}]`);
}
console.log(
  `Inventaris (${inventoryMode}): ${tracked.length} file; publik: ${audit.eligiblePaths.length}; privat dikecualikan: ${audit.privatePaths.length}.`,
);
if (audit.privatePaths.length) console.log('File privat yang dikecualikan:');
for (const file of audit.privatePaths) console.log(` - ${file}`);
if (sourceFingerprintFindings.length) {
  console.error('AUDIT GAGAL: byte identik dengan salah satu dari empat source privat ditemukan di checkout publik:');
  for (const file of sourceFingerprintFindings) console.error(` - ${file}`);
  process.exitCode = 1;
}
if (secretFindings.length) {
  console.error('AUDIT GAGAL: kemungkinan secret ditemukan (nilai tidak dicetak):');
  for (const item of secretFindings) console.error(` - ${item}`);
  process.exitCode = 1;
}
if (!sourceFingerprintFindings.length && !secretFindings.length) {
  console.log('AUDIT LULUS: tidak ditemukan byte source privat identik atau pola credential pada file publik.');
}
