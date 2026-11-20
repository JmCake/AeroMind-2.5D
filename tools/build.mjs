import { build } from 'esbuild';
import { cp, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const out = path.resolve('dist');
await mkdir(path.join(out, 'runtime'), { recursive: true });
await cp('public', out, { recursive: true });
await build({
  entryPoints: { game: 'src/main.ts', vision: 'src/worker.ts' },
  outdir: out,
  format: 'esm',
  bundle: true,
  target: 'es2022',
  minify: true,
  legalComments: 'eof',
  logLevel: 'info',
});
for (const ext of ['mjs', 'wasm'])
  await copyFile(
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.' + ext,
    path.join(out, 'runtime', 'ort-wasm-simd-threaded.' + ext)
  );
const notices = await readFile('THIRD_PARTY.md', 'utf8');
await writeFile(
  path.join(out, 'THIRD_PARTY.txt'),
  notices + '\n\n' + (await readFile('node_modules/three/LICENSE', 'utf8'))
);
console.log('Offline application ready in dist/');
