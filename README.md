# Global Data Tracker

This repository archives Sunflower Land community snapshots and publishes a GitHub Pages dashboard for trend tracking across farms.

## Data Sources

- Complete dump (manual bootstrap):
  - `https://community.sunflower-land.com/{YYYY-MM-DD}/all.jsonl.gz`
- Daily active farms dump (automated):
  - `https://community.sunflower-land.com/{YYYY-MM-DD}/active.jsonl.gz`

## How It Works

1. Before launch, run a one-time complete fetch (`all.jsonl.gz`) for a chosen date.
2. Every day at `00:10 UTC`, GitHub Actions fetches that day's `active.jsonl.gz`.
3. Raw gzip files are saved by date under `data/raw/active/` so previous files are never overwritten.
4. Aggregated summaries and time-series outputs are written to `data/processed/`.
5. A chunked, browser-friendly farm dataset is generated under `data/processed-data/active/{YYYY-MM-DD}/`.
6. Processed outputs are mirrored into `docs/data/` so GitHub Pages can serve them when building from `main/docs`.

## Repository Structure

- `scripts/fetchDump.mjs`: Download and archive raw `.jsonl.gz` dumps.
- `scripts/aggregateDaily.mjs`: Parse farm records and aggregate item totals.
- `scripts/runDaily.mjs`: Fetch + aggregate the daily `active` snapshot.
- `scripts/buildProcessedDataChunks.mjs`: Build date-partitioned farm chunks for browser lookup.
- `scripts/syncDocsData.mjs`: Sync processed outputs into `docs/data/` for branch-based Pages hosting.
- `scripts/bootstrapAll.mjs`: Manual complete snapshot bootstrap.
- `.github/workflows/daily-data.yml`: Scheduled data pull at `00:10 UTC`.
- `.github/workflows/deploy-pages.yml`: Deploy dashboard to GitHub Pages.
- `docs/`: Static dashboard frontend.

## Manual Bootstrap (Step 0.5)

Run once before going live:

```bash
node scripts/bootstrapAll.mjs YYYY-MM-DD
```

Example:

```bash
node scripts/bootstrapAll.mjs 2026-07-26
```

This stores the raw file in `data/raw/all/` and creates the aggregate summary/history for source `all`.

## Daily Local Run

```bash
node scripts/runDaily.mjs YYYY-MM-DD
```

If date is omitted, UTC today is used.

When run without an explicit date, the daily runner automatically falls back to
the previous two UTC dates if today is temporarily unavailable upstream (for
example a `403` or `404` during publication lag).

To build only the browser chunk output for an existing active snapshot:

```bash
node scripts/buildProcessedDataChunks.mjs YYYY-MM-DD
```

To mirror processed outputs into `docs/data` for Pages branch builds:

```bash
node scripts/syncDocsData.mjs
```

## GitHub Action Schedule

`daily-data.yml` runs on:

- Cron: `10 0 * * *` (00:10 UTC daily)
- Manual dispatch in Actions tab

Manual dispatch supports an optional `date` input (`YYYY-MM-DD`).
- Leave blank to run for current UTC date.
- Provide a date to backfill or re-run a specific day.

If upstream dump access requires authentication, set repository secret `API_KEY`.
The daily workflow forwards it to the downloader request headers.

The workflow commits changed files in:

- `data/raw/active/`
- `data/processed/`
- `data/processed-data/`
- `docs/data/`

## GitHub Pages

The deploy workflow publishes:

- `docs/*`
- `data/processed/*.json`
- `data/processed/daily/*.json`
- `data/processed-data/**`

## Processed Data Chunks

Daily browser-friendly chunks for source `active` are saved to:

- `data/processed-data/active/{YYYY-MM-DD}/index.json`
- `data/processed-data/active/{YYYY-MM-DD}/chunks/chunk-00001.json`
- `data/processed-data/active/{YYYY-MM-DD}/chunks/chunk-00002.json`

`index.json` includes chunk metadata (farm counts and file list), while each chunk file contains a slice of farms with normalized item totals. Pages can fetch `index.json` first, then load only the needed chunk files.

If Pages source is set to **Deploy from a branch**, use `main` with `/docs` so
the dashboard and synced data under `docs/data/` are published together.

## Dashboard Features

- Source selector (`active` and `all` when available)
- Item trend chart in two modes:
  - Total amount
  - Per active farm (normalizes by farm count)
- Category filter and text search for faster item selection
- Day-over-day movers panel:
  - Top gainers
  - Top losers
- Top items table with:
  - Total amount
  - Per-farm amount
  - Day delta versus the previous snapshot
- Market movement chart:
  - Aggregate of all tracked items across snapshots
  - Supports total and per-farm modes
- CSV export button for the currently selected item:
  - One row per snapshot date with raw total, farm count, and per-farm value
- CSV export button for all currently filtered items:
  - Includes source, date, item, category, raw total, farm count, and per-farm value
  - Respects current source, category filter, and search query

## Notes

- The item aggregation logic is schema-tolerant and scans likely inventory-like numeric bags recursively.
- If the upstream JSON schema changes, update `scripts/aggregateDaily.mjs` bag detection heuristics.
