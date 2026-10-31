import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const guardedRoots = ['src', 'scripts', 'tests'];
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.sql']);
function hasForbiddenApprovalName(content) {
  const identifiers = content.match(/[A-Za-z][A-Za-z0-9_-]*/g) ?? [];
  return identifiers.some((identifier) => /(?:human|manual|user)/i.test(identifier) && /(?:approv|approval)/i.test(identifier));
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }));
  return paths.flat();
}

const sourceFiles = (await Promise.all(guardedRoots.map((directory) => walk(path.join(root, directory)))))
  .flat()
  .filter((file) => sourceExtensions.has(path.extname(file)) && path.basename(file) !== 'invariant-guard.mjs');
const violations = [];
for (const file of sourceFiles) {
  const content = await readFile(file, 'utf8');
  if (hasForbiddenApprovalName(content)) {
    violations.push(`${path.relative(root, file)} contains a forbidden human-approval field or route name.`);
  }
}
if (violations.length) {
  console.error(['The build cannot include a human approval path:', ...violations].join('\n'));
  process.exitCode = 1;
} else {
  console.log('Invariant guard passed: no human approval path is modeled.');
}
