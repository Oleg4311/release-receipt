#!/usr/bin/env node
// CLI: release-receipt verify <url> | stamp
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { normalizeSha } from './core.ts';
import { exitCode, renderText } from './render.ts';
import { verify } from './verify.ts';

declare const __VERSION__: string | undefined;

const HELP = `release-receipt — сверка коммита, CI и развёрнутой версии

Использование:
  release-receipt verify <url-сайта> [параметры]
  release-receipt stamp [--out version.json] [--app-version X]

verify проверяет, что сайт отдаёт version.json с ожидаемым коммитом, а CI для этого коммита успешен.
Параметры verify:
  --sha <sha>            ожидаемый коммит (иначе GITHUB_SHA, иначе git HEAD)
  --repo <owner/name>    репозиторий для проверки CI через GitHub API
  --workflow <имя>       workflow, который обязан быть успешным (можно несколько раз)
  --version-path <путь>  путь к version.json относительно сайта (по умолчанию version.json)
  --wait <сек>           повторять проверку до совпадения, не дольше этого времени
  --interval <сек>       пауза между повторами (по умолчанию 5)
  --out <файл>           сохранить JSON-квитанцию
  --json                 печатать квитанцию в JSON вместо текста
  --api-base <url>       адрес GitHub API (по умолчанию https://api.github.com)
Токен для API берётся из GITHUB_TOKEN или GH_TOKEN.

stamp создаёт version.json (commit, version, builtAt, repo, runId) для публикации вместе с сайтом.

Коды выхода: 0 совпало, 1 расхождение, 2 проверить не удалось или ошибка использования.`;

function version(): string {
  if (typeof __VERSION__ === 'string') return __VERSION__;
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
}

function gitHead(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function resolveExpected(flag: string | undefined, env: NodeJS.ProcessEnv): { sha: string | null; source: string } {
  if (flag !== undefined) {
    const sha = normalizeSha(flag);
    if (!sha) throw new Error(`--sha «${flag}» не похож на SHA коммита (7–40 hex-символов)`);
    return { sha, source: '--sha' };
  }
  const fromEnv = normalizeSha(env.GITHUB_SHA);
  if (fromEnv) return { sha: fromEnv, source: 'GITHUB_SHA' };
  const head = normalizeSha(gitHead());
  if (head) return { sha: head, source: 'git HEAD' };
  throw new Error('не удалось определить ожидаемый коммит: укажите --sha');
}

async function runVerify(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      sha: { type: 'string' },
      repo: { type: 'string' },
      workflow: { type: 'string', multiple: true },
      'version-path': { type: 'string' },
      wait: { type: 'string' },
      interval: { type: 'string' },
      out: { type: 'string' },
      json: { type: 'boolean' },
      'api-base': { type: 'string' },
    },
  });
  const site = positionals[0];
  if (!site) throw new Error('укажите адрес сайта: release-receipt verify https://example.com/');
  try {
    new URL(site);
  } catch {
    throw new Error(`«${site}» не похоже на URL`);
  }
  const num = (v: string | undefined, name: string, def: number) => {
    if (v === undefined) return def;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} должен быть неотрицательным числом`);
    return n;
  };
  const receipt = await verify({
    site,
    versionPath: values['version-path'],
    expected: resolveExpected(values.sha, env),
    repo: values.repo,
    workflows: values.workflow,
    waitSec: num(values.wait, 'wait', 0),
    intervalSec: num(values.interval, 'interval', 5),
    apiBase: values['api-base'],
    token: env.GITHUB_TOKEN || env.GH_TOKEN,
  });
  if (values.out) writeFileSync(values.out, JSON.stringify(receipt, null, 2) + '\n');
  console.log(values.json ? JSON.stringify(receipt, null, 2) : renderText(receipt));
  return exitCode(receipt.verdict);
}

function runStamp(argv: string[], env: NodeJS.ProcessEnv): number {
  const { values } = parseArgs({
    args: argv,
    options: { out: { type: 'string' }, 'app-version': { type: 'string' } },
  });
  const sha = normalizeSha(env.GITHUB_SHA) ?? normalizeSha(gitHead());
  if (!sha) throw new Error('не удалось определить коммит: нет GITHUB_SHA и git HEAD');
  let appVersion = values['app-version'];
  if (appVersion === undefined && existsSync('package.json')) {
    appVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
  }
  const epoch = Number(env.SOURCE_DATE_EPOCH);
  const builtAt = new Date(Number.isFinite(epoch) && env.SOURCE_DATE_EPOCH ? epoch * 1000 : Date.now()).toISOString();
  const stamp: Record<string, string> = { commit: sha, builtAt };
  if (appVersion) stamp.version = appVersion;
  if (env.GITHUB_REPOSITORY) stamp.repo = env.GITHUB_REPOSITORY;
  if (env.GITHUB_RUN_ID) stamp.runId = env.GITHUB_RUN_ID;
  const out = values.out ?? 'version.json';
  writeFileSync(out, JSON.stringify(stamp, null, 2) + '\n');
  console.log(`Записан ${out}: коммит ${sha.slice(0, 7)}`);
  return 0;
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
      console.log(HELP);
      return cmd ? 0 : 2;
    }
    if (cmd === '--version' || cmd === '-v') {
      console.log(`release-receipt ${version()}`);
      return 0;
    }
    if (cmd === 'verify') return await runVerify(rest, process.env);
    if (cmd === 'stamp') return runStamp(rest, process.env);
    throw new Error(`неизвестная команда «${cmd}», см. --help`);
  } catch (e) {
    console.error(`release-receipt: ${(e as Error).message}`);
    return 2;
  }
}

process.exitCode = await main();
