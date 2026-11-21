import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from '../../core/config.js';
import { listPlugins, getPlugin } from '../../core/plugin-loader.js';
import { generateWithFallback } from '../../ai/providers.js';
import { putRecord, getRecord } from '../../core/repository.js';
import { spawnSync } from 'node:child_process';
import { buildCommandAuthorPrompt, parseModelJson, validateCommandDraft, validatePluginSource } from '../../ai/command-author.js';
import { inspectWorkload, assessWorkloadWithOcha } from '../../master/workload-tracker.js';
import { logger } from '../../core/logger.js';

const ROOT = path.resolve('src/plugins');
const DRAFT_NS = 'command.author.draft';
const folders = async () => (await fs.readdir(ROOT, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
function quotedSource(m) { return String(m.quoted?.text || m.quoted?.caption || '').trim(); }
function makeId() { return `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }

export default {
  name: 'createcmd', aliases: ['makecmd', 'commandcreate'], category: 'owner', ownerOnly: true, privateOnly: true,
  usage: '<instruction|quoted-code> | apply <draft-id> | list',
  description: 'AI-assisted plugin authoring, architecture matching, source validation and staged installation',
  async execute({ m, args, text }) {
    if (m.isGroup) return m.reply('Command Author hanya tersedia di chat pribadi owner.');
    const action = String(args[0] || '').toLowerCase();
    if (action === 'show') {
      const id = String(args[1] || '');
      const draft = await getRecord(DRAFT_NS, id);
      if (!draft) return m.reply('Draft tidak ditemukan.');
      return m.reply(`COMMAND DRAFT SOURCE\nID: ${id} · Status: ${draft.status}\n
\`\`\`javascript\n${String(draft.source || '').slice(0, 42000)}\n\`\`\`\n
Review source sebelum menjalankan .createcmd apply ${id}.`);
    }
    if (action === 'list') {
      const { listRecords } = await import('../../core/repository.js');
      const drafts = await listRecords(DRAFT_NS);
      const pending = Object.entries(drafts).filter(([, value]) => value.status === 'draft');
      return m.reply(pending.length ? `COMMAND DRAFTS\n${pending.map(([id, d]) => `${id} · ${d.name} · ${d.category} · ${d.risk}`).join('\n')}` : 'Tidak ada draft command yang menunggu persetujuan.');
    }
    if (action === 'apply') {
      const id = String(args[1] || '');
      const draft = await getRecord(DRAFT_NS, id);
      if (!draft || draft.status !== 'draft') return m.reply('Draft tidak ditemukan atau sudah diproses. Gunakan .createcmd list.');
      const dirs = await folders();
      const normalized = validateCommandDraft(draft, dirs);
      validatePluginSource(normalized.source);
      if (getPlugin(normalized.name)) return m.reply(`Command .${normalized.name} sudah terdaftar. Draft tidak diterapkan.`);
      const aliases = new Set(listPlugins().flatMap(plugin => [plugin.name, ...(plugin.aliases || [])]).map(value => String(value).toLowerCase()));
      const nameCollision = aliases.has(normalized.name);
      if (nameCollision) return m.reply(`Nama command .${normalized.name} atau aliasnya sudah digunakan plugin lain.`);
      const collision = normalized.aliases.find(alias => aliases.has(alias));
      if (collision) return m.reply(`Alias .${collision} sudah digunakan plugin lain.`);
      const targetDir = path.resolve(ROOT, normalized.folder);
      if (!targetDir.startsWith(`${ROOT}${path.sep}`)) throw new Error('Target plugin path ditolak.');
      const target = path.join(targetDir, `${normalized.name}.js`);
      try { await fs.access(target); return m.reply(`File ${normalized.folder}/${normalized.name}.js sudah ada. Tidak ditimpa.`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const temp = `${target}.${process.pid}.tmp.mjs`;
      await fs.writeFile(temp, `${normalized.source.trim()}\n`, { flag: 'wx', mode: 0o600 });
      try {
        const check = spawnSync(process.execPath, ['--check', temp], { encoding: 'utf8', timeout: 10000 });
        if (check.error || check.status !== 0) throw new Error(String(check.stderr || check.error?.message || 'Syntax check failed').slice(-1000));
        await fs.rename(temp, target);
      } catch (error) { await fs.rm(temp, { force: true }); throw error; }
      await putRecord(DRAFT_NS, id, { ...draft, status: 'applied', appliedAt: new Date().toISOString(), target: path.relative(process.cwd(), target) }, { source: 'createcmd', actor: m.sender });
      logger.info({ name: normalized.name, target: path.relative(process.cwd(), target), draftId: id }, 'Owner-created plugin installed; transactional hot reload will discover it');
      return m.reply(`PLUGIN DIBUAT\nCommand: .${normalized.name}\nFile: ${normalized.folder}/${normalized.name}.js\nKategori: ${normalized.category}\nAliases: ${normalized.aliases.join(', ') || '-'}\n\nTransactional hot reload akan memuat plugin setelah batch source stabil dan valid.`);
    }

    const instruction = action === 'new' ? args.slice(1).join(' ') : text;
    const inlineCode = String(instruction || '').trim().startsWith('=> ');
    const suppliedCode = quotedSource(m) || (inlineCode ? String(instruction).trim().slice(3) : '');
    const request = inlineCode || (suppliedCode && !instruction.replace(/^new\s*/i, '').trim())
      ? 'Bungkus source owner menjadi plugin dengan perubahan minimum. Pertahankan seluruh sintaks dan perilaku; jangan perbaiki sintaks.'
      : instruction.replace(/^new\s*/i, '').trim();
    if (!request && !suppliedCode) return m.reply('Gunakan .createcmd <arahan> atau reply source code dengan .createcmd <arahan>. Contoh: .createcmd buat command kalkulator.');
    const config = getConfig();
    const existing = listPlugins().map(plugin => ({ name: plugin.name, aliases: plugin.aliases || [], category: plugin.category || 'other', usage: plugin.usage || '', description: plugin.description || '' }));
    const availableFolders = await folders();
    const prompt = buildCommandAuthorPrompt({ instruction: request || 'Buat plugin dari source yang diberikan.', suppliedCode, plugins: existing, folders: availableFolders });
    const result = await generateWithFallback(config.ai.providerOrder, [
      { role: 'system', content: 'You generate safe, maintainable WhatsApp bot plugin source. Return only the requested JSON object. Do not use markdown fences.' },
      { role: 'user', content: prompt }
    ], { models: config.ai.models, timeoutMs: Math.min(45_000, Math.max(15_000, config.ai.timeoutMs * 6)), maxOutputTokens: 5000, temperature: 0.15 });
    const raw = parseModelJson(result.text);
    if (raw.error) return m.reply(`Command belum dibuat: ${String(raw.error).slice(0, 900)}`);
    const draft = validateCommandDraft(raw, availableFolders);
    if (suppliedCode && !draft.source.includes(suppliedCode.trim())) {
      return m.reply('Draft ditolak: AI mengubah atau tidak menyertakan source asli secara utuh. Tidak ada file yang ditulis. Ulangi dengan source yang di-reply atau minta pembungkusan tanpa perubahan kode.');
    }
    if (getPlugin(draft.name)) return m.reply(`Nama command .${draft.name} sudah digunakan. Minta AI memilih nama lain.`);
    const aliases = new Set(existing.flatMap(plugin => [plugin.name, ...plugin.aliases]).map(value => String(value).toLowerCase()));
    const collision = draft.aliases.find(alias => aliases.has(alias));
    if (collision) return m.reply(`Alias .${collision} sudah digunakan. Minta AI memilih alias lain.`);
    validatePluginSource(draft.source);
    const syntaxCheck = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: draft.source, encoding: 'utf8', timeout: 10000 });
    if (syntaxCheck.error || syntaxCheck.status !== 0) {
      const detail = String(syntaxCheck.stderr || syntaxCheck.error?.message || 'syntax check failed').slice(-900);
      return m.reply(`Draft ditolak: syntax check ESM gagal. Source tidak ditulis dan tidak diperbaiki otomatis.\n${detail}`);
    }
    const heuristic = inspectWorkload('=>', draft.source);
    if (heuristic.hardBlock) return m.reply(`Draft ditolak oleh Workload Guard: ${heuristic.reasons.join('; ')}`);
    let assessment;
    try { assessment = await assessWorkloadWithOcha('plugin-authoring', draft.source); }
    catch (error) {
      assessment = { severity: heuristic.level, recommendation: 'REVIEW', summary: 'AI workload review tidak tersedia; menggunakan analisis lokal konservatif.', impacts: heuristic.reasons || [], saferAlternative: 'Periksa source sebelum memasang.', provider: 'local-heuristic', error: String(error.message || error).slice(0, 240) };
    }
    if (assessment.severity === 'critical') return m.reply(`Draft ditolak oleh AI Workload Assessor: ${assessment.summary}`);
    const risk = ['critical', 'high', 'medium', 'low'].indexOf(assessment.severity) >= 0 ? assessment.severity : heuristic.level;
    const id = makeId();
    await putRecord(DRAFT_NS, id, { ...draft, status: 'draft', createdAt: new Date().toISOString(), provider: result.provider, risk, riskReasons: heuristic.reasons || [], assessment: { severity: assessment.severity, recommendation: assessment.recommendation, summary: assessment.summary, impacts: assessment.impacts, saferAlternative: assessment.saferAlternative, provider: assessment.provider }, notes: String(raw.notes || '').slice(0, 800), suppliedCode: Boolean(suppliedCode) }, { source: 'createcmd', actor: m.sender });
    return m.reply([
      'COMMAND DRAFT READY',
      `ID: ${id}`,
      `Command: .${draft.name}`,
      `Folder: ${draft.folder}/ · Category: ${draft.category}`,
      `Aliases: ${draft.aliases.join(', ') || '-'}`,
      `Usage: ${draft.usage || '-'}`,
      `Risk: ${risk} · ${assessment.recommendation}`,
      `Assessment: ${String(assessment.summary || '').slice(0, 350)}`,
      `AI provider: ${result.provider}`,
      '',
      String(raw.notes || 'Source disusun mengikuti struktur plugin aktif.').slice(0, 800),
      '',
      'Source sudah divalidasi dan belum dieksekusi. Untuk memasang: .createcmd apply ' + id,
      `Review source: .createcmd show ${id}`,
      'Draft lain: .createcmd list'
    ].join('\n'));
  }
};
