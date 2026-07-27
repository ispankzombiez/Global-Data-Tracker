import { spawnSync } from "node:child_process";
import { normalizeDate, utcDateString } from "./common.mjs";

const inputDate = process.argv[2];
const date = normalizeDate(inputDate);
const hasExplicitDate = Boolean(inputDate);
const pipelineStartedAt = Date.now();

function shiftUtcDate(dateString, days) {
  const day = new Date(`${dateString}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return utcDateString(day);
}

function runStep(args, exitOnFail = true) {
  const label = args.join(" ");
  const startedAt = Date.now();
  console.log(`\n==> Starting: ${label}`);

  const result = spawnSync("node", args, { stdio: "inherit" });

  const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.1);
  if (result.status === 0) {
    console.log(`==> Completed: ${label} (${elapsedSeconds.toFixed(1)}s)`);
  } else {
    console.log(`==> Failed: ${label} (exit ${result.status ?? 1}, ${elapsedSeconds.toFixed(1)}s)`);
  }

  if (result.status !== 0 && exitOnFail) {
    process.exit(result.status ?? 1);
  }
  return result.status ?? 1;
}

function runPipelineForDate(targetDate) {
  console.log(`\n---- Running daily pipeline for ${targetDate} ----`);
  const fetchStatus = runStep(["scripts/fetchDump.mjs", "active", targetDate], false);
  if (fetchStatus !== 0) {
    console.log(`Fetch step did not succeed for ${targetDate} (exit ${fetchStatus})`);
    return fetchStatus;
  }

  runStep(["scripts/aggregateDaily.mjs", "active", targetDate]);
  runStep(["scripts/syncDocsData.mjs"]);
  return 0;
}

if (hasExplicitDate) {
  console.log(`Running with explicit date: ${date}`);
  process.exit(runPipelineForDate(date));
}

const fallbackDates = [date, shiftUtcDate(date, -1), shiftUtcDate(date, -2)];
console.log(`Running with fallback dates: ${fallbackDates.join(" -> ")}`);

for (const candidate of fallbackDates) {
  const status = runPipelineForDate(candidate);
  if (status === 0) {
    const totalSeconds = Math.max((Date.now() - pipelineStartedAt) / 1000, 0.1);
    if (candidate !== date) {
      console.log(`Used fallback snapshot date ${candidate} because ${date} was unavailable.`);
    }
    console.log(`Daily pipeline completed in ${totalSeconds.toFixed(1)}s`);
    process.exit(0);
  }

  // fetchDump exits with 2 on HTTP download failure (often 403/404/429); try earlier dates.
  if (status !== 2) {
    process.exit(status);
  }
}

console.error(`No active snapshot available for ${fallbackDates.join(", ")}`);
process.exit(2);
