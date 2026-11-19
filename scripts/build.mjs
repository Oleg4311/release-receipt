// Сборка. Без аргументов: сайт в site/ (с version.json). С --cli: один файл dist/release-receipt.mjs и его SHA-256.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

if (process.argv.includes('--cli')) {
  rmSync('dist', { recursive: true, force: true });
  mkdirSync('dist');
  await build({
    entryPoints: ['src/cli.ts'],
    outfile: 'dist/release-receipt.mjs',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    define: { __VERSION__: JSON.stringify(pkg.version) },
  });
  const sum = createHash('sha256').update(readFileSync('dist/release-receipt.mjs')).digest('hex');
  writeFileSync('dist/release-receipt.mjs.sha256', `${sum}  release-receipt.mjs\n`);
  console.log(`dist/release-receipt.mjs  sha256 ${sum}`);
} else {
  rmSync('site', { recursive: true, force: true });
  mkdirSync('site');
  await build({
    entryPoints: ['src/web.ts'],
    outfile: 'site/app.js',
    bundle: true,
    format: 'iife',
    target: 'es2023',
    minify: true,
  });
  copyFileSync('web/index.html', 'site/index.html');
  // version.json публикуется вместе с сайтом: именно его потом сверяет сам Release Receipt
  execFileSync(process.execPath, ['src/cli.ts', 'stamp', '--out', 'site/version.json'], { stdio: 'inherit' });
  console.log('site/ готов');
}
