const PLATFORMS = ['image-canvas', 'pinterest', 'tiktok', 'instagram', 'youtube', 'facebook', 'twitter', 'x', 'reddit', 'telegram', 'spotify', 'soundcloud'];
const ACTIONS = [
  ['metadata', /(?:metadata|meta|info|details?|inspect)/i],
  ['search', /(?:search|find|query)/i],
  ['download.video', /(?:download|fetch|save|extract).*(?:video|mp4)|(?:video|mp4).*(?:download|fetch|save|extract)/i],
  ['download.audio', /(?:download|fetch|save|extract).*(?:audio|music|mp3)|(?:audio|music|mp3).*(?:download|fetch|save|extract)/i],
  ['download.image', /(?:download|fetch|save|extract).*(?:image|photo|picture)|(?:image|photo|picture).*(?:download|fetch|save|extract)/i],
  ['download', /(?:download|fetch|save|extract)/i],
  ['render.text', /(?:render|draw|paint|canvas|textimage)/i]
];

export function discoverCapabilities(analysis, textEvidence = '') {
  const platformText = `${textEvidence} ${(analysis.platformIdentifiers || []).join(' ')} ${analysis.inventory.map(item => item.path).join(' ')}`.toLowerCase();
  const found = [];
  for (const platform of PLATFORMS) {
    if (!new RegExp(`\\b${platform}\\b`, 'i').test(platformText)) continue;
    const names = analysis.functions.map(item => item.name);
    const specificActions = ACTIONS.filter(([action]) => action !== 'download');
    let hasSpecificDownload = false;
    for (const [action, regex] of specificActions) {
      const matches = names.filter(name => regex.test(name));
      if (!matches.length) continue;
      if (action.startsWith('download.')) hasSpecificDownload = true;
      found.push({ id: `${platform}.${action}`, platform, action, evidence: matches.slice(0, 20), confidence: 'candidate', status: 'unverified', requiresHumanReview: true });
    }
    if (!hasSpecificDownload) {
      const generic = names.filter(name => /(?:download|fetch|save|extract)/i.test(name));
      if (generic.length) found.push({ id: `${platform}.download`, platform, action: 'download', evidence: generic.slice(0, 20), confidence: 'candidate', status: 'unverified', requiresHumanReview: true });
    }
  }
  for (const signal of analysis.capabilitySignals || []) {
    if (signal.id === 'image-canvas.render.text') {
      found.push({
        id: 'image-canvas.render.text', platform: 'image-canvas', action: 'render.text',
        evidence: [signal.file, ...(signal.evidence || [])], confidence: 'source-indicator', status: 'unverified',
        requiresHumanReview: true, outputMimeType: signal.outputMimeType || 'image/jpeg',
        inputContract: signal.inputContract || 'unverified', dynamicTextInput: signal.dynamicTextInput === true,
        integration: signal.integration || 'unknown',
        adapterProtocol: signal.integration === 'legacy-whatsapp-inline' ? 'legacy-whatsapp-inline-bridge-draft-v1' : 'acie-json-stdio-v1'
      });
    }
  }
  return [...new Map(found.map(item => [item.id, item])).values()];
}
