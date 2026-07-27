import path from "node:path";
import { createReadStream } from "node:fs";
import { createWriteStream } from "node:fs";
import { readdir, unlink } from "node:fs/promises";
import readline from "node:readline";
import zlib from "node:zlib";
import { ensureDir, normalizeDate, rootDir } from "./common.mjs";

const inputDate = process.argv[2];
const source = "active";
const date = normalizeDate(inputDate);

const chunkSizeArg = process.argv.find((arg) => arg.startsWith("--chunk-size="));
const maxFarmsArg = process.argv.find((arg) => arg.startsWith("--max-farms="));
const chunkSize = Number.parseInt(chunkSizeArg?.split("=")[1] ?? "500", 10);
const maxFarms = maxFarmsArg ? Number.parseInt(maxFarmsArg.split("=")[1], 10) : null;
const progressEveryFarms = 5000;
const startedAt = Date.now();
const progressLogEveryMs = 2000;
let nextTimeProgressLogAt = startedAt + progressLogEveryMs;

if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
  console.error("Invalid --chunk-size value. Use a positive integer.");
  process.exit(1);
}

if (maxFarms !== null && (!Number.isInteger(maxFarms) || maxFarms <= 0)) {
  console.error("Invalid --max-farms value. Use a positive integer.");
  process.exit(1);
}

const rawPath = path.join(rootDir, "data", "raw", source, `${date}.jsonl.gz`);
const baseOutputDir = path.join(rootDir, "data", "processed-data", source, date);
const chunksDir = path.join(baseOutputDir, "chunks");

console.log(`Building chunked processed data for ${source} on ${date}`);
console.log(`Chunk size: ${chunkSize}${maxFarms ? ` | Max farms: ${maxFarms}` : ""}`);
console.log(`Raw input: ${rawPath}`);
console.log(`Output directory: ${baseOutputDir}`);

await ensureDir(chunksDir);

let removedChunkFiles = 0;
for (const file of await readdir(chunksDir)) {
  if (file.endsWith(".json")) {
    await unlink(path.join(chunksDir, file));
    removedChunkFiles += 1;
  }
}

if (removedChunkFiles > 0) {
  console.log(`Cleared ${removedChunkFiles} previous chunk files`);
}

const likelyBagKeys = new Set([
  "inventory",
  "chest",
  "collectibles",
  "wardrobe",
  "kitchen",
  "beach",
  "items",
  "barn",
  "stock"
]);

function asNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function isLikelyItemBag(obj, parentKey) {
  const entries = Object.entries(obj);
  if (entries.length === 0) {
    return false;
  }

  let numericCount = 0;
  let nestedCount = 0;

  for (const [, value] of entries) {
    if (asNumber(value) !== null) {
      numericCount += 1;
    } else if (value !== null && typeof value === "object") {
      nestedCount += 1;
    }
  }

  if (nestedCount > 0) {
    return false;
  }

  if (likelyBagKeys.has(parentKey)) {
    return numericCount > 0;
  }

  return entries.length >= 3 && numericCount === entries.length;
}

function addItem(totals, name, value) {
  if (!name) {
    return;
  }
  const current = totals.get(name) ?? 0;
  totals.set(name, current + value);
}

function walkForItems(node, totals, parentKey = "") {
  if (node === null || typeof node !== "object") {
    return;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      walkForItems(child, totals, parentKey);
    }
    return;
  }

  if (isLikelyItemBag(node, parentKey)) {
    for (const [itemName, rawValue] of Object.entries(node)) {
      const amount = asNumber(rawValue);
      if (amount !== null) {
        addItem(totals, itemName, amount);
      }
    }
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    walkForItems(value, totals, key.toLowerCase());
  }
}

function findFarmId(farm, ordinal) {
  const candidates = [
    farm?.id,
    farm?.farmId,
    farm?.farmID,
    farm?.account,
    farm?.owner,
    farm?.wallet,
    farm?.userId,
    farm?.userID,
    farm?.username
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return `farm-${ordinal}`;
}

function formatChunkName(index) {
  return `chunk-${String(index).padStart(5, "0")}.json`;
}

function writeJson(filePath, payload) {
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(filePath, { encoding: "utf8" });
    stream.on("error", reject);
    stream.on("finish", resolve);
    stream.end(`${JSON.stringify(payload, null, 2)}\n`);
  });
}

let totalFarms = 0;
let chunkIndex = 0;
let chunkRows = [];
const chunkManifest = [];

const readStream = createReadStream(rawPath);
const gunzip = zlib.createGunzip();
const lineReader = readline.createInterface({
  input: readStream.pipe(gunzip),
  crlfDelay: Infinity
});

async function flushChunk() {
  if (chunkRows.length === 0) {
    return;
  }

  chunkIndex += 1;
  const fileName = formatChunkName(chunkIndex);
  const outputPath = path.join(chunksDir, fileName);

  await writeJson(outputPath, {
    date,
    source,
    chunk: chunkIndex,
    farms: chunkRows
  });

  const firstFarmId = chunkRows[0]?.farmId ?? null;
  const lastFarmId = chunkRows.at(-1)?.farmId ?? null;

  chunkManifest.push({
    file: `chunks/${fileName}`,
    count: chunkRows.length,
    firstFarmId,
    lastFarmId
  });

  if (chunkIndex % 10 === 0) {
    console.log(`Wrote chunk ${chunkIndex} (${totalFarms} farms processed so far)`);
  }

  chunkRows = [];
}

for await (const line of lineReader) {
  if (maxFarms !== null && totalFarms >= maxFarms) {
    break;
  }

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

  totalFarms += 1;
  const farmId = findFarmId(farm, totalFarms);

  const itemTotals = new Map();
  walkForItems(farm, itemTotals);

  const items = Object.fromEntries(
    [...itemTotals.entries()].sort((a, b) => b[1] - a[1])
  );

  const totalItemUnits = Object.values(items).reduce((sum, value) => sum + value, 0);

  chunkRows.push({
    farmId,
    itemTypes: Object.keys(items).length,
    totalItemUnits,
    items
  });

  if (chunkRows.length >= chunkSize) {
    await flushChunk();
  }

  const now = Date.now();
  if (now >= nextTimeProgressLogAt) {
    const elapsedSeconds = Math.max((now - startedAt) / 1000, 1);
    const farmsPerSecond = totalFarms / elapsedSeconds;
    console.log(`Processed ${totalFarms} farms (${farmsPerSecond.toFixed(1)} farms/s)`);
    nextTimeProgressLogAt = now + progressLogEveryMs;
  }

  if (totalFarms % progressEveryFarms === 0) {
    const elapsedSeconds = Math.max((now - startedAt) / 1000, 1);
    const farmsPerSecond = totalFarms / elapsedSeconds;
    console.log(`Processed ${totalFarms} farms (${farmsPerSecond.toFixed(1)} farms/s)`);
  }
}

await flushChunk();

const indexPayload = {
  date,
  source,
  generatedAt: new Date().toISOString(),
  chunkSize,
  totalFarms,
  chunkCount: chunkManifest.length,
  chunks: chunkManifest
};

await writeJson(path.join(baseOutputDir, "index.json"), indexPayload);
console.log(`Saved chunked processed data: ${baseOutputDir}`);
console.log(`Farm records: ${totalFarms} | Chunk files: ${chunkManifest.length}`);
const totalSeconds = Math.max((Date.now() - startedAt) / 1000, 1);
console.log(`Chunk build stage complete in ${totalSeconds.toFixed(1)}s`);
