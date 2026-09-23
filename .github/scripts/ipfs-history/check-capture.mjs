import fs from "node:fs";
import path from "node:path";
import { captureIsValid } from "./capture-data.mjs";

const [root, cid] = process.argv.slice(2);
if (!root) throw new Error("Usage: check-capture.mjs <history-root> [cid]");
if (cid) process.exit(captureIsValid(root, cid) ? 0 : 1);
const cids = new Set();
for (const name of fs.readdirSync(path.join(root, "history")).filter(name => name.endsWith(".jsonl"))) {
  for (const line of fs.readFileSync(path.join(root, "history", name), "utf8").split(/\r?\n/).filter(line => line.trim())) {
    const entry = JSON.parse(line);
    if (!entry.cid) throw new Error(`Missing CID in ${name}`);
    cids.add(entry.cid);
  }
}
const valid = [...cids].filter(cid => captureIsValid(root, cid)).length;
console.log(JSON.stringify({ total: cids.size, valid, missing: cids.size - valid }));
