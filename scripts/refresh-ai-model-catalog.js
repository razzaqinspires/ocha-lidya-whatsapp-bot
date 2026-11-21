import 'dotenv/config';
import { initializeProviderKeys } from '../src/ai/providers.js';
import { refreshModelCatalog } from '../src/ai/model-catalog.js';

try {
  await initializeProviderKeys({ skipTelemetry: true });
  const snapshot = await refreshModelCatalog({ force: true, timeoutMs: 12000 });
  const summary = Object.fromEntries(Object.entries(snapshot.providers || {}).map(([provider, state]) => [provider, {
    status: state.status,
    modelCount: state.modelCount,
    recommendedFreeModel: state.recommendedFreeModel,
    recommendedPaidModel: state.recommendedPaidModel,
    keyFingerprint: state.keyFingerprint || null,
    stale: Boolean(state.stale)
  }]));
  process.stdout.write(`${JSON.stringify({ checkedAt: snapshot.checkedAt, nextCheckAt: snapshot.nextCheckAt, providers: summary }, null, 2)}\n`);
  const freeReady = ['groq', 'gemini'].some(name => summary[name]?.recommendedFreeModel);
  if (!freeReady) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`AI model catalog refresh failed: ${String(error?.message || error).slice(0, 400)}\n`);
  process.exitCode = 1;
}
