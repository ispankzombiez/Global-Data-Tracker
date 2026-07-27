import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
export const rootDir = path.resolve(currentDir, "..");

export function utcDateString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function normalizeDate(dateString) {
  if (!dateString) {
    return utcDateString();
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    throw new Error(`Invalid date format: ${dateString}. Use YYYY-MM-DD.`);
  }

  const candidate = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(candidate.getTime())) {
    throw new Error(`Invalid date value: ${dateString}`);
  }

  return dateString;
}

export async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

export async function readJson(filePath) {
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text);
}

export async function writeJson(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}
