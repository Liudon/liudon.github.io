const ERROR_TITLE = /^(?:404(?:\s|$)|not found(?:\s|$)|bad gateway(?:\s|$)|gateway timeout(?:\s|$)|service unavailable(?:\s|$)|internal server error(?:\s|$))/iu;

export function parseCssColor(value) {
  const nums = String(value || "").match(/[-+]?(?:\d*\.)?\d+/g)?.map(Number) || [];
  if (nums.length < 3 || nums.slice(0, 3).some((item) => !Number.isFinite(item))) {
    return [0, 0, 0, 0];
  }
  return [
    nums[0],
    nums[1],
    nums[2],
    nums.length >= 4 && Number.isFinite(nums[3]) ? nums[3] : 1,
  ];
}

export function compositeColor(fg, bg) {
  const alpha = fg[3] + bg[3] * (1 - fg[3]);
  if (alpha <= 0) return [0, 0, 0, 0];

  return [
    (fg[0] * fg[3] + bg[0] * bg[3] * (1 - fg[3])) / alpha,
    (fg[1] * fg[3] + bg[1] * bg[3] * (1 - fg[3])) / alpha,
    (fg[2] * fg[3] + bg[2] * bg[3] * (1 - fg[3])) / alpha,
    alpha,
  ];
}

export function classifyPageEvidence(raw) {
  const root = parseCssColor(raw.root_background);
  const body = parseCssColor(raw.body_background);
  const effective = compositeColor(
    body,
    compositeColor(root, [255, 255, 255, 1]),
  );
  const luminance =
    effective[0] * 0.2126 +
    effective[1] * 0.7152 +
    effective[2] * 0.0722;

  const title = String(raw.title || "").trim();
  const leadingText = String(raw.visible_text || "").trim().slice(0, 160);
  const errorPageDetected =
    ERROR_TITLE.test(title) ||
    ERROR_TITLE.test(leadingText);

  return {
    visible_text: String(raw.visible_text || ""),
    background: raw.body_background,
    effective_background:
      `rgb(${Math.round(effective[0])}, ${Math.round(effective[1])}, ${Math.round(effective[2])})`,
    background_luminance: Number(luminance.toFixed(2)),
    light_verified: luminance >= 180,
    theme: raw.theme ?? null,
    title,
    final_url: raw.final_url || "",
    blog_body_selector: raw.blog_body_selector || null,
    blog_body_verified: Boolean(raw.blog_body_selector),
    error_page_detected: errorPageDetected,
  };
}

export async function collectPageEvidence(page) {
  const raw = await page.evaluate(() => {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    const parts = [];

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const el = node.parentElement;
      if (!el || el.closest("script, style, template, noscript")) continue;

      let visible = true;
      for (let ancestor = el; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (
          style.display === "none" ||
          style.visibility !== "visible" ||
          Number(style.opacity) === 0 ||
          /^rect\(0px[, ]+0px[, ]+0px[, ]+0px\)$/.test(style.clip) ||
          style.clipPath === "inset(50%)"
        ) {
          visible = false;
          break;
        }
      }

      const range = document.createRange();
      range.selectNodeContents(node);
      if (
        visible &&
        [...range.getClientRects()].some(
          (rect) => rect.width > 0 && rect.height > 0,
        )
      ) {
        parts.push(node.textContent);
      }
    }

    const selectors = [
      "main",
      "article",
      "#content",
      ".content",
      ".main",
      ".post",
      ".posts",
      ".post-content",
      ".post-entry",
      ".container",
    ];

    const blogBodySelector =
      selectors.find((selector) =>
        [...document.querySelectorAll(selector)].some((el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility === "visible" &&
            String(el.innerText || "").trim().length > 0
          );
        }),
      ) || null;

    return {
      visible_text: parts.join(" "),
      root_background:
        getComputedStyle(document.documentElement).backgroundColor,
      body_background:
        getComputedStyle(document.body).backgroundColor,
      theme: document.documentElement.getAttribute("data-theme"),
      title: document.title,
      final_url: location.href,
      blog_body_selector: blogBodySelector,
    };
  });

  return classifyPageEvidence(raw);
}
