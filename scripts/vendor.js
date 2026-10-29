import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('vendor', { recursive: true });
for (const [source, target] of [
  ['preact/dist/preact.module.js', 'preact.module.js'],
  ['preact/hooks/dist/hooks.module.js', 'hooks.module.js'],
  ['htm/dist/htm.module.js', 'htm.module.js'],
  ['preact/LICENSE', 'PREACT-LICENSE'],
  ['htm/LICENSE', 'HTM-LICENSE'],
]) {
  await copyFile(`node_modules/${source}`, `vendor/${target}`);
}
console.log('Copied Preact, hooks, HTM, and their licenses into vendor/. No build needed.');
