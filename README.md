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
5. GitHub Pages deploys `docs/` plus processed JSON data as a public dashboard.

## Repository Structure

- `scripts/fetchDump.mjs`: Download and archive raw `.jsonl.gz` dumps.
- `scripts/aggregateDaily.mjs`: Parse farm records and aggregate item totals.
- `scripts/runDaily.mjs`: Fetch + aggregate the daily `active` snapshot.
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

## GitHub Action Schedule

`daily-data.yml` runs on:

- Cron: `10 0 * * *` (00:10 UTC daily)
- Manual dispatch in Actions tab

The workflow commits changed files in:

- `data/raw/active/`
- `data/processed/`

## GitHub Pages

The deploy workflow publishes:

- `docs/*`
- `data/processed/*.json`
- `data/processed/daily/*.json`

Enable Pages in repository settings with **Source: GitHub Actions**.

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
