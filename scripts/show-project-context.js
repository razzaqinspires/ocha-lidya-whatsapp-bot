import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const contextPath = resolve('.private/project/AI_CONTEXT.md');
try {
  process.stdout.write(await readFile(contextPath, 'utf8'));
} catch (error) {
  if (error?.code === 'ENOENT') {
    console.error('Private AI_CONTEXT.md is not present at .private/project/AI_CONTEXT.md');
    process.exitCode = 2;
  } else {
    throw error;
  }
}
