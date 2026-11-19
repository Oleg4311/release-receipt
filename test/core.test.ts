import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, normalizeSha, parseVersionJson, shaMatches, summarize, type Check } from '../src/core.ts';

const FULL = '9f2c1ab4d7e0836b5c4a12ef90d3b7a8c61e5f04';

test('normalizeSha принимает 7–40 hex и приводит к нижнему регистру', () => {
  assert.equal(normalizeSha(' 9F2C1AB '), '9f2c1ab');
  assert.equal(normalizeSha(FULL), FULL);
  for (const bad of ['', '9f2c1a', 'xyz1234', FULL + '0', null, undefined, 42]) assert.equal(normalizeSha(bad), null);
});

test('shaMatches: префикс считается совпадением, разные коммиты нет', () => {
  assert.ok(shaMatches(FULL, '9f2c1ab'));
  assert.ok(shaMatches('9F2C1AB', FULL));
  assert.ok(!shaMatches(FULL, '9f2c1ac'));
  assert.ok(!shaMatches(FULL, 'zzz'));
  assert.ok(!shaMatches(null, FULL));
});

test('parseVersionJson: commit, sha и gitCommit, лишние поля игнорируются', () => {
  assert.deepEqual(parseVersionJson(JSON.stringify({ commit: FULL, version: '1.2.3' })), {
    commit: FULL,
    version: '1.2.3',
    builtAt: undefined,
    repo: undefined,
    runId: undefined,
  });
  assert.equal(parseVersionJson(JSON.stringify({ sha: FULL })).commit, FULL);
  assert.equal(parseVersionJson(JSON.stringify({ gitCommit: FULL })).commit, FULL);
});

test('parseVersionJson: понятные ошибки', () => {
  assert.throws(() => parseVersionJson('<html>'), /не является корректным JSON/);
  assert.throws(() => parseVersionJson('[]'), /должен быть объектом/);
  assert.throws(() => parseVersionJson('{"commit":"main"}'), /нет поля commit/);
});

const c = (id: Check['id'], status: Check['status']): Check => ({ id, status, detail: `${id}:${status}` });

test('decide: fail важнее error, match только при успешном deployed', () => {
  assert.equal(decide([c('expected', 'ok'), c('ci', 'ok'), c('deployed', 'ok')]), 'match');
  assert.equal(decide([c('expected', 'ok'), c('ci', 'skip'), c('deployed', 'ok')]), 'match');
  assert.equal(decide([c('expected', 'ok'), c('ci', 'error'), c('deployed', 'fail')]), 'mismatch');
  assert.equal(decide([c('expected', 'ok'), c('ci', 'fail'), c('deployed', 'ok')]), 'mismatch');
  assert.equal(decide([c('expected', 'ok'), c('ci', 'ok'), c('deployed', 'error')]), 'unverifiable');
  assert.equal(decide([c('expected', 'ok'), c('ci', 'ok'), c('deployed', 'skip')]), 'unverifiable');
});

test('summarize перечисляет причины', () => {
  const s = summarize('mismatch', FULL, [c('ci', 'fail'), c('deployed', 'fail')]);
  assert.match(s, /^Не совпадает: ci:fail; deployed:fail$/);
  assert.match(summarize('match', FULL, []), /9f2c1ab/);
});
