import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { blockAdRequests, removeAdContainers } from "./capture-ads.mjs";
import { captureVersion, captureIsValid, hash, normalizeText } from "./capture-data.mjs";

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

function screenshotPath(snapshot) {
  return path.join(screenshotDir, `${snapshot.cid}.webp`);
}

function metadataPath(snapshot) {
  return path.join(metadataDir, `${snapshot.cid}.json`);
}

function screenshotIsValid(snapshot) {
  return captureIsValid(historyRoot, snapshot.cid);
}

const stableStyle = `*, *::before, *::after {
  animation: none !important; transition: none !important;
  caret-color: transparent !important; scroll-behavior: auto !important;
}`;

async function stabilizePage(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
  const removedAds = await removeAdContainers(page);
  console.log(`  removed ${removedAds} ad container(s)`);
  await page.addStyleTag({ content: stableStyle });
  // Terminal and PaperMod use different theme attributes/storage keys.
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "light");
    document.documentElement.classList.remove("dark");
    document.body.classList.remove("dark");
  });
  // Trigger native and JS lazy loading, with a bound for broken/infinite pages.
  for (let step = 0; step < 40; step += 1) {
    const bottom = await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
      return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight;
    });
    await page.waitForTimeout(100);
    if (bottom) break;
    if (step === 39) throw new Error("Page exceeded lazy-loading scroll limit");
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => {
    const stylesReady = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .filter(link => !link.disabled && (!link.media || matchMedia(link.media).matches))
      .every(link => link.sheet);
    const imagesReady = [...document.images].filter(img => img.getClientRects().length)
      .every(img => img.complete && img.naturalWidth > 0);
    return stylesReady && imagesReady && document.fonts.status === "loaded";
  }, null, { timeout: 20_000 });
  let previous = "";
  let stable = 0;
  for (let step = 0; step < 20; step += 1) {
    const signature = await page.evaluate(() => JSON.stringify({
      text: document.body.innerText,
      boxes: [...document.querySelectorAll("body *")].map(el => {
        const r = el.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height];
      }),
    }));
    stable = signature === previous ? stable + 1 : 0;
    if (stable >= 2) return;
    previous = signature;
    await page.waitForTimeout(250);
  }
  throw new Error("Page text/layout did not stabilize");
}

async function pageEvidence(page) {
  return page.evaluate(() => {
    // Read rendered text nodes: innerText alone can include opacity:0 content.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const parts = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const el = node.parentElement;
      if (!el || el.closest("script, style, template, noscript")) continue;
      let visible = true;
      for (let ancestor = el; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0 ||
            /^rect\(0px[, ]+0px[, ]+0px[, ]+0px\)$/.test(style.clip) ||
            style.clipPath === "inset(50%)") {
          visible = false; break;
        }
      }
      const range = document.createRange();
      range.selectNodeContents(node);
      if (visible && [...range.getClientRects()].some(r => r.width > 0 && r.height > 0)) {
        parts.push(node.textContent);
      }
    }
    const root = getComputedStyle(document.documentElement).backgroundColor;
    const body = getComputedStyle(document.body).backgroundColor;

    const parseColor = (value) => {
      const nums = value.match(/[\\d.]+/g)?.map(Number) || [];
      if (nums.length < 3) return [0, 0, 0, 0];
      return [nums[0], nums[1], nums[2], nums.length >= 4 ? nums[3] : 1];
    };

    const composite = (fg, bg) => {
      const a = fg[3] + bg[3] * (1 - fg[3]);
      if (a <= 0) return [0, 0, 0, 0];
      return [
        (fg[0] * fg[3] + bg[0] * bg[3] * (1 - fg[3])) / a,
        (fg[1] * fg[3] + bg[1] * bg[3] * (1 - fg[3])) / a,
        (fg[2] * fg[3] + bg[2] * bg[3] * (1 - fg[3])) / a,
        a,
      ];
    };

    // CSS backgrounds are layered body -> html -> browser canvas.
    // Chromium's page canvas is white for the forced light color scheme.
    const effective = composite(
      parseColor(body),
      composite(parseColor(root), [255, 255, 255, 1]),
    );
    const luminance =
      effective[0] * 0.2126 + effective[1] * 0.7152 + effective[2] * 0.0722;
    const light = luminance >= 180;
    const background = body;

    return {
      visible_text: parts.join(" "),
      background,
      effective_background: `rgb(${Math.round(effective[0])}, ${Math.round(effective[1])}, ${Math.round(effective[2])})`,
      background_luminance: Number(luminance.toFixed(2)),
      light_verified: light,
      theme: document.documentElement.getAttribute("data-theme"),
    };
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

async function captureOne(browser, snapshot) {
  const target = screenshotPath(snapshot);
  const tempTarget = `${target}.tmp.webp`;
  const url = snapshotUrl(snapshot);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const context = await browser.newContext({
      viewport: { width: viewportWidth, height: viewportHeight },
      deviceScaleFactor: 1, javaScriptEnabled: true, serviceWorkers: "block",
      reducedMotion: "reduce", colorScheme: "light", locale: "zh-CN", timezoneId: "UTC",
    });
    await context.addInitScript(() => {
      try {
        localStorage.setItem("theme", "light");
        localStorage.setItem("pref-theme", "light");
      } catch {}
    });
    await blockAdRequests(context);
    const page = await context.newPage();

    try {
      fs.rmSync(tempTarget, { force: true });
      console.log(`[${snapshot.deployed_at}] ${snapshot.cid} (attempt ${attempt}/${maxAttempts})`);
      console.log(`  ${url}`);

      console.log("  navigating...");
      const response = await withHeartbeat("still waiting for main HTML response", () =>
        page.goto(url, {
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

      const evidence = await pageEvidence(page);
      if (!evidence.light_verified) throw new Error(`Light theme verification failed: ${evidence.background}`);
      if (!normalizeText(evidence.visible_text)) throw new Error("No visible text captured");
      // One browser screenshot. Store lossless WebP for both comparison and display.
      const png = await withHeartbeat("still capturing screenshot", () => page.screenshot({
        type: "png", fullPage: true, animations: "disabled", caret: "hide", timeout: 45_000,
      }));
      const after = await pageEvidence(page);
      if (JSON.stringify(evidence) !== JSON.stringify(after)) throw new Error("Page changed during capture");
      const webp = await sharp(png).webp({ lossless: true }).toBuffer();
      await sharp(webp).metadata();
      fs.writeFileSync(tempTarget, webp);
      const size = webp.length;
      const metadata = {
        capture_version: captureVersion, captured_at: new Date().toISOString(),
        viewport_width: viewportWidth, viewport_height: viewportHeight,
        format: "webp", lossless: true, javascript_enabled: true,
        service_workers: "block", reduced_motion: "reduce", color_scheme: "light",
        animations_disabled: true, ads_blocked: true, ad_containers_removed: true, ...evidence,
        text_hash: hash(normalizeText(evidence.visible_text)), image_hash: hash(webp),
        profile: { browser: browser.version(), platform: process.platform,
          viewport: [viewportWidth, viewportHeight], device_scale_factor: 1,
          locale: "zh-CN", timezone: "UTC", capture_version: captureVersion },
      };
      const metaTemp = `${metadataPath(snapshot)}.tmp`;
      fs.writeFileSync(metaTemp, JSON.stringify(metadata, null, 2) + "\n");
      fs.renameSync(tempTarget, target);
      fs.renameSync(metaTemp, metadataPath(snapshot));

      console.log(
        `  saved ${path.relative(historyRoot, target)} (${Math.round(size / 1024)} KiB), capture v${captureVersion}`,
      );
      return;
    } catch (error) {
      console.error(`  failed: ${error.stack || error.message}`);
      fs.rmSync(tempTarget, { force: true });
      fs.rmSync(`${metadataPath(snapshot)}.tmp`, { force: true });

      if (attempt === maxAttempts) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    } finally {
      await context.close();
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

const { chromium } = await import("playwright");
const browser = await chromium.launch({
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
  headless: true,
  args: ["--disable-dev-shm-usage"],
});
console.log(`Browser: ${browser.version()}, capture v${captureVersion}, JavaScript enabled, lossless WebP`);

const failures = [];

try {
  for (const snapshot of missing) {
    try {
      await captureOne(browser, snapshot);
    } catch (error) {
      failures.push({
        cid: snapshot.cid,
        deployed_at: snapshot.deployed_at,
        error: error.message,
      });
    }
  }
} finally {
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

