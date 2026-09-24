import fs from "node:fs";
import path from "node:path";
import {
  captureIsValid,
  captureProfileConfig,
  captureProfileId,
} from "./capture-data.mjs";

const [root, cid] = process.argv.slice(2);

if (!root) {
  throw new Error("Usage: check-capture.mjs <history-root> [cid]");
}

const requireCurrent =
  process.env.CAPTURE_REQUIRE_CURRENT_PROFILE === "true";
const profileId = requireCurrent
  ? captureProfileId(captureProfileConfig())
  : null;
const options = profileId
  ? { profileId, allowLegacy: false }
  : {};

if (cid) {
  process.exit(captureIsValid(root, cid, options) ? 0 : 1);
}

const cids = new Set();
for (
  const name of fs
    .readdirSync(path.join(root, "history"))
    .filter((item) => item.endsWith(".jsonl"))
) {
  for (
    const line of fs
      .readFileSync(path.join(root, "history", name), "utf8")
      .split(/\r?\n/)
      .filter((item) => item.trim())
  ) {
    const entry = JSON.parse(line);
    if (!entry.cid) throw new Error(`Missing CID in ${name}`);
    cids.add(entry.cid);
  }
}

const valid = [...cids].filter((item) =>
  captureIsValid(root, item, options),
).length;

console.log(
  JSON.stringify({
    total: cids.size,
    valid,
    missing: cids.size - valid,
    profile_id: profileId,
  }),
);
