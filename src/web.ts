// Веб-демо: те же verify() и core, что и в CLI, только в браузере.
import { normalizeSha, type Receipt } from './core.ts';
import { fetchCommitSha } from './github.ts';
import { DEMO_EXPECTED, DEMO_REPO, DEMO_SITE, SCENARIOS, scenarioFetch, type ScenarioId } from './scenarios.ts';
import { verify } from './verify.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const SELF_REPO = 'Oleg4311/release-receipt';
const VERDICT = { match: 'Совпадает', mismatch: 'Не совпадает', unverifiable: 'Проверить не удалось' } as const;
const TITLE = { expected: 'Ожидаемый коммит', ci: 'CI', deployed: 'Развёрнутая версия' } as const;
const MARK = { ok: '✓', fail: '✗', error: '?', skip: '–' } as const;

let current: Receipt | null = null;

function show(r: Receipt, demo: boolean) {
  current = r;
  $('error').hidden = true;
  $('result').hidden = false;
  const v = $('verdict');
  v.textContent = VERDICT[r.verdict];
  v.dataset.verdict = r.verdict;
  $('demo-note').textContent = demo ? 'Демо-сценарий: данные вымышленные.' : '';
  $('summary').textContent = r.summary;
  $('checks').innerHTML = r.checks
    .map(
      (c) =>
        `<li data-testid="check-${c.id}" data-status="${c.status}"><span class="m" aria-hidden="true">${MARK[c.status]}</span><b>${TITLE[c.id]}</b><span>${esc(c.detail)}</span></li>`,
    )
    .join('');
  $('json').textContent = JSON.stringify(r, null, 2);
}

function fail(message: string) {
  const e = $('error');
  e.textContent = message;
  e.hidden = false;
}

async function runScenario(id: ScenarioId) {
  const receipt = await verify({
    site: DEMO_SITE,
    repo: DEMO_REPO,
    workflows: ['CI'],
    expected: { sha: DEMO_EXPECTED, source: 'демо-сценарий' },
    fetchImpl: scenarioFetch(id),
  });
  show(receipt, true);
}

async function runForm() {
  const site = $<HTMLInputElement>('site').value.trim();
  const repo = $<HTMLInputElement>('repo').value.trim() || undefined;
  const shaRaw = $<HTMLInputElement>('sha').value.trim();
  const workflows = $<HTMLInputElement>('workflows')
    .value.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    new URL(site);
  } catch {
    return fail('Введите корректный адрес сайта, например https://example.github.io/app/');
  }
  let expected: { sha: string | null; source: string };
  try {
    if (shaRaw) {
      const sha = normalizeSha(shaRaw);
      if (!sha) return fail('Коммит должен состоять из 7–40 шестнадцатеричных символов.');
      expected = { sha, source: 'введён вручную' };
    } else if (repo) {
      expected = { sha: await fetchCommitSha(repo, 'main', {}), source: `последний коммит main ${repo}` };
    } else {
      return fail('Укажите ожидаемый коммит или репозиторий, чтобы взять последний коммит main.');
    }
  } catch (e) {
    return fail((e as Error).message);
  }
  const receipt = await verify({ site, repo, workflows: workflows.length ? workflows : undefined, expected });
  show(receipt, false);
}

function init() {
  $('scen').innerHTML = (Object.keys(SCENARIOS) as ScenarioId[])
    .map((id) => `<button type="button" data-testid="scenario-${id}" data-id="${id}">${esc(SCENARIOS[id].title)}<small>${esc(SCENARIOS[id].about)}</small></button>`)
    .join('');
  $('scen').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b) void runScenario(b.dataset.id as ScenarioId);
  });
  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    void runForm();
  });
  $('self').addEventListener('click', () => {
    $<HTMLInputElement>('site').value = new URL('./', location.href).toString();
    $<HTMLInputElement>('repo').value = SELF_REPO;
    $<HTMLInputElement>('sha').value = '';
  });
  $('copy').addEventListener('click', async () => {
    if (current) await navigator.clipboard.writeText(JSON.stringify(current, null, 2));
  });
  $('download').addEventListener('click', () => {
    if (!current) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2) + '\n'], { type: 'application/json' }));
    a.download = 'receipt.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

init();
