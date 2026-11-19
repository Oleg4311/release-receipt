// Скриншот для README: сценарий «Сайт отстаёт».
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const url = process.env.BASE_URL ?? 'http://127.0.0.1:4175/';
mkdirSync('docs', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 860, height: 900 }, colorScheme: 'light' });
await page.goto(url);
await page.getByTestId('scenario-stale').click();
await page.getByTestId('verdict').waitFor();
await page.screenshot({ path: 'docs/screenshot.png', fullPage: true });
await browser.close();
console.log('docs/screenshot.png');
