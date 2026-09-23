import fs from "node:fs";
import path from "node:path";

const historyRoot = process.argv[2];

if (!historyRoot) {
  console.error("Usage: node capture-screenshots.mjs <ipfs-history-worktree>");
  process.exit(1);
}

const historyDir = path.join(historyRoot, "history");
const screenshotDir = path.join(historyRoot, "screenshots");
const gatewayBase = process.env.IPFS_GATEWAY_BASE || "https://liudon.xyz/ipfs";
const sourceUrl = process.env.SCREENSHOT_SOURCE_URL || "";
const targetCid = process.env.CAPTURE_CID || "";
const viewportWidth = Number(process.env.SCREENSHOT_WIDTH || 1440);
const viewportHeight = Number(process.env.SCREENSHOT_HEIGHT || 900);
const webpQuality = Number(process.env.SCREENSHOT_QUALITY || 72);
const maxAttempts = Number(process.env.SCREENSHOT_ATTEMPTS || 3);

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

async function warmLazyContent(page) {
  await page.evaluate(async () => {
    try {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
    } catch {
      // Font readiness is best-effort; the screenshot should still proceed.
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const root = document.scrollingElement || document.documentElement;

    let lastHeight = 0;
    let stableRounds = 0;

    while (stableRounds < 3) {
      const height = Math.max(
        root.scrollHeight,
        document.documentElement.scrollHeight,
        document.body?.scrollHeight || 0,
      );

      if (height === lastHeight) {
        stableRounds += 1;
      } else {
        stableRounds = 0;
        lastHeight = height;
      }

      for (let y = 0; y < height; y += 800) {
        window.scrollTo(0, y);
        await sleep(70);
      }

      window.scrollTo(0, height);
      await sleep(250);
    }

    window.scrollTo(0, 0);
    await sleep(350);
  });
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

async function captureOne(context, snapshot) {
  const target = path.join(screenshotDir, `${snapshot.cid}.webp`);
  const url = snapshotUrl(snapshot);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const page = await context.newPage();

    try {
      console.log(`[${snapshot.deployed_at}] ${snapshot.cid} (attempt ${attempt}/${maxAttempts})`);
      console.log(`  ${url}`);

      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });

      if (!response) {
        throw new Error("Navigation returned no HTTP response");
      }

      if (!response.ok()) {
        throw new Error(
          `HTTP ${response.status()} ${response.statusText()} while loading ${url}`,
        );
      }

      await page.waitForTimeout(1_000);
      await warmLazyContent(page);

      await page.screenshot({
        path: target,
        type: "webp",
        quality: webpQuality,
        fullPage: true,
        animations: "disabled",
        caret: "hide",
      });

      const size = fs.statSync(target).size;
      if (size < 10_000) {
        throw new Error(`Screenshot looks unexpectedly small: ${size} bytes`);
      }

      console.log(
        `  saved ${path.relative(historyRoot, target)} (${Math.round(size / 1024)} KiB)`,
      );
      return;
    } catch (error) {
      console.error(`  failed: ${error.stack || error.message}`);
      fs.rmSync(target, { force: true });

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

let candidates = snapshots;

if (targetCid) {
  candidates = snapshots.filter((snapshot) => snapshot.cid === targetCid);
  if (candidates.length !== 1) {
    throw new Error(`CAPTURE_CID was not found in history: ${targetCid}`);
  }
}

function screenshotIsValid(snapshot) {
  const target = path.join(screenshotDir, `${snapshot.cid}.webp`);
  if (!fs.existsSync(target)) {
    return false;
  }

  return fs.statSync(target).size >= 10_000;
}

const missing = candidates.filter((snapshot) => !screenshotIsValid(snapshot));

for (const snapshot of missing) {
  const target = path.join(screenshotDir, `${snapshot.cid}.webp`);
  if (fs.existsSync(target)) {
    console.log(`Removing invalid existing screenshot: ${path.relative(historyRoot, target)}`);
    fs.rmSync(target, { force: true });
  }
}

console.log(`Snapshots in history: ${snapshots.length}`);
if (targetCid) {
  console.log(`Target CID: ${targetCid}`);
}
console.log(`Missing screenshots to capture: ${missing.length}`);

if (missing.length === 0) {
  process.exit(0);
}

const chrome = findChrome();
if (!chrome) {
  throw new Error("Chrome/Chromium executable not found on the runner");
}

console.log(`Browser: ${chrome}`);
console.log(`Viewport: ${viewportWidth}x${viewportHeight}, WebP quality: ${webpQuality}`);

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
