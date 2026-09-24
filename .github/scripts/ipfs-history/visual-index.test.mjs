import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { hash, normalizeText, captureIsValid, captureVersion } from "./capture-data.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function fixture(t, texts, colors = [], dimensions = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "visual-v8-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "history"));
  fs.mkdirSync(path.join(root, "screenshots/meta"), { recursive: true });
  const entries = [];
  for (const [i, text] of texts.entries()) {
    const cid = `sample-${i}`;
    const width = dimensions.width || 1440;
    const height = dimensions.height || 900;
    const image = await sharp({ create: { width, height, channels: 3, background: colors[i] || "white" } })
      .webp({ lossless: true }).toBuffer();
    fs.writeFileSync(path.join(root, "screenshots", `${cid}.webp`), image);
    fs.writeFileSync(path.join(root, "screenshots/meta", `${cid}.json`), JSON.stringify({
      capture_version: captureVersion, ads_blocked: true, ad_containers_removed: true,
      javascript_enabled: true, light_verified: true, lossless: true,
      visible_text: text, text_hash: hash(normalizeText(text)), image_hash: hash(image),
      profile: { browser: "fixture" },
    }));
    entries.push({ cid, deployed_at: `2026-09-${String(i + 1).padStart(2, "0")}T00:00:00Z` });
  }
  fs.writeFileSync(path.join(root, "history/2026-09.jsonl"), entries.map(JSON.stringify).join("\n"));
  return root;
}

function run(root, env = {}) {
  return spawnSync(process.execPath, [new URL("./generate-visual-index.mjs", import.meta.url).pathname, root], {
    encoding: "utf8", env: { ...process.env, ...env },
  });
}
function index(root) { return JSON.parse(fs.readFileSync(path.join(root, "visual-index.json"))); }

test("small numeric text change survives identical image; baseline is retained across merges", async t => {
  const root = await fixture(t, ["57.1K", "57.1K", "58.2K", "58.2K"]);
  const result = run(root); assert.equal(result.status, 0, result.stderr);
  assert.equal(index(root).visual_count, 2);
  assert.equal(index(root).frames[0].unchanged_deployments, 1);
  const diffs = fs.readFileSync(path.join(root, "visual-diffs.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(diffs[1].reason, "text_change");
  assert.equal(diffs[1].baseline_cid, "sample-0");
  assert.match(diffs[1].text_diff.after, /58.2K/);
});

test("whitespace differences merge", async t => {
  const root = await fixture(t, ["hello  world", "hello\nworld"]);
  assert.equal(run(root).status, 0); assert.equal(index(root).visual_count, 1);
});

test("same text with color change is retained", async t => {
  const root = await fixture(t, ["same", "same"], ["white", "#dddddd"]);
  assert.equal(run(root).status, 0); assert.equal(index(root).visual_count, 2);
});

test("old capture version is rejected without replacing existing index", async t => {
  const root = await fixture(t, ["same"]);
  const file = path.join(root, "screenshots/meta/sample-0.json");
  const meta = JSON.parse(fs.readFileSync(file)); meta.capture_version = 7; fs.writeFileSync(file, JSON.stringify(meta));
  fs.writeFileSync(path.join(root, "visual-index.json"), "previous index");
  assert.notEqual(run(root).status, 0);
  assert.equal(fs.readFileSync(path.join(root, "visual-index.json"), "utf8"), "previous index");
});

test("missing/corrupt image is invalid even when metadata says current version", async t => {
  const root = await fixture(t, ["same"]);
  assert.equal(captureIsValid(root, "sample-0"), true);
  fs.writeFileSync(path.join(root, "screenshots/sample-0.webp"), "broken");
  assert.equal(captureIsValid(root, "sample-0"), false);
  assert.notEqual(run(root).status, 0);
});

test("mixed browser profiles cannot be merged", async t => {
  const root = await fixture(t, ["same", "same"]);
  const file = path.join(root, "screenshots/meta/sample-1.json");
  const meta = JSON.parse(fs.readFileSync(file)); meta.profile.browser = "different"; fs.writeFileSync(file, JSON.stringify(meta));
  const result = run(root); assert.notEqual(result.status, 0); assert.match(result.stderr, /Incompatible capture profiles/);
});

test("sparse low-amplitude raster noise merges", async t => {
  const root = await fixture(t, ["same", "same"]);
  const image = await sharp({ create: { width: 1440, height: 900, channels: 3, background: "white" } })
    .composite([{ input: await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fefefe" } }).png().toBuffer(), left: 50, top: 50 }])
    .webp({ lossless: true }).toBuffer();
  fs.writeFileSync(path.join(root, "screenshots/sample-1.webp"), image);
  const file = path.join(root, "screenshots/meta/sample-1.json");
  const meta = JSON.parse(fs.readFileSync(file)); meta.image_hash = hash(image); fs.writeFileSync(file, JSON.stringify(meta));
  assert.equal(run(root).status, 0); assert.equal(index(root).visual_count, 1);
});

test("capture without ad exclusion evidence is invalid", async t => {
  const root = await fixture(t, ["same"]);
  const file = path.join(root, "screenshots/meta/sample-0.json");
  const original = JSON.parse(fs.readFileSync(file));
  for (const key of ["ads_blocked", "ad_containers_removed"]) {
    const meta = { ...original }; delete meta[key]; fs.writeFileSync(file, JSON.stringify(meta));
    assert.equal(captureIsValid(root, "sample-0"), false);
  }
});

test("visual frames use immutable content-hash playback images with dimensions", async t => {
  const root = await fixture(t, ["first", "second"], ["white", "#cccccc"], { width: 1440, height: 3000 });
  const result = run(root, { PLAYBACK_WIDTH: "960", PLAYBACK_QUALITY: "75", PLAYBACK_MAX_PIXELS: "8000000", PLAYBACK_MAX_EDGE: "16383" });
  assert.equal(result.status, 0, result.stderr);
  const doc = index(root);
  assert.equal(doc.playback_profile.target_width, 960);
  for (const frame of doc.frames) {
    assert.match(frame.screenshot, /^screenshots\/playback\/[0-9a-f]{64}\.webp$/);
    assert.ok(frame.width > 0 && frame.width <= 960);
    assert.ok(frame.height > 0 && frame.width * frame.height <= 8_000_000);
    assert.ok(frame.bytes > 0);
    const file = path.join(root, frame.screenshot);
    const bytes = fs.readFileSync(file);
    assert.equal(path.basename(file, ".webp"), sha256(bytes));
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.width, frame.width);
    assert.equal(meta.height, frame.height);
  }
});

test("long pages scale by pixel and edge budgets without cropping", async t => {
  const root = await fixture(t, ["long page"], ["white"], { width: 1440, height: 12000 });
  const result = run(root, { PLAYBACK_WIDTH: "960", PLAYBACK_MAX_PIXELS: "8000000", PLAYBACK_MAX_EDGE: "4000" });
  assert.equal(result.status, 0, result.stderr);
  const frame = index(root).frames[0];
  assert.ok(frame.width * frame.height <= 8_000_000);
  assert.ok(Math.max(frame.width, frame.height) <= 4_000);
  assert.ok(Math.abs(frame.width / frame.height - 1440 / 12000) < 0.001);
});
