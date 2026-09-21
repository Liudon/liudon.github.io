(() => {
  "use strict";

  const HISTORY_BASE =
    "https://raw.githubusercontent.com/Liudon/liudon.github.io/ipfs-history";
  const SNAPSHOT_BASE = "https://liudon.xyz/ipfs";
  const FRAME_SOFT_TIMEOUT_MS = 5000;
  const MIN_TRAVEL_MS = 650;
  const SNAPSHOT_REVEAL_MS = 1200;
  const MAX_RANDOM_ATTEMPTS = 40;
  const DEFAULT_LINE_DELAY_MS = 650;

  let frame = document.getElementById("snapshot");
  const travel = document.getElementById("travel");
  const errorBox = document.getElementById("error");
  const errorTitle = document.getElementById("error-title");
  const errorMessage = document.getElementById("error-message");
  const retryButton = document.getElementById("retry");
  const travelLinesRoot = document.getElementById("travel-lines");
  const travelLines = travelLinesRoot
    ? Array.from(travelLinesRoot.querySelectorAll(".time-line:not(.time-waiting)"))
    : [];
  const waitingLine = document.getElementById("travel-waiting");
  const configuredLineDelay = travelLinesRoot
    ? Number.parseInt(travelLinesRoot.dataset.lineDelay, 10)
    : DEFAULT_LINE_DELAY_MS;
  const travelLineDelayMs =
    Number.isFinite(configuredLineDelay) && configuredLineDelay >= 0
      ? configuredLineDelay
      : DEFAULT_LINE_DELAY_MS;
  const past = document.getElementById("past");
  const pastCollapsed = document.getElementById("past-collapsed");
  const pastClose = document.getElementById("past-close");
  const randomAgain = document.getElementById("random-again");
  const pastDate = document.getElementById("past-date");
  const pastDateShort = document.getElementById("past-date-short");

  const monthCache = new Map();
  let historyIndex = null;
  let latestCid = null;
  let currentSnapshot = null;
  let loadToken = 0;
  let waitingTimer = null;

  function fetchJson(path) {
    return fetch(HISTORY_BASE + "/" + path, {
      cache: "no-store",
      headers: { Accept: "application/json" }
    }).then((response) => {
      if (!response.ok) {
        throw new Error("HTTP " + response.status + " while loading " + path);
      }
      return response.json();
    });
  }

  async function loadHistoryIndex() {
    if (historyIndex) return historyIndex;

    const [months, latest] = await Promise.all([
      fetchJson("months.json"),
      fetchJson("latest.json")
    ]);

    if (
      months.version !== 2 ||
      !Number.isInteger(months.total) ||
      months.total < 1 ||
      !Array.isArray(months.months)
    ) {
      throw new Error("Invalid months.json");
    }

    const calculatedTotal = months.months.reduce((sum, item) => {
      if (
        !item ||
        typeof item.month !== "string" ||
        !Number.isInteger(item.count) ||
        item.count < 0
      ) {
        throw new Error("Invalid month index entry");
      }
      return sum + item.count;
    }, 0);

    if (calculatedTotal !== months.total) {
      throw new Error("Timeline index count mismatch");
    }

    historyIndex = months;
    latestCid = typeof latest.cid === "string" ? latest.cid : null;
    return historyIndex;
  }

  async function loadMonth(month) {
    if (monthCache.has(month)) return monthCache.get(month);

    const response = await fetch(
      HISTORY_BASE + "/history/" + month + ".jsonl",
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error("HTTP " + response.status + " while loading " + month);
    }

    const text = await response.text();
    const seen = new Set();
    const rows = [];

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;

      const row = JSON.parse(line);
      if (
        !row ||
        typeof row.cid !== "string" ||
        typeof row.deployed_at !== "string"
      ) {
        continue;
      }

      if (seen.has(row.cid)) continue;
      seen.add(row.cid);
      rows.push(row);
    }

    monthCache.set(month, rows);
    return rows;
  }

  function locateGlobalIndex(globalIndex) {
    let offset = globalIndex;

    for (const item of historyIndex.months) {
      if (offset < item.count) {
        return {
          month: item.month,
          index: offset,
          expectedCount: item.count
        };
      }
      offset -= item.count;
    }

    throw new Error("Random index outside timeline");
  }

  async function randomSnapshot() {
    await loadHistoryIndex();

    if (historyIndex.total <= 1 && latestCid) {
      throw new Error("NO_HISTORY");
    }

    for (let attempt = 0; attempt < MAX_RANDOM_ATTEMPTS; attempt += 1) {
      const globalIndex = Math.floor(Math.random() * historyIndex.total);
      const location = locateGlobalIndex(globalIndex);
      const rows = await loadMonth(location.month);

      if (rows.length !== location.expectedCount) {
        throw new Error(
          "Timeline shard mismatch for " +
            location.month +
            ": " +
            rows.length +
            " != " +
            location.expectedCount
        );
      }

      const snapshot = rows[location.index];
      if (!snapshot) continue;
      if (latestCid && snapshot.cid === latestCid) continue;
      if (currentSnapshot && snapshot.cid === currentSnapshot.cid) continue;

      return snapshot;
    }

    throw new Error("NO_ALTERNATIVE");
  }

  function formatSnapshotTime(iso) {
    const date = new Date(iso);

    if (Number.isNaN(date.getTime())) {
      return { full: iso, short: iso.slice(0, 10) };
    }

    const parts = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);

    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value])
    );

    const short = values.year + "-" + values.month + "-" + values.day;

    return {
      full: short + " · " + values.hour + ":" + values.minute,
      short
    };
  }

  function hideError() {
    errorBox.classList.remove("is-visible");
  }

  function showError(title, message) {
    errorTitle.textContent = title;
    errorMessage.textContent = message;
    errorBox.classList.add("is-visible");
  }

  function stopWaitingIndicator() {
    if (waitingTimer !== null) {
      window.clearInterval(waitingTimer);
      waitingTimer = null;
    }

    if (waitingLine) {
      waitingLine.classList.remove("is-visible");
      waitingLine.textContent = "";
    }
  }

  function startWaitingIndicator(token) {
    if (!waitingLine) return;

    stopWaitingIndicator();

    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    const text = waitingLine.dataset.text || "loading snapshot...";
    let frameIndex = 0;

    waitingLine.textContent = text + " " + frames[frameIndex];
    waitingLine.classList.add("is-visible");

    waitingTimer = window.setInterval(() => {
      if (token !== loadToken) {
        stopWaitingIndicator();
        return;
      }

      frameIndex = (frameIndex + 1) % frames.length;
      waitingLine.textContent = text + " " + frames[frameIndex];
    }, 90);
  }

  function createBlankSnapshotFrame() {
    const nextFrame = document.createElement("iframe");
    nextFrame.id = "snapshot";
    nextFrame.className = "snapshot";
    nextFrame.title = "博客历史快照";
    nextFrame.referrerPolicy = "strict-origin-when-cross-origin";

    frame.replaceWith(nextFrame);
    frame = nextFrame;
  }

  function resetSnapshotReveal({ replaceFrame = false } = {}) {
    if (replaceFrame) {
      createBlankSnapshotFrame();
    } else {
      frame.classList.remove("is-loading", "is-emerging", "is-visible");
    }

    travel.classList.remove("is-revealing");
  }

  function beginSnapshotReveal() {
    frame.classList.add("is-loading");
    travel.classList.add("is-revealing");

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        frame.classList.add("is-emerging");
      });
    });
  }

  function showTravel() {
    stopWaitingIndicator();
    past.classList.remove("is-visible");
    resetSnapshotReveal({ replaceFrame: true });
    travel.classList.remove("is-hidden");
    travelLines.forEach((line) => line.classList.remove("is-visible"));
    hideError();
  }

  async function printTravelLines(token) {
    for (let index = 0; index < travelLines.length; index += 1) {
      if (token !== loadToken) return;

      await new Promise((resolve) =>
        window.setTimeout(resolve, index === 0 ? 300 : travelLineDelayMs)
      );

      if (token !== loadToken) return;
      travelLines[index].classList.add("is-visible");
    }
  }

  function expandPast() {
    past.classList.remove("is-collapsed");
  }

  function collapsePast() {
    past.classList.add("is-collapsed");
  }

  function revealPast(snapshot) {
    const formatted = formatSnapshotTime(snapshot.deployed_at);

    pastDate.textContent = formatted.full;
    pastDateShort.textContent = formatted.short;
    expandPast();
    past.classList.add("is-visible");
  }

  function waitForFrame(token) {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();

        if (token !== loadToken) {
          reject(new Error("Snapshot load superseded"));
          return;
        }

        resolve("soft-timeout");
      }, FRAME_SOFT_TIMEOUT_MS);

      function cleanup() {
        clearTimeout(timeout);
        frame.removeEventListener("load", onLoad);
      }

      function onLoad() {
        cleanup();

        if (token !== loadToken) {
          reject(new Error("Snapshot load superseded"));
          return;
        }

        resolve("load");
      }

      frame.addEventListener("load", onLoad, { once: true });
    });
  }

  async function travelToRandomSnapshot() {
    const token = ++loadToken;
    const startedAt = performance.now();

    showTravel();
    const travelOutput = printTravelLines(token).then(() => {
      if (token !== loadToken || errorBox.classList.contains("is-visible")) {
        return;
      }
      startWaitingIndicator(token);
    });

    try {
      const snapshot = await randomSnapshot();
      if (token !== loadToken) return;

      const loaded = waitForFrame(token);
      frame.src = SNAPSHOT_BASE + "/" + snapshot.cid + "/";

      const [frameResult] = await Promise.all([loaded, travelOutput]);

      if (frameResult === "soft-timeout") {
        console.debug(
          "Snapshot iframe is still loading subresources; revealing rendered content."
        );
      }

      if (token !== loadToken) return;

      beginSnapshotReveal();
      await new Promise((resolve) => setTimeout(resolve, SNAPSHOT_REVEAL_MS));
      stopWaitingIndicator();

      const remaining = MIN_TRAVEL_MS - (performance.now() - startedAt);
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }

      if (token !== loadToken) return;

      currentSnapshot = snapshot;
      frame.classList.remove("is-loading", "is-emerging");
      frame.classList.add("is-visible");
      revealPast(snapshot);
      travel.classList.add("is-hidden");
      travel.classList.remove("is-revealing");
    } catch (error) {
      stopWaitingIndicator();
      if (token !== loadToken) return;

      resetSnapshotReveal({ replaceFrame: true });
      travel.classList.remove("is-hidden", "is-revealing");

      console.error(error);

      if (error.message === "NO_HISTORY") {
        showError(
          "no historical snapshots available yet.",
          "当前没有可用于时间旅行的历史快照。"
        );
      } else if (error.message === "NO_ALTERNATIVE") {
        showError(
          "no other point in time is available.",
          "目前没有另一个可随机的历史快照。"
        );
      } else if (
        /months\.json|latest\.json|Timeline|month index|HTTP/.test(
          error.message
        )
      ) {
        showError(
          "unable to locate the timeline.",
          "读取博客历史索引失败，可以重新尝试。"
        );
      } else {
        showError(
          "connection to the past was lost.",
          "历史快照加载失败，可以随机尝试另一个时间点。"
        );
      }
    }
  }

  pastCollapsed.addEventListener("click", expandPast);
  pastClose.addEventListener("click", collapsePast);
  randomAgain.addEventListener("click", travelToRandomSnapshot);
  retryButton.addEventListener("click", travelToRandomSnapshot);

  travelToRandomSnapshot();
})();
