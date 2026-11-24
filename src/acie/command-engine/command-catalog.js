import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const tick = String.fromCharCode(96);
function cell(value) {
  return String(value ?? '').replace(/[|\r\n]+/g, ' ').trim().slice(0, 240) || '—';
}

export function renderGeneratedCommandCatalog(commands = []) {
  const rows = [...commands].sort((a, b) => String(a.command || '').localeCompare(String(b.command || '')));
  const lines = [
    '# ACIE Generated Command Catalog',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '> Private runtime artifact. Drafts are not available to users until provider gates and owner approval pass.',
    '',
    '| Command ID | Command | Aliases | Capability | Provider | Permission | Status |',
    '|---|---|---|---|---|---|---|'
  ];
  for (const item of rows) {
    lines.push('| ' + cell(item.commandId) + ' | ' + tick + '.' + cell(item.command) + tick + ' | ' + cell((item.aliases || []).map(alias => '.' + alias).join(', ')) + ' | ' + cell(item.capability) + ' | ' + cell(item.providerMapping) + ' | ' + cell(item.permission) + ' | ' + cell(item.status) + ' |');
    if (item.description) lines.push('', '**' + cell(item.command) + ':** ' + cell(item.description));
    if (item.syntax) lines.push('', '- Syntax: ' + tick + cell(item.syntax) + tick);
    if (item.examples?.length) lines.push('- Examples: ' + (item.examples || []).slice(0, 3).map(value => tick + cell(value) + tick).join(', '));
    if (item.collision?.detected) lines.push('- Collision: ' + (item.collision.resolved ? cell(item.collision.resolution || 'resolved') : 'blocked; manual name review required'));
    lines.push('');
  }
  if (!rows.length) lines.push('_No command drafts have been generated._', '');
  return lines.join('\n').trimEnd() + '\n';
}

export async function writeGeneratedCommandCatalog(directory, commands = []) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'COMMAND_CATALOG.md');
  const temporary = file + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp';
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(renderGeneratedCommandCatalog(commands), 'utf8');
    await handle.sync();
  } finally { await handle.close(); }
  await fs.rename(temporary, file);
  return file;
}
