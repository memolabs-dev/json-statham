import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test(
  'installed package supports ESM, precise TypeScript reports and its real CLI binary',
  { timeout: 90000 },
  () => {
    const root = resolve('.'),
      dir = mkdtempSync(join(tmpdir(), 'statham-consumer-'));
    const run = (cmd, args, cwd = dir, timeout = 30000) => {
      const result = spawnSync(cmd, args, {
        cwd,
        encoding: 'utf8',
        timeout,
        maxBuffer: 1024 * 1024,
      });
      assert.equal(
        result.status,
        0,
        result.stderr || result.stdout || String(result.error),
      );
      return result;
    };
    try {
      const packed = run(
        'npm',
        ['pack', '--ignore-scripts', '--json', '--pack-destination', dir],
        root,
      );
      const tar = join(dir, JSON.parse(packed.stdout)[0].filename);
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ private: true, type: 'module' }),
      );
      run('npm', [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        '--prefer-offline',
        tar,
      ]);
      writeFileSync(
        join(dir, 'consumer.mjs'),
        `import assert from 'node:assert/strict';
import * as api from 'json-statham';
assert.deepEqual(Object.keys(api).sort(),['ContractInputError','compare','createBaseline','validate']);
assert.equal(api.validate({type:'integer'},1).status,'valid');
assert.equal(api.validate({type:'integer'},'1').status,'invalid');
const old={type:'string'}, next={type:'string',minLength:1};
assert.equal(api.compare(old,next,api.createBaseline(old,next)).status,'accepted');
assert.throws(() => api.validate({type:'PRIVATE_VALUE'},null),e => e instanceof api.ContractInputError && e.code === 'invalid-schema' && !String(e).includes('PRIVATE_VALUE'));
await assert.rejects(import('json-statham/dist/worker.js'),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
console.log('consumer-ok');`,
      );
      assert.equal(
        run(process.execPath, ['consumer.mjs']).stdout.trim(),
        'consumer-ok',
      );
      writeFileSync(
        join(dir, 'consumer.ts'),
        `import {validate, compare, createBaseline, ContractInputError, type ValidationReport, type ComparisonReport, type Report, type Baseline, type Diagnostic, type InputErrorCode} from 'json-statham';
const validation:ValidationReport=validate(true,null);
const validationStatus:'valid'|'invalid'=validation.status;
const comparison:ComparisonReport=compare(true,false);
const comparisonStatus:'unchanged'|'potentially-breaking'|'accepted'=comparison.status;
const report:Report=validation;
const baseline:Baseline=createBaseline(true,false);
const diagnostics:Diagnostic[]=comparison.diagnostics;
const code:InputErrorCode=new ContractInputError('invalid-schema').code;
// @ts-expect-error Validation never returns an accepted comparison.
const wrongValidation:ValidationReport['status']='accepted';
// @ts-expect-error Comparison never validates one document.
const wrongComparison:ComparisonReport['status']='valid';
// @ts-expect-error Internal workers are not a supported package export.
import { validate as hidden } from 'json-statham/dist/core.js';
void [validationStatus,comparisonStatus,report,baseline,diagnostics,code];`,
      );
      writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            types: [],
            skipLibCheck: false,
          },
          files: ['consumer.ts'],
        }),
      );
      run(process.execPath, [
        join(root, 'node_modules/typescript/bin/tsc'),
        '--project',
        'tsconfig.json',
      ]);
      const binary = join(dir, 'node_modules/.bin/json-statham');
      const result = run(binary, [
        'validate',
        join(root, 'examples/schema.json'),
        join(root, 'examples/valid.json'),
        '--json',
      ]);
      assert.equal(JSON.parse(result.stdout).status, 'valid');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
