// Minimal Analytics 4 v1.12.0
// Source: https://github.com/idarek/minimal-analytics-4
(function () {
  const analyticsHosts = new Set(["liudon.com", "blog.liudon.xyz"]);
  if (!analyticsHosts.has(window.location.hostname)) return;

  const config = {
    tid: "G-G9ZDJQN9E2",
    timeout: 1800000,
    endpoint: "https://liudon.com/analytics/post",
    ext: [
      "pdf", "xls", "xlsx", "doc", "docx", "txt", "rtf", "csv", "exe",
      "key", "pps", "ppt", "pptx", "7z", "pkg", "rar", "gz", "zip",
      "avi", "mov", "mp4", "mpe", "mpeg", "wmv", "mid", "midi", "mp3",
      "wav", "wma"
    ],
    searchKeys: ["q", "s", "search", "query", "keyword"]
  };

  const debug = false;
  const pageId = Math.floor(Math.random() * 1000000000) + 1;
  const pageStartTime = Date.now();
  let lastEventTime = pageStartTime;
  let enScroll = false;
  let enFdl = false;
  let enEngagement = false;
  let enClick = false;
  let rafPending = false;

  const lStor = (function () {
    try {
      localStorage.setItem("t", "t");
      localStorage.removeItem("t");
      return localStorage;
    } catch (error) {
      return {
        getItem: () => null,
        setItem: () => null,
        removeItem: () => null
      };
    }
  })();

  const doc = document;
  const docEl = document.documentElement;
  const docBody = document.body;
  const docLoc = document.location;
  const display = screen;
  const nav = navigator || {};
  const generateId = () => Math.floor(Math.random() * 1000000000) + 1;
  const generateDateId = () => Math.floor(Date.now() / 1000);
  const generateClientId = () => generateId() + "." + generateDateId();
  const encode = encodeURIComponent;

  const clientId = () => {
    let cid = lStor.getItem("cid_v4");
    if (!cid) {
      cid = generateClientId();
      lStor.setItem("cid_v4", cid);
    }
    return cid;
  };

  const serialize = (object) => {
    const fields = [];
    for (const property in object) {
      if (Object.prototype.hasOwnProperty.call(object, property) && object[property] !== undefined) {
        fields.push(encode(property) + "=" + encode(object[property]));
      }
    }
    return fields.join("&");
  };

  const searchString = docLoc.search;
  const searchParams = new URLSearchParams(searchString);
  const getUtm = (key) => searchParams.get("utm_" + key);
  const searchKey = [...searchParams.keys()].find((key) =>
    config.searchKeys.includes(key.toLowerCase())
  );
  const searchTerm = searchKey ? searchParams.get(searchKey) : undefined;
  const isSearch = Boolean(searchTerm);

  const eventId = () => {
    if (enScroll) return "scroll";
    if (enFdl) return "file_download";
    if (enEngagement) return "user_engagement";
    if (enClick) return "click";
    if (isSearch) return "view_search_results";
    return "page_view";
  };

  const scrollPercentage = () => (enScroll ? "90" : undefined);

  const currentSearchTerm = () => {
    if (!isSearch || enScroll || enFdl || enEngagement || enClick) return undefined;
    return searchTerm;
  };

  function sendEvent(extension, filename, linkText, linkUrl) {
    const engagementTime = Date.now() - lastEventTime;
    lastEventTime = Date.now();
    const existingClientId = lStor.getItem("cid_v4");

    const firstVisit = () => {
      if (existingClientId || enScroll || enFdl || enEngagement || enClick) return undefined;
      return "1";
    };

    const now = generateDateId();
    const lastActive = lStor.getItem("_ga_last") || 0;
    let sessionId = lStor.getItem("_ga_sid");
    let sessionCount = lStor.getItem("_ga_sct") || 0;
    let isNewSession = false;

    if (!sessionId || now - lastActive > config.timeout / 1000) {
      isNewSession = true;
      sessionId = now;
      sessionCount = Number(sessionCount) + 1;
      lStor.setItem("_ga_sid", sessionId);
      lStor.setItem("_ga_sct", sessionCount);
      lStor.setItem("_ga_hits", "0");
    }

    lStor.setItem("_ga_last", now);
    const hits = Number(lStor.getItem("_ga_hits") || 0) + 1;
    lStor.setItem("_ga_hits", hits);

    const utmSource = getUtm("source");
    const utmMedium = getUtm("medium");
    const utmCampaign = getUtm("campaign");

    if (isNewSession) {
      if (utmSource) {
        lStor.setItem("_ga_utm_source", utmSource);
        lStor.setItem("_ga_utm_medium", utmMedium || "");
        lStor.setItem("_ga_utm_campaign", utmCampaign || "");
      } else {
        lStor.removeItem("_ga_utm_source");
        lStor.removeItem("_ga_utm_medium");
        lStor.removeItem("_ga_utm_campaign");
      }
    }

    const data = serialize({
      v: "2",
      tid: config.tid,
      _p: pageId,
      sr: display.width + "x" + display.height,
      ul: nav.language ? nav.language.toLowerCase() : undefined,
      cid: clientId(),
      _fv: firstVisit(),
      dl: docLoc.origin + docLoc.pathname + searchString,
      dt: doc.title || undefined,
      dr: doc.referrer || undefined,
      seg: hits > 1 || Date.now() - pageStartTime > 10000 ? "1" : undefined,
      "epn.percent_scrolled": scrollPercentage(),
      "ep.search_term": currentSearchTerm(),
      "ep.file_extension": extension || undefined,
      "ep.file_name": filename || undefined,
      "ep.link_text": linkText || undefined,
      "ep.link_url": linkUrl || undefined,
      _s: hits,
      sid: sessionId,
      sct: sessionCount,
      _ss: isNewSession ? "1" : undefined,
      en: eventId(),
      _et: engagementTime,
      cs: lStor.getItem("_ga_utm_source") || undefined,
      cm: lStor.getItem("_ga_utm_medium") || undefined,
      cn: lStor.getItem("_ga_utm_campaign") || undefined,
      "ep.outbound": enClick ? "true" : undefined,
      _dbg: debug ? 1 : undefined
    });

    const url = config.endpoint + "?" + data;
    if (nav.sendBeacon) {
      nav.sendBeacon(url);
    } else {
      const request = new XMLHttpRequest();
      request.open("POST", url, true);
      request.send();
    }
  }

  sendEvent();

  function getScrollPercentage() {
    const scrollable = (docEl.scrollHeight || docBody.scrollHeight) - docEl.clientHeight;
    return scrollable > 0
      ? ((docEl.scrollTop || docBody.scrollTop) / scrollable) * 100
      : 0;
  }

  function handleScroll() {
    if (rafPending) return;
    rafPending = true;

    requestAnimationFrame(function () {
      rafPending = false;
      if (getScrollPercentage() >= 90) {
        enScroll = true;
        sendEvent();
        doc.removeEventListener("scroll", handleScroll);
        enScroll = false;
      }
    });
  }

  doc.addEventListener("scroll", handleScroll, { passive: true });

  doc.addEventListener("click", function (event) {
    if (!(event.target instanceof Element)) return;
    const element = event.target.closest("a");
    if (!element || !element.getAttribute("href")) return;

    const url = element.getAttribute("href");
    const cleanPath = url.split(/[?#]/)[0];
    const file = cleanPath.substring(cleanPath.lastIndexOf("/") + 1);
    const lastDotIndex = file.lastIndexOf(".");
    const extension = lastDotIndex !== -1
      ? file.substring(lastDotIndex + 1).toLowerCase()
      : "";
    const cleanFilename = lastDotIndex !== -1 ? file.substring(0, lastDotIndex) : file;
    const linkText = element.textContent ? element.textContent.trim().substring(0, 100) : "";

    if (element.hasAttribute("download") || config.ext.includes(extension)) {
      enFdl = true;
      sendEvent(
        extension || undefined,
        cleanFilename || undefined,
        linkText,
        url.replace(docLoc.origin, "")
      );
      enFdl = false;
    } else if (element.hostname && element.hostname !== docLoc.hostname) {
      enClick = true;
      sendEvent(undefined, undefined, linkText, url);
      enClick = false;
    }
  }, true);

  doc.addEventListener("visibilitychange", function () {
    if (doc.visibilityState === "hidden") {
      enEngagement = true;
      sendEvent();
      enEngagement = false;
    }
  });
})();
