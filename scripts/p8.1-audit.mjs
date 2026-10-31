import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedFeatures = [
  'accounts', 'projects', 'verification-contract', 'change-requests', 'agent-runs',
  'verification-engine', 'risk', 'approver', 'shipping', 'watching', 'undo', 'history', 'system-health',
].sort();
const passed = [];

async function check(name, action) {
  await action();
  passed.push(name);
}

await check('exactly the 13 required feature folders exist', async () => {
  const found = (await readdir(path.join(root, 'src/features'), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.deepEqual(found, expectedFeatures);
});

await check('each feature has its map, query layer, and four owned folders', async () => {
  for (const feature of expectedFeatures) {
    const base = path.join(root, 'src/features', feature);
    for (const relative of ['feature.map.md', 'queries', 'components/README.md', 'actions/README.md', 'schema/README.md', 'queries/README.md']) {
      assert.ok((await stat(path.join(base, relative))).isFile() || (await stat(path.join(base, relative))).isDirectory(), `${feature}/${relative}`);
    }
    assert.ok((await readdir(path.join(base, 'queries'))).some((file) => file.endsWith('.ts')), `${feature} has no action query`);
  }
});

await check('cross-feature imports are a lint error and have real parser tests', async () => {
  const [config, testFile] = await Promise.all([
    readFile(path.join(root, 'eslint.config.mjs'), 'utf8'),
    readFile(path.join(root, 'tests/feature-boundaries.test.mjs'), 'utf8'),
  ]);
  assert.match(config, /proofloop\/no-cross-feature-imports': 'error'/);
  assert.match(testFile, /rejects relative and aliased cross-feature imports/);
});

await check('every table has a primary key and created/updated timestamps', async () => {
  const [schema, migration] = await Promise.all([
    readFile(path.join(root, 'src/db/schema.ts'), 'utf8'),
    readFile(path.join(root, 'src/db/migrations/0000_proofloop_data_layer.sql'), 'utf8'),
  ]);
  assert.equal((schema.match(/pgTable\(/g) ?? []).length, 20);
  assert.equal((schema.match(/\.\.\.recordTimestamps\(\)/g) ?? []).length, 20);
  assert.equal((migration.match(/PRIMARY KEY/g) ?? []).length, 20);
  assert.equal((migration.match(/"created_at" timestamp/g) ?? []).length, 20);
  assert.equal((migration.match(/"updated_at" timestamp/g) ?? []).length, 20);
});

await check('all foreign keys restrict deletion and preserve related data', async () => {
  const migration = await readFile(path.join(root, 'src/db/migrations/0000_proofloop_data_layer.sql'), 'utf8');
  assert.equal((migration.match(/ON DELETE restrict/gi) ?? []).length, 27);
  assert.doesNotMatch(migration, /ON DELETE CASCADE|ON DELETE SET NULL/i);
});

await check('database triggers enforce exact-version shipping, independent evidence, lifecycle, and automatic reversion', async () => {
  const invariants = await readFile(path.join(root, 'src/db/migrations/0002_database_invariants.sql'), 'utf8');
  for (const trigger of [
    'verification_runs_passing_evidence_gate', 'approver_decisions_evidence_gate', 'ship_records_gate',
    'change_requests_status_gate', 'failed_post_check_requires_revert', 'auto_reverts_recheck_gate',
  ]) assert.ok(invariants.includes(trigger), trigger);
  for (const invariant of ['I4', 'I5', 'I6', 'I7', 'I8', 'I10']) assert.ok(invariants.includes(invariant), invariant);
});

await check('the database test attempts each of the five illegal ship cases on PostgreSQL', async () => {
  const tests = await readFile(path.join(root, 'tests/shipping-gates.integration.test.mjs'), 'utf8');
  for (const scenario of ['wrong SHA', 'failing verification', 'missing spot-check', 'unevidenced requirement', 'untraced claim']) assert.ok(tests.includes(scenario), scenario);
  assert.match(tests, /new Pool\(/);
  assert.match(tests, /REJECTED \$\{scenario\}/);
});

await check('Argon2id passwords, expiring hashed reset links, and revocable database sessions are implemented', async () => {
  const [accounts, schema, manifest] = await Promise.all([
    readFile(path.join(root, 'src/features/accounts/queries/accounts.ts'), 'utf8'),
    readFile(path.join(root, 'src/db/schema.ts'), 'utf8'),
    readFile(path.join(root, 'package.json'), 'utf8'),
  ]);
  assert.match(manifest, /"@node-rs\/argon2": "2.2.2"/);
  assert.match(accounts, /Algorithm|algorithm: 2 as Algorithm/);
  for (const name of ['sessions', 'passwordResetTokens']) assert.ok(schema.includes(`export const ${name}`));
  assert.match(schema, /users_password_hash_argon2id_check/);
});

await check('AES-256-GCM is centralized, and database integration tests inspect ciphertext at rest', async () => {
  const [crypto, accountsTest] = await Promise.all([
    readFile(path.join(root, 'src/lib/crypto.ts'), 'utf8'),
    readFile(path.join(root, 'tests/accounts.integration.test.mjs'), 'utf8'),
  ]);
  assert.match(crypto, /aes-256-gcm/);
  assert.match(crypto, /createDecipheriv/);
  assert.match(accountsTest, /ciphertext/);
  assert.match(accountsTest, /decryptStoredValue/);
});

await check('risk is deterministic in TypeScript and enforced against the stored footprint in PostgreSQL', async () => {
  const [risk, trigger] = await Promise.all([
    readFile(path.join(root, 'src/features/risk/classification.ts'), 'utf8'),
    readFile(path.join(root, 'src/db/migrations/0004_deterministic_risk_footprint.sql'), 'utf8'),
  ]);
  assert.match(risk, /HIGH_RISK_PATH_RULES/);
  assert.match(trigger, /proofloop_validate_risk_assessment/);
  assert.match(trigger, /file-count-over-10/);
  assert.match(trigger, /changed-lines-over-400/);
});

await check('all eight automation contexts have distinct required credentials wired to the runtime', async () => {
  const [auth, compose, example] = await Promise.all([
    readFile(path.join(root, 'src/db/authorization.ts'), 'utf8'),
    readFile(path.join(root, 'docker-compose.yml'), 'utf8'),
    readFile(path.join(root, '.env.example'), 'utf8'),
  ]);
  for (const role of ['intake', 'implementer', 'verifier', 'risk', 'approver', 'shipper', 'watcher', 'orchestrator']) {
    const key = `PROOFLOOP_${role.toUpperCase()}_KEY`;
    assert.ok(auth.includes(`${role}: '${key}'`), role);
    assert.ok(compose.includes(key), `${role} key missing from Compose`);
    assert.ok(example.includes(key), `${role} key missing from .env.example`);
  }
  assert.match(auth, /new Set\(configured\)\.size !== configured\.length/);
});

await check('build and lint fail if a human approval path is modeled', async () => {
  const [manifest, guard] = await Promise.all([
    readFile(path.join(root, 'package.json'), 'utf8'),
    readFile(path.join(root, 'scripts/invariant-guard.mjs'), 'utf8'),
  ]);
  assert.match(manifest, /"prebuild": "node scripts\/invariant-guard.mjs"/);
  assert.match(manifest, /invariant-guard\.mjs && eslint/);
  assert.match(guard, /hasForbiddenApprovalName/);
});

await check('history is derived, and all feature queries enforce user or automation access', async () => {
  const schema = await readFile(path.join(root, 'src/db/schema.ts'), 'utf8');
  assert.doesNotMatch(schema, /pgTable\(['"]history['"]/);
  for (const feature of expectedFeatures) {
    const files = (await readdir(path.join(root, 'src/features', feature, 'queries'))).filter((file) => file.endsWith('.ts'));
    assert.ok(files.length > 0);
    const source = await Promise.all(files.map((file) => readFile(path.join(root, 'src/features', feature, 'queries', file), 'utf8')));
    assert.ok(source.some((text) => /requireUserId|requireAutomationAccess|requireOwnedProject|requireOwnedChangeRequest|checkDatabaseConnection/.test(text)), feature);
  }
});

await check('PostgreSQL 17, readiness, app dependency, evidence storage, and real-database test gate are configured', async () => {
  const [compose, makefile, packageJson] = await Promise.all([
    readFile(path.join(root, 'docker-compose.yml'), 'utf8'),
    readFile(path.join(root, 'Makefile'), 'utf8'),
    readFile(path.join(root, 'package.json'), 'utf8'),
  ]);
  assert.match(compose, /image: postgres:17/);
  assert.match(compose, /pg_isready/);
  assert.match(compose, /condition: service_healthy/);
  assert.match(compose, /proofloop-evidence:/);
  assert.match(compose, /\/api\/health/);
  assert.match(makefile, /corepack pnpm db:migrate/);
  assert.match(packageJson, /require-database\.mjs/);
});

console.log('P8.1 AUDIT — data-layer phase');
for (const name of passed) console.log(`PASS ${name}`);
console.log(`RESULT ${passed.length}/${passed.length} checks passed`);
console.log('SCOPE Docker-backed PostgreSQL runtime proof requires Docker, which is not installed in this workspace.');
