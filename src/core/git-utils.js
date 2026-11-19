/** Pure helpers for auto Git synchronization. */
export function parsePorcelainZ(output) {
  const chunks = String(output || '').split('\0');
  const paths = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const record = chunks[index];
    if (!record) continue;
    const status = record.slice(0, 2);
    const filePath = record.slice(3);
    if (filePath) paths.push(filePath);
    // -z porcelain output stores the second path of a rename/copy as a
    // separate NUL-delimited item. Stage both names so deletion is captured.
    if (status.includes('R') || status.includes('C')) {
      const previousPath = chunks[index + 1];
      if (previousPath) paths.push(previousPath);
      index += 1;
    }
  }
  return [...new Set(paths)];
}

export function parseGitIgnore(content) {
  return String(content || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

export function formatJakartaTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.weekday}, ${values.day} ${values.month} ${values.year} ${values.hour}:${values.minute}:${values.second} WIB`;
}

export function createAutomaticCommitMessage(date = new Date()) {
  return [
    'pasang waktu Otomatis, waktu, tanggal, jam, dan hari yang kompleks.',
    '',
    `Waktu commit: ${formatJakartaTimestamp(date)}`,
    `ISO-8601: ${new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).format(date).replace(' ', 'T')}+07:00`
  ].join('\n');
}
