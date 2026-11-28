import 'dotenv/config';
import { startAcAutoGitSync } from '../src/core/ac-auto-git-sync.js';

const watcher = await startAcAutoGitSync({ enabled: true });
if (!watcher.ready) {
  console.error(
    'AC Git watcher tidak berjalan: nested repository belum siap. Jalankan npm run ac:git:setup setelah mengisi GITHUB_PAT.',
  );
  process.exitCode = 1;
} else {
  console.log('AC Git watcher aktif untuk repository artificial-consciousness-component. Tekan Ctrl+C untuk berhenti.');
  const shutdown = async () => {
    await watcher.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
