import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  captureProfileConfig,
  captureProfileId,
  captureVersion,
  hash,
  normalizeText,
  readCapture,
  writeCaptureProfileMarker,
} from "./capture-data.mjs";

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "capture-data-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeCurrent(root, cid, config, image = Buffer.from("image")) {
  const profileId = captureProfileId(config);
  const dir = path.join(root, "captures", profileId, cid);
  fs.mkdirSync(dir, { recursive: true });

  const imageHash = hash(image);
  const imagePath =
    `captures/${profileId}/${cid}/${imageHash}.png`;
  fs.writeFileSync(
    path.join(root, ...imagePath.split("/")),
    image,
  );

  const visibleText = "Blog content";
  fs.writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify({
      capture_version: captureVersion,
      profile_id: profileId,
      profile_config: config,
      image_path: imagePath,
      image_hash: imageHash,
      text_hash: hash(normalizeText(visibleText)),
      visible_text: visibleText,
      javascript_enabled: true,
      light_verified: true,
      lossless: true,
      ads_blocked: true,
      ad_containers_removed: true,
      blog_body_verified: true,
      error_page_detected: false,
    }),
  );

  return profileId;
}

test("capture profile id is stable and changes with rendering configuration", () => {
  const a = captureProfileConfig({
    SCREENSHOT_WIDTH: "1440",
    SCREENSHOT_HEIGHT: "900",
    CAPTURE_ENVIRONMENT_ID: "fixed",
  });
  const b = captureProfileConfig({
    SCREENSHOT_WIDTH: "1440",
    SCREENSHOT_HEIGHT: "900",
    CAPTURE_ENVIRONMENT_ID: "fixed",
  });
  const c = captureProfileConfig({
    SCREENSHOT_WIDTH: "1080",
    SCREENSHOT_HEIGHT: "900",
    CAPTURE_ENVIRONMENT_ID: "fixed",
  });

  assert.equal(captureProfileId(a), captureProfileId(b));
  assert.notEqual(captureProfileId(a), captureProfileId(c));
});

test("runtime evidence participates in capture profile identity", () => {
  const baseEnv = {
    SCREENSHOT_WIDTH: "1440",
    SCREENSHOT_HEIGHT: "900",
    CAPTURE_ENVIRONMENT_ID: "fixed",
    CAPTURE_BROWSER_EVIDENCE: "Chromium 153.0.8010.52",
    CAPTURE_FONT_EVIDENCE: "fonts-noto-cjk=1:20240730+repack1-1",
    CAPTURE_IMAGE_TOOLCHAIN_EVIDENCE: "sharp=0.35.0;vips=8.18.3;webp=1.6.0",
  };

  const a = captureProfileConfig(baseEnv);
  const b = captureProfileConfig({
    ...baseEnv,
    CAPTURE_BROWSER_EVIDENCE: "Chromium 154.0.0.0",
  });

  assert.notEqual(captureProfileId(a), captureProfileId(b));
});

test("strict capture profile requires runtime evidence", () => {
  assert.throws(
    () => captureProfileConfig({
      CAPTURE_REQUIRE_RUNTIME_EVIDENCE: "true",
      CAPTURE_ENVIRONMENT_ID: "fixed",
    }),
    /Missing required capture runtime evidence/,
  );
});

test("current profile marker selects only the matching new archive", (t) => {
  const root = tempRoot(t);
  const config = captureProfileConfig({
    CAPTURE_ENVIRONMENT_ID: "fixed",
  });
  const profileId = writeCurrent(root, "cid-a", config);
  writeCaptureProfileMarker(root, config);

  const capture = readCapture(root, "cid-a");
  assert.equal(capture.profile_id, profileId);
  assert.equal(capture.storage, "profile-v1");
});

test("current profile marker does not silently fall back to legacy data", (t) => {
  const root = tempRoot(t);
  const config = captureProfileConfig({
    CAPTURE_ENVIRONMENT_ID: "fixed",
  });
  writeCaptureProfileMarker(root, config);

  fs.mkdirSync(path.join(root, "screenshots/meta"), { recursive: true });
  const image = Buffer.from("legacy");
  fs.writeFileSync(path.join(root, "screenshots/cid-a.webp"), image);
  fs.writeFileSync(
    path.join(root, "screenshots/meta/cid-a.json"),
    JSON.stringify({
      capture_version: 8,
      javascript_enabled: true,
      light_verified: true,
      lossless: true,
      ads_blocked: true,
      ad_containers_removed: true,
      visible_text: "legacy",
      text_hash: hash("legacy"),
      image_hash: hash(image),
      profile: { browser: "old" },
    }),
  );

  assert.throws(
    () => readCapture(root, "cid-a"),
    /ENOENT|Invalid capture/,
  );
});

test("legacy archive remains readable before a current profile is selected", (t) => {
  const root = tempRoot(t);
  fs.mkdirSync(path.join(root, "screenshots/meta"), { recursive: true });

  const image = Buffer.from("legacy");
  fs.writeFileSync(path.join(root, "screenshots/cid-a.webp"), image);
  fs.writeFileSync(
    path.join(root, "screenshots/meta/cid-a.json"),
    JSON.stringify({
      capture_version: 8,
      javascript_enabled: true,
      light_verified: true,
      lossless: true,
      ads_blocked: true,
      ad_containers_removed: true,
      visible_text: "legacy",
      text_hash: hash("legacy"),
      image_hash: hash(image),
      profile: { browser: "old" },
    }),
  );

  const capture = readCapture(root, "cid-a");
  assert.match(capture.profile_id, /^legacy-v8-/);
  assert.equal(
    capture.evidence_status,
    "legacy-not-reverified",
  );
});
