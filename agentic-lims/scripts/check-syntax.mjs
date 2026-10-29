/**
 * Fail fast on syntax errors before anyone restarts the host.
 *
 * A stray backtick inside the PROMPT template literal in index.js once made the
 * whole plugin fail to load — the sidebar tab simply disappeared, with no error
 * in the panel. `node --check` on every entry point catches that in one second.
 *
 * Run: node agentic-lims/scripts/check-syntax.mjs
 */
import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

async function list(dir, pattern) {
  const entries = await readdir(join(root, dir), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => `${dir}/${entry.name}`);
}

const files = [
  'index.js',
  'client.js',
  ...(await list('lib', /\.js$/)),
  ...(await list('scripts', /\.mjs$/)),
];

let failures = 0;
for (const file of files) {
  try {
    await exec(process.execPath, ['--check', join(root, file)], { timeout: 20000 });
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${file}`);
    const detail = String(error.stderr ?? error.message).split('\n').slice(0, 6).join('\n');
    console.log(detail.replace(/^/gm, '       '));
  }
}

console.log(`${files.length} files checked, ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
