import { spawnSync } from "node:child_process";
import { normalizeDate } from "./common.mjs";

const inputDate = process.argv[2];
const date = normalizeDate(inputDate);

function runStep(args) {
  const result = spawnSync("node", args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

runStep(["scripts/fetchDump.mjs", "all", date]);
runStep(["scripts/aggregateDaily.mjs", "all", date]);
