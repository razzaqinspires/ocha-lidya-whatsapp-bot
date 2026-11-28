import 'dotenv/config';
import { startAutoPushRuntime } from '../src/core/auto-push-runtime.js';
import { normalizeAutoPushTarget } from '../src/core/auto-push-config.js';

const action = String(process.argv[2] || 'status').toLowerCase();
const target = normalizeAutoPushTarget(process.argv[3] || 'all');
if (!target) {
  console.error('Target tidak dikenal. Gunakan ocha, ac, atau all.');
  process.exit(2);
}

const runtime = await startAutoPushRuntime({ watch: false });
try {
  if (action === 'status') {
    console.log(JSON.stringify(await runtime.getStatus(target), null, 2));
  } else if (action === 'push') {
    const result = await runtime.pushNow(target);
    console.log(JSON.stringify(result, null, 2));
    if (Object.values(result).some(value => !value.ok)) process.exitCode = 1;
  } else if (['on', 'off'].includes(action)) {
    console.log(JSON.stringify(await runtime.setEnabled(target, action === 'on'), null, 2));
  } else {
    console.error('Usage: node scripts/git-sync-control.js <status|push|on|off> <ocha|ac|all>');
    process.exitCode = 2;
  }
} finally {
  await runtime.close();
}
