import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const markdownFiles = [];
async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', '.private', '.release'].includes(entry.name)) continue;
      await walk(path.join(dir, entry.name));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      markdownFiles.push(path.join(dir, entry.name));
    }
  }
}
await walk(root);
const failures = [];
for (const file of markdownFiles) {
  const source = await fs.readFile(file, 'utf8');
  const withoutCode = source.replace(/```[\s\S]*?```/g, '');
  const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of withoutCode.matchAll(linkPattern)) {
    const raw = match[1].trim().replace(/^<|>$/g, '');
    const target = raw.split(/[?#]/, 1)[0];
    if (!target || /^(?:https?:|mailto:|data:|#)/i.test(target)) continue;
    const decoded = decodeURIComponent(target);
    const resolved = path.resolve(path.dirname(file), decoded);
    if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
      failures.push(`${path.relative(root, file)}: link escapes repository root -> ${raw}`);
      continue;
    }
    try {
      await fs.access(resolved);
    } catch {
      failures.push(`${path.relative(root, file)}: missing link target -> ${raw}`);
    }
  }
}
if (failures.length) {
  console.error(
    `Documentation validation failed (${failures.length} issue(s), ${markdownFiles.length} Markdown files scanned):`,
  );
  for (const issue of failures) console.error(`- ${issue}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation validation passed: ${markdownFiles.length} Markdown files; all local link targets exist.`);
}
