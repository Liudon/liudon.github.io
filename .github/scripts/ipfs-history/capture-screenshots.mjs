import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { blockAdRequests, removeAdContainers } from "./capture-ads.mjs";
import {
  captureVersion,
  captureIsValid,
  captureProfileConfig,
  captureProfileId,
  hash,
  normalizeText,
  writeCaptureProfileMarker,
} from "./capture-data.mjs";
import { collectPageEvidence } from "./capture-evidence.mjs";

const historyRoot = process.argv[2];

if (!historyRoot) {
  console.error("Usage: node capture-screenshots.mjs <ipfs-history-worktree>");
  process.exit(1);
}

const historyDir = path.join(historyRoot, "history");
const gatewayBase =
  process.env.IPFS_GATEWAY_BASE || "https://liudon.xyz/ipfs";
const sourceUrl = process.env.SCREENSHOT_SOURCE_URL || "";
const targetCid = process.env.CAPTURE_CID || "";
const viewportWidth = Number(process.env.SCREENSHOT_WIDTH || 1440);
const viewportHeight = Number(process.env.SCREENSHOT_HEIGHT || 900);
const maxAttempts = Number(process.env.SCREENSHOT_ATTEMPTS || 3);
const maxOriginalPixels = Number(
  process.env.CAPTURE_MAX_PIXELS || 40_000_000,
);
const expectedContentDigest =
  process.env.CAPTURE_CONTENT_DIGEST || "";
const expectedSourceCommit =
  process.env.CAPTURE_SOURCE_COMMIT || "";

const profileConfig = captureProfileConfig();
const profileId = captureProfileId(profileConfig);

if (!Number.isFinite(maxOriginalPixels) || maxOriginalPixels <= 0) {
  throw new Error(
    `Invalid CAPTURE_MAX_PIXELS: ${maxOriginalPixels}`,
  );
}

function readSnapshots() {
  const byCid = new Map();

  for (
    const name of fs
      .readdirSync(historyDir)
      .filter((item) => item.endsWith(".jsonl"))
      .sort()
  ) {
    const file = path.join(historyDir, name);
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);

    for (const [index, raw] of lines.entries()) {
      const line = raw.trim();
      if (!line) continue;

      let entry;
      try {
        entry = JSON.parse(line);
      } catch (error) {
        throw new Error(
          `Invalid JSON in ${name}:${index + 1}: ${error.message}`,
        );
      }

      if (!entry.cid || !entry.deployed_at) {
        throw new Error(
          `Missing cid/deployed_at in ${name}:${index + 1}`,
        );
      }

      const currentMillis = Date.parse(entry.deployed_at);
      if (!Number.isFinite(currentMillis)) {
        throw new Error(
          `Invalid deployed_at in ${name}:${index + 1}`,
        );
      }

      const previous = byCid.get(entry.cid);
      const previousMillis = previous
        ? Date.parse(previous.deployed_at)
        : Number.POSITIVE_INFINITY;

      if (!previous || currentMillis < previousMillis) {
        byCid.set(entry.cid, entry);
      }
    }
  }

  return [...byCid.values()].sort(
    (a, b) =>
      Date.parse(a.deployed_at) -
        Date.parse(b.deployed_at) ||
      a.cid.localeCompare(b.cid),
  );
}

function captureDir(snapshot) {
  return path.join(
    historyRoot,
    "captures",
    profileId,
    snapshot.cid,
  );
}

function metadataPath(snapshot) {
  return path.join(captureDir(snapshot), "meta.json");
}

function screenshotIsValid(snapshot) {
  return captureIsValid(
    historyRoot,
    snapshot.cid,
    { profileId, allowLegacy: false },
  );
}

const stableStyle = `*, *::before, *::after {
  animation: none !important; transition: none !important;
  caret-color: transparent !important; scroll-behavior: auto !important;
}`;

async function stabilizePage(page) {
  await page.waitForLoadState(
    "domcontentloaded",
    { timeout: 30_000 },
  );

  const removedAds = await removeAdContainers(page);
  console.log(`  removed ${removedAds} ad container(s)`);

  await page.addStyleTag({ content: stableStyle });

  await page.evaluate(() => {
    document.documentElement.setAttribute(
      "data-theme",
      "light",
    );
    document.documentElement.classList.remove("dark");
    document.body.classList.remove("dark");
  });

  for (let step = 0; step < 40; step += 1) {
    const bottom = await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
      return (
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight
      );
    });

    await page.waitForTimeout(100);

    if (bottom) break;
    if (step === 39) {
      throw new Error(
        "Page exceeded lazy-loading scroll limit",
      );
    }
  }

  await page.evaluate(() => window.scrollTo(0, 0));

  await page.waitForFunction(
    () => {
      const stylesReady = [
        ...document.querySelectorAll(
          'link[rel="stylesheet"]',
        ),
      ]
        .filter(
          (link) =>
            !link.disabled &&
            (!link.media ||
              matchMedia(link.media).matches),
        )
        .every((link) => link.sheet);

      const imagesReady = [...document.images]
        .filter(
          (img) => img.getClientRects().length,
        )
        .every(
          (img) =>
            img.complete &&
            img.naturalWidth > 0,
        );

      return (
        stylesReady &&
        imagesReady &&
        document.fonts.status === "loaded"
      );
    },
    null,
    { timeout: 20_000 },
  );

  let previous = "";
  let stable = 0;

  for (let step = 0; step < 20; step += 1) {
    const signature = await page.evaluate(() =>
      JSON.stringify({
        text: document.body.innerText,
        boxes: [
          ...document.querySelectorAll("body *"),
        ].map((el) => {
          const rect = el.getBoundingClientRect();
          return [
            rect.x,
            rect.y,
            rect.width,
            rect.height,
          ];
        }),
      }),
    );

    stable =
      signature === previous
        ? stable + 1
        : 0;

    if (stable >= 2) return;

    previous = signature;
    await page.waitForTimeout(250);
  }

  throw new Error(
    "Page text/layout did not stabilize",
  );
}

function snapshotUrl(snapshot) {
  if (sourceUrl) {
    if (!targetCid) {
      throw new Error(
        "SCREENSHOT_SOURCE_URL requires CAPTURE_CID",
      );
    }
    return sourceUrl;
  }

  return (
    `${gatewayBase.replace(/\/$/, "")}/` +
    `${snapshot.cid}/`
  );
}

async function withHeartbeat(label, task) {
  const startedAt = Date.now();
  const timer = setInterval(() => {
    const seconds = Math.round(
      (Date.now() - startedAt) / 1000,
    );
    console.log(
      `  ... ${label} (${seconds}s)`,
    );
  }, 10_000);

  try {
    return await task();
  } finally {
    clearInterval(timer);
  }
}

function assertSnapshotIdentity(snapshot) {
  if (
    expectedContentDigest &&
    snapshot.digest &&
    snapshot.digest !== expectedContentDigest
  ) {
    throw new Error(
      `Content digest mismatch for ${snapshot.cid}: ` +
      `${snapshot.digest} != ${expectedContentDigest}`,
    );
  }

  if (
    expectedSourceCommit &&
    snapshot.source_commit &&
    snapshot.source_commit !== expectedSourceCommit
  ) {
    throw new Error(
      `Source commit mismatch for ${snapshot.cid}: ` +
      `${snapshot.source_commit} != ${expectedSourceCommit}`,
    );
  }
}

function assertFinalLocation(snapshot, finalUrl) {
  if (sourceUrl) return;

  const expectedPath = `/${snapshot.cid}/`;
  const parsed = new URL(finalUrl);

  if (!parsed.pathname.includes(expectedPath)) {
    throw new Error(
      `Final URL no longer points at target CID ` +
      `${snapshot.cid}: ${finalUrl}`,
    );
  }
}

async function encodeLosslessOriginal(
  png,
  snapshot,
) {
  const inputMeta = await sharp(
    png,
    { failOn: "error" },
  ).metadata();

  if (!inputMeta.width || !inputMeta.height) {
    throw new Error(
      `Unable to read screenshot dimensions: ${snapshot.cid}`,
    );
  }

  const pixels =
    inputMeta.width * inputMeta.height;

  if (
    !Number.isSafeInteger(pixels) ||
    pixels > maxOriginalPixels
  ) {
    throw new Error(
      `Original screenshot exceeds ` +
      `${maxOriginalPixels} pixels: ` +
      `${inputMeta.width}x${inputMeta.height}`,
    );
  }

  try {
    const webp = await sharp(
      png,
      { failOn: "error" },
    )
      .webp({ lossless: true })
      .toBuffer();

    const meta = await sharp(
      webp,
      { failOn: "error" },
    ).metadata();

    if (
      meta.width !== inputMeta.width ||
      meta.height !== inputMeta.height
    ) {
      throw new Error(
        "WebP dimension mismatch",
      );
    }

    return {
      buffer: webp,
      format: "webp",
      width: inputMeta.width,
      height: inputMeta.height,
    };
  } catch (error) {
    console.warn(
      `  lossless WebP unavailable for ` +
      `${snapshot.cid}; preserving PNG ` +
      `(${error.message})`,
    );

    const meta = await sharp(
      png,
      { failOn: "error" },
    ).metadata();

    if (
      meta.width !== inputMeta.width ||
      meta.height !== inputMeta.height
    ) {
      throw new Error(
        "PNG fallback dimension mismatch",
      );
    }

    return {
      buffer: png,
      format: "png",
      width: inputMeta.width,
      height: inputMeta.height,
    };
  }
}

async function captureOne(
  browser,
  snapshot,
) {
  assertSnapshotIdentity(snapshot);

  const targetDir = captureDir(snapshot);
  const url = snapshotUrl(snapshot);
  fs.mkdirSync(
    targetDir,
    { recursive: true },
  );

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    const context = await browser.newContext({
      viewport: {
        width: viewportWidth,
        height: viewportHeight,
      },
      deviceScaleFactor: 1,
      javaScriptEnabled: true,
      serviceWorkers: "block",
      reducedMotion: "reduce",
      colorScheme: "light",
      locale: "zh-CN",
      timezoneId: "UTC",
    });

    await context.addInitScript(() => {
      try {
        localStorage.setItem(
          "theme",
          "light",
        );
        localStorage.setItem(
          "pref-theme",
          "light",
        );
      } catch {}
    });

    await blockAdRequests(context);
    const page = await context.newPage();

    try {
      console.log(
        `[${snapshot.deployed_at}] ` +
        `${snapshot.cid} ` +
        `(attempt ${attempt}/${maxAttempts})`,
      );
      console.log(`  ${url}`);

      const response = await withHeartbeat(
        "still waiting for main HTML response",
        () =>
          page.goto(url, {
            waitUntil: "commit",
            timeout: 30_000,
          }),
      );

      if (!response) {
        throw new Error(
          "Navigation returned no HTTP response",
        );
      }

      if (!response.ok()) {
        throw new Error(
          `HTTP ${response.status()} ` +
          `${response.statusText()} ` +
          `while loading ${url}`,
        );
      }

      await withHeartbeat(
        "still waiting for <body>",
        () =>
          page.waitForSelector(
            "body",
            {
              state: "attached",
              timeout: 15_000,
            },
          ),
      );

      await page.waitForTimeout(500);

      await withHeartbeat(
        "still stabilizing",
        () => stabilizePage(page),
      );

      const evidence =
        await collectPageEvidence(page);

      assertFinalLocation(
        snapshot,
        evidence.final_url,
      );

      if (!evidence.light_verified) {
        throw new Error(
          `Light theme verification failed: ` +
          `${evidence.background}`,
        );
      }

      if (!evidence.blog_body_verified) {
        throw new Error(
          "No recognizable blog body found",
        );
      }

      if (evidence.error_page_detected) {
        throw new Error(
          `Error page detected: ` +
          `${evidence.title || evidence.visible_text.slice(0, 80)}`,
        );
      }

      if (
        !normalizeText(
          evidence.visible_text,
        )
      ) {
        throw new Error(
          "No visible text captured",
        );
      }

      const png = await withHeartbeat(
        "still capturing screenshot",
        () =>
          page.screenshot({
            type: "png",
            fullPage: true,
            animations: "disabled",
            caret: "hide",
            timeout: 45_000,
          }),
      );

      const after =
        await collectPageEvidence(page);

      if (
        JSON.stringify(evidence) !==
        JSON.stringify(after)
      ) {
        throw new Error(
          "Page changed during capture",
        );
      }

      const original =
        await encodeLosslessOriginal(
          png,
          snapshot,
        );

      const imageHash =
        hash(original.buffer);
      const relativeImage =
        `captures/${profileId}/` +
        `${snapshot.cid}/` +
        `${imageHash}.${original.format}`;
      const finalImage = path.join(
        historyRoot,
        ...relativeImage.split("/"),
      );
      const tempImage =
        `${finalImage}.tmp-${process.pid}`;

      if (!fs.existsSync(finalImage)) {
        fs.writeFileSync(
          tempImage,
          original.buffer,
        );

        const verify =
          fs.readFileSync(tempImage);

        if (hash(verify) !== imageHash) {
          throw new Error(
            `Temporary image hash mismatch: ` +
            `${snapshot.cid}`,
          );
        }

        fs.renameSync(
          tempImage,
          finalImage,
        );
      } else if (
        hash(fs.readFileSync(finalImage)) !==
        imageHash
      ) {
        throw new Error(
          `Existing content-hash image mismatch: ` +
          relativeImage,
        );
      }

      const profileEvidence = {
        browser: browser.version(),
        platform: process.platform,
        font_evidence:
          process.env.CAPTURE_FONT_EVIDENCE ||
          null,
        sharp: sharp.versions.sharp,
        vips: sharp.versions.vips,
        webp: sharp.versions.webp,
      };

      const metadata = {
        capture_version: captureVersion,
        captured_at:
          new Date().toISOString(),
        target_cid: snapshot.cid,
        deployed_at:
          snapshot.deployed_at,
        source_commit:
          snapshot.source_commit || null,
        content_digest:
          snapshot.digest || null,
        capture_source:
          sourceUrl ? "local" : "gateway",
        capture_source_url: url,
        main_document_status:
          response.status(),
        profile_id: profileId,
        profile_config: profileConfig,
        profile_evidence: profileEvidence,
        viewport_width: viewportWidth,
        viewport_height: viewportHeight,
        format: original.format,
        width: original.width,
        height: original.height,
        lossless: true,
        javascript_enabled: true,
        service_workers: "block",
        reduced_motion: "reduce",
        color_scheme: "light",
        animations_disabled: true,
        ads_blocked: true,
        ad_containers_removed: true,
        ...evidence,
        text_hash: hash(
          normalizeText(
            evidence.visible_text,
          ),
        ),
        image_hash: imageHash,
        image_path: relativeImage,
      };

      const metaTarget =
        metadataPath(snapshot);
      const metaTemp =
        `${metaTarget}.tmp-${process.pid}`;

      fs.writeFileSync(
        metaTemp,
        JSON.stringify(
          metadata,
          null,
          2,
        ) + "\n",
        "utf8",
      );
      fs.renameSync(
        metaTemp,
        metaTarget,
      );

      console.log(
        `  saved ${relativeImage} ` +
        `(${Math.round(original.buffer.length / 1024)} KiB), ` +
        `capture v${captureVersion}`,
      );

      return;
    } catch (error) {
      console.error(
        `  failed: ` +
        `${error.stack || error.message}`,
      );

      for (
        const name of fs
          .readdirSync(targetDir)
          .filter(
            (item) =>
              item.includes(
                `.tmp-${process.pid}`,
              ),
          )
      ) {
        fs.rmSync(
          path.join(targetDir, name),
          { force: true },
        );
      }

      if (attempt === maxAttempts) {
        throw error;
      }

      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            attempt * 2_000,
          ),
      );
    } finally {
      await context.close();
    }
  }
}

const snapshots = readSnapshots();
writeCaptureProfileMarker(
  historyRoot,
  profileConfig,
);

let candidates = snapshots;

if (targetCid) {
  candidates = snapshots.filter(
    (snapshot) =>
      snapshot.cid === targetCid,
  );

  if (candidates.length !== 1) {
    throw new Error(
      `CAPTURE_CID was not found in history: ` +
      targetCid,
    );
  }
}

const missing = candidates.filter(
  (snapshot) =>
    !screenshotIsValid(snapshot),
);

console.log(
  `Snapshots in history: ${snapshots.length}`,
);
console.log(
  `Capture version: ${captureVersion}`,
);
console.log(
  `Capture profile: ${profileId}`,
);

if (targetCid) {
  console.log(
    `Target CID: ${targetCid}`,
  );
}

console.log(
  `Screenshots to capture: ${missing.length}`,
);

if (missing.length === 0) {
  process.exit(0);
}

const { chromium } =
  await import("playwright");

const browser =
  await chromium.launch({
    ...(process.env.CHROME_BIN
      ? {
          executablePath:
            process.env.CHROME_BIN,
        }
      : {}),
    headless: true,
    args: [
      "--disable-dev-shm-usage",
    ],
  });

console.log(
  `Browser: ${browser.version()}, ` +
  `capture v${captureVersion}, ` +
  `profile ${profileId}`,
);

const failures = [];

try {
  for (const snapshot of missing) {
    try {
      await captureOne(
        browser,
        snapshot,
      );
    } catch (error) {
      failures.push({
        cid: snapshot.cid,
        deployed_at:
          snapshot.deployed_at,
        error: error.message,
      });
    }
  }
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(
    "\nScreenshot failures:",
  );

  for (const failure of failures) {
    console.error(
      `- ${failure.deployed_at} ` +
      `${failure.cid}: ` +
      `${failure.error}`,
    );
  }

  process.exit(1);
}

console.log(
  `\nCaptured ${missing.length} screenshot(s).`,
);
