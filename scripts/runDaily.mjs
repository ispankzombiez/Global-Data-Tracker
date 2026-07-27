import { spawnSync } from "node:child_process";
import { normalizeDate, utcDateString } from "./common.mjs";

const inputDate = process.argv[2];
const date = normalizeDate(inputDate);
const hasExplicitDate = Boolean(inputDate);

function shiftUtcDate(dateString, days) {
  const day = new Date(`${dateString}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return utcDateString(day);
}

function runStep(args, exitOnFail = true) {
  const result = spawnSync("node", args, { stdio: "inherit" });
  if (result.status !== 0 && exitOnFail) {
    process.exit(result.status ?? 1);
  }
  return result.status ?? 1;
}

function runPipelineForDate(targetDate) {
  const fetchStatus = runStep(["scripts/fetchDump.mjs", "active", targetDate], false);
  if (fetchStatus !== 0) {
    return fetchStatus;
  }

  runStep(["scripts/aggregateDaily.mjs", "active", targetDate]);
  runStep(["scripts/buildProcessedDataChunks.mjs", targetDate]);
  return 0;
}

if (hasExplicitDate) {
  process.exit(runPipelineForDate(date));
}

const fallbackDates = [date, shiftUtcDate(date, -1), shiftUtcDate(date, -2)];

for (const candidate of fallbackDates) {
  const status = runPipelineForDate(candidate);
  if (status === 0) {
    if (candidate !== date) {
      console.log(`Used fallback snapshot date ${candidate} because ${date} was unavailable.`);
    }
    process.exit(0);
  }

  // fetchDump exits with 2 on HTTP download failure (often 403/404/429); try earlier dates.
  if (status !== 2) {
    process.exit(status);
  }
}

console.error(`No active snapshot available for ${fallbackDates.join(", ")}`);
process.exit(2);
