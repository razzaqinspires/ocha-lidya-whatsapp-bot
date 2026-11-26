import { loadPrivateRuntime, getPrivateRuntimeStatus } from '../src/private-runtime/loader.js';

await loadPrivateRuntime();
const status = getPrivateRuntimeStatus();
console.log(JSON.stringify(status, null, 2));
if (
  process.env.OCHA_PRIVATE_RUNTIME_REQUIRED &&
  /^(?:1|true|yes|on)$/i.test(process.env.OCHA_PRIVATE_RUNTIME_REQUIRED) &&
  !status.available
) {
  process.exitCode = 1;
}
