import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('copies browser modules and their licenses unchanged for static hosting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wkfast-vendor-'));
  const originalDirectory = process.cwd();
  const files = [
    ['preact/dist/preact.module.js', 'preact.module.js'],
    ['preact/hooks/dist/hooks.module.js', 'hooks.module.js'],
    ['htm/dist/htm.module.js', 'htm.module.js'],
    ['preact/LICENSE', 'PREACT-LICENSE'],
    ['htm/LICENSE', 'HTM-LICENSE'],
  ];
  try {
    for (const [source] of files) {
      const path = join(root, 'node_modules', source);
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, `fixture: ${source}`);
    }
    process.chdir(root);
    await import('../scripts/vendor.js');
    for (const [source, target] of files) {
      assert.equal(await readFile(join(root, 'vendor', target), 'utf8'), `fixture: ${source}`);
    }
  } finally {
    process.chdir(originalDirectory);
    await rm(root, { recursive: true, force: true });
  }
});
