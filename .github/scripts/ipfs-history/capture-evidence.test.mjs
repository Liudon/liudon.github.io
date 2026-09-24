import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyPageEvidence,
  parseCssColor,
} from "./capture-evidence.mjs";

test("CSS rgb and rgba numeric components are parsed", () => {
  assert.deepEqual(parseCssColor("rgb(245, 246, 247)"), [245, 246, 247, 1]);
  assert.deepEqual(
    parseCssColor("rgba(0, 0, 0, 0.25)"),
    [0, 0, 0, 0.25],
  );
});

test("transparent backgrounds composite onto the light browser canvas", () => {
  const evidence = classifyPageEvidence({
    root_background: "rgba(0, 0, 0, 0)",
    body_background: "rgba(0, 0, 0, 0)",
    title: "流动",
    visible_text: "正常博客内容",
    blog_body_selector: "main",
  });

  assert.equal(evidence.light_verified, true);
  assert.equal(evidence.effective_background, "rgb(255, 255, 255)");
});

test("dark pages fail light verification", () => {
  const evidence = classifyPageEvidence({
    root_background: "rgb(10, 10, 10)",
    body_background: "rgb(20, 20, 20)",
    title: "流动",
    visible_text: "正常博客内容",
    blog_body_selector: "main",
  });

  assert.equal(evidence.light_verified, false);
});

test("gateway-style error title and missing blog body are rejected evidence", () => {
  const evidence = classifyPageEvidence({
    root_background: "white",
    body_background: "white",
    title: "404 Not Found",
    visible_text: "404 Not Found",
    blog_body_selector: null,
  });

  assert.equal(evidence.error_page_detected, true);
  assert.equal(evidence.blog_body_verified, false);
});
