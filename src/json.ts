import { createHash } from 'node:crypto';
import { MAX_INPUT_BYTES, MAX_DEPTH } from './limits.js';
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );

export const digest = (value: unknown): string =>
  createHash('sha256').update(canonical(value)).digest('hex');

export function cloneJson(value: unknown): unknown {
  const ancestors = new Set<object>();
  function visit(item: unknown, depth: number): void {
    if (depth > MAX_DEPTH) throw new Error('JSON depth limit.');
    if (
      item === null ||
      typeof item === 'string' ||
      typeof item === 'boolean' ||
      (typeof item === 'number' && Number.isFinite(item))
    )
      return;
    if (typeof item !== 'object' || ancestors.has(item))
      throw new Error('Not JSON.');
    if (Array.isArray(item) && Object.getPrototypeOf(item) !== Array.prototype)
      throw new Error('Not a plain JSON array.');
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    )
      throw new Error('Not plain JSON.');
    if (Object.getOwnPropertySymbols(item).length) throw new Error('Not JSON.');
    ancestors.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Array.isArray(item) && Object.keys(item).length !== item.length)
      throw new Error('Not a dense JSON array.');
    for (const [key, d] of Object.entries(descriptors)) {
      if (Array.isArray(item) && key === 'length') continue;
      if (
        !d.enumerable ||
        !('value' in d) ||
        (Array.isArray(item) &&
          (!/^(0|[1-9][0-9]*)$/.test(key) ||
            !Number.isSafeInteger(Number(key)) ||
            Number(key) >= item.length))
      )
        throw new Error('Not JSON data.');
      visit(d.value, depth + 1);
    }
    ancestors.delete(item);
  }
  visit(value, 0);
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_INPUT_BYTES)
    throw new Error('JSON byte limit.');
  return JSON.parse(serialized) as unknown;
}
