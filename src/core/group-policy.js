/**
 * Response gate only. This function must never be used to gate Baileys events,
 * group metadata hydration, or verified contact indexing.
 */
export function shouldSuppressGroupInteraction(message, config) {
  return Boolean(message?.isGroup && config?.features?.groupsMuted === true);
}
