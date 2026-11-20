const registry = new Map();

export function registerAICapability({ name, label, description, isEnabled, execute }) {
  const key = String(name || '').trim().toLowerCase();
  if (!key || typeof execute !== 'function' || typeof isEnabled !== 'function') {
    throw new TypeError('Capability requires name, isEnabled(), and execute().');
  }
  registry.set(key, { name: key, label: String(label || key), description: String(description || ''), isEnabled, execute });
  return () => registry.delete(key);
}

export function getAICapabilityStatus() {
  return [...registry.values()].map(capability => {
    let enabled = false;
    try { enabled = Boolean(capability.isEnabled()); } catch {}
    return { name: capability.name, label: capability.label, description: capability.description, enabled };
  });
}

export async function invokeAICapability(name, input, context) {
  const capability = registry.get(String(name || '').toLowerCase());
  if (!capability) throw new Error(`Kapabilitas AI tidak terdaftar: ${name}`);
  if (!capability.isEnabled()) throw new Error(`Kapabilitas ${capability.label} sedang dinonaktifkan.`);
  return capability.execute(input, context);
}
