import { readFileSync } from 'node:fs';
import type { OpeningBook } from '../lib/analysis/openings';
import { analyzeForLibrary } from '../lib/analytics/analyze';
import { analysisSpec } from '../lib/analytics/model';
import { serializeAnalysis } from '../lib/analytics/transfer';
import { EnginePool } from '../lib/engine/stockfish';
import { nodeEngine } from '../scripts/support/node-engine';
import { expect, test, type Page } from '@playwright/test';
import { gameFixture, MATE } from '../tests/fixtures/analytics';

async function mockArchives(page: Page) {
  await page.route('https://api.chess.com/pub/player/testplayer/games/**', async (route) => {
    if (route.request().url().endsWith('/archives')) {
      return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: { archives: ['https://api.chess.com/pub/player/testplayer/games/2026/01'] } });
    }
    const games = [
      gameFixture(1), gameFixture(2), gameFixture(3, { timeClass: 'blitz' }),
      gameFixture(4, { pgn: 'invalid PGN' }),
    ].map((g) => ({
      url: `https://www.chess.com/game/live/${g.endTime}`, uuid: g.id.split(':')[1], pgn: g.pgn,
      end_time: g.endTime! / 1000, rules: 'chess', time_class: g.timeClass, time_control: g.timeControl, rated: g.rated,
      white: { username: g.white.name, rating: g.white.rating, result: 'win' },
      black: { username: g.black.name, rating: g.black.rating, result: 'checkmated' },
    }));
    return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: { games } });
  });
}

test('selects a sample, pauses, reloads, saves, filters, and retries an engine-backed position', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockArchives(page);
  // Hold the first worker until the batch is paused, independent of machine speed.
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/stockfish/stockfish.js', async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Bulk Analysis', exact: true }).click();
  await page.getByPlaceholder('Player handle').fill('TestPlayer');
  await expect(page.getByPlaceholder('Player handle')).toHaveValue('TestPlayer');
  await page.getByRole('combobox', { name: 'Time control', exact: true }).selectOption('rapid');
  await page.getByRole('button', { name: 'Fetch games' }).click();
  await expect(page.getByRole('button', { name: 'Analyze 3 selected' })).toBeEnabled();
  const entries = page.getByRole('checkbox', { name: /^Select Opponent/ });
  await expect(entries).toHaveCount(3);
  await entries.first().uncheck();
  await expect(page.getByRole('button', { name: 'Analyze 2 selected' })).toBeEnabled();
  await page.getByRole('combobox', { name: 'Analysis preset', exact: true }).selectOption('fast');
  await page.getByRole('combobox', { name: 'Engine workers', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Analyze 2 selected' }).click();
  await expect(page.getByText('Searching positions', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  release();

  await page.reload();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByText('2 saved · 0 reused · 0 failed', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'View results', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Player dashboard' })).toBeVisible();
  await expect(page.getByText('2 of 2 saved games', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
  await expect(page.getByRole('img', { name: 'Accuracy history chart' }).locator('canvas')).toBeVisible();
  await page.getByRole('combobox', { name: 'Color', exact: true }).selectOption('w');
  await expect(page.getByText('No analyzed games match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await page.getByRole('button', { name: 'Weaknesses', exact: true }).click();
  await expect(page.getByText('Allowed forced mates', { exact: false })).toBeVisible();
  await expect(page.getByText('2 positions across 2 of 2 games', { exact: false })).toBeVisible();

  let reviewEngineRequests = 0;
  await page.unroute('**/stockfish/stockfish.js');
  await page.route('**/stockfish/stockfish.js', (route) => { reviewEngineRequests++; return route.abort(); });
  await page.getByRole('button', { name: 'Review move', exact: true }).first().click();
  await expect(page).toHaveURL(/ply=5/);
  await expect(page.getByText(/allows checkmate in 1/i).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText(/allows checkmate in 1/i).first()).toBeVisible();
  await page.getByRole('button', { name: 'Back to games' }).click();
  await expect(page.getByRole('heading', { name: 'Weaknesses & training' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry position', exact: true }).first().click();
  await expect(page).toHaveURL(/retry=1/);
  await expect(page.getByText('Find a better move', { exact: true }).first()).toBeVisible();
  expect(reviewEngineRequests).toBe(0);
  expect(errors).toEqual([]);
});

test('retains the single-game PGN workflow', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'PGN / link', exact: true }).click();
  await page.locator('textarea').fill(MATE);
  await page.getByRole('button', { name: 'Review game', exact: true }).click();
  await expect(page.getByRole('button', { name: /^start review$/i }).first()).toBeVisible();
});

test('cancels a queued batch without starting a worker', async ({ page }) => {
  await mockArchives(page);
  await page.goto('/?view=bulk');
  await page.getByPlaceholder('Player handle').fill('TestPlayer');
  await page.getByRole('button', { name: 'Fetch games' }).click();
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/stockfish/stockfish.js', async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  await page.getByRole('button', { name: 'Analyze 4 selected' }).click();
  await page.getByRole('button', { name: 'Queue 4 selected' }).click();
  await expect(page.getByRole('button', { name: 'Start batch' })).toBeDisabled();
  // The active batch owns the engine; a queued job can be cancelled after it is released.
  await page.getByRole('combobox', { name: 'Batch', exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  release();
  await page.getByRole('combobox', { name: 'Batch', exact: true }).selectOption({ index: 0 });
  await page.getByRole('button', { name: 'Cancel batch', exact: true }).click();
  await expect(page.getByText('4 cancelled', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByText('4 cancelled', { exact: false })).toBeVisible();
});

test('imports the CLI format and keeps duplicate imports out of the sample', async ({ page }) => {
  const pool = new EnginePool(1, nodeEngine);
  let text: string;
  try {
    const book = JSON.parse(readFileSync('public/data/openings.json', 'utf8')) as OpeningBook;
    const result = await analyzeForLibrary(gameFixture(1), analysisSpec('fast'), pool, undefined, undefined, book);
    text = serializeAnalysis(result) + '\n' + serializeAnalysis(result) + '\n{}\n';
  } finally { pool.terminate(); }
  await page.goto('/?view=bulk');
  await page.getByLabel('Import analysis file').setInputFiles({
    name: 'games.jsonl', mimeType: 'application/x-ndjson', buffer: Buffer.from(text),
  });
  await expect(page.getByText('1 imported · 1 already saved · 1 invalid')).toBeVisible();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByText('1 of 1 saved games', { exact: false })).toBeVisible();
});
