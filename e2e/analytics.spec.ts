import { readFileSync } from 'node:fs';
import { buildReview } from '../lib/analysis/review';
import type { OpeningBook } from '../lib/analysis/openings';
import { analyzeForLibrary } from '../lib/analytics/analyze';
import { summarizeGame } from '../lib/analytics/metrics';
import { analysisSpec, type StoredSummary } from '../lib/analytics/model';
import { serializeAnalysis } from '../lib/analytics/transfer';
import { parseGame } from '../lib/games/pgn';
import { EnginePool } from '../lib/engine/stockfish';
import { nodeEngine } from '../scripts/support/node-engine';
import { expect, test, type Page } from '@playwright/test';
import { gameFixture, MATE } from '../tests/fixtures/analytics';

async function mockArchives(page: Page, user = 'testplayer') {
  const base = `https://api.chess.com/pub/player/${user}/games`;
  await page.route(`${base}/**`, async (route) => {
    if (route.request().url().endsWith('/archives')) {
      return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: { archives: [`${base}/2026/01`] } });
    }
    const source = user === 'testplayer' ? [
      gameFixture(1), gameFixture(2), gameFixture(3, { timeClass: 'blitz' }),
      gameFixture(4, { pgn: 'invalid PGN' }),
    ] : [gameFixture(6, { black: { name: 'OtherPlayer' } })];
    const games = source.map((g) => ({
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
  const library = page.locator('summary').filter({ hasText: 'Analyzed games', visible: true });
  await expect(library.getByText('2 games in this sample')).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search analyzed games' })).toBeHidden();
  await library.focus();
  await page.keyboard.press('Enter');
  const gameSearch = page.getByRole('searchbox', { name: 'Search analyzed games' });
  await gameSearch.fill('Opponent');
  await expect(page.getByRole('button', { name: /Review game vs Opponent/ })).toHaveCount(2);
  await page.getByText('Game stats', { exact: true }).first().click();
  await expect(page.getByText('Opponent accuracy', { exact: true }).filter({ visible: true })).toBeVisible();
  await library.click();
  await expect(gameSearch).toBeHidden();
  const conditions = page.getByRole('region', { name: 'Performance by condition' });
  await conditions.getByRole('button', { name: 'Time control', exact: true }).click();
  await expect(conditions.getByRole('heading', { name: 'Rapid' })).toBeVisible();
  await page.locator('summary').filter({ hasText: 'Analysis sample', visible: true }).click();
  await page.getByRole('combobox', { name: 'Color', exact: true }).selectOption('w');
  await expect(page.getByText('No analyzed games match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await page.getByRole('button', { name: 'Openings', exact: true }).click();
  const repertoire = page.getByRole('region', { name: 'Opening repertoire' });
  await repertoire.getByRole('spinbutton', { name: 'Minimum games' }).fill('1');
  await repertoire.locator('.opening-summary').first().click();
  await expect(repertoire.getByText('Opponent accuracy', { exact: true }).filter({ visible: true })).toBeVisible();
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
  await mockArchives(page);
  await page.goto('/?view=bulk');
  await page.getByPlaceholder('Player handle').fill('TestPlayer');
  await page.getByRole('button', { name: 'Fetch games' }).click();
  await expect(page.getByRole('button', { name: 'Deselect player' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Analysis preset' }).selectOption('fast');
  await page.getByLabel('Import analysis file').setInputFiles({
    name: 'games.jsonl', mimeType: 'application/x-ndjson', buffer: Buffer.from(text),
  });
  await expect(page.getByText('1 imported · 1 already saved · 1 invalid')).toBeVisible();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByText('1 of 1 saved games', { exact: false })).toBeVisible();
});

test('keeps one profile across tabs and includes independent reviews in the shared sample', async ({ page }) => {
  await mockArchives(page);
  await mockArchives(page, 'otherplayer');
  await page.goto('/?view=bulk');
  await page.getByPlaceholder('Player handle').fill('TestPlayer');
  await page.getByRole('combobox', { name: 'Time control', exact: true }).selectOption('rapid');
  await page.getByLabel('From (UTC)', { exact: true }).fill('2026-01-01');
  await page.getByLabel('Through (UTC)', { exact: true }).fill('2026-01-02');
  await page.getByRole('button', { name: 'Fetch games' }).click();
  await expect(page.getByRole('button', { name: 'Analyze 2 selected' })).toBeEnabled();
  await page.getByRole('combobox', { name: 'Analysis preset' }).selectOption('fast');

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  for (const tab of ['Dashboard', 'Openings', 'Weaknesses']) {
    await nav.getByRole('button', { name: tab, exact: true }).click();
    const sample = page.locator('summary').filter({ hasText: 'Analysis sample', visible: true });
    await expect(sample.getByText('Rapid', { exact: true })).toBeVisible();
    const time = page.getByRole('combobox', { name: 'Time control', exact: true });
    await expect(time).toBeHidden();
    await sample.focus();
    await page.keyboard.press('Enter');
    await expect(time).toHaveValue('rapid');
    await expect(page.getByLabel('Through (UTC)', { exact: true }).filter({ visible: true })).toHaveValue('2026-01-02');
    await sample.click();
    await expect(time).toBeHidden();
  }
  await nav.getByRole('button', { name: 'Games', exact: true }).click();
  const individual = page.getByRole('button', { name: /Opponent.*1400/ });
  await expect(individual).toHaveCount(4);
  // The second most recent game is Blitz and outside the sample's date window.
  await individual.nth(1).click();
  await expect(page.getByText('Saved to player analytics', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to games' }).click();
  await nav.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByText('0 of 1 saved games', { exact: false })).toBeVisible();
  await page.locator('summary').filter({ hasText: 'Analysis sample', visible: true }).click();
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expect(page.getByText('1 of 1 saved games', { exact: false })).toBeVisible();

  await page.reload();
  await expect(page.getByText('1 of 1 saved games', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Deselect player' }).click();
  await expect(page.getByPlaceholder('Player handle')).toHaveValue('');
  await page.getByPlaceholder('Player handle').fill('OtherPlayer');
  await page.getByRole('button', { name: 'Fetch games' }).click();
  await expect(page.getByRole('button', { name: 'Analyze 1 selected' })).toBeEnabled();
  await nav.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByText('0 of 0 saved games', { exact: false })).toBeVisible();

  // Selecting the original account brings back its saved review.
  await page.getByRole('button', { name: 'Deselect player' }).click();
  await page.getByPlaceholder('Player handle').fill('TestPlayer');
  await page.getByRole('button', { name: 'Fetch games' }).click();
  await expect(page.getByRole('button', { name: 'Analyze 4 selected' })).toBeEnabled();
  await page.getByRole('combobox', { name: 'Analysis preset' }).selectOption('fast');
  await nav.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByText('1 of 1 saved games', { exact: false })).toBeVisible();
});

test('saves a matching Lichess link under its provider game ID', async ({ page }) => {
  const game = {
    id: 'abcdefgh', rated: true, variant: 'standard', speed: 'rapid', status: 'mate', winner: 'white',
    createdAt: Date.UTC(2026, 0, 2), lastMoveAt: Date.UTC(2026, 0, 2),
    players: { white: { user: { name: 'Opponent' } }, black: { user: { name: 'TestPlayer' } } },
    clock: { initial: 600, increment: 0 }, pgn: MATE,
  };
  await page.route('https://lichess.org/api/games/user/TestPlayer?**', (route) =>
    route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(game) + '\n' }));
  await page.route('https://lichess.org/game/export/abcdefgh?**', (route) =>
    route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: game }));
  await page.goto('/?view=bulk');
  await page.getByRole('combobox', { name: 'Platform' }).selectOption('lichess');
  await page.getByPlaceholder('Player handle').fill('TestPlayer');
  await page.getByRole('button', { name: 'Fetch games' }).click();
  await expect(page.getByRole('button', { name: 'Analyze 1 selected' })).toBeEnabled();
  await page.getByRole('combobox', { name: 'Analysis preset' }).selectOption('fast');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('button', { name: 'Games', exact: true }).click();
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await page.getByRole('tab', { name: 'PGN / link' }).click();
  await page.getByRole('textbox', { name: 'PGN or game link' }).fill('https://lichess.org/abcdefgh/black');
  await page.getByRole('button', { name: 'Review game' }).click();
  await expect(page.getByText('Saved to player analytics', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to games' }).click();
  await nav.getByRole('button', { name: 'Bulk Analysis', exact: true }).click();
  await page.getByRole('button', { name: 'Analyze 1 selected' }).click();
  await expect(page.getByText('1 saved · 1 reused', { exact: false })).toBeVisible();
});

test('opens a brilliant move from a new or older saved review', async ({ page }) => {
  const fen = '2r4k/6p1/4Q2p/3p3P/3P2P1/1P3rBK/3q4/4R3 b - - 1 40';
  const pgn = `[SetUp "1"]
[FEN "${fen}"]

40... Rxg3+ 41. Kxg3 0-1`;
  const parsed = parseGame(pgn);
  const line = (pv: string[], cp: number, rank = 1) => ({ pv, score: { cp }, depth: 20, rank });
  // The same scored sacrifice position used by the classification regression test.
  const positions = [
    { fen, depth: 20, lines: [line(['f3g3', 'h3g3', 'c8c3'], 1369), line(['c8f8', 'e6d6'], 326, 2)] },
    { fen: parsed.plies[0].fenAfter, depth: 20, lines: [line(['h3g3', 'c8c3'], -1366)] },
    { fen: parsed.plies[1].fenAfter, depth: 20, lines: [line(['c8c3'], 1366)] },
  ];
  const review = buildReview(parsed.plies, positions, {});
  const games = [
    gameFixture(11, { pgn, result: '0-1', white: { name: 'NewOpponent' } }),
    gameFixture(10, { pgn, result: '0-1', white: { name: 'OldOpponent' } }),
  ];
  const analyses = games.map((game) => summarizeGame(game, parsed, review, {}, analysisSpec('fast')));
  expect(analyses[0].summary.sides.b.brilliantMoves).toEqual([{ ply: 0, notation: '40… Rxg3+' }]);

  await mockArchives(page);
  await page.goto('/?view=bulk');
  await page.getByPlaceholder('Player handle').fill('TestPlayer');
  await page.getByRole('button', { name: 'Fetch games' }).click();
  await expect(page.getByRole('button', { name: 'Deselect player' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Analysis preset' }).selectOption('fast');
  await page.getByLabel('Import analysis file').setInputFiles({
    name: 'brilliant.jsonl', mimeType: 'application/x-ndjson',
    buffer: Buffer.from(analyses.map(serializeAnalysis).join('\n')),
  });
  await expect(page.getByText('2 imported · 0 already saved · 0 invalid')).toBeVisible();

  // Simulate a library saved before the dashboard indexed brilliant moves.
  await page.evaluate((id) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('chess-review-analytics');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('summaries', 'readwrite');
      const store = tx.objectStore('summaries');
      const request = store.get(id);
      request.onsuccess = () => {
        const row = request.result as StoredSummary;
        delete row.sides.b.brilliantMoves;
        store.put(row);
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), analyses[1].summary.id);
  await page.goto('/?view=dashboard');
  const section = page.getByRole('region', { name: 'Brilliant moves', exact: true });
  await expect(section.getByText('2 moves in 2 games', { exact: false })).toBeVisible();
  const classifications = page.getByRole('region', { name: 'Move classifications', exact: true });
  expect(await classifications.evaluate((element) => element.nextElementSibling?.id)).toBe('brilliant-moves');
  await expect(section.getByRole('button', { name: /40… Rxg3\+.*NewOpponent/ })).toBeVisible();
  await section.getByRole('button', { name: /40… Rxg3\+.*OldOpponent/ }).click();
  await expect(page).toHaveURL(/side=b&ply=0/);
  await expect(page.getByRole('img', { name: 'Brilliant', exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/OldOpponent vs TestPlayer/).filter({ visible: true }).first()).toBeVisible();
});
