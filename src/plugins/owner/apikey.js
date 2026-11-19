import { manageApiKeys, providerNames } from '../../ai/providers.js';
export default {
  name: 'apikey', aliases: ['keys', 'keymanager'], category: 'owner', ownerOnly: true,
  description: 'Kelola API key AI dan status pemakaiannya tanpa menampilkan secret utuh',
  async execute({ sock, m, args }) {
    const [action, provider, ...rest] = args;
    const type = String(action || '').toLowerCase();
    const name = String(provider || '').toLowerCase();
    if (!['add', 'delete', 'list', 'get'].includes(type) || !name) {
      return m.reply([
        'API KEY MANAGER',
        '.apikey add <provider> <key1,key2,key3>',
        '.apikey delete <provider> <key atau fingerprint>',
        '.apikey list <provider>',
        '.apikey get <provider> <fingerprint>',
        `Provider: ${providerNames.join(', ')}`,
        'Secret ditampilkan dalam bentuk masked; jangan kirim API key ke grup.'
      ].join('\n'));
    }
    const values = rest.join(' ').split(',').map(value => value.trim()).filter(Boolean);
    if (m.isGroup) return m.reply('Semua pengelolaan API key hanya boleh melalui chat pribadi owner.');
    const result = await manageApiKeys(type, name, values);
    if (['add', 'delete', 'get'].includes(type)) {
      // Remove any key-bearing command message from the WhatsApp conversation when possible.
      try { if (m.key) await sock.sendMessage(m.chat, { delete: m.key }); } catch {}
    }
    if (type === 'add') return m.reply(`Berhasil menambahkan ${result.added} key ${name}. Total terdaftar: ${result.total}. Pesan perintah berisi secret telah diminta untuk dihapus. Vault lokal: data/secrets/provider-keys.json (permission 0600).`);
    if (type === 'delete') return m.reply(`Key ${name} dihapus dari vault: ${result.removed}. ${result.note}`);
    if (type === 'list') {
      const lines = result.keys.map((key, i) => `${i + 1}. ${key.masked} [${key.fingerprint}]\n   status: ${key.status} · hit: ${key.hits} · sukses: ${key.successes} · gagal: ${key.failures}\n   source: ${key.source} · last HTTP: ${key.lastHttpStatus ?? '-'} · alasan: ${key.reason || '-'}\n   retry: ${key.retryAt ? new Date(key.retryAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : 'sekarang'}`);
      return m.reply([`KEY INVENTORY — ${name}`, `Total: ${result.keys.length}`, ...lines].join('\n\n') || `Belum ada API key untuk ${name}.`);
    }
    const key = result.key;
    return m.reply([
      `KEY DETAIL — ${name}`,
      `Masked: ${key.masked}`,
      `Fingerprint: ${key.fingerprint}`,
      `Source: ${key.source}`,
      `Status: ${key.status}`,
      `Usable now: ${key.usableNow ? 'yes' : 'no'}`,
      `Total hit: ${key.hits}`,
      `Success: ${key.successes}`,
      `Failure: ${key.failures}`,
      `Token usage: ${key.tokens}`,
      `Last hit: ${key.lastHitAt || '-'}`,
      `Last success: ${key.lastSuccessAt || '-'}`,
      `Last error: ${key.lastErrorAt || '-'}`,
      `Last HTTP status: ${key.lastHttpStatus ?? '-'}`,
      `Reason: ${key.reason || '-'}`,
      `Retry at: ${key.retryAt ? new Date(key.retryAt).toISOString() : 'eligible'}`
    ].join('\n'));
  }
};
