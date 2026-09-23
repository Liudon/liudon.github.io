import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { blockAdRequests, removeAdContainers } from "./capture-ads.mjs";

test("ad requests are blocked while normal scripts still execute", async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", route => route.fulfill({ contentType: "application/javascript", body: "window.scriptRan = true;" }));
  await blockAdRequests(context);
  const page = await context.newPage();
  for (const host of ["pagead2.googlesyndication.com", "doubleclick.net", "www.googleadservices.com"]) {
    await page.setContent(`<script src="https://${host}/ad.js"></script>`);
    assert.equal(await page.evaluate(() => window.scriptRan), undefined, host);
  }
  for (const host of ["example.com", "notdoubleclick.net", "doubleclick.net.example.com"]) {
    await page.evaluate(() => { delete window.scriptRan; });
    await page.setContent(`<script src="https://${host}/app.js"></script>`);
    assert.equal(await page.evaluate(() => window.scriptRan), true, host);
  }
});

test("different ad heights collapse to the same layout and article content is preserved", async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const positions = [];
  for (const height of [0, 280, null]) {
    await page.setContent(`<style>.post-entry{padding:24px;margin-bottom:26px}</style>
      <article class="post-entry"><h2 class="entry-header">First</h2></article>
      ${height === null ? "" : `<article class="post-entry" id="ad"><ins class="adsbygoogle" style="display:block;height:${height}px"></ins></article>`}
      <article class="post-entry" id="next"><h2 class="entry-header">Next</h2><div class="entry-content">Keep this text<ins class="adsbygoogle"></ins></div></article>
      <div id="unrelated">Ordinary empty space</div>`);
    await removeAdContainers(page);
    assert.equal(await page.locator("#ad").count(), 0);
    assert.equal(await page.locator("ins.adsbygoogle").count(), 0);
    assert.equal(await page.locator(".entry-header").count(), 2);
    assert.match(await page.locator("#next").innerText(), /Keep this text/);
    assert.equal(await page.locator("#unrelated").count(), 1);
    positions.push((await page.locator("#next").boundingBox()).y);
  }
  assert.deepEqual(positions, [positions[0], positions[0], positions[0]]);
});
