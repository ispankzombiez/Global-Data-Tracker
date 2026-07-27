import path from "node:path";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import readline from "node:readline";
import zlib from "node:zlib";
import {
  ensureDir,
  normalizeDate,
  readJson,
  rootDir,
  utcDateString,
  writeJson
} from "./common.mjs";
import { walkForItems } from "./itemExtraction.mjs";

const source = process.argv[2];
const inputDate = process.argv[3];

if (!["active", "all"].includes(source)) {
  console.error("Usage: node scripts/aggregateDaily.mjs <active|all> [YYYY-MM-DD]");
  process.exit(1);
}

const date = normalizeDate(inputDate);
const rawPath = path.join(rootDir, "data", "raw", source, `${date}.jsonl.gz`);
const processedDir = path.join(rootDir, "data", "processed");
const dailyDir = path.join(processedDir, "daily");
await ensureDir(dailyDir);

const startedAt = Date.now();
const progressEveryFarms = 5000;
const progressLogEveryMs = 2000;
let nextTimeProgressLogAt = startedAt + progressLogEveryMs;

console.log(`Aggregating ${source} snapshot for ${date}`);
console.log(`Reading raw file: ${rawPath}`);

const itemTotals = new Map();
let farmCount = 0;


const readStream = createReadStream(rawPath);
const gunzip = zlib.createGunzip();
const lineReader = readline.createInterface({
  input: readStream.pipe(gunzip),
  crlfDelay: Infinity
});

for await (const line of lineReader) {
  const trimmed = line.trim();
  if (!trimmed) {
    continue;
  }

  let farm;
  try {
    farm = JSON.parse(trimmed);
  } catch {
    continue;
  }

  farmCount += 1;
  walkForItems(farm, itemTotals);

  const now = Date.now();
  if (now >= nextTimeProgressLogAt) {
    const elapsedSeconds = Math.max((now - startedAt) / 1000, 1);
    const farmsPerSecond = farmCount / elapsedSeconds;
    console.log(`Parsed ${farmCount} farms (${farmsPerSecond.toFixed(1)} farms/s)`);
    nextTimeProgressLogAt = now + progressLogEveryMs;
  }

  if (farmCount % progressEveryFarms === 0) {
    const elapsedSeconds = Math.max((now - startedAt) / 1000, 1);
    const farmsPerSecond = farmCount / elapsedSeconds;
    console.log(`Parsed ${farmCount} farms (${farmsPerSecond.toFixed(1)} farms/s)`);
  }
}

console.log(`Finished parsing farms. Total valid farm records: ${farmCount}`);

const items = Object.fromEntries(
  [...itemTotals.entries()].sort((a, b) => b[1] - a[1])
);

const totalItemUnits = Object.values(items).reduce((sum, value) => sum + value, 0);

const summary = {
  date,
  source,
  farmCount,
  itemTypes: Object.keys(items).length,
  totalItemUnits,
  items,
  generatedAt: new Date().toISOString()
};

const dailyPath = path.join(dailyDir, `${date}-${source}.json`);
await writeJson(dailyPath, summary);
console.log(`Saved daily summary: ${dailyPath}`);

async function rebuildHistoryFor(selectedSource) {
  console.log(`Rebuilding history for source '${selectedSource}'...`);
  const files = await readdir(dailyDir);
  const sourceFiles = files
    .filter((file) => file.endsWith(`-${selectedSource}.json`))
    .sort();

  console.log(`Found ${sourceFiles.length} daily snapshots for '${selectedSource}'`);

  const dailySummaries = [];
  for (const file of sourceFiles) {
    const fullPath = path.join(dailyDir, file);
    const payload = await readJson(fullPath);
    dailySummaries.push(payload);
  }

  dailySummaries.sort((a, b) => a.date.localeCompare(b.date));

  const dates = dailySummaries.map((entry) => entry.date);
  const farmCountByDate = {};
  const seriesByItem = {};

  for (const day of dailySummaries) {
    farmCountByDate[day.date] = day.farmCount;
    for (const [itemName, count] of Object.entries(day.items)) {
      if (!seriesByItem[itemName]) {
        seriesByItem[itemName] = {};
      }
      seriesByItem[itemName][day.date] = count;
    }
  }

  const latest = dailySummaries.at(-1) ?? null;

  const history = {
    source: selectedSource,
    generatedAt: new Date().toISOString(),
    dates,
    farmCountByDate,
    seriesByItem,
    itemTypes: Object.keys(seriesByItem).length,
    latestDate: latest?.date ?? null,
    latestFarmCount: latest?.farmCount ?? 0,
    latestTotalItemUnits: latest?.totalItemUnits ?? 0
  };

  await writeJson(
    path.join(processedDir, `history-${selectedSource}.json`),
    history
  );

  if (latest) {
    await writeJson(path.join(processedDir, `latest-${selectedSource}.json`), latest);
  }

  const catalogPath = path.join(processedDir, "catalog.json");
  let catalog = {
    updatedAt: utcDateString(),
    sources: {}
  };

  try {
    catalog = await readJson(catalogPath);
  } catch {
    // Use default catalog when file does not yet exist.
  }

  catalog.updatedAt = new Date().toISOString();
  catalog.sources[selectedSource] = {
    latestDate: latest?.date ?? null,
    snapshotCount: dailySummaries.length,
    historyFile: `history-${selectedSource}.json`,
    latestFile: `latest-${selectedSource}.json`
  };

  await writeJson(catalogPath, catalog);
}

await rebuildHistoryFor(source);
console.log(`Rebuilt history for '${source}'`);
const totalSeconds = Math.max((Date.now() - startedAt) / 1000, 1);
console.log(`Aggregation stage complete in ${totalSeconds.toFixed(1)}s`);
