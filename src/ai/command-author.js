import path from 'node:path';

export function parseModelJson(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI tidak mengembalikan objek JSON command yang valid.');
  const value = JSON.parse(raw.slice(start, end + 1));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Draft command harus berupa objek.');
  return value;
}

export function validateCommandDraft(draft, existingFolders = ['general', 'owner']) {
  const name = String(draft?.name || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(name)) throw new Error('Nama command harus 2–32 karakter: huruf kecil, angka, _ atau -.');
  const folder = String(draft?.folder || '').trim();
  if (!existingFolders.includes(folder)) throw new Error(`Folder plugin '${folder}' tidak tersedia. Folder baru tidak dibuat; pilih salah satu: ${existingFolders.join(', ')}.`);
  const category = String(draft?.category || '').trim().toLowerCase();
  if (!['general', 'developer', 'owner'].includes(category)) throw new Error('Kategori command harus general, developer, atau owner.');
  const source = String(draft?.source || '').trim();
  if (!source || Buffer.byteLength(source) > 48 * 1024) throw new Error('Source plugin kosong atau melebihi 48 KB.');
  if (!/export\s+default\s*\{/.test(source) || !/\bname\s*:\s*['"]/.test(source) || !/\bexecute\s*\(/.test(source)) {
    throw new Error('Source harus berupa plugin ESM dengan export default, name, dan execute().');
  }
  for (const field of ['aliases', 'category', 'usage', 'description']) {
    if (!new RegExp(`\\b${field}\\s*:`).test(source)) throw new Error(`Metadata plugin '${field}' wajib ada pada source.`);
  }
  const declaredName = source.match(/\bname\s*:\s*['"]([^'"]+)['"]/i)?.[1]?.toLowerCase();
  if (declaredName !== name) throw new Error('Metadata name di source harus sama dengan nama draft.');
  if ((folder === 'owner' || draft.ownerOnly) && !/\bownerOnly\s*:\s*true/.test(source)) {
    throw new Error('Plugin owner wajib menyertakan ownerOnly: true pada source.');
  }
  if (folder === 'owner' && !/\bprivateOnly\s*:\s*true/.test(source)) {
    throw new Error('Plugin di folder owner wajib menyertakan privateOnly: true.');
  }
  const aliases = Array.isArray(draft.aliases) ? [...new Set(draft.aliases.map(x => String(x).trim().toLowerCase()).filter(x => /^[a-z][a-z0-9_-]{1,31}$/.test(x)))].slice(0, 8) : [];
  if (aliases.includes(name)) throw new Error('Alias tidak boleh sama dengan nama command.');
  const usage = String(draft.usage || '').trim().slice(0, 180);
  const description = String(draft.description || '').trim().slice(0, 240);
  if (!description) throw new Error('Description plugin wajib diisi.');
  const ownerOnly = Boolean(draft.ownerOnly || folder === 'owner');
  return { name, folder, category, aliases, usage, description, ownerOnly, source };
}

export function validatePluginSource(source) {
  const code = String(source || '');
  // Static policy validation only. Syntax is checked with node --check at apply time; no draft code is evaluated.
  const blocked = [
    /from\s*['"]node:child_process['"]|from\s*['"]child_process['"]|require\s*\(\s*['"](?:node:)?child_process['"]\s*\)/,
    /\bprocess\s*\.\s*exit\s*\(/,
    /\beval\s*\(/,
    /new\s+Function\s*\(/,
    /\bimport\s*\(/
  ];
  const match = blocked.find(pattern => pattern.test(code));
  if (match) throw new Error('Source mengandung primitive eksekusi dinamis/proses yang tidak diizinkan oleh generator command.');
  const imports = [...code.matchAll(/from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g)].map(m => m[1] || m[2]);
  for (const specifier of imports) {
    if (specifier.startsWith('node:') || specifier.startsWith('@whiskeysockets/baileys') || specifier === 'baileys') continue;
    if (specifier.startsWith('../../core/') || specifier.startsWith('../../ai/') || specifier.startsWith('../../lib/')) continue;
    throw new Error(`Import '${specifier}' tidak termasuk allowlist plugin. Gunakan API internal Ocha yang sudah tersedia.`);
  }
  return { valid: true, bytes: Buffer.byteLength(code), imports };
}

export function buildCommandAuthorPrompt({ instruction, suppliedCode, plugins, folders }) {
  const codeMode = Boolean(suppliedCode);
  return `Anda adalah Ocha Command Architect. Hasilkan SATU plugin WhatsApp Baileys ESM yang cocok dengan arsitektur proyek ini.\n\nKONTEKS PLUGIN AKTIF:\n${JSON.stringify(plugins, null, 2)}\n\nFOLDER PLUGIN YANG SUDAH ADA (DILARANG MEMBUAT FOLDER BARU): ${folders.join(', ')}\n\nARAHAN OWNER:\n${instruction}\n\n${codeMode ? `SOURCE YANG DIBERIKAN OWNER (jaga semantik dan urutan operasi; jangan memperbaiki atau menulis ulang sintaks. Hanya bungkus ke execute() dan tambahkan metadata yang diperlukan. Jika sintaks memang tidak valid, jelaskan lewat field error dan jangan mengarang source pengganti):\n${suppliedCode}` : 'Buat implementasi baru sesuai arahan. Ikuti pola plugin internal yang sudah ada.'}\n\nATURAN WAJIB:\n- Pilih folder hanya dari daftar folder yang tersedia; jangan membuat folder kategori baru.\n- Jangan menimpa command/alias yang sudah ada.\n- Kategori metadata hanya general, developer, atau owner. Folder owner berarti ownerOnly=true dan privateOnly=true.\n- Gunakan API Baileys dan helper internal yang memang diperlukan. Handler harus async execute({ sock, m, args, text, config, isOwner }).\n- Lengkapi name, aliases, category, usage, description, ownerOnly, privateOnly bila perlu.\n- Jangan gunakan child_process, process.exit, eval, Function constructor, atau import dinamis. Jangan menaruh secret.\n- Jangan membuat folder baru. Hindari dependency npm baru.\n- Jika owner memberi source siap pakai, jangan ubah struktur payload, method Baileys, URL, teks, urutan, atau perilaku source.\n- Output hanya JSON valid dengan bentuk: {"name":"...","folder":"general|owner","category":"general|developer|owner","aliases":[],"usage":"...","description":"...","ownerOnly":false,"source":"...","notes":"...","error":null}. Escape newline dan kutip pada source sesuai JSON. Jika tidak bisa mempertahankan source tanpa koreksi sintaks, isi error dan source kosong.`;
}
