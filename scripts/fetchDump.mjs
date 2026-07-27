import path from "node:path";
import { createWriteStream, existsSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { ensureDir, normalizeDate, rootDir } from "./common.mjs";

const source = process.argv[2];
const inputDate = process.argv[3];
const force = process.argv.includes("--force");

if (!["active", "all"].includes(source)) {
  console.error("Usage: node scripts/fetchDump.mjs <active|all> [YYYY-MM-DD] [--force]");
  process.exit(1);
}

const date = normalizeDate(inputDate);
const url = `https://community.sunflower-land.com/${date}/${source}.jsonl.gz`;
const outputDir = path.join(rootDir, "data", "raw", source);
const outputPath = path.join(outputDir, `${date}.jsonl.gz`);
const maxAttempts = 4;
const retryableStatuses = new Set([403, 404, 408, 425, 429, 500, 502, 503, 504]);
const apiKey = process.env.API_KEY?.trim();

await ensureDir(outputDir);

if (existsSync(outputPath) && !force) {
  console.log(`Skipping download. File already exists at ${outputPath}`);
  process.exit(0);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildHeaders() {
  const headers = {
    "user-agent": "global-data-tracker/0.1 (+https://github.com/ispankzombiez/Global-Data-Tracker)",
    "accept": "application/gzip, application/octet-stream, */*"
  };

  if (apiKey) {
    // Different upstream setups use either x-api-key or Authorization headers.
    headers["x-api-key"] = apiKey;
    headers.authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

let response = null;
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  console.log(`Downloading ${url} (attempt ${attempt}/${maxAttempts})`);

  try {
    response = await fetch(url, {
      redirect: "follow",
      headers: buildHeaders()
    });
  } catch (error) {
    if (attempt >= maxAttempts) {
      console.error(`Failed to download ${url}. Network error: ${error.message}`);
      process.exit(2);
    }

    console.log(`Network error. Retrying in ${attempt * 5}s...`);
    await sleep(attempt * 5000);
    continue;
  }

  if (response.ok && response.body) {
    break;
  }

  if (!retryableStatuses.has(response.status) || attempt >= maxAttempts) {
    console.error(`Failed to download ${url}. HTTP ${response.status}`);
    process.exit(2);
  }

  console.log(`HTTP ${response.status}. Retrying in ${attempt * 5}s...`);
  await sleep(attempt * 5000);
}

if (!response || !response.ok || !response.body) {
  console.error(`Failed to download ${url}.`);
  process.exit(2);
}

await pipeline(Readable.fromWeb(response.body), createWriteStream(outputPath));
console.log(`Saved ${outputPath}`);
