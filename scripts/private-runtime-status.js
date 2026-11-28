import { loadPrivateRuntime, getPrivateRuntimeStatus } from '../src/private-runtime/loader.js';
import { getRuntimeSettings } from '../src/core/runtime-settings.js';

await loadPrivateRuntime();
const status = getPrivateRuntimeStatus();
console.log(JSON.stringify(status, null, 2));
if (getRuntimeSettings().privateRuntime.required && !status.available) {
  process.exitCode = 1;
}
