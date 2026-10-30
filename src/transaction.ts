import * as fs from 'node:fs';
import { join, dirname } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { canonical, digest } from './json.js';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { MigrationReport } from './migration.js';
import {
  capture,
  parseJson,
  targetPath,
  trustedDirectory,
  absent,
  writeNew,
  publishJson,
  syncDirectory,
  TransactionError,
  rawHash,
  canonicalPath,
} from './transaction-io.js';
export { TransactionError } from './transaction-io.js';
export interface TransactionReport {
  status:
    | 'prepared'
    | 'applied'
    | 'restored'
    | 'apply-pending'
    | 'restore-pending'
    | 'incomplete';
  diagnostics: { code: string; path: string; message: string }[];
  transaction: string;
  output?: string;
  rollbackVerified?: boolean;
  sourceHash?: string;
  candidateHash?: string;
  nextAction?: string;
}
async function verify(
  before: unknown,
  after: unknown,
  document: unknown,
  plan: unknown,
): Promise<MigrationReport> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./transaction-worker.js', import.meta.url),
      {
        workerData: { before, after, document, plan },
        resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
      },
    );
    let done = false;
    const finish = (value: unknown, error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(value as MigrationReport);
    };
    const timer = setTimeout(
      () => finish(null, new TransactionError('resource-limit')),
      5000,
    );
    worker.once('message', (value) => {
      if (value.status === 'error')
        finish(null, new TransactionError('invalid-input'));
      else finish(value);
    });
    worker.once('error', () =>
      finish(null, new TransactionError('resource-limit')),
    );
    worker.once('exit', () => {
      if (!done) finish(null, new TransactionError('resource-limit'));
    });
  });
}
export async function runTransaction(
  command: string,
  first: string | undefined,
  second: string | undefined,
  paths: Record<string, string>,
): Promise<TransactionReport | MigrationReport> {
  if (!['linux', 'darwin'].includes(process.platform))
    throw new TransactionError('unsupported-platform');
  if (command === 'apply') return applyTransaction(paths);
  if (command === 'restore') return restoreTransaction(paths);
  if (command === 'inspect-transaction') return inspectTransaction(paths);
  if (command !== 'stage') throw new TransactionError('unsupported-command');
  const original = capture(paths['--document']),
    before = capture(first!),
    after = capture(second!),
    plan = capture(paths['--plan']);
  const result = await verify(
    parseJson(before),
    parseJson(after),
    parseJson(original),
    parseJson(plan),
  );
  if (result.status === 'rejected') return result;
  const output = targetPath(paths['--output']),
    tx = targetPath(paths['--transaction']);
  if (output === tx) throw new TransactionError('transaction-conflict');
  if (!absent(output) || !absent(tx))
    throw new TransactionError('already-exists');
  if (
    fs.statSync(dirname(output), { bigint: true }).dev !==
    fs.statSync(dirname(tx), { bigint: true }).dev
  )
    throw new TransactionError('cross-device');
  const candidate = Buffer.from(JSON.stringify(result.document));
  fs.mkdirSync(tx, { mode: 0o700 });
  fs.chmodSync(tx, 0o700);
  if (!absent(output)) throw new TransactionError('transaction-conflict');
  const snapshots: Record<string, Buffer> = {
    'original.json': original.bytes,
    'candidate.json': candidate,
    'source-schema.json': before.bytes,
    'target-schema.json': after.bytes,
    'plan.json': plan.bytes,
  };
  for (const [name, bytes] of Object.entries(snapshots))
    writeNew(join(tx, name), bytes, 0o400);
  writeNew(join(tx, 'apply.payload'), candidate, 0o600);
  writeNew(join(tx, 'restore.payload'), original.bytes, 0o600);
  const apply = capture(join(tx, 'apply.payload')),
    restore = capture(join(tx, 'restore.payload'));
  const manifest = {
    version: 1,
    kind: 'file-transaction',
    id: randomUUID(),
    source: {
      path: original.path,
      sha256: original.sha256,
      identity: original.identity,
    },
    output,
    files: Object.fromEntries(
      Object.entries(snapshots).map(([name, bytes]) => [name, rawHash(bytes)]),
    ),
    publication: {
      apply: { dev: apply.identity.dev, ino: apply.identity.ino },
      restore: { dev: restore.identity.dev, ino: restore.identity.ino },
    },
  };
  publishJson(tx, 'manifest.json', manifest);
  syncDirectory(tx);
  syncDirectory(dirname(tx));
  return {
    status: 'prepared',
    diagnostics: [],
    transaction: tx,
    output,
    rollbackVerified: true,
    sourceHash: original.sha256,
    candidateHash: rawHash(candidate),
    nextAction: 'apply',
  };
}

const FILES = [
  'original.json',
  'candidate.json',
  'source-schema.json',
  'target-schema.json',
  'plan.json',
] as const;
type FileName = (typeof FILES)[number];
type PubId = { dev: string; ino: string };
interface Manifest {
  version: 1;
  kind: 'file-transaction';
  id: string;
  source: {
    path: string;
    sha256: string;
    identity: import('./transaction-io.js').Identity;
  };
  output: string;
  files: Record<FileName, string>;
  publication: { apply: PubId; restore: PubId };
}
const hashSchema = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const idSchema = { type: 'string', pattern: '^-?[0-9]{1,30}$' };
const objectSchema = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const pubSchema = objectSchema({ dev: idSchema, ino: idSchema });
const checkManifest = new Ajv2020({ strict: true }).compile<Manifest>(
  objectSchema({
    version: { const: 1 },
    kind: { const: 'file-transaction' },
    id: { type: 'string', pattern: '^[a-f0-9-]{36}$' },
    source: objectSchema({
      path: { type: 'string', maxLength: 4096 },
      sha256: hashSchema,
      identity: objectSchema({
        dev: idSchema,
        ino: idSchema,
        size: idSchema,
        mtimeNs: idSchema,
        ctimeNs: idSchema,
      }),
    }),
    output: { type: 'string', maxLength: 4096 },
    files: objectSchema(
      Object.fromEntries(FILES.map((name) => [name, hashSchema])),
    ),
    publication: objectSchema({ apply: pubSchema, restore: pubSchema }),
  }),
);
interface Loaded {
  tx: string;
  manifest: Manifest;
  snapshots: Record<FileName, import('./transaction-io.js').Capture>;
  manifestHash: string;
}
function privateFile(
  tx: string,
  name: string,
  mode = 0o400,
  max = 1048576,
  nlinks = 2,
) {
  const file = capture(join(tx, name), max);
  if (
    file.uid !== process.getuid!() ||
    file.mode !== mode ||
    file.nlink < 1 ||
    file.nlink > nlinks
  )
    throw new TransactionError('invalid-transaction');
  return file;
}
function loadTransaction(path: string): Loaded {
  try {
    const tx = trustedDirectory(path);
    if ((fs.lstatSync(tx).mode & 0o7777) !== 0o700)
      throw new TransactionError('invalid-transaction');
    const value = parseJson(privateFile(tx, 'manifest.json', 0o400, 65536));
    if (!checkManifest(value))
      throw new TransactionError('invalid-transaction');
    const manifest = value;
    if (
      targetPath(manifest.output) !== manifest.output ||
      !manifest.source.path.startsWith('/')
    )
      throw new TransactionError('invalid-transaction');
    const snapshots = {} as Loaded['snapshots'];
    for (const name of FILES) {
      const file = privateFile(tx, name, 0o400, 1048576, 1);
      if (file.sha256 !== manifest.files[name])
        throw new TransactionError('invalid-transaction');
      snapshots[name] = file;
    }
    if (snapshots['original.json'].sha256 !== manifest.source.sha256)
      throw new TransactionError('invalid-transaction');
    for (const kind of ['apply', 'restore'] as const) {
      const pub = privateFile(tx, `${kind}.payload`, 0o600);
      if (
        pub.identity.dev !== manifest.publication[kind].dev ||
        pub.identity.ino !== manifest.publication[kind].ino ||
        pub.sha256 !==
          manifest.files[kind === 'apply' ? 'candidate.json' : 'original.json']
      )
        throw new TransactionError('invalid-transaction');
    }
    const loaded = { tx, manifest, snapshots, manifestHash: digest(manifest) };
    externalOutput(loaded, manifest.output);
    return loaded;
  } catch {
    throw new TransactionError('invalid-transaction');
  }
}
async function reverify(t: Loaded): Promise<void> {
  const s = t.snapshots;
  const proof = await verify(
    parseJson(s['source-schema.json']),
    parseJson(s['target-schema.json']),
    parseJson(s['original.json']),
    parseJson(s['plan.json']),
  );
  if (
    proof.status !== 'verified' ||
    rawHash(Buffer.from(JSON.stringify(proof.document))) !==
      s['candidate.json'].sha256
  )
    throw new TransactionError('invalid-transaction');
}
function marker(t: Loaded, name: string, expected: unknown): boolean {
  if (absent(join(t.tx, name))) return false;
  try {
    if (
      canonical(parseJson(privateFile(t.tx, name, 0o400, 65536))) !==
      canonical(expected)
    )
      throw new Error('Conflicting marker.');
    return true;
  } catch {
    throw new TransactionError('invalid-transaction');
  }
}
function ensureMarker(t: Loaded, name: string, expected: unknown): void {
  if (!marker(t, name, expected)) {
    try {
      publishJson(t.tx, name, expected);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  if (!marker(t, name, expected))
    throw new TransactionError('invalid-transaction');
  const fd = fs.openSync(
    join(t.tx, name),
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const info = fs.fstatSync(fd);
    if (
      !info.isFile() ||
      info.uid !== process.getuid!() ||
      (info.mode & 0o7777) !== 0o400
    )
      throw new TransactionError('invalid-transaction');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  syncDirectory(t.tx);
  syncDirectory(dirname(t.tx));
}
function published(
  t: Loaded,
  output: string,
  kind: 'apply' | 'restore',
): boolean {
  if (absent(output)) return false;
  try {
    const file = capture(output),
      expected = t.manifest.publication[kind];
    const sha =
      kind === 'apply'
        ? t.manifest.files['candidate.json']
        : t.manifest.files['original.json'];
    if (
      file.identity.dev !== expected.dev ||
      file.identity.ino !== expected.ino ||
      file.sha256 !== sha ||
      file.uid !== process.getuid!() ||
      file.mode !== 0o600
    )
      throw new Error('Not owned output.');
    return true;
  } catch {
    throw new TransactionError('output-changed');
  }
}
function publish(t: Loaded, output: string, kind: 'apply' | 'restore'): void {
  const payload = privateFile(t.tx, `${kind}.payload`, 0o600);
  const sha =
    kind === 'apply'
      ? t.manifest.files['candidate.json']
      : t.manifest.files['original.json'];
  if (payload.sha256 !== sha) throw new TransactionError('invalid-transaction');
  if (
    String(fs.statSync(dirname(output), { bigint: true }).dev) !==
    payload.identity.dev
  )
    throw new TransactionError('cross-device');
  syncDirectory(t.tx);
  syncDirectory(dirname(t.tx));
  try {
    fs.linkSync(join(t.tx, `${kind}.payload`), output);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  if (!published(t, output, kind)) throw new TransactionError('output-changed');
}
function confirmPublication(
  t: Loaded,
  output: string,
  kind: 'apply' | 'restore',
): void {
  if (!published(t, output, kind)) throw new TransactionError('output-changed');
  const fd = fs.openSync(
    output,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const info = fs.fstatSync(fd, { bigint: true }),
      expected = t.manifest.publication[kind];
    if (
      !info.isFile() ||
      String(info.dev) !== expected.dev ||
      String(info.ino) !== expected.ino
    )
      throw new TransactionError('output-changed');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  syncDirectory(dirname(output));
  if (!published(t, output, kind)) throw new TransactionError('output-changed');
}

function appliedMarker(t: Loaded) {
  return {
    version: 1,
    kind: 'applied',
    manifest: t.manifestHash,
    output: t.manifest.output,
  };
}
async function applyTransaction(
  paths: Record<string, string>,
): Promise<TransactionReport> {
  const t = loadTransaction(paths['--transaction']);
  const output = targetPath(paths['--output']);
  if (
    output !== t.manifest.output ||
    canonicalPath(paths['--document']) !== t.manifest.source.path
  )
    throw new TransactionError('transaction-conflict');
  await reverify(t);
  const expected = appliedMarker(t),
    recorded = marker(t, 'applied.json', expected),
    already = published(t, output, 'apply');
  if (recorded && !already) throw new TransactionError('output-changed');
  if (!already) {
    const source = capture(paths['--document']);
    if (
      source.sha256 !== t.manifest.source.sha256 ||
      canonical(source.identity) !== canonical(t.manifest.source.identity)
    )
      throw new TransactionError('source-changed');
    publish(t, output, 'apply');
  }
  confirmPublication(t, output, 'apply');
  ensureMarker(t, 'applied.json', expected);
  return {
    status: 'applied',
    diagnostics: [],
    transaction: t.tx,
    output,
    rollbackVerified: true,
    sourceHash: t.manifest.source.sha256,
    candidateHash: t.manifest.files['candidate.json'],
    nextAction: 'restore',
  };
}

interface RestoreIntent {
  version: 1;
  kind: 'restore-intent';
  manifest: string;
  output: string;
}
const checkRestoreIntent = new Ajv2020({ strict: true }).compile<RestoreIntent>(
  objectSchema({
    version: { const: 1 },
    kind: { const: 'restore-intent' },
    manifest: hashSchema,
    output: { type: 'string', maxLength: 4096 },
  }),
);
function restoreIntent(t: Loaded): RestoreIntent | undefined {
  if (absent(join(t.tx, 'restore-intent.json'))) return undefined;
  const value = parseJson(
    privateFile(t.tx, 'restore-intent.json', 0o400, 65536),
  );
  if (
    !checkRestoreIntent(value) ||
    value.manifest !== t.manifestHash ||
    targetPath(value.output) !== value.output
  )
    throw new TransactionError('invalid-transaction');
  externalOutput(t, value.output);
  return value;
}
function restoredMarker(t: Loaded, intent: RestoreIntent) {
  return {
    version: 1,
    kind: 'restored',
    manifest: t.manifestHash,
    intent: digest(intent),
  };
}
async function restoreTransaction(
  paths: Record<string, string>,
): Promise<TransactionReport> {
  const t = loadTransaction(paths['--transaction']);
  if (canonicalPath(paths['--document']) !== t.manifest.output)
    throw new TransactionError('transaction-conflict');
  await reverify(t);
  if (!marker(t, 'applied.json', appliedMarker(t)))
    throw new TransactionError('not-applied');
  if (!published(t, t.manifest.output, 'apply'))
    throw new TransactionError('output-changed');
  const output = targetPath(paths['--output']);
  externalOutput(t, output);
  if (
    String(fs.statSync(dirname(output), { bigint: true }).dev) !==
    t.manifest.publication.restore.dev
  )
    throw new TransactionError('cross-device');
  const intent: RestoreIntent = {
    version: 1,
    kind: 'restore-intent',
    manifest: t.manifestHash,
    output,
  };
  const existing = restoreIntent(t);
  if (existing && existing.output !== output)
    throw new TransactionError('transaction-conflict');
  if (!existing && !absent(output))
    throw new TransactionError('already-exists');
  ensureMarker(t, 'restore-intent.json', intent);
  const expected = restoredMarker(t, intent),
    recorded = marker(t, 'restored.json', expected),
    already = published(t, output, 'restore');
  if (recorded && !already) throw new TransactionError('output-changed');
  if (!already) publish(t, output, 'restore');
  confirmPublication(t, output, 'restore');
  ensureMarker(t, 'restored.json', expected);
  return {
    status: 'restored',
    diagnostics: [],
    transaction: t.tx,
    output,
    rollbackVerified: true,
    sourceHash: t.manifest.source.sha256,
    candidateHash: t.manifest.files['candidate.json'],
    nextAction: 'none',
  };
}

async function inspectTransaction(
  paths: Record<string, string>,
): Promise<TransactionReport> {
  const dir = trustedDirectory(paths['--transaction']);
  if ((fs.lstatSync(dir).mode & 0o7777) !== 0o700)
    throw new TransactionError('unsafe-path');
  if (absent(join(dir, 'manifest.json')))
    return {
      status: 'incomplete',
      diagnostics: [
        {
          code: 'incomplete-transaction',
          path: '',
          message:
            'Keep existing artifacts and stage into a fresh transaction directory.',
        },
      ],
      transaction: dir,
      nextAction: 'restage',
    };
  const t = loadTransaction(dir);
  await reverify(t);
  const applied = marker(t, 'applied.json', appliedMarker(t)),
    hasOutput = published(t, t.manifest.output, 'apply'),
    intent = restoreIntent(t);
  const result = (
    status: TransactionReport['status'],
    nextAction: string,
    output = t.manifest.output,
  ): TransactionReport => ({
    status,
    diagnostics: [],
    transaction: t.tx,
    output,
    sourceHash: t.manifest.source.sha256,
    candidateHash: t.manifest.files['candidate.json'],
    rollbackVerified: true,
    nextAction,
  });
  if (!applied) {
    if (intent || !absent(join(t.tx, 'restored.json')))
      throw new TransactionError('invalid-transaction');
    return result(hasOutput ? 'apply-pending' : 'prepared', 'apply');
  }
  if (!hasOutput) throw new TransactionError('output-changed');
  if (!intent) {
    if (!absent(join(t.tx, 'restored.json')))
      throw new TransactionError('invalid-transaction');
    return result('applied', 'restore');
  }
  const restored = marker(t, 'restored.json', restoredMarker(t, intent)),
    hasRestore = published(t, intent.output, 'restore');
  if (restored && !hasRestore) throw new TransactionError('output-changed');
  return result(
    restored ? 'restored' : 'restore-pending',
    restored ? 'none' : 'restore',
    intent.output,
  );
}

function externalOutput(t: Loaded, output: string): void {
  const transaction = fs.statSync(t.tx, { bigint: true });
  let directory = dirname(output);
  for (;;) {
    const stat = fs.statSync(directory, { bigint: true });
    if (stat.dev === transaction.dev && stat.ino === transaction.ino)
      throw new TransactionError('transaction-conflict');
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
}
