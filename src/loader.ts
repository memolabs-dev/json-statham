import { openSync, closeSync, fstatSync, readSync } from 'node:fs';
export const MAX_INPUT_BYTES = 1024 * 1024;
export function loadJson(path: string): unknown {
  const fd = openSync(path, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_INPUT_BYTES)
      throw new Error('Input must be a regular file up to 1 MiB.');
    const buffer = Buffer.alloc(MAX_INPUT_BYTES + 1);
    let count = 0;
    while (count < buffer.length) {
      const n = readSync(fd, buffer, count, buffer.length - count, null);
      if (!n) break;
      count += n;
    }
    if (count > MAX_INPUT_BYTES) throw new Error('Input size limit exceeded.');
    const value: unknown = JSON.parse(
      buffer.subarray(0, count).toString('utf8'),
    );
    checkDepth(value);
    return value;
  } finally {
    closeSync(fd);
  }
}
function checkDepth(value: unknown, depth = 0): void {
  if (depth > 64) throw new Error('Nesting limit exceeded.');
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) checkDepth(child, depth + 1);
  }
}
