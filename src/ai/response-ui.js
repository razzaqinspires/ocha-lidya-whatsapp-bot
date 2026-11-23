import crypto from 'node:crypto';
import { registerReplySession } from '../core/reply-sessions.js';
import { formatAITextForWhatsApp, splitWhatsAppText } from './whatsapp-format.js';

const OPEN = '[[OCHA_UI]]';
const CLOSE = '[[/OCHA_UI]]';
const MAX_UI_BODY = 1700;

function cleanText(value, max = 120) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || /^\d+(?:\.\d+){3}$/.test(host) || host.includes(':')) return null;
    return url.toString();
  } catch { return null; }
}

function explicitlyRequestedUI(userText, type) {
  const value = String(userText || '').toLowerCase();
  const asksForUI = /\b(?:pakai|gunakan|tampilkan|kirim(?:kan)?|buat(?:kan)?|berikan)\b.{0,36}\b(?:tombol|button|quick[ -]?reply|list|daftar pilihan|menu pilihan)\b|\b(?:tombol|button|quick[ -]?reply|list|daftar pilihan|menu pilihan)\b.{0,28}\b(?:pakai|gunakan|tampilkan|kirim|buat|berikan)\b|\bdengan\s+(?:tombol|button|quick[ -]?reply|list|daftar pilihan|menu pilihan)\b/i.test(value);
  if (type === 'copy') return /\b(?:tombol\s+(?:salin|copy)|copy\s+button|pakai\s+(?:tombol\s+)?copy)\b/i.test(value);
  if (type === 'url') return /\b(?:tombol\s+(?:url|tautan|link)|cta\s+url|tautan\s+dengan\s+tombol)\b/i.test(value);
  return asksForUI;
}

export function extractAIResponsePlan(input, userText = '') {
  const raw = String(input || '');
  const start = raw.lastIndexOf(OPEN);
  if (start < 0) return { text: raw.trim(), plan: null };
  const end = raw.indexOf(CLOSE, start + OPEN.length);
  if (end < 0) return { text: raw.trim(), plan: null };
  const payload = raw.slice(start + OPEN.length, end).trim();
  let parsed;
  try { parsed = JSON.parse(payload); } catch { return { text: `${raw.slice(0, start)}${raw.slice(end + CLOSE.length)}`.trim(), plan: null }; }

  const baseText = `${raw.slice(0, start)}${raw.slice(end + CLOSE.length)}`.trim();
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { text: baseText, plan: null };
  const type = String(parsed.type || '').toLowerCase();
  if (!['quick_reply', 'list', 'copy', 'url'].includes(type)) return { text: baseText, plan: null };
  // Interactive output is opt-in. Model-generated UI markers are ignored unless
  // the current user message explicitly asks for that interaction style.
  if (!explicitlyRequestedUI(userText, type)) return { text: baseText, plan: null };

  const commandLike = /(?:jalankan|eksekusi|run|execute)\s+(?:perintah|command)?\s*[.!/#]?[a-z][a-z0-9_-]*/i;
  let items = Array.isArray(parsed.items) ? parsed.items : [];
  items = items.slice(0, type === 'list' ? 10 : 3).map(item => ({
    title: cleanText(item?.title, 28),
    prompt: cleanText(item?.prompt, 180),
    description: cleanText(item?.description, 72)
  })).filter(item => item.title && item.prompt && !commandLike.test(item.prompt));

  if (type === 'copy') {
    const copyCode = cleanText(parsed.copyCode, 128);
    if (!copyCode || !baseText.includes(copyCode)) return { text: baseText, plan: null };
    return { text: baseText, plan: { type, copyCode, copyLabel: cleanText(parsed.copyLabel || 'Salin kode', 24) } };
  }

  if (type === 'url') {
    const url = safeHttpsUrl(parsed.url);
    // Only promote a URL to a CTA when the user supplied the exact destination.
    const suppliedUrls = String(userText || '').match(/https:\/\/[^\s)]+/gi) || [];
    const exactUserDestination = suppliedUrls.some(value => safeHttpsUrl(value) === url);
    if (!url || !exactUserDestination || !cleanText(parsed.label, 28)) return { text: baseText, plan: null };
    return { text: baseText, plan: { type, url, label: cleanText(parsed.label, 28) } };
  }

  if (items.length < (type === 'list' ? 2 : 1)) return { text: baseText, plan: null };
  return { text: baseText, plan: { type, items } };
}

function makeButtons(plan, sessionId) {
  const buttons = [];
  const choices = [];
  if (plan.type === 'quick_reply' || plan.type === 'list') {
    const ids = plan.items.map((_item, index) => `ocha:followup:${sessionId}:${index + 1}`);
    if (plan.type === 'quick_reply') {
      plan.items.forEach((item, index) => {
        buttons.push({ name: 'quick_reply', display_text: item.title, id: ids[index] });
        choices.push({ key: ids[index], label: item.title, value: { prompt: item.prompt } });
      });
    } else {
      buttons.push({
        name: 'single_select',
        title: 'Pilih tindak lanjut',
        sections: [{
          title: 'Pilihan',
          rows: plan.items.map((item, index) => ({
            title: item.title,
            ...(item.description ? { description: item.description } : {}),
            id: ids[index]
          }))
        }]
      });
      plan.items.forEach((item, index) => choices.push({ key: ids[index], label: item.title, value: { prompt: item.prompt } }));
    }
  } else if (plan.type === 'copy') {
    buttons.push({ name: 'cta_copy', display_text: plan.copyLabel || 'Salin kode', copy_code: plan.copyCode });
  } else if (plan.type === 'url') {
    buttons.push({ name: 'cta_url', display_text: plan.label, url: plan.url, merchant_url: plan.url, webview_interaction: true });
  }
  return { buttons, choices };
}

async function sendPlainChunks(sock, message, text) {
  const chunks = splitWhatsAppText(text);
  if (!chunks.length) return [];
  const sent = [];
  sent.push(await message.reply(chunks[0]));
  for (const part of chunks.slice(1)) sent.push(await sock.sendMessage(message.chat, { text: part }));
  return sent;
}

function isInteractiveEnvelope(message) {
  const payload = message?.message || {};
  return Boolean(
    payload.interactiveMessage ||
    payload.viewOnceMessage?.message?.interactiveMessage ||
    payload.ephemeralMessage?.message?.interactiveMessage
  );
}

export async function deliverAIResponse(sock, message, rawText, { userText = '', onInteractiveSent } = {}) {
  const extracted = extractAIResponsePlan(rawText, userText);
  const text = formatAITextForWhatsApp(extracted.text);
  const plan = extracted.plan;

  if (!text) return { sent: [], text: '', interactive: false };
  if (!plan || !sock?.sendInteractive || text.length > MAX_UI_BODY) {
    return { sent: await sendPlainChunks(sock, message, text), text, interactive: false };
  }

  const sessionId = crypto.randomUUID().replaceAll('-', '').slice(0, 14);
  const { buttons, choices } = makeButtons(plan, sessionId);
  if (!buttons.length) return { sent: await sendPlainChunks(sock, message, text), text, interactive: false };

  let sent;
  try {
    sent = await sock.sendInteractive(message.chat, {
      title: 'Ocha Lidya AI',
      subtitle: 'Nexora · Pilihan kontekstual',
      body: text,
      footer: 'Razzaq Ventures',
      buttons,
      messageVersion: 1,
      nativeFlowName: 'mixed',
      nativeFlowVersion: '9'
    }, message);
  } catch {
    return { sent: await sendPlainChunks(sock, message, text), text, interactive: false };
  }

  if (!isInteractiveEnvelope(sent)) {
    // The serializer returns a text fallback when native-flow relay fails.
    return { sent: [sent], text, interactive: false, fallback: true };
  }

  const messageId = sent?.key?.id;
  if (messageId && choices.length) {
    registerReplySession({
      chat: message.chat,
      messageId,
      sender: message.sender,
      kind: 'ai-followup',
      choices,
      ttlMs: 10 * 60_000,
      helpText: 'Pilih salah satu opsi yang tersedia pada tombol atau daftar Ocha.',
      onSelect: async ({ sock: activeSock, message: selectedMessage, value }) => {
        const nextMessage = { ...selectedMessage, body: String(value?.prompt || ''), quoted: null, isAISuggestedFollowup: true };
        const { answerMessage } = await import('./engine.js');
        await answerMessage(activeSock, nextMessage);
      }
    });
  }
  if (typeof onInteractiveSent === 'function') await onInteractiveSent(sent, { plan, messageId });
  return { sent: [sent], text, interactive: true, messageId };
}
