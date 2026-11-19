// Вымышленные сценарии для демо и тестов: подменяют fetch, сеть не нужна.
// Данные не относятся к реальным сайтам или репозиториям.

export type ScenarioId = 'match' | 'stale' | 'ci-red' | 'unreachable';

export const DEMO_SITE = 'https://demo.example/shop/';
export const DEMO_REPO = 'acme/shop';
export const DEMO_EXPECTED = '9f2c1ab4d7e0836b5c4a12ef90d3b7a8c61e5f04';
export const DEMO_STALE = '3b7a0c91e5d24f68a1b90c7d5e3f2a41b6c8d9e0';

export const SCENARIOS: Record<ScenarioId, { title: string; about: string }> = {
  match: { title: 'Всё совпадает', about: 'Сайт отдаёт ожидаемый коммит, CI зелёный.' },
  stale: { title: 'Сайт отстаёт', about: 'CI зелёный, но на сайте остался предыдущий коммит: деплой не доехал.' },
  'ci-red': { title: 'CI красный', about: 'Сайт обновлён, но тесты для этого коммита упали.' },
  unreachable: { title: 'Сайт недоступен', about: 'version.json не отвечает: проверить выпуск невозможно.' },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function scenarioFetch(id: ScenarioId): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.origin === 'https://demo.example' && url.pathname === '/shop/version.json') {
      if (id === 'unreachable') return new Response('Service Unavailable', { status: 503 });
      const commit = id === 'stale' ? DEMO_STALE : DEMO_EXPECTED;
      return json({ commit, version: '2.4.1', builtAt: '2026-11-19T09:00:00Z', repo: DEMO_REPO });
    }
    if (url.origin === 'https://api.github.com' && url.pathname === `/repos/${DEMO_REPO}/actions/runs`) {
      const ok = id !== 'ci-red';
      return json({
        workflow_runs: [
          {
            id: 1001,
            name: 'CI',
            status: 'completed',
            conclusion: ok ? 'success' : 'failure',
            html_url: `https://github.com/${DEMO_REPO}/actions/runs/1001`,
            head_sha: DEMO_EXPECTED,
          },
        ],
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}
