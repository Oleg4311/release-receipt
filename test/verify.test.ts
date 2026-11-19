import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEMO_EXPECTED, DEMO_REPO, DEMO_SITE, DEMO_STALE, scenarioFetch, type ScenarioId } from '../src/scenarios.ts';
import { collect, verify, type VerifyOptions } from '../src/verify.ts';

const base = (id: ScenarioId, extra: Partial<VerifyOptions> = {}): VerifyOptions => ({
  site: DEMO_SITE,
  repo: DEMO_REPO,
  expected: { sha: DEMO_EXPECTED, source: 'test' },
  fetchImpl: scenarioFetch(id),
  now: () => Date.parse('2026-11-19T10:00:00Z'),
  ...extra,
});

const status = (r: Awaited<ReturnType<typeof collect>>, id: string) => r.checks.find((c) => c.id === id)!.status;

test('match: сайт и CI соответствуют коммиту', async () => {
  const r = await collect(base('match'));
  assert.equal(r.verdict, 'match');
  assert.equal(r.schema, 'release-receipt/1');
  assert.equal(r.deployed.info?.version, '2.4.1');
  assert.equal(r.checkedAt, '2026-11-19T10:00:00.000Z');
  assert.equal(r.ci?.runs[0].workflow, 'CI');
});

test('stale: CI зелёный, но на сайте старый коммит', async () => {
  const r = await collect(base('stale'));
  assert.equal(r.verdict, 'mismatch');
  assert.equal(status(r, 'ci'), 'ok');
  assert.equal(status(r, 'deployed'), 'fail');
  assert.match(r.summary, /на сайте коммит 3b7a0c9, ожидается 9f2c1ab/);
  assert.equal(r.deployed.info?.commit, DEMO_STALE);
});

test('ci-red: сайт обновлён, но CI упал', async () => {
  const r = await collect(base('ci-red'));
  assert.equal(r.verdict, 'mismatch');
  assert.equal(status(r, 'deployed'), 'ok');
  assert.equal(status(r, 'ci'), 'fail');
  assert.match(r.summary, /CI красный/);
});

test('unreachable: недоступный сайт даёт unverifiable, а не mismatch', async () => {
  const r = await collect(base('unreachable'));
  assert.equal(r.verdict, 'unverifiable');
  assert.equal(r.deployed.httpStatus, 503);
  assert.match(r.summary, /HTTP 503/);
});

test('без репозитория CI пропускается, вердикт зависит от сайта', async () => {
  const r = await collect(base('match', { repo: undefined }));
  assert.equal(status(r, 'ci'), 'skip');
  assert.equal(r.verdict, 'match');
  assert.equal(r.ci, null);
});

test('без ожидаемого коммита проверить нельзя', async () => {
  const r = await collect(base('match', { expected: undefined }));
  assert.equal(r.verdict, 'unverifiable');
  assert.equal(status(r, 'expected'), 'error');
});

test('workflow: нужный workflow отсутствует или красный', async () => {
  const missing = await collect(base('match', { workflows: ['Deploy'] }));
  assert.equal(status(missing, 'ci'), 'error');
  assert.equal(missing.verdict, 'unverifiable');
  const named = await collect(base('match', { workflows: ['ci'] }));
  assert.equal(status(named, 'ci'), 'ok');
  const red = await collect(base('ci-red', { workflows: ['CI'] }));
  assert.equal(status(red, 'ci'), 'fail');
});

test('ошибка GitHub API даёт error с подсказкой про токен', async () => {
  const fetchImpl = (async (u: RequestInfo | URL) =>
    String(u).includes('api.github.com') ? new Response('rate limit', { status: 403 }) : scenarioFetch('match')(u)) as typeof fetch;
  const r = await collect(base('match', { fetchImpl }));
  assert.equal(status(r, 'ci'), 'error');
  assert.match(r.summary, /GITHUB_TOKEN/);
});

test('мусор вместо version.json даёт unverifiable', async () => {
  const fetchImpl = (async () => new Response('<html>stub</html>', { status: 200 })) as typeof fetch;
  const r = await collect(base('match', { repo: undefined, fetchImpl }));
  assert.equal(r.verdict, 'unverifiable');
  assert.match(r.summary, /не является корректным JSON/);
});

test('сетевая ошибка объясняется адресом и кодом, а не «fetch failed»', async () => {
  const fetchImpl = (async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  }) as typeof fetch;
  const r = await collect(base('match', { repo: undefined, fetchImpl }));
  assert.equal(r.verdict, 'unverifiable');
  assert.match(r.summary, /не удалось получить https:\/\/demo\.example\/shop\/version\.json \(ENOTFOUND\)/);
});

test('verify ждёт: сначала старый коммит, затем новый', async () => {
  let t = 0;
  let version = 0;
  const fetchImpl = (async (u: RequestInfo | URL) => {
    if (String(u).includes('version.json')) {
      version++;
      const commit = version < 3 ? DEMO_STALE : DEMO_EXPECTED; // деплой «доезжает» на третьей попытке
      return new Response(JSON.stringify({ commit }), { status: 200 });
    }
    return scenarioFetch('match')(u);
  }) as typeof fetch;
  const sleeps: number[] = [];
  const r = await verify(
    base('match', {
      fetchImpl,
      now: () => t,
      waitSec: 60,
      intervalSec: 5,
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
    }),
  );
  assert.equal(r.verdict, 'match');
  assert.equal(version, 3);
  assert.deepEqual(sleeps, [5000, 5000]);
});

test('verify сдаётся по истечении времени и возвращает последнюю квитанцию', async () => {
  let t = 0;
  const r = await verify(
    base('stale', {
      now: () => t,
      waitSec: 12,
      intervalSec: 5,
      sleep: async (ms) => {
        t += ms;
      },
    }),
  );
  assert.equal(r.verdict, 'mismatch');
  assert.ok(t >= 12_000 && t <= 15_000, `ожидание вышло за рамки: ${t}`);
});
