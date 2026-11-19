import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('run')).toBeVisible();
});

test('сценарий «Всё совпадает»', async ({ page }) => {
  await page.getByTestId('scenario-match').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', 'match');
  await expect(page.getByTestId('check-ci')).toHaveAttribute('data-status', 'ok');
  await expect(page.getByTestId('check-deployed')).toHaveAttribute('data-status', 'ok');
});

test('сценарий «Сайт отстаёт»: видны оба коммита', async ({ page }) => {
  await page.getByTestId('scenario-stale').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', 'mismatch');
  await expect(page.getByTestId('check-ci')).toHaveAttribute('data-status', 'ok');
  await expect(page.getByTestId('check-deployed')).toHaveAttribute('data-status', 'fail');
  await expect(page.getByTestId('summary')).toContainText('на сайте коммит 3b7a0c9, ожидается 9f2c1ab');
});

test('сценарий «CI красный»', async ({ page }) => {
  await page.getByTestId('scenario-ci-red').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', 'mismatch');
  await expect(page.getByTestId('check-ci')).toHaveAttribute('data-status', 'fail');
  await expect(page.getByTestId('check-deployed')).toHaveAttribute('data-status', 'ok');
});

test('сценарий «Сайт недоступен»: не расхождение, а невозможность проверить', async ({ page }) => {
  await page.getByTestId('scenario-unreachable').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', 'unverifiable');
  await expect(page.getByTestId('summary')).toContainText('HTTP 503');
});

test('квитанция — валидный JSON со схемой', async ({ page }) => {
  await page.getByTestId('scenario-stale').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', 'mismatch'); // ждём, пока проверка завершится
  const receipt = JSON.parse(await page.getByTestId('receipt-json').innerText());
  expect(receipt.schema).toBe('release-receipt/1');
  expect(receipt.verdict).toBe('mismatch');
  expect(receipt.checks.map((c: { id: string }) => c.id)).toEqual(['expected', 'ci', 'deployed']);
});

// Реальная проверка: сайт отдаёт собственный version.json, а страница сверяет его в браузере.
test('сайт сверяет сам себя: version.json совпадает с введённым коммитом', async ({ page, baseURL }) => {
  const res = await page.request.get('version.json');
  expect(res.status()).toBe(200);
  const info = await res.json();
  expect(info.commit).toMatch(/^[0-9a-f]{40}$/);

  await page.getByTestId('fill-self').click();
  await page.locator('#repo').fill(''); // CI не проверяем: тест не должен зависеть от GitHub API
  await page.locator('#site').fill(baseURL!);
  await page.locator('#sha').fill(info.commit);
  await page.getByTestId('run').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', 'match');
  await expect(page.getByTestId('check-ci')).toHaveAttribute('data-status', 'skip');
});

test('чужой коммит даёт расхождение, а не успех', async ({ page, baseURL }) => {
  await page.locator('#site').fill(baseURL!);
  await page.locator('#sha').fill('0123456789abcdef0123456789abcdef01234567');
  await page.getByTestId('run').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', 'mismatch');
  await expect(page.getByTestId('check-deployed')).toHaveAttribute('data-status', 'fail');
});

test('валидация формы', async ({ page }) => {
  await page.locator('#site').fill('не адрес');
  await page.getByTestId('run').click(); // type=url блокирует submit в браузере
  await expect(page.getByTestId('verdict')).toBeHidden();

  await page.locator('#site').fill('https://example.com/');
  await page.locator('#sha').fill('main');
  await page.getByTestId('run').click();
  await expect(page.getByTestId('error')).toContainText('7–40 шестнадцатеричных');

  await page.locator('#sha').fill('');
  await page.getByTestId('run').click();
  await expect(page.getByTestId('error')).toContainText('Укажите ожидаемый коммит');
});
