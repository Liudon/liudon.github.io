import fs from "node:fs";
import path from "node:path";

const historyRoot = process.argv[2];

if (!historyRoot) {
  console.error("Usage: node capture-screenshots.mjs <ipfs-history-worktree>");
  process.exit(1);
}

const historyDir = path.join(historyRoot, "history");
const screenshotDir = path.join(historyRoot, "screenshots");
const metadataDir = path.join(screenshotDir, "meta");
const gatewayBase = process.env.IPFS_GATEWAY_BASE || "https://liudon.xyz/ipfs";
const sourceUrl = process.env.SCREENSHOT_SOURCE_URL || "";
const targetCid = process.env.CAPTURE_CID || "";
const viewportWidth = Number(process.env.SCREENSHOT_WIDTH || 1440);
const viewportHeight = Number(process.env.SCREENSHOT_HEIGHT || 900);
const webpQuality = Number(process.env.SCREENSHOT_QUALITY || 72);
const maxAttempts = Number(process.env.SCREENSHOT_ATTEMPTS || 3);
const captureVersion = Number(process.env.SCREENSHOT_CAPTURE_VERSION || 5);

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

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate));
}

function screenshotPath(snapshot) {
  return path.join(screenshotDir, `${snapshot.cid}.webp`);
}

function metadataPath(snapshot) {
  return path.join(metadataDir, `${snapshot.cid}.json`);
}

function readCaptureMetadata(snapshot) {
  const file = metadataPath(snapshot);
  if (!fs.existsSync(file)) return null;

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function screenshotIsValid(snapshot) {
  const target = screenshotPath(snapshot);
  if (!fs.existsSync(target) || fs.statSync(target).size < 10_000) {
    return false;
  }

  const metadata = readCaptureMetadata(snapshot);
  return metadata?.capture_version === captureVersion;
}

function writeCaptureMetadata(snapshot) {
  fs.mkdirSync(metadataDir, { recursive: true });
  const file = metadataPath(snapshot);
  const tmp = `${file}.tmp`;

  const metadata = {
    capture_version: captureVersion,
    captured_at: new Date().toISOString(),
    viewport_width: viewportWidth,
    viewport_height: viewportHeight,
    format: "webp",
    quality: webpQuality,
    javascript_enabled: false,
    service_workers: "block",
    reduced_motion: "reduce",
    animations_disabled: true,
  };

  fs.writeFileSync(tmp, JSON.stringify(metadata, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

async function stabilizePage(page) {
  // JavaScript is disabled in the browser context. Keep stabilization limited
  // to native browser operations so this step cannot depend on page script
  // execution or DOM injection.
  await page.waitForTimeout(500);

  // Warm native lazy-loaded resources with a small bounded number of scrolls.
  // Each action has its own short timeout guard so one old snapshot cannot
  // stall the whole repair job.
  for (let step = 0; step < 8; step += 1) {
    await Promise.race([
      page.mouse.wheel(0, Math.max(900, viewportHeight)),
      page.waitForTimeout(1_500).then(() => {
        throw new Error("scroll warmup timed out");
      }),
    ]);
    await page.waitForTimeout(60);
  }

  await Promise.race([
    page.keyboard.press("Home"),
    page.waitForTimeout(1_500).then(() => {
      throw new Error("return-to-top timed out");
    }),
  ]);

  await page.waitForTimeout(250);
}

function snapshotUrl(snapshot) {
  if (sourceUrl) {
    if (!targetCid) {
      throw new Error("SCREENSHOT_SOURCE_URL requires CAPTURE_CID");
    }
    return sourceUrl;
  }

  return `${gatewayBase.replace(/\/$/, "")}/${snapshot.cid}/`;
}

async function withHeartbeat(label, task) {
  const startedAt = Date.now();
  const timer = setInterval(() => {
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    console.log(`  ... ${label} (${seconds}s)`);
  }, 10_000);

  try {
    return await task();
  } finally {
    clearInterval(timer);
  }
}

async function captureOne(context, snapshot) {
  const target = screenshotPath(snapshot);
  const tempTarget = `${target}.tmp.webp`;
  const url = snapshotUrl(snapshot);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const page = await context.newPage();

    try {
      fs.rmSync(tempTarget, { force: true });
      console.log(`[${snapshot.deployed_at}] ${snapshot.cid} (attempt ${attempt}/${maxAttempts})`);
      console.log(`  ${url}`);

      console.log("  navigating...");
      const response = await withHeartbeat("still waiting for main HTML response", () =>
        page.goto(url, {
          // Do not wait for DOMContentLoaded here. Historical pages can contain
          // slow third-party script tags. JavaScript is disabled, and the
          // screenshot only needs the static HTML/CSS/image rendering.
          waitUntil: "commit",
          timeout: 30_000,
        }),
      );

      if (!response) {
        throw new Error("Navigation returned no HTTP response");
      }

      console.log(`  main HTML response: HTTP ${response.status()}`);

      if (!response.ok()) {
        throw new Error(
          `HTTP ${response.status()} ${response.statusText()} while loading ${url}`,
        );
      }

      console.log("  waiting for <body>...");
      await withHeartbeat("still waiting for <body>", () =>
        page.waitForSelector("body", {
          state: "attached",
          timeout: 15_000,
        }),
      );
      console.log("  <body> ready");

      console.log("  stabilizing page...");
      await page.waitForTimeout(500);
      await withHeartbeat("still stabilizing", () => stabilizePage(page));
      console.log("  page stabilized");

      console.log("  capturing full-page screenshot...");
      await withHeartbeat("still capturing screenshot", () =>
        page.screenshot({
          path: tempTarget,
          type: "webp",
          quality: webpQuality,
          fullPage: true,
          animations: "disabled",
          caret: "hide",
          timeout: 45_000,
        }),
      );
      console.log("  screenshot captured");

      const size = fs.statSync(tempTarget).size;
      if (size < 10_000) {
        throw new Error(`Screenshot looks unexpectedly small: ${size} bytes`);
      }

      // Only replace the old screenshot after a complete successful capture.
      // This keeps the previous usable image if a recapture attempt fails.
      fs.renameSync(tempTarget, target);
      writeCaptureMetadata(snapshot);

      console.log(
        `  saved ${path.relative(historyRoot, target)} (${Math.round(size / 1024)} KiB), capture v${captureVersion}`,
      );
      return;
    } catch (error) {
      console.error(`  failed: ${error.stack || error.message}`);
      fs.rmSync(tempTarget, { force: true });

      if (attempt === maxAttempts) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    } finally {
      await page.close();
    }
  }
}

const snapshots = readSnapshots();
fs.mkdirSync(screenshotDir, { recursive: true });
fs.mkdirSync(metadataDir, { recursive: true });

let candidates = snapshots;

if (targetCid) {
  candidates = snapshots.filter((snapshot) => snapshot.cid === targetCid);
  if (candidates.length !== 1) {
    throw new Error(`CAPTURE_CID was not found in history: ${targetCid}`);
  }
}

const missing = candidates.filter((snapshot) => !screenshotIsValid(snapshot));

for (const snapshot of missing) {
  const target = screenshotPath(snapshot);
  if (fs.existsSync(target)) {
    console.log(
      `Recapturing stale/invalid screenshot in place: ${path.relative(historyRoot, target)}`,
    );
  }
}

console.log(`Snapshots in history: ${snapshots.length}`);
console.log(`Capture version: ${captureVersion}`);
if (targetCid) {
  console.log(`Target CID: ${targetCid}`);
}
console.log(`Screenshots to capture: ${missing.length}`);

if (missing.length === 0) {
  process.exit(0);
}

const chrome = findChrome();
if (!chrome) {
  throw new Error("Chrome/Chromium executable not found on the runner");
}

console.log(`Browser: ${chrome}`);
console.log(`Viewport: ${viewportWidth}x${viewportHeight}, WebP quality: ${webpQuality}`);
console.log("Capture mode: JavaScript disabled, service workers blocked, native stabilization only.");

const { chromium } = await import("playwright-core");

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ["--disable-dev-shm-usage"],
});

const context = await browser.newContext({
  viewport: {
    width: viewportWidth,
    height: viewportHeight,
  },
  deviceScaleFactor: 1,
  javaScriptEnabled: false,
  serviceWorkers: "block",
  reducedMotion: "reduce",
});


const failures = [];

try {
  for (const snapshot of missing) {
    try {
      await captureOne(context, snapshot);
    } catch (error) {
      failures.push({
        cid: snapshot.cid,
        deployed_at: snapshot.deployed_at,
        error: error.message,
      });
    }
  }
} finally {
  await context.close();
  await browser.close();
}

if (failures.length > 0) {
  console.error("\nScreenshot failures:");
  for (const failure of failures) {
    console.error(`- ${failure.deployed_at} ${failure.cid}: ${failure.error}`);
  }
  process.exit(1);
}

console.log(`\nCaptured ${missing.length} screenshot(s).`);
