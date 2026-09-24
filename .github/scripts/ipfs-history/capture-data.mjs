import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const captureVersion = 9;
export const legacyCaptureVersion = 8;
export const captureProfileVersion = 1;
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const normalizeText = (text) => text.replace(/\s+/gu, " ").trim();

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableObject(value[key])]),
  );
}

export function captureProfileConfig(env = process.env) {
  const width = Number(env.SCREENSHOT_WIDTH || 1440);
  const height = Number(env.SCREENSHOT_HEIGHT || 900);

  if (!Number.isSafeInteger(width) || width <= 0 ||
      !Number.isSafeInteger(height) || height <= 0) {
    throw new Error(`Invalid capture viewport: ${width}x${height}`);
  }

  return {
    profile_version: captureProfileVersion,
    capture_version: captureVersion,
    environment_id: env.CAPTURE_ENVIRONMENT_ID || "local-unpinned",
    viewport: [width, height],
    device_scale_factor: 1,
    locale: "zh-CN",
    timezone: "UTC",
    color_scheme: "light",
    javascript_enabled: true,
    service_workers: "block",
    reduced_motion: "reduce",
  };
}

export function captureProfileId(config = captureProfileConfig()) {
  return hash(JSON.stringify(stableObject(config)));
}

export function captureProfileMarkerPath(root) {
  return path.join(root, "captures", "current-profile.json");
}

export function writeCaptureProfileMarker(root, config = captureProfileConfig()) {
  const profileId = captureProfileId(config);
  const target = captureProfileMarkerPath(root);
  const temp = `${target}.tmp-${process.pid}`;

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    temp,
    JSON.stringify({ version: 1, profile_id: profileId, config }, null, 2) + "\n",
    "utf8",
  );
  fs.renameSync(temp, target);

  return profileId;
}

export function readCaptureProfileMarker(root) {
  const file = captureProfileMarkerPath(root);
  if (!fs.existsSync(file)) return null;

  const marker = JSON.parse(fs.readFileSync(file, "utf8"));
  if (marker?.version !== 1 ||
      typeof marker.profile_id !== "string" ||
      !marker.profile_id ||
      !marker.config) {
    throw new Error("Invalid current capture profile marker");
  }

  if (captureProfileId(marker.config) !== marker.profile_id) {
    throw new Error("Capture profile marker hash mismatch");
  }

  return marker;
}

function validateCurrentCapture(meta, image, cid) {
  if (meta.javascript_enabled !== true ||
      meta.light_verified !== true ||
      meta.lossless !== true ||
      meta.ads_blocked !== true ||
      meta.ad_containers_removed !== true ||
      meta.blog_body_verified !== true ||
      meta.error_page_detected === true ||
      typeof meta.visible_text !== "string" ||
      !meta.visible_text.trim() ||
      meta.text_hash !== hash(normalizeText(meta.visible_text)) ||
      meta.image_hash !== hash(image)) {
    throw new Error(`Invalid capture evidence: ${cid}`);
  }
}

function readCurrentCapture(root, cid, profileId) {
  const base = path.join(root, "captures", profileId, cid);
  const metaPath = path.join(base, "meta.json");
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));

  if (meta.capture_version !== captureVersion ||
      meta.profile_id !== profileId ||
      !meta.profile_config ||
      captureProfileId(meta.profile_config) !== profileId ||
      typeof meta.image_path !== "string" ||
      !meta.image_path) {
    throw new Error(`Invalid capture v${captureVersion}: ${cid}`);
  }

  const normalized = path.posix.normalize(meta.image_path.replaceAll("\\", "/"));
  const expectedPrefix = `captures/${profileId}/${cid}/`;

  if (!normalized.startsWith(expectedPrefix) || normalized.includes("../")) {
    throw new Error(`Invalid capture image path: ${cid}`);
  }

  const imagePath = path.join(root, ...normalized.split("/"));
  const image = fs.readFileSync(imagePath);
  validateCurrentCapture(meta, image, cid);

  return {
    ...meta,
    image_path: normalized,
    storage: "profile-v1",
  };
}

function readLegacyCapture(root, cid) {
  const imagePath = path.join(root, "screenshots", `${cid}.webp`);
  const metaPath = path.join(root, "screenshots", "meta", `${cid}.json`);
  const image = fs.readFileSync(imagePath);
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));

  if (meta.capture_version !== legacyCaptureVersion ||
      meta.javascript_enabled !== true ||
      meta.light_verified !== true ||
      meta.lossless !== true ||
      meta.ads_blocked !== true ||
      meta.ad_containers_removed !== true ||
      typeof meta.visible_text !== "string" ||
      !meta.visible_text.trim() ||
      meta.text_hash !== hash(normalizeText(meta.visible_text)) ||
      meta.image_hash !== hash(image) ||
      !meta.profile) {
    throw new Error(`Invalid legacy capture v${legacyCaptureVersion}: ${cid}`);
  }

  return {
    ...meta,
    profile_id:
      `legacy-v${legacyCaptureVersion}-${hash(JSON.stringify(stableObject(meta.profile)))}`,
    profile_config: meta.profile,
    image_path: `screenshots/${cid}.webp`,
    storage: `legacy-v${legacyCaptureVersion}`,
    evidence_status: "legacy-not-reverified",
  };
}

export function readCapture(root, cid, options = {}) {
  const explicitProfileId = options.profileId || null;
  const marker = explicitProfileId ? null : readCaptureProfileMarker(root);
  const profileId = explicitProfileId || marker?.profile_id || null;

  if (profileId) {
    return readCurrentCapture(root, cid, profileId);
  }

  if (options.allowLegacy === false) {
    throw new Error(`No current capture profile available for ${cid}`);
  }

  return readLegacyCapture(root, cid);
}

export function captureIsValid(root, cid, options = {}) {
  try {
    readCapture(root, cid, options);
    return true;
  } catch {
    return false;
  }
}
