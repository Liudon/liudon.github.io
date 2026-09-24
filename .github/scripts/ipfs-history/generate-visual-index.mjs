import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { readCapture, normalizeText, hash } from "./capture-data.mjs";

const historyRoot = process.argv[2];

if (!historyRoot) {
  console.error("Usage: node generate-visual-index.mjs <ipfs-history-worktree>");
  process.exit(1);
}

const historyDir = path.join(historyRoot, "history");
const screenshotDir = path.join(historyRoot, "screenshots");
const indexPath = path.join(historyRoot, "visual-index.json");
const diffPath = path.join(historyRoot, "visual-diffs.jsonl");
const playbackDir = path.join(historyRoot, "screenshots", "playback");

const algorithmVersion = 3;
const sampleWidth = Number(process.env.VISUAL_SAMPLE_WIDTH || 480);
const pixelDelta = Number(process.env.VISUAL_PIXEL_DELTA || 18);
const blurSigma = Number(process.env.VISUAL_BLUR_SIGMA || 0.8);
const overallChangedMax = Number(process.env.VISUAL_OVERALL_CHANGED_MAX || 0.002);
const tileChangedMax = Number(process.env.VISUAL_TILE_CHANGED_MAX || 0.08);
const meanDeltaMax = Number(process.env.VISUAL_MEAN_DELTA_MAX || 0.35);
const significantTileRatio = Number(process.env.VISUAL_SIGNIFICANT_TILE_RATIO || 0.01);
const tileSize = Number(process.env.VISUAL_TILE_SIZE || 48);
const heightDeltaMax = Number(process.env.VISUAL_HEIGHT_DELTA_MAX || 2);

const playbackVersion = 1;
const playbackWidth = Number(process.env.PLAYBACK_WIDTH || 960);
const playbackQuality = Number(process.env.PLAYBACK_QUALITY || 75);
const playbackMaxPixels = Number(process.env.PLAYBACK_MAX_PIXELS || 8_000_000);
const playbackMaxEdge = Number(process.env.PLAYBACK_MAX_EDGE || 16_383);

for (const [name, value] of Object.entries({
  sampleWidth,
  pixelDelta,
  blurSigma,
  overallChangedMax,
  tileChangedMax,
  meanDeltaMax,
  significantTileRatio,
  tileSize,
  heightDeltaMax,
  playbackWidth,
  playbackQuality,
  playbackMaxPixels,
  playbackMaxEdge,
})) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
}
if (playbackQuality > 100) {
  throw new Error(`Invalid playbackQuality: ${playbackQuality}`);
}

function parseDeploymentTime(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid deployed_at in ${label}`);
  }
  if (!/(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) {
    throw new Error(`deployed_at must include timezone in ${label}: ${value}`);
  }
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) {
    throw new Error(`Invalid deployed_at in ${label}: ${value}`);
  }
  return millis;
}

function readSnapshots() {
  const byCid = new Map();

  for (const name of fs.readdirSync(historyDir).filter((item) => item.endsWith(".jsonl")).sort()) {
    const file = path.join(historyDir, name);
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);

    for (const [index, raw] of lines.entries()) {
      const line = raw.trim();
      if (!line) continue;

      let entry;
      try {
        entry = JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSON in ${name}:${index + 1}: ${error.message}`);
      }

      if (!entry.cid || !entry.deployed_at) {
        throw new Error(`Missing cid/deployed_at in ${name}:${index + 1}`);
      }

      const deployedMillis = parseDeploymentTime(entry.deployed_at, `${name}:${index + 1}`);
      const previous = byCid.get(entry.cid);
      if (!previous || deployedMillis < previous.__deployed_millis) {
        byCid.set(entry.cid, { ...entry, __deployed_millis: deployedMillis });
      }
    }
  }

  return [...byCid.values()]
    .sort((a, b) => a.__deployed_millis - b.__deployed_millis || a.cid.localeCompare(b.cid))
    .map(({ __deployed_millis, ...entry }) => entry);
}

function captureImagePath(capture) {
  return path.join(historyRoot, ...capture.image_path.split("/"));
}

async function sampleScreenshot(snapshot) {
  const capture = readCapture(historyRoot, snapshot.cid);
  const file = captureImagePath(capture);

  if (!fs.existsSync(file)) {
    throw new Error(`Missing screenshot for ${snapshot.deployed_at} ${snapshot.cid}`);
  }

  const image = sharp(file, { failOn: "error" });
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error(`Unable to read screenshot dimensions: ${snapshot.cid}`);
  }

  const { data, info } = await image
    .resize({
      width: sampleWidth,
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
    })
    .blur(blurSigma)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 3) {
    throw new Error(`Unexpected channel count for ${snapshot.cid}: ${info.channels}`);
  }

  return {
    cid: snapshot.cid,
    capture,
    width: info.width,
    height: info.height,
    data,
    original_width: metadata.width,
    original_height: metadata.height,
  };
}

function compareSamples(baseline, candidate) {
  const heightDelta = Math.abs(baseline.height - candidate.height);

  if (baseline.width !== candidate.width || heightDelta > heightDeltaMax) {
    return {
      same: false,
      reason: "dimensions",
      height_delta: heightDelta,
      overall_changed_ratio: 1,
      max_tile_changed_ratio: 1,
      mean_channel_delta: 255,
      changed_tiles: null,
    };
  }

  const width = Math.min(baseline.width, candidate.width);
  const height = Math.min(baseline.height, candidate.height);
  const tilesX = Math.ceil(width / tileSize);
  const tilesY = Math.ceil(height / tileSize);
  const tileChanged = new Uint32Array(tilesX * tilesY);
  const tilePixels = new Uint32Array(tilesX * tilesY);

  let minX = width, minY = height, maxX = -1, maxY = -1;
  let changedPixels = 0;
  let totalPixels = 0;
  let totalChannelDelta = 0;

  for (let y = 0; y < height; y += 1) {
    const tileY = Math.floor(y / tileSize);

    for (let x = 0; x < width; x += 1) {
      const tileX = Math.floor(x / tileSize);
      const tile = tileY * tilesX + tileX;
      const offset = (y * width + x) * 3;

      const dr = Math.abs(baseline.data[offset] - candidate.data[offset]);
      const dg = Math.abs(baseline.data[offset + 1] - candidate.data[offset + 1]);
      const db = Math.abs(baseline.data[offset + 2] - candidate.data[offset + 2]);
      const maxDelta = Math.max(dr, dg, db);

      totalChannelDelta += dr + dg + db;
      totalPixels += 1;
      tilePixels[tile] += 1;

      if (maxDelta > pixelDelta) {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        changedPixels += 1;
        tileChanged[tile] += 1;
      }
    }
  }

  const overallChangedRatio = changedPixels / totalPixels;
  const meanChannelDelta = totalChannelDelta / (totalPixels * 3);

  let maxTileChangedRatio = 0;
  let changedTiles = 0;
  let significantTiles = 0;

  for (let i = 0; i < tilePixels.length; i += 1) {
    if (!tilePixels[i]) continue;

    const ratio = tileChanged[i] / tilePixels[i];
    maxTileChangedRatio = Math.max(maxTileChangedRatio, ratio);

    if (tileChanged[i] > 0) changedTiles += 1;
    if (ratio >= significantTileRatio) significantTiles += 1;
  }

  const same =
    overallChangedRatio <= overallChangedMax &&
    maxTileChangedRatio <= tileChangedMax &&
    meanChannelDelta <= meanDeltaMax;

  return {
    same,
    reason: same ? "visually_same" : "visual_change",
    height_delta: heightDelta,
    overall_changed_ratio: Number(overallChangedRatio.toFixed(8)),
    max_tile_changed_ratio: Number(maxTileChangedRatio.toFixed(8)),
    mean_channel_delta: Number(meanChannelDelta.toFixed(6)),
    changed_bounds_sample: maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    changed_tiles: changedTiles,
    significant_tiles: significantTiles,
  };
}

function frameFromSnapshot(snapshot) {
  return {
    cid: snapshot.cid,
    deployed_at: snapshot.deployed_at,
    source_commit: snapshot.source_commit || null,
    screenshot: null,
    unchanged_deployments: 0,
    same_until: snapshot.deployed_at,
  };
}

async function generatePlayback(frame) {
  const capture = readCapture(historyRoot, frame.cid);
  const source = captureImagePath(capture);
  const image = sharp(source, { failOn: "error" });
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error(`Unable to read playback source dimensions: ${frame.cid}`);
  }

  const scale = Math.min(
    1,
    playbackWidth / metadata.width,
    Math.sqrt(playbackMaxPixels / (metadata.width * metadata.height)),
    playbackMaxEdge / Math.max(metadata.width, metadata.height),
  );

  const width = Math.max(1, Math.floor(metadata.width * scale));
  const height = Math.max(1, Math.floor(metadata.height * scale));

  if (width * height > playbackMaxPixels || width > playbackMaxEdge || height > playbackMaxEdge) {
    throw new Error(`Playback dimensions exceed limits for ${frame.cid}: ${width}x${height}`);
  }

  const buffer = await image
    .resize({ width, height, fit: "fill", kernel: sharp.kernel.lanczos3, withoutEnlargement: true })
    .webp({ quality: playbackQuality })
    .toBuffer();

  const decoded = await sharp(buffer, { failOn: "error" }).metadata();
  if (decoded.width !== width || decoded.height !== height) {
    throw new Error(`Playback decode dimension mismatch for ${frame.cid}`);
  }

  const digest = hash(buffer);
  const filename = `${digest}.webp`;
  const target = path.join(playbackDir, filename);
  fs.mkdirSync(playbackDir, { recursive: true });

  if (fs.existsSync(target)) {
    const existing = fs.readFileSync(target);
    if (hash(existing) !== digest || !existing.equals(buffer)) {
      throw new Error(`Playback content mismatch for ${frame.cid}`);
    }
  } else {
    const temp = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(temp, buffer);
    const verified = await sharp(temp, { failOn: "error" }).metadata();
    if (verified.width !== width || verified.height !== height) {
      fs.rmSync(temp, { force: true });
      throw new Error(`Playback temporary file verification failed for ${frame.cid}`);
    }
    fs.renameSync(temp, target);
  }

  return {
    screenshot: `screenshots/playback/${filename}`,
    width,
    height,
    bytes: buffer.length,
  };
}

const snapshots = readSnapshots();

if (snapshots.length === 0) {
  throw new Error("No IPFS history snapshots found");
}

console.log(`History snapshots: ${snapshots.length}`);
console.log(
  `Visual algorithm v${algorithmVersion}: width=${sampleWidth}, blur=${blurSigma}, pixelDelta=${pixelDelta}, overall<=${overallChangedMax}, tile<=${tileChangedMax}, mean<=${meanDeltaMax}`,
);
console.log(
  `Playback profile v${playbackVersion}: width=${playbackWidth}, quality=${playbackQuality}, maxPixels=${playbackMaxPixels}, maxEdge=${playbackMaxEdge}`,
);

const frames = [];
const comparisons = [];

let baselineSnapshot = snapshots[0];
let baselineSample = await sampleScreenshot(baselineSnapshot);
let currentFrame = frameFromSnapshot(baselineSnapshot);
frames.push(currentFrame);

for (let index = 1; index < snapshots.length; index += 1) {
  const candidateSnapshot = snapshots[index];
  const candidateSample = await sampleScreenshot(candidateSnapshot);
  if (baselineSample.capture.profile_id !== candidateSample.capture.profile_id) {
    throw new Error(`Incompatible capture profiles: ${baselineSnapshot.cid} / ${candidateSnapshot.cid}`);
  }
  const metrics = compareSamples(baselineSample, candidateSample);
  const before = normalizeText(baselineSample.capture.visible_text);
  const after = normalizeText(candidateSample.capture.visible_text);
  metrics.text_changed = before !== after;
  if (metrics.text_changed) {
    metrics.same = false;
    metrics.reason = "text_change";
    let offset = 0;
    while (offset < Math.min(before.length, after.length) && before[offset] === after[offset]) offset += 1;
    metrics.text_diff = {
      offset,
      before: before.slice(Math.max(0, offset - 60), offset + 180),
      after: after.slice(Math.max(0, offset - 60), offset + 180),
    };
  }

  comparisons.push({
    baseline_cid: baselineSnapshot.cid,
    baseline_deployed_at: baselineSnapshot.deployed_at,
    candidate_cid: candidateSnapshot.cid,
    candidate_deployed_at: candidateSnapshot.deployed_at,
    ...metrics,
  });

  const ratio = (metrics.overall_changed_ratio * 100).toFixed(4);
  const tile = (metrics.max_tile_changed_ratio * 100).toFixed(3);
  console.log(
    `${metrics.same ? "SAME   " : "CHANGED"} ${candidateSnapshot.deployed_at} ${candidateSnapshot.cid} reason=${metrics.reason} overall=${ratio}% tile=${tile}% mean=${metrics.mean_channel_delta}`,
  );

  if (metrics.same) {
    currentFrame.unchanged_deployments += 1;
    currentFrame.same_until = candidateSnapshot.deployed_at;
    continue;
  }

  baselineSnapshot = candidateSnapshot;
  baselineSample = candidateSample;
  currentFrame = frameFromSnapshot(candidateSnapshot);
  frames.push(currentFrame);
}

for (const frame of frames) {
  Object.assign(frame, await generatePlayback(frame));
}

const latest = snapshots.at(-1);
const visualIndex = {
  version: 1,
  algorithm: {
    version: algorithmVersion,
    strategy: "visible-text-and-lossless-pixel-tiles",
    sample_width: sampleWidth,
    blur_sigma: blurSigma,
    pixel_delta: pixelDelta,
    overall_changed_max: overallChangedMax,
    tile_changed_max: tileChangedMax,
    mean_delta_max: meanDeltaMax,
    significant_tile_ratio: significantTileRatio,
    tile_size: tileSize,
    height_delta_max: heightDeltaMax,
  },
  capture_profile: {
    id: baselineSample.capture.profile_id,
    ...baselineSample.capture.profile_config,
  },
  source: {
    snapshot_count: snapshots.length,
    latest_cid: latest.cid,
    latest_deployed_at: latest.deployed_at,
  },
  playback_profile: {
    version: playbackVersion,
    format: "webp",
    target_width: playbackWidth,
    quality: playbackQuality,
    max_pixels: playbackMaxPixels,
    max_edge: playbackMaxEdge,
    encoder: {
      sharp: sharp.versions.sharp,
      vips: sharp.versions.vips,
      webp: sharp.versions.webp,
    },
  },
  visual_count: frames.length,
  frames,
};

const indexTemp = `${indexPath}.tmp-${process.pid}`;
const diffTemp = `${diffPath}.tmp-${process.pid}`;
fs.writeFileSync(indexTemp, JSON.stringify(visualIndex, null, 2) + "\n", "utf8");
fs.writeFileSync(diffTemp, comparisons.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
fs.renameSync(indexTemp, indexPath);
fs.renameSync(diffTemp, diffPath);

console.log();
console.log(`Visual frames: ${frames.length}/${snapshots.length}`);
console.log(`Playback files: ${new Set(frames.map((frame) => frame.screenshot)).size}`);
console.log(`Wrote ${path.relative(historyRoot, indexPath)}`);
console.log(`Wrote ${path.relative(historyRoot, diffPath)}`);
