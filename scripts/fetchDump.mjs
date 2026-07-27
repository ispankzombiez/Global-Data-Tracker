import path from "node:path";
import { createWriteStream, existsSync } from "node:fs";
import { once } from "node:events";
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
const progressLogEveryBytesWhenUnknown = 16 * 1024 * 1024;

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
let contentLengthBytes = null;
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
    const contentLengthHeader = response.headers.get("content-length");
    contentLengthBytes = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : null;
    const contentLength = contentLengthBytes && Number.isFinite(contentLengthBytes)
      ? `${(contentLengthBytes / 1024 / 1024).toFixed(1)} MB`
      : "unknown";
    console.log(`Download response OK (HTTP ${response.status}, content-length: ${contentLength})`);
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

const startedAt = Date.now();
let downloadedBytes = 0;
let nextProgressLog = progressLogEveryBytesWhenUnknown;
let lastLoggedPercent = -1;
let lastLoggedAt = 0;

const writer = createWriteStream(outputPath);
const reader = response.body.getReader();

try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (!value || value.byteLength === 0) {
      continue;
    }

    downloadedBytes += value.byteLength;

    if (!writer.write(Buffer.from(value))) {
      await once(writer, "drain");
    }

    if (contentLengthBytes && contentLengthBytes > 0) {
      const percent = Math.min(
        100,
        Math.floor((downloadedBytes / contentLengthBytes) * 100)
      );
      const now = Date.now();
      const shouldLogByPercent = percent >= lastLoggedPercent + 1;
      const shouldLogByTime = now - lastLoggedAt >= 2000;

      if (shouldLogByPercent || shouldLogByTime || percent === 100) {
        const elapsedSeconds = Math.max((now - startedAt) / 1000, 1);
        const mbDownloaded = downloadedBytes / 1024 / 1024;
        const mbTotal = contentLengthBytes / 1024 / 1024;
        const mbPerSecond = mbDownloaded / elapsedSeconds;
        console.log(
          `Download progress: ${percent}% (${mbDownloaded.toFixed(1)} / ${mbTotal.toFixed(1)} MB) at ${mbPerSecond.toFixed(2)} MB/s`
        );
        lastLoggedPercent = percent;
        lastLoggedAt = now;
      }
    } else if (downloadedBytes >= nextProgressLog) {
      const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 1);
      const mbDownloaded = downloadedBytes / 1024 / 1024;
      const mbPerSecond = mbDownloaded / elapsedSeconds;
      console.log(`Download progress: ${mbDownloaded.toFixed(1)} MB (${mbPerSecond.toFixed(2)} MB/s)`);
      nextProgressLog += progressLogEveryBytesWhenUnknown;
    }
  }

  writer.end();
  await once(writer, "finish");
} catch (error) {
  writer.destroy();
  console.error(`Failed while writing ${outputPath}: ${error.message}`);
  process.exit(2);
}

const totalSeconds = Math.max((Date.now() - startedAt) / 1000, 1);
const totalMb = downloadedBytes / 1024 / 1024;
console.log(`Saved ${outputPath}`);
console.log(`Download complete: ${totalMb.toFixed(1)} MB in ${totalSeconds.toFixed(1)}s`);
