// Сверка: ожидаемый коммит, результат CI и то, что реально отдаёт сайт.
import {
  SCHEMA,
  decide,
  normalizeSha,
  parseVersionJson,
  shaMatches,
  short,
  summarize,
  type Check,
  type CiRun,
  type Receipt,
  type VersionInfo,
} from './core.ts';
import { fetchRuns, type ApiOptions } from './github.ts';

export interface VerifyOptions extends ApiOptions {
  site: string;
  versionPath?: string;
  /** Коммит, который должен быть выпущен, и откуда он взят. */
  expected?: { sha: string | null; source: string };
  repo?: string;
  /** Имена workflow, которые обязаны завершиться успехом. Без списка достаточно одного успешного запуска. */
  workflows?: string[];
  /** Сколько секунд повторять проверку, пока вердикт не станет match. */
  waitSec?: number;
  intervalSec?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function checkCi(runs: CiRun[], workflows: string[] | undefined): Check {
  const failed = (r: CiRun) => r.status === 'completed' && r.conclusion !== 'success' && r.conclusion !== 'skipped';
  if (runs.length === 0) return { id: 'ci', status: 'error', detail: 'для коммита нет запусков CI (возможно, ещё не начался)' };

  const names = workflows?.length ? workflows : null;
  if (!names) {
    if (runs.some((r) => r.status === 'completed' && r.conclusion === 'failure')) {
      const bad = runs.find((r) => r.conclusion === 'failure')!;
      return { id: 'ci', status: 'fail', detail: `CI красный: ${bad.workflow} (${bad.url})` };
    }
    if (runs.some((r) => r.status === 'completed' && r.conclusion === 'success')) {
      return { id: 'ci', status: 'ok', detail: `успешных запусков: ${runs.filter((r) => r.conclusion === 'success').length}` };
    }
    return { id: 'ci', status: 'error', detail: 'CI ещё выполняется' };
  }

  const parts: string[] = [];
  let status: Check['status'] = 'ok';
  for (const name of names) {
    const mine = runs.filter((r) => r.workflow.toLowerCase() === name.toLowerCase());
    if (mine.length === 0) {
      parts.push(`${name}: запусков нет`);
      if (status !== 'fail') status = 'error';
      continue;
    }
    const latest = mine.reduce((a, b) => (b.id > a.id ? b : a));
    if (latest.status !== 'completed') {
      parts.push(`${name}: ещё выполняется`);
      if (status !== 'fail') status = 'error';
    } else if (latest.conclusion === 'success') {
      parts.push(`${name}: успех`);
    } else if (failed(latest)) {
      parts.push(`${name}: ${latest.conclusion} (${latest.url})`);
      status = 'fail';
    } else {
      parts.push(`${name}: ${latest.conclusion}`);
    }
  }
  return { id: 'ci', status, detail: parts.join('; ') };
}

/** Один проход проверки. */
export async function collect(o: VerifyOptions): Promise<Receipt> {
  const now = o.now ?? Date.now;
  const f = o.fetchImpl ?? fetch;
  const checks: Check[] = [];
  const siteUrl = new URL(o.site.endsWith('/') ? o.site : o.site + '/');
  const versionUrl = new URL(o.versionPath ?? 'version.json', siteUrl).toString();
  const expected = o.expected ?? { sha: null, source: 'не задан' };
  const expSha = normalizeSha(expected.sha);

  checks.push(
    expSha
      ? { id: 'expected', status: 'ok', detail: `${short(expSha)} (источник: ${expected.source})` }
      : { id: 'expected', status: 'error', detail: 'не задан ожидаемый коммит' },
  );

  let ci: Receipt['ci'] = null;
  if (o.repo && expSha) {
    try {
      const runs = await fetchRuns(o.repo, expSha, o);
      ci = { runs };
      checks.push(checkCi(runs, o.workflows));
    } catch (e) {
      checks.push({ id: 'ci', status: 'error', detail: (e as Error).message });
    }
  } else {
    checks.push({ id: 'ci', status: 'skip', detail: o.repo ? 'нет ожидаемого коммита' : 'репозиторий не указан, CI не проверялся' });
  }

  const deployed: Receipt['deployed'] = { httpStatus: null, info: null, error: null };
  try {
    const bust = `${versionUrl}${versionUrl.includes('?') ? '&' : '?'}_rr=${now()}`;
    const res = await f(bust, { cache: 'no-store' });
    deployed.httpStatus = res.status;
    if (!res.ok) throw new Error(`сайт вернул HTTP ${res.status} для ${versionUrl}`);
    const info: VersionInfo = parseVersionJson(await res.text());
    deployed.info = info;
    if (!expSha) checks.push({ id: 'deployed', status: 'error', detail: `на сайте коммит ${short(info.commit)}, сравнить не с чем` });
    else if (shaMatches(info.commit, expSha)) checks.push({ id: 'deployed', status: 'ok', detail: `на сайте коммит ${short(info.commit)}` });
    else checks.push({ id: 'deployed', status: 'fail', detail: `на сайте коммит ${short(info.commit)}, ожидается ${short(expSha)}` });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    deployed.error =
      err.message === 'fetch failed'
        ? `не удалось получить ${versionUrl}${err.cause?.code ? ` (${err.cause.code})` : ''}`
        : err.message;
    checks.push({ id: 'deployed', status: 'error', detail: deployed.error });
  }

  const verdict = decide(checks);
  return {
    schema: SCHEMA,
    checkedAt: new Date(now()).toISOString(),
    site: siteUrl.toString(),
    versionUrl,
    repo: o.repo ?? null,
    expected: { sha: expSha, source: expected.source },
    ci,
    deployed,
    checks,
    verdict,
    summary: summarize(verdict, expSha, checks),
  };
}

/** Проверка с ожиданием: повторяет проход, пока не получится match или не истечёт время. */
export async function verify(o: VerifyOptions): Promise<Receipt> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? defaultSleep;
  const deadline = now() + (o.waitSec ?? 0) * 1000;
  let receipt = await collect(o);
  while (receipt.verdict !== 'match' && (o.waitSec ?? 0) > 0 && now() < deadline) {
    await sleep((o.intervalSec ?? 5) * 1000);
    receipt = await collect(o);
  }
  return receipt;
}
