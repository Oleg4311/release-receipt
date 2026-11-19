// Запросы к GitHub API. fetch подменяется, поэтому в тестах и в демо сеть не нужна.
import type { CiRun } from './core.ts';

export interface ApiOptions {
  apiBase?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

async function api(path: string, o: ApiOptions): Promise<unknown> {
  const base = (o.apiBase ?? 'https://api.github.com').replace(/\/+$/, '');
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  const res = await (o.fetchImpl ?? fetch)(`${base}${path}`, { headers });
  if (!res.ok) {
    const hint = res.status === 403 || res.status === 429 ? ' (возможно, исчерпан лимит запросов, задайте GITHUB_TOKEN)' : '';
    throw new Error(`GitHub API ${res.status} для ${path}${hint}`);
  }
  return res.json();
}

/** Завершённые и текущие запуски workflow для коммита. */
export async function fetchRuns(repo: string, sha: string, o: ApiOptions): Promise<CiRun[]> {
  const data = (await api(`/repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`, o)) as {
    workflow_runs?: Array<Record<string, unknown>>;
  };
  return (data.workflow_runs ?? []).map((r) => ({
    id: Number(r.id),
    workflow: String(r.name ?? ''),
    status: String(r.status ?? ''),
    conclusion: r.conclusion === null || r.conclusion === undefined ? null : String(r.conclusion),
    url: String(r.html_url ?? ''),
    headSha: String(r.head_sha ?? ''),
  }));
}

/** Полный SHA последнего коммита ветки или ref. */
export async function fetchCommitSha(repo: string, ref: string, o: ApiOptions): Promise<string> {
  const data = (await api(`/repos/${repo}/commits/${encodeURIComponent(ref)}`, o)) as { sha?: string };
  if (!data.sha) throw new Error(`GitHub не вернул SHA для ${repo}@${ref}`);
  return data.sha;
}
