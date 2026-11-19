// Чистая логика квитанции: типы, сравнение коммитов, разбор version.json, вердикт.
// Здесь нет сети и файловой системы, поэтому код одинаково работает в CLI и в браузере.

export const SCHEMA = 'release-receipt/1';

export type CheckStatus = 'ok' | 'fail' | 'error' | 'skip';
/** ok: проверка пройдена; fail: найдено расхождение; error: определить не удалось; skip: не запрашивалась. */
export interface Check {
  id: 'expected' | 'ci' | 'deployed';
  status: CheckStatus;
  detail: string;
}

export type Verdict = 'match' | 'mismatch' | 'unverifiable';

export interface VersionInfo {
  commit: string;
  version?: string;
  builtAt?: string;
  repo?: string;
  runId?: string;
}

export interface CiRun {
  id: number;
  workflow: string;
  status: string;
  conclusion: string | null;
  url: string;
  headSha: string;
}

export interface Receipt {
  schema: typeof SCHEMA;
  checkedAt: string;
  site: string;
  versionUrl: string;
  repo: string | null;
  expected: { sha: string | null; source: string };
  ci: { runs: CiRun[] } | null;
  deployed: { httpStatus: number | null; info: VersionInfo | null; error: string | null };
  checks: Check[];
  verdict: Verdict;
  summary: string;
}

/** Приводит строку к нижнему регистру и проверяет, что это 7–40 hex-символов. */
export function normalizeSha(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(s) ? s : null;
}

/** Коммиты совпадают, если один является префиксом другого (короткий SHA от 7 символов). */
export function shaMatches(a: unknown, b: unknown): boolean {
  const x = normalizeSha(a);
  const y = normalizeSha(b);
  if (!x || !y) return false;
  return x.startsWith(y) || y.startsWith(x);
}

export const short = (sha: string | null | undefined): string => (sha ? sha.slice(0, 7) : '—');

/** Разбирает version.json. Коммит берётся из commit, sha или gitCommit. */
export function parseVersionJson(text: string): VersionInfo {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('version.json не является корректным JSON');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('version.json должен быть объектом');
  }
  const o = data as Record<string, unknown>;
  const commit = [o.commit, o.sha, o.gitCommit].map(normalizeSha).find((x) => x !== null);
  if (!commit) throw new Error('в version.json нет поля commit (7–40 hex-символов)');
  const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : undefined);
  return {
    commit,
    version: str(o.version),
    builtAt: str(o.builtAt),
    repo: str(o.repo),
    runId: str(o.runId),
  };
}

/** fail важнее error: найденное расхождение нельзя заменить «не удалось проверить». */
export function decide(checks: Check[]): Verdict {
  if (checks.some((c) => c.status === 'fail')) return 'mismatch';
  if (checks.some((c) => c.status === 'error')) return 'unverifiable';
  const deployed = checks.find((c) => c.id === 'deployed');
  return deployed?.status === 'ok' ? 'match' : 'unverifiable';
}

export function summarize(verdict: Verdict, expected: string | null, checks: Check[]): string {
  if (verdict === 'match') return `Совпадает: на сайте выпущен коммит ${short(expected)}, CI подтверждён.`;
  const bad = checks.filter((c) => c.status === 'fail' || c.status === 'error').map((c) => c.detail);
  const head = verdict === 'mismatch' ? 'Не совпадает' : 'Проверить не удалось';
  return `${head}: ${bad.join('; ')}`;
}
