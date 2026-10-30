import * as fs from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { MAX_INPUT_BYTES } from './limits.js';
import { cloneJson } from './json.js';
export type Identity = {
  dev: string;
  ino: string;
  size: string;
  mtimeNs: string;
  ctimeNs: string;
};
export interface Capture {
  path: string;
  bytes: Buffer;
  sha256: string;
  identity: Identity;
  mode: number;
  uid: number;
  nlink: number;
}
export class TransactionError extends Error {
  constructor(readonly code: string) {
    super(
      `Transaction ${code}; inspect the transaction and explicit file targets before retrying.`,
    );
    this.name = 'TransactionError';
  }
}
export const rawHash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
export function canonicalPath(path: string): string {
  const full = resolve(path);
  return join(
    trustedDirectory(fs.realpathSync(dirname(full)), false),
    basename(full),
  );
}
export function capture(path: string, max = MAX_INPUT_BYTES): Capture {
  const full = canonicalPath(path);
  const fd = fs.openSync(
    full,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    noGrantAcl(full);
    const uid = process.getuid!();
    if (
      (Number(before.uid) !== uid && Number(before.uid) !== 0) ||
      (Number(before.mode) & 0o022) !== 0
    )
      throw new TransactionError('unsafe-path');
    if (!before.isFile() || before.size > BigInt(max))
      throw new TransactionError('invalid-input');
    const bytes = Buffer.alloc(max + 1);
    let count = 0;
    while (count < bytes.length) {
      const n = fs.readSync(fd, bytes, count, bytes.length - count, null);
      if (!n) break;
      count += n;
    }
    const after = fs.fstatSync(fd, { bigint: true });
    const identity = (s: typeof before): Identity => ({
      dev: String(s.dev),
      ino: String(s.ino),
      size: String(s.size),
      mtimeNs: String(s.mtimeNs),
      ctimeNs: String(s.ctimeNs),
    });
    if (
      count > max ||
      JSON.stringify(identity(before)) !== JSON.stringify(identity(after))
    )
      throw new TransactionError('source-changed');
    const content = bytes.subarray(0, count);
    return {
      path: full,
      bytes: content,
      sha256: rawHash(content),
      identity: identity(after),
      mode: Number(after.mode) & 0o7777,
      uid: Number(after.uid),
      nlink: Number(after.nlink),
    };
  } finally {
    fs.closeSync(fd);
  }
}
export function parseJson(c: Capture): unknown {
  try {
    return cloneJson(
      JSON.parse(
        new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
          c.bytes,
        ),
      ) as unknown,
    );
  } catch {
    throw new TransactionError('invalid-input');
  }
}
export function trustedDirectory(path: string, requireOwner = true): string {
  if (fs.lstatSync(resolve(path)).isSymbolicLink())
    throw new TransactionError('unsafe-path');
  const full = fs.realpathSync(path);
  let current = full;
  const uid = process.getuid!();
  for (;;) {
    const stat = fs.lstatSync(current);
    noGrantAcl(current);
    if (
      !stat.isDirectory() ||
      (stat.uid !== 0 && stat.uid !== uid) ||
      ((stat.mode & 0o022) !== 0 &&
        !((stat.mode & 0o1000) !== 0 && stat.uid === 0))
    )
      throw new TransactionError('unsafe-path');
    if (requireOwner && current === full && stat.uid !== uid)
      throw new TransactionError('unsafe-path');
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return full;
}
export function targetPath(path: string): string {
  const full = resolve(path);
  return join(trustedDirectory(dirname(full)), basename(full));
}
export function absent(path: string): boolean {
  try {
    fs.lstatSync(path);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
}
export function syncDirectory(path: string): void {
  const fd = fs.openSync(
    path,
    fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
  );
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
export function writeNew(path: string, bytes: Buffer, mode: number): void {
  const fd = fs.openSync(
    path,
    fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    fs.writeFileSync(fd, bytes);
    fs.fchmodSync(fd, mode);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
export function publishJson(dir: string, name: string, value: unknown): void {
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  if (bytes.length > 65536) throw new TransactionError('invalid-transaction');
  const tmp = join(dir, `.${name}.${randomUUID()}.tmp`);
  writeNew(tmp, bytes, 0o400);
  try {
    fs.linkSync(tmp, join(dir, name));
    syncDirectory(dir);
  } finally {
    fs.unlinkSync(tmp);
    syncDirectory(dir);
  }
}

const aclCache = new Map<string, string>();
function noGrantAcl(path: string): void {
  if (process.platform !== 'darwin') return;
  const stat = fs.lstatSync(path, { bigint: true });
  const identity = [stat.dev, stat.ino, stat.ctimeNs, stat.mode, stat.uid].join(
    ':',
  );
  if (aclCache.get(path) === identity) return;
  const acl = execFileSync('/bin/ls', ['-ldeb', path], {
    encoding: 'utf8',
    timeout: 2000,
    maxBuffer: 65536,
    env: {
      ...process.env,
      LC_ALL: 'C',
      LANG: 'C',
      CLICOLOR: '0',
      CLICOLOR_FORCE: '0',
    },
  });
  if (/^\s*\d+:.*\ballow\b/m.test(acl))
    throw new TransactionError('unsafe-path');
  aclCache.set(path, identity);
}
