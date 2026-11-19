// Пример квитанции для релиза: сценарий «Сайт отстаёт» на вымышленных данных.
import { writeFileSync } from 'node:fs';
import { DEMO_EXPECTED, DEMO_REPO, DEMO_SITE, scenarioFetch } from '../src/scenarios.ts';
import { verify } from '../src/verify.ts';

const receipt = await verify({
  site: DEMO_SITE,
  repo: DEMO_REPO,
  workflows: ['CI'],
  expected: { sha: DEMO_EXPECTED, source: 'пример' },
  fetchImpl: scenarioFetch('stale'),
  now: () => Date.parse('2026-11-19T09:00:00Z'),
});
const out = process.argv[2] ?? 'example-receipt.json';
writeFileSync(out, JSON.stringify(receipt, null, 2) + '\n');
console.log(`${out}: ${receipt.verdict}`);
