// Проверка настоящего CLI: процесс, локальный HTTP-сервер вместо сайта и вместо GitHub API.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const GOOD = '9f2c1ab4d7e0836b5c4a12ef90d3b7a8c61e5f04';
const OLD = '3b7a0c91e5d24f68a1b90c7d5e3f2a41b6c8d9e0';

let server: Server;
let origin = '';
let deployed = GOOD;
let ciConclusion = 'success';

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/site/version.json') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ commit: deployed, version: '1.0.0' }));
    } else if (url.pathname === '/repos/o/r/actions/runs') {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          workflow_runs: [{ id: 7, name: 'CI', status: 'completed', conclusion: ciConclusion, html_url: 'http://x/run/7', head_sha: GOOD }],
        }),
      );
    } else {
      res.statusCode = 404;
      res.end('nope');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

function run(args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, GITHUB_SHA: '', GITHUB_TOKEN: '', ...env },
    });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code: code ?? -1, out, err }));
  });
}

const verifyArgs = (extra: string[] = []) => ['verify', `${origin}/site/`, '--sha', GOOD, '--repo', 'o/r', '--api-base', origin, ...extra];

test('verify: совпало, код 0, квитанция сохранена', async () => {
  deployed = GOOD;
  ciConclusion = 'success';
  const out = join(mkdtempSync(join(tmpdir(), 'rr-')), 'receipt.json');
  const r = await run(verifyArgs(['--workflow', 'CI', '--out', out]));
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /СОВПАДАЕТ/);
  const receipt = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(receipt.verdict, 'match');
  assert.equal(receipt.expected.source, '--sha');
});

test('verify: сайт отстаёт, код 1', async () => {
  deployed = OLD;
  const r = await run(verifyArgs());
  assert.equal(r.code, 1);
  assert.match(r.out, /НЕ СОВПАДАЕТ/);
  assert.match(r.out, /на сайте коммит 3b7a0c9, ожидается 9f2c1ab/);
});

test('verify: красный CI, код 1', async () => {
  deployed = GOOD;
  ciConclusion = 'failure';
  const r = await run(verifyArgs());
  assert.equal(r.code, 1);
  assert.match(r.out, /CI красный/);
});

test('verify --json печатает валидный JSON', async () => {
  deployed = GOOD;
  ciConclusion = 'success';
  const r = await run(verifyArgs(['--json']));
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).verdict, 'match');
});

test('verify: недоступная страница, код 2', async () => {
  const r = await run(['verify', `${origin}/missing/`, '--sha', GOOD]);
  assert.equal(r.code, 2);
  assert.match(r.out, /HTTP 404/);
});

test('verify --wait: деплой доезжает во время ожидания', async () => {
  deployed = OLD;
  ciConclusion = 'success';
  setTimeout(() => (deployed = GOOD), 700);
  const r = await run(verifyArgs(['--wait', '10', '--interval', '0.3']));
  assert.equal(r.code, 0, r.out);
});

test('verify: ожидаемый коммит берётся из GITHUB_SHA', async () => {
  deployed = GOOD;
  const r = await run(['verify', `${origin}/site/`, '--json'], { GITHUB_SHA: GOOD });
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(r.out).expected.source, 'GITHUB_SHA');
});

test('ошибки использования дают код 2 и понятное сообщение', async () => {
  const noUrl = await run(['verify']);
  assert.equal(noUrl.code, 2);
  assert.match(noUrl.err, /укажите адрес сайта/);
  const badSha = await run(['verify', `${origin}/site/`, '--sha', 'main']);
  assert.equal(badSha.code, 2);
  assert.match(badSha.err, /не похож на SHA/);
  const unknown = await run(['deploy']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /неизвестная команда/);
});

test('stamp пишет version.json с коммитом и метаданными', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rr-stamp-'));
  const out = join(dir, 'version.json');
  const r = await run(['stamp', '--out', out, '--app-version', '3.1.4'], {
    GITHUB_SHA: GOOD,
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_RUN_ID: '42',
    SOURCE_DATE_EPOCH: '1790000000',
  });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), {
    commit: GOOD,
    builtAt: new Date(1790000000 * 1000).toISOString(),
    version: '3.1.4',
    repo: 'o/r',
    runId: '42',
  });
});

test('--version и --help', async () => {
  assert.match((await run(['--version'])).out, /^release-receipt \d+\.\d+\.\d+/);
  const h = await run(['--help']);
  assert.equal(h.code, 0);
  assert.match(h.out, /Коды выхода/);
});
