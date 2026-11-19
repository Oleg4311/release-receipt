import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Доступность: нет серьёзных и критических нарушений WCAG 2.1 AA в светлой и тёмной теме на всех состояниях страницы.
for (const scheme of ['light', 'dark'] as const) {
  test(`axe: ${scheme === 'light' ? 'светлая' : 'тёмная'} тема`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('./');
    const check = async (label: string) => {
      const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => `${v.id}: ${v.nodes[0]?.html}`), label).toEqual([]);
    };
    await check('начальный экран');
    for (const id of ['match', 'stale', 'ci-red', 'unreachable']) {
      await page.getByTestId(`scenario-${id}`).click();
      await expect(page.getByTestId('verdict')).toBeVisible();
      await check(`сценарий ${id}`);
    }
    await page.locator('#site').fill('не адрес');
    await page.getByTestId('run').click();
    await check('форма с невалидным вводом');
  });
}

test('нет горизонтальной прокрутки на узком экране', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('./');
  await page.getByTestId('scenario-stale').click();
  await expect(page.getByTestId('verdict')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
