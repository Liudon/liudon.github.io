const adDomains = ["googlesyndication.com", "doubleclick.net", "googleadservices.com"];

export async function blockAdRequests(context) {
  await context.route(
    url => adDomains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)),
    route => route.abort(),
  );
}

export async function removeAdContainers(page) {
  return page.evaluate(() => {
    let removed = 0;
    for (const ad of document.querySelectorAll("ins.adsbygoogle")) {
      if (!ad.isConnected) continue;
      const card = ad.closest("article.post-entry");
      // Historical PaperMod inserts a dedicated card containing only ad scripts/slots.
      // Never remove a parent that also contains article content or other elements.
      const adOnly = card && [...card.children].every(child => child.matches("script, ins.adsbygoogle")) &&
        [...card.childNodes].every(node => node.nodeType !== Node.TEXT_NODE || !node.textContent.trim());
      (adOnly ? card : ad).remove();
      removed += 1;
    }
    return removed;
  });
}
