import path from "node:path";
import { access, cp, rm, readdir } from "node:fs/promises";
import { rootDir } from "./common.mjs";

const dataDir = path.join(rootDir, "data");
const docsDataDir = path.join(rootDir, "docs", "data");

const sourceProcessedDir = path.join(dataDir, "processed");
const sourceProcessedDataDir = path.join(dataDir, "processed-data");

const targetProcessedDir = path.join(docsDataDir, "processed");
const targetProcessedDataDir = path.join(docsDataDir, "processed-data");

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function countFilesRecursive(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    if (entry.name === ".gitkeep") {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      count += await countFilesRecursive(fullPath);
    } else {
      count += 1;
    }
  }

  return count;
}

async function copyTree(sourceDir, targetDir, label) {
  if (!(await exists(sourceDir))) {
    console.log(`Skipping ${label}: source directory not found (${sourceDir})`);
    return;
  }

  await rm(targetDir, { recursive: true, force: true });
  await cp(sourceDir, targetDir, { recursive: true, force: true });

  const fileCount = await countFilesRecursive(targetDir);
  console.log(`Synced ${label}: ${fileCount} file(s) to ${targetDir}`);
}

console.log("Syncing processed data into docs/data for Pages branch deployment...");
await copyTree(sourceProcessedDir, targetProcessedDir, "processed summaries");
await copyTree(sourceProcessedDataDir, targetProcessedDataDir, "processed-data chunks");
console.log("Docs data sync complete.");
