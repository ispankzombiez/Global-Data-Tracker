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

await ensureDir(outputDir);

if (existsSync(outputPath) && !force) {
  console.log(`Skipping download. File already exists at ${outputPath}`);
  process.exit(0);
}

console.log(`Downloading ${url}`);
const response = await fetch(url);

if (!response.ok || !response.body) {
  console.error(`Failed to download ${url}. HTTP ${response.status}`);
  process.exit(2);
}

await pipeline(Readable.fromWeb(response.body), createWriteStream(outputPath));
console.log(`Saved ${outputPath}`);
