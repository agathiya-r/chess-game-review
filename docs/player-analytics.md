# Player analytics

Bulk review calls the same two-pass Stockfish 17.1 WASM search and
`buildReview` used by single-game review. It does not substitute another
accuracy or classification model. Game accuracy and Game Rating are estimates.
An increase in accuracy does not by itself establish increased playing strength.

| Display | Definition |
| --- | --- |
| Mean game accuracy | Arithmetic mean of available player game accuracy values. Each scored game contributes once. |
| Mean move accuracy and average CP loss | Sum divided by the number of graded player moves. Excludes Book and Forced. CP loss is capped by the underlying review model. |
| Classification distribution | All classified player moves, including Book and Forced; each move contributes once. |
| Best move percentage | Moves classified Best divided by graded moves. Great and Brilliant have their own categories. |
| Win rate | Wins divided by wins, draws and losses. Missing outcomes do not count as draws. |
| Phase metrics | Use the review's phase boundaries and numeric move data. Phases never reached have no observations. |
| Estimated game rating | Existing Game Rating estimate for that game; actual source rating is shown separately. |
| Modeled points lost | Existing win-probability loss divided by 100. A sum is a training priority measure, not an estimate of tournament points. |

The chart uses raw time order (UTC) and straight line segments. Periods are
calendar days, Monday-based weeks, or months; the rolling window averages the
underlying games or graded moves in the previous observed periods, including
the current one. Actual ratings can be overlaid on a separate axis. Small group
sizes are visible. A repertoire study flag requires at least 5 games and 20
graded opening moves, plus an opening accuracy at least 8 points below the
selected sample's opening average.

## Data and execution

- Provider adapters reuse the game's PGN and metadata normalization. Chess.com
  downloads one monthly archive at a time; Lichess pages by game start time and
  supports server-side time control and rated filters. Date filters are UTC,
  using start time on Lichess and finish time on Chess.com. Archive-list
  requests are cached briefly; game responses can use the browser HTTP cache.
  Requests are serialized per provider and retried with backoff, with a
  one-minute minimum wait for HTTP 429.
- The IndexedDB library has versioned stores for game metadata/PGN, summaries,
  engine details, and batch jobs. A completed game and its progress are
  committed in one transaction. Detailed positions are read on demand.
  Compact engine lines and the opening book entries for that game reproduce
  move classifications, variations, evaluations, and explanations in the
  original review. Saved-review URLs open on the browser profile holding the
  data. The original 200-entry single-review cache remains independent.
- Analysis identity is the provider's game ID plus exact preset settings,
  algorithm version, engine version, and metrics version. A game appears once
  per compatible dashboard sample. Old browser results stay separate; queued
  jobs from incompatible versions must be recreated. JSONL import validates
  metadata, settings, and FENs, and rebuilds summaries with the local review
  code. Import only analyses from CLI runs you trust.
- A batch processes one game at a time with up to four single-threaded workers.
  In browsers with Web Locks, only one batch runs per site across tabs.
  Remaining games in the queue can be started manually. Paused or interrupted
  games restart from the beginning of that game. Storage errors pause work;
  quota, private browsing, and clearing site data affect persistence.

## Training evidence

The detector checks materially different moves against the engine's scored
played move. A mate claim requires replaying the reported variation to mate;
forks and skewers must win material on the indicated squares in the line.
Capture and exchange findings require legal captures and positive static
exchange evidence. Pins are labeled possible. Opening and rook endgame
findings identify where a loss occurred, without inventing a positional cause.
The ranking combines total modeled loss, confidence, and the number of
different games; each position contributes to at most one pattern.

The first version does not diagnose general pawn structure, center control, or
king safety. It also does not analyze incomplete games, variants, or histories
beyond 5,000 matches in one batch. Very long runs depend on device speed and
browser storage; use smaller date ranges, a faster preset, or the CLI. Future
work could add calibrated positional motifs, position-level batch checkpoints,
and side-by-side comparisons that control for opponent strength and game mix.

## Validation

```sh
npm run check
npm run build
npx playwright install chromium
npm run test:e2e
```

The integration tests use the real Stockfish WASM build to compare batch and
single-game results, reopen saved reviews, round-trip the CLI format, and test
recovery after per-game and storage failures. Playwright tests exercise the
production app with controlled archive responses on desktop and mobile.
