import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const captureVersion = 8;
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const normalizeText = (text) => text.replace(/\s+/gu, " ").trim();

export function readCapture(root, cid) {
  const image = fs.readFileSync(path.join(root, "screenshots", `${cid}.webp`));
  const meta = JSON.parse(fs.readFileSync(path.join(root, "screenshots", "meta", `${cid}.json`), "utf8"));
  if (meta.capture_version !== captureVersion || meta.javascript_enabled !== true ||
      meta.light_verified !== true || meta.lossless !== true ||
      meta.ads_blocked !== true || meta.ad_containers_removed !== true ||
      typeof meta.visible_text !== "string" || !meta.visible_text.trim() ||
      meta.text_hash !== hash(normalizeText(meta.visible_text)) ||
      meta.image_hash !== hash(image) || !meta.profile) {
    throw new Error(`Invalid capture v${captureVersion}: ${cid}`);
  }
  return meta;
}

export function captureIsValid(root, cid) {
  try { readCapture(root, cid); return true; } catch { return false; }
}

