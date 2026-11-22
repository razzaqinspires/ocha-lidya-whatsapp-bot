import { getRecord, putRecord } from './repository.js';
import { getGroupMetadata } from './group-metadata.js';

const validGroup = jid => typeof jid === 'string' && /^\d{5,30}(?:-\d{1,25})?@g\.us$/.test(jid);
const nowIso = () => new Date().toISOString();

export async function getGroupTools(groupJid) {
  if (!validGroup(groupJid)) return { welcome: { enabled: false, text: '' }, rules: '' };
  const stored = await getRecord('group.tools', groupJid) || {};
  return {
    welcome: { enabled: stored.welcome?.enabled === true, text: String(stored.welcome?.text || '') },
    rules: String(stored.rules || '')
  };
}

export async function updateGroupWelcome(groupJid, enabled, text = '', actor = '') {
  if (!validGroup(groupJid)) throw new Error('ID grup tidak valid.');
  const welcomeText = String(text || '').trim();
  if (welcomeText.length > 500) throw new Error('Pesan sambutan maksimal 500 karakter.');
  const current = await getGroupTools(groupJid);
  const next = { ...current, welcome: { enabled: Boolean(enabled), text: welcomeText }, updatedAt: nowIso(), updatedBy: actor };
  await putRecord('group.tools', groupJid, next, { actor, reason: `group welcome ${enabled ? 'enabled' : 'disabled'}` });
  return next;
}

export async function updateGroupRules(groupJid, rules, actor = '') {
  if (!validGroup(groupJid)) throw new Error('ID grup tidak valid.');
  const text = String(rules || '').trim();
  if (text.length > 1500) throw new Error('Aturan grup maksimal 1.500 karakter.');
  const current = await getGroupTools(groupJid);
  const next = { ...current, rules: text, updatedAt: nowIso(), updatedBy: actor };
  await putRecord('group.tools', groupJid, next, { actor, reason: text ? 'group rules updated' : 'group rules cleared' });
  return next;
}

export async function handleGroupWelcome(sock, groupJid, participants = [], action = '') {
  if (action !== 'add' || !validGroup(groupJid) || !participants.length) return { sent: false, reason: 'not-a-join-event' };
  const settings = await getGroupTools(groupJid);
  if (!settings.welcome.enabled) return { sent: false, reason: 'disabled' };

  const meta = getGroupMetadata(groupJid);
  const pns = [...new Set(participants.map(item => {
    const candidate = typeof item === 'string' ? item : (item?.phoneNumber || item?.phone_number || item?.pn || item?.participantPn || item?.id);
    const jid = String(candidate || '').replace(/:\d+(?=@)/, '');
    if (/^\d{8,15}@s\.whatsapp\.net$/.test(jid)) return jid;
    const cached = (meta?.participants || []).find(participant => [participant?.id, participant?.lid].filter(Boolean).some(value => String(value).replace(/:\d+(?=@)/, '') === jid));
    const pn = String(cached?.phoneNumber || '').replace(/:\d+(?=@)/, '');
    return /^\d{8,15}@s\.whatsapp\.net$/.test(pn) ? pn : '';
  }).filter(Boolean))].slice(0, 25);
  const mentions = pns.length ? pns : [];
  const labels = pns.map(jid => `@${jid.split('@')[0]}`);
  const greeting = settings.welcome.text || 'Selamat datang di grup! Silakan baca aturan grup dan jaga suasana tetap nyaman.';
  const text = `${labels.length ? `Selamat datang ${labels.join(', ')}!` : 'Anggota baru bergabung!'}\n\n${greeting}${settings.rules ? `\n\nKetik .gadmin aturan untuk membaca aturan grup.` : ''}`;
  await sock.sendMessage(groupJid, { text, ...(mentions.length ? { mentions } : {}) });
  return { sent: true, count: participants.length };
}
