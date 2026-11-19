// Текстовое представление квитанции для терминала.
import type { Receipt } from './core.ts';

const MARK = { ok: '✓', fail: '✗', error: '?', skip: '–' } as const;
const TITLE = { expected: 'Ожидаемый коммит', ci: 'CI', deployed: 'Развёрнутая версия' } as const;
const VERDICT = { match: 'СОВПАДАЕТ', mismatch: 'НЕ СОВПАДАЕТ', unverifiable: 'ПРОВЕРИТЬ НЕ УДАЛОСЬ' } as const;

export function renderText(r: Receipt): string {
  const lines = [`Квитанция выпуска: ${r.site}`];
  for (const c of r.checks) lines.push(`  ${MARK[c.status]} ${TITLE[c.id]}: ${c.detail}`);
  lines.push('', `Вердикт: ${VERDICT[r.verdict]}`, r.summary);
  return lines.join('\n');
}

/** Код выхода процесса по вердикту: 0 совпало, 1 расхождение, 2 не удалось проверить. */
export const exitCode = (v: Receipt['verdict']): number => (v === 'match' ? 0 : v === 'mismatch' ? 1 : 2);
