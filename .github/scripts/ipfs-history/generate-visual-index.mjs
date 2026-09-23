import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const historyRoot = process.argv[2];

if (!historyRoot) {
  console.error("Usage: node generate-visual-index.mjs <ipfs-history-worktree>");
  process.exit(1);
}

const historyDir = path.join(historyRoot, "history");
const screenshotDir = path.join(historyRoot, "screenshots");
const indexPath = path.join(historyRoot, "visual-index.json");
const diffPath = path.join(historyRoot, "visual-diffs.jsonl");

const algorithmVersion = 2;
const sampleWidth = Number(process.env.VISUAL_SAMPLE_WIDTH || 480);
const pixelDelta = Number(process.env.VISUAL_PIXEL_DELTA || 18);
const blurSigma = Number(process.env.VISUAL_BLUR_SIGMA || 0.8);
const overallChangedMax = Number(process.env.VISUAL_OVERALL_CHANGED_MAX || 0.002);
const tileChangedMax = Number(process.env.VISUAL_TILE_CHANGED_MAX || 0.08);
const meanDeltaMax = Number(process.env.VISUAL_MEAN_DELTA_MAX || 0.35);
const significantTileRatio = Number(process.env.VISUAL_SIGNIFICANT_TILE_RATIO || 0.01);
const tileSize = Number(process.env.VISUAL_TILE_SIZE || 48);
const heightDeltaMax = Number(process.env.VISUAL_HEIGHT_DELTA_MAX || 2);

function readSnapshots() {
  const byCid = new Map();

  for (const name of fs.readdirSync(historyDir).filter((name) => name.endsWith(".jsonl")).sort()) {
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

      const previous = byCid.get(entry.cid);
      if (!previous || entry.deployed_at < previous.deployed_at) {
        byCid.set(entry.cid, entry);
      }
    }
  }

  return [...byCid.values()].sort(
    (a, b) => a.deployed_at.localeCompare(b.deployed_at) || a.cid.localeCompare(b.cid),
  );
}

function screenshotPath(snapshot) {
  return path.join(screenshotDir, `${snapshot.cid}.webp`);
}

async function sampleScreenshot(snapshot) {
  const file = screenshotPath(snapshot);

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

    if (tileChanged[i] > 0) {
      changedTiles += 1;
    }

    if (ratio >= significantTileRatio) {
      significantTiles += 1;
    }
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
    changed_tiles: changedTiles,
    significant_tiles: significantTiles,
  };
}

function frameFromSnapshot(snapshot) {
  return {
    cid: snapshot.cid,
    deployed_at: snapshot.deployed_at,
    source_commit: snapshot.source_commit || null,
    screenshot: `screenshots/${snapshot.cid}.webp`,
    unchanged_deployments: 0,
    same_until: snapshot.deployed_at,
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

const frames = [];
const comparisons = [];

let baselineSnapshot = snapshots[0];
let baselineSample = await sampleScreenshot(baselineSnapshot);
let currentFrame = frameFromSnapshot(baselineSnapshot);
frames.push(currentFrame);

for (let index = 1; index < snapshots.length; index += 1) {
  const candidateSnapshot = snapshots[index];
  const candidateSample = await sampleScreenshot(candidateSnapshot);
  const metrics = compareSamples(baselineSample, candidateSample);

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
    `${metrics.same ? "SAME   " : "CHANGED"} ${candidateSnapshot.deployed_at} ${candidateSnapshot.cid} overall=${ratio}% tile=${tile}% mean=${metrics.mean_channel_delta}`,
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

const latest = snapshots.at(-1);

const visualIndex = {
  version: 1,
  algorithm: {
    version: algorithmVersion,
    strategy: "baseline-blurred-pixel-tiles",
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
  source: {
    snapshot_count: snapshots.length,
    latest_cid: latest.cid,
    latest_deployed_at: latest.deployed_at,
  },
  visual_count: frames.length,
  frames,
};

fs.writeFileSync(indexPath, JSON.stringify(visualIndex, null, 2) + "\n", "utf8");
fs.writeFileSync(
  diffPath,
  comparisons.map((item) => JSON.stringify(item)).join("\n") + "\n",
  "utf8",
);

console.log();
console.log(`Visual frames: ${frames.length}/${snapshots.length}`);
console.log(`Wrote ${path.relative(historyRoot, indexPath)}`);
console.log(`Wrote ${path.relative(historyRoot, diffPath)}`);
