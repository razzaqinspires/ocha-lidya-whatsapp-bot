import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = 'https://github.com/razzaqinspires/ocha-lidya-whatsapp-bot.git';

function git(args, allowFailure = false) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(result.stderr.trim() || `git ${args.join(' ')} gagal`);
  return result;
}

const inside = git(['rev-parse', '--is-inside-work-tree'], true);
if (inside.status !== 0) {
  git(['init', '-b', 'main']);
  console.log('Git repository lokal dibuat dengan branch main.');
} else {
  const top = path.resolve(git(['rev-parse', '--show-toplevel']).stdout.trim());
  if (top !== root) throw new Error(`Root Git ${top} berbeda dari root proyek ${root}. Jalankan setup dari clone repository yang benar.`);
  const currentBranch = git(['branch', '--show-current']).stdout.trim();
  if (currentBranch !== 'main') {
    const existingMain = git(['show-ref', '--verify', '--quiet', 'refs/heads/main'], true);
    if (existingMain.status === 0) git(['switch', 'main']);
    else git(['branch', '-M', 'main']);
  }
}

const remote = git(['remote', 'get-url', 'origin'], true);
if (remote.status !== 0) {
  git(['remote', 'add', 'origin', repo]);
  console.log('Remote origin ditambahkan:', repo);
} else if (remote.stdout.trim().replace(/\.git$/i, '') !== 'https://github.com/razzaqinspires/ocha-lidya-whatsapp-bot') {
  throw new Error(`Remote origin harus menggunakan HTTPS ke repository target, bukan: ${remote.stdout.trim()}. Periksa dan ubah secara manual sebelum melanjutkan.`);
} else {
  console.log('Remote origin sudah sesuai:', remote.stdout.trim());
}

console.log('Git setup selesai. Pastikan branch main, identitas Git terisi, .env berisi GITHUB_PAT, lalu jalankan npm start.');
