(() => {
  'use strict';

  const CONFIG = {
    assetBase: 'https://gh-proxy.org/https://raw.githubusercontent.com/Liudon/liudon.github.io/ipfs-history/',
    fallbackAssetBase: 'https://raw.githubusercontent.com/Liudon/liudon.github.io/ipfs-history/',
    gatewayBase: 'https://liudon.xyz/ipfs/',
    indexTimeoutMs: 15000,
    primaryAssetTimeoutMs: 8000,
    imageTimeoutMs: 20000,
    maxActiveLoads: 2,
    cacheMaxPixels: 24000000,
    maxPlaybackPixels: 8000000,
    maxLegacyPixels: 24000000,
    readReleaseMs: 1800,
  };

  const assetBases = [
    CONFIG.assetBase,
    CONFIG.fallbackAssetBase,
  ].filter((value, index, values) => value && values.indexOf(value) === index);

  function assetUrls(relativePath) {
    return assetBases.map((base) => new URL(relativePath, base).href);
  }

  const indexUrls = assetUrls('visual-index.json');
  let preferredAssetSourceIndex = 0;

  function orderedAssetUrls(urls) {
    if (
      preferredAssetSourceIndex <= 0 ||
      preferredAssetSourceIndex >= urls.length
    ) return urls;

    return [
      urls[preferredAssetSourceIndex],
      ...urls.filter((_, index) => index !== preferredAssetSourceIndex),
    ];
  }

  const $ = (id) => document.getElementById(id);
  const timeEl = $('time');
  const counterEl = $('counter');
  const prevBtn = $('prev');
  const nextBtn = $('next');
  const togglePlayBtn = $('togglePlay');
  const speedSelect = $('speedSelect');
  const teleportBtn = $('teleportBtn');
  const timelineToolbar = $('timelineToolbar');
  const historyToolbar = $('historyToolbar');
  const backToTimeline = $('backToTimeline');
  const progressTrack = $('progressTrack');
  const progressFill = $('progressFill');
  const hoverStatus = $('hoverStatus');
  const loadingTip = $('loadingTip');
  const clockEl = $('clock');
  const driveLed = $('driveLed');
  const viewport = $('viewport');
  const contentBox = viewport.querySelector('.content-box');
  let mainImg = $('mainImg');
  const scrollTrack = $('scrollTrack');
  const scrollThumb = $('scrollThumb');
  const arrowUp = $('arrowUp');
  const arrowDown = $('arrowDown');
  const timelineScrollbar = $('timelineScrollbar');
  const historyFrameShell = $('historyFrameShell');
  const historyFrame = $('historyFrame');

  const appleMenuBtn = $('appleMenuBtn');
  const appleDropdown = $('appleDropdown');
  const specialMenuBtn = $('specialMenuBtn');
  const specialDropdown = $('specialDropdown');
  const tmMenuBtn = $('tmMenuBtn');
  const tmDropdown = $('tmDropdown');
  const menuShutdown = $('menuShutdown');
  const menuRestart = $('menuRestart');
  const aboutMacBtn = $('aboutMacBtn');
  const aboutMacDialog = $('aboutMacDialog');
  const closeAboutMacBtn = $('closeAboutMacBtn');
  const aboutTmBtn = $('aboutTmBtn');
  const aboutTmDialog = $('aboutTmDialog');
  const closeAboutTmBtn = $('closeAboutTmBtn');
  const mainAppWindow = $('mainAppWindow');
  const windowCloseBox = $('windowCloseBox');
  const desktopAppIcon = $('desktopAppIcon');
  const systemScreenOverlay = $('systemScreenOverlay');
  const bootContainer = $('bootContainer');
  const shuttingDownContainer = $('shuttingDownContainer');
  const shutdownContainer = $('shutdownContainer');
  const bootStatusText = $('bootStatusText');
  const bootProgressBar = $('bootProgressBar');
  const shutdownStatusText = $('shutdownStatusText');
  const shutdownProgressBar = $('shutdownProgressBar');
  const rebootBtn = $('rebootBtn');

  const state = {
    frames: [],
    indexLoaded: false,
    indexPromise: null,
    power: 'booting',
    window: 'open',
    playMode: 'paused',
    viewMode: 'timeline',
    snapshotIndex: null,
    resumeAfterSnapshot: false,
    displayedIndex: null,
    targetIndex: null,
    sessionId: 0,
    requestId: 0,
    playGeneration: 0,
    windowGeneration: 0,
    reading: false,
    pointerHeld: false,
    documentHidden: document.hidden,
    frameError: null,
    frameElapsedMs: 0,
    frameTickAt: 0,
    loopPhase: 'normal',
    pendingTargetOrigin: null,
    recentUserIntentAt: 0,
    programmaticScroll: false,
  };

  const cache = new Map(); // absolute URL -> resource record
  const loadQueue = [];
  let activeLoads = 0;
  let clockTimer = null;
  let playRaf = null;
  let readingTimer = null;
  let draggedPointerId = null;
  let dragStartY = 0;
  let dragStartThumbTop = 0;

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  function diagnostics(message, detail) {
    console.warn(`[TimeMachine] ${message}`, detail ?? '');
  }

  function setStatus(text) {
    hoverStatus.textContent = text;
  }

  function triggerLedFlicker(duration = 750) {
    if (!driveLed || driveLed.classList.contains('off')) return;
    const session = state.sessionId;
    driveLed.classList.remove('standby');
    driveLed.classList.add('active');
    setTimeout(() => {
      if (session !== state.sessionId || driveLed.classList.contains('off')) return;
      driveLed.classList.remove('active');
      driveLed.classList.add('standby');
    }, duration);
  }

  function startClock() {
    if (clockTimer) return;
    const render = () => {
      const d = new Date();
      clockEl.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };
    render();
    clockTimer = setInterval(render, 1000);
  }

  function formatTime(isoStr) {
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).format(new Date(isoStr));
    } catch {
      return isoStr;
    }
  }

  function historyUrl(cid) {
    return `${CONFIG.gatewayBase.replace(/\/$/, '')}/${cid}/`;
  }

  function currentSnapshotFrame() {
    if (state.snapshotIndex == null) return null;
    return state.frames[state.snapshotIndex] || null;
  }

  function syncViewModeDom() {
    const snapshot = state.viewMode === 'snapshot';

    timelineToolbar.classList.toggle('timeline-hidden', snapshot);
    progressTrack.classList.toggle('timeline-hidden', snapshot);
    viewport.classList.toggle('timeline-hidden', snapshot);
    timelineScrollbar.classList.toggle('timeline-hidden', snapshot);

    historyToolbar.classList.toggle('is-visible', snapshot);
    historyFrameShell.classList.toggle('is-visible', snapshot);

    hoverStatus.classList.toggle('history-status', snapshot);
  }

  function openCurrentSnapshot() {
    if (
      state.viewMode === 'snapshot' ||
      state.displayedIndex == null ||
      !state.frames[state.displayedIndex] ||
      state.power !== 'on'
    ) return;

    const index = state.displayedIndex;
    const frame = state.frames[index];

    state.resumeAfterSnapshot = state.playMode === 'playing';
    state.viewMode = 'snapshot';
    state.snapshotIndex = index;

    stopAutoPlay(false);
    cancelBackgroundLoads();
    closeAllDropdowns();

    syncViewModeDom();
    renderStatus();
    triggerLedFlicker(500);

    historyFrame.src = historyUrl(frame.cid);
  }

  function returnToTimeline({ resume = true } = {}) {
    if (state.viewMode !== 'snapshot') return;

    const shouldResume = resume && state.resumeAfterSnapshot;

    historyFrame.src = 'about:blank';
    state.viewMode = 'timeline';
    state.snapshotIndex = null;
    state.resumeAfterSnapshot = false;

    syncViewModeDom();
    if (state.displayedIndex != null) {
      warmBuffer(state.displayedIndex);
      requestAnimationFrame(syncScrollbar);
    }

    if (
      shouldResume &&
      state.frames.length > 1 &&
      state.power === 'on' &&
      state.window === 'open' &&
      state.viewMode === 'timeline'
    ) {
      startAutoPlay();
    } else {
      updateControls();
      renderStatus();
    }
  }

  function validateScreenshotPath(value) {
    if (typeof value !== 'string' || !value) return null;
    if (!value.startsWith('screenshots/')) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('/') || value.includes('\\')) return null;
    if (/[?#]/.test(value)) return null;

    let decoded;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      return null;
    }

    if (decoded.split('/').some((part) => part === '..' || part === '.')) return null;
    if (!/\.(?:webp|png|jpe?g)$/i.test(decoded)) return null;

    const urls = assetUrls(value);
    if (!urls.length) return null;

    return {
      path: value,
      urls,
    };
  }

  function normalizeFrames(data) {
    if (!data || data.version !== 1 || !Array.isArray(data.frames)) {
      throw new Error(data?.version && data.version !== 1 ? '档案格式暂不支持' : '档案清单格式错误');
    }
    const seenCid = new Set();
    const valid = [];
    data.frames.forEach((raw, sourceIndex) => {
      const reasons = [];
      const cid = typeof raw?.cid === 'string' ? raw.cid.trim() : '';
      if (!cid || cid.includes('/') || cid.includes('\\')) reasons.push('invalid cid');
      const deployedAt = typeof raw?.deployed_at === 'string' ? raw.deployed_at.trim() : '';
      const time = Date.parse(deployedAt);
      if (!deployedAt || !Number.isFinite(time) || !/(?:Z|[+-]\d\d:\d\d)$/.test(deployedAt)) reasons.push('invalid deployed_at');
      const screenshot = validateScreenshotPath(raw?.screenshot);
      if (!screenshot) reasons.push('invalid screenshot');
      const hasWidth = raw?.width !== undefined && raw?.width !== null;
      const hasHeight = raw?.height !== undefined && raw?.height !== null;
      if (hasWidth !== hasHeight) reasons.push('partial dimensions');
      if (hasWidth && (!Number.isSafeInteger(raw.width) || raw.width <= 0 || !Number.isSafeInteger(raw.height) || raw.height <= 0)) reasons.push('invalid dimensions');
      if (hasWidth && raw.width * raw.height > Number.MAX_SAFE_INTEGER) reasons.push('invalid pixels');
      if (raw?.bytes != null && (!Number.isSafeInteger(raw.bytes) || raw.bytes <= 0)) reasons.push('invalid bytes');
      if (reasons.length) {
        diagnostics('filtered invalid frame', { sourceIndex, cid, reasons });
        return;
      }
      if (seenCid.has(cid)) {
        diagnostics('filtered duplicate cid', { sourceIndex, cid });
        return;
      }
      seenCid.add(cid);
      valid.push({
        ...raw,
        cid,
        deployed_at: deployedAt,
        _time: time,
        _path: screenshot.path,
        _urls: screenshot.urls,
        _url: screenshot.urls[0],
      });
    });
    valid.sort((a, b) => a._time - b._time || a.cid.localeCompare(b.cid));
    if (data.visual_count !== undefined && data.visual_count !== valid.length) {
      diagnostics('visual_count differs from valid frame count', { visual_count: data.visual_count, valid: valid.length });
    }
    return valid;
  }

  function createTimeoutError(label = '请求超时') {
    const error = new Error(label);
    error.name = 'TimeoutError';
    return error;
  }

  async function fetchWithTimeout(
    url,
    options = {},
    timeoutMs,
    externalSignal = null,
    consume = response => response,
  ) {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromExternal = () => {
      if (!controller.signal.aborted) {
        controller.abort(externalSignal?.reason || new DOMException('Cancelled', 'AbortError'));
      }
    };
    if (externalSignal?.aborted) abortFromExternal();
    else externalSignal?.addEventListener('abort', abortFromExternal, { once: true });

    let rejectTimeout;
    const deadline = new Promise((_, reject) => {
      rejectTimeout = reject;
    });
    const timer = setTimeout(() => {
      if (!controller.signal.aborted) {
        timedOut = true;
        const error = createTimeoutError();
        controller.abort(error);
        rejectTimeout(error);
      }
    }, timeoutMs);

    try {
      return await Promise.race([
        (async () => {
          const response = await fetch(url, {
            ...options,
            signal: controller.signal,
          });
          return consume(response);
        })(),
        deadline,
      ]);
    } catch (error) {
      if (timedOut) throw createTimeoutError();
      throw error;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    }
  }

  async function decodeWithTimeout(img, timeoutMs, externalSignal) {
    let timer;
    let abortListener;
    const cancelled = new Promise((_, reject) => {
      abortListener = () => reject(
        externalSignal.reason || new DOMException('Cancelled', 'AbortError'),
      );
      if (externalSignal.aborted) abortListener();
      else externalSignal.addEventListener('abort', abortListener, { once: true });
    });
    const timedOut = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(createTimeoutError('图片解码超时')),
        timeoutMs,
      );
    });

    try {
      await Promise.race([img.decode(), cancelled, timedOut]);
    } finally {
      clearTimeout(timer);
      externalSignal.removeEventListener('abort', abortListener);
    }
  }

  async function loadIndex(force = false) {
    if (state.indexLoaded && !force) return state.frames;
    if (state.indexPromise && !force) return state.indexPromise;

    const session = state.sessionId;
    const promise = (async () => {
      let lastError;

      for (const [sourceIndex, url] of indexUrls.entries()) {
        try {
          const data = await fetchWithTimeout(
            url,
            { cache: force ? 'reload' : 'default' },
            sourceIndex === 0
              ? CONFIG.primaryAssetTimeoutMs
              : CONFIG.indexTimeoutMs,
            null,
            async response => {
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              return response.json();
            },
          );
          preferredAssetSourceIndex = sourceIndex;
          const frames = normalizeFrames(data);
          if (!frames.length) throw new Error('暂无可用快照');

          if (session !== state.sessionId) {
            throw new DOMException('Stale session', 'AbortError');
          }

          state.frames = frames;
          state.indexLoaded = true;
          diagnostics('index source ready', { url });
          return frames;
        } catch (error) {
          if (error?.name === 'AbortError' && session !== state.sessionId) throw error;
          lastError = error;
          diagnostics('index source failed; trying fallback', {
            url,
            error: error.message,
          });
        }
      }

      throw lastError || new Error('档案清单读取失败');
    })();

    state.indexPromise = promise;
    try {
      return await promise;
    } finally {
      if (state.indexPromise === promise) state.indexPromise = null;
    }
  }

  function framePixels(frame) {
    if (
      Number.isSafeInteger(frame.width) &&
      Number.isSafeInteger(frame.height)
    ) {
      return frame.width * frame.height;
    }
    return null;
  }

  function releaseRecord(record, { remove = true } = {}) {
    if (!record) return;
    record.cancelled = true;
    if (record.controller && !record.controller.signal.aborted) {
      record.controller.abort(new DOMException('Resource released', 'AbortError'));
    }
    if (record.objectUrl) {
      URL.revokeObjectURL(record.objectUrl);
      record.objectUrl = null;
    }
    if (record.task) {
      record.task.cancel(new DOMException('Resource released', 'AbortError'));
    }
    if (remove && cache.get(record.url) === record) {
      cache.delete(record.url);
    }
  }

  function pumpQueue() {
    while (activeLoads < CONFIG.maxActiveLoads && loadQueue.length) {
      loadQueue.sort((a, b) =>
        a.priority - b.priority ||
        a.queuedAt - b.queuedAt
      );
      const task = loadQueue.shift();
      if (task.cancelled) continue;
      task.started = true;
      activeLoads += 1;
      task.run().finally(() => {
        activeLoads -= 1;
        pumpQueue();
      });
    }
  }

  function enqueue(run, priority) {
    let resolvePromise;
    let rejectPromise;
    let settled = false;

    const settle = (kind, value) => {
      if (settled) return;
      settled = true;
      if (kind === 'resolve') resolvePromise(value);
      else rejectPromise(value);
    };

    const task = {
      priority: priority === 'foreground' ? 0 : 1,
      queuedAt: performance.now(),
      cancelled: false,
      started: false,
      cancel: (reason = new DOMException('Cancelled', 'AbortError')) => {
        task.cancelled = true;
        if (!task.started) settle('reject', reason);
      },
      run: async () => {
        if (task.cancelled) return;
        try {
          settle('resolve', await run());
        } catch (error) {
          settle('reject', error);
        }
      },
    };

    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    loadQueue.push(task);
    pumpQueue();
    return { task, promise };
  }

  function promoteRecord(record) {
    if (!record || record.state !== 'loading') return;
    record.priority = 'foreground';
    if (record.task && !record.task.started) {
      record.task.priority = 0;
      record.task.queuedAt = -1;
      pumpQueue();
    }
  }

  async function prepareImage(record) {
    const frame = record.frame;
    let lastError;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (record.cancelled || record.controller.signal.aborted) {
        throw new DOMException('Cancelled', 'AbortError');
      }
      const attemptStartedAt = performance.now();

      for (const sourceUrl of orderedAssetUrls(frame._urls)) {
        try {
          const originalSourceIndex = frame._urls.indexOf(sourceUrl);
          const attemptRemainingMs = Math.max(
            1,
            CONFIG.imageTimeoutMs - (performance.now() - attemptStartedAt),
          );
          const timeoutMs = Math.min(
            originalSourceIndex === 0
              ? CONFIG.primaryAssetTimeoutMs
              : CONFIG.imageTimeoutMs,
            attemptRemainingMs,
          );
          const sourceStartedAt = performance.now();
          const blob = await fetchWithTimeout(
            sourceUrl,
            { cache: 'default', mode: 'cors' },
            timeoutMs,
            record.controller.signal,
            async response => {
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              return response.blob();
            },
          );

          if (
            Number.isSafeInteger(frame.bytes) &&
            frame.bytes > 0 &&
            blob.size !== frame.bytes
          ) {
            throw new Error(
              `文件大小不匹配：索引 ${frame.bytes} bytes，实际 ${blob.size} bytes`,
            );
          }

          const objectUrl = URL.createObjectURL(blob);
          const img = new Image();
          img.id = 'mainImg';
          img.alt = '快照截图';
          img.style.opacity = '0';
          img.src = objectUrl;

          try {
            const remainingMs = Math.max(
              1,
              timeoutMs - (performance.now() - sourceStartedAt),
            );
            await decodeWithTimeout(
              img,
              remainingMs,
              record.controller.signal,
            );
          } catch (error) {
            URL.revokeObjectURL(objectUrl);
            throw error;
          }

          if (record.cancelled || record.controller.signal.aborted) {
            URL.revokeObjectURL(objectUrl);
            throw new DOMException('Cancelled', 'AbortError');
          }

          const width = img.naturalWidth;
          const height = img.naturalHeight;
          const pixels = width * height;

          if (
            !Number.isSafeInteger(width) ||
            !Number.isSafeInteger(height) ||
            width <= 0 ||
            height <= 0 ||
            !Number.isSafeInteger(pixels)
          ) {
            URL.revokeObjectURL(objectUrl);
            throw new Error('图片尺寸无效');
          }

          if (
            frame.width &&
            (frame.width !== width || frame.height !== height)
          ) {
            URL.revokeObjectURL(objectUrl);
            throw new Error(
              `尺寸不匹配：索引 ${frame.width}x${frame.height}，实际 ${width}x${height}`,
            );
          }

          const limit = frame.width
            ? CONFIG.maxPlaybackPixels
            : CONFIG.maxLegacyPixels;

          if (pixels > limit) {
            URL.revokeObjectURL(objectUrl);
            throw new Error(
              `图片像素超出限制：${width}x${height}`,
            );
          }

          if (originalSourceIndex >= 0) {
            preferredAssetSourceIndex = originalSourceIndex;
          }

          diagnostics('image source ready', {
            index: record.index,
            sourceUrl,
            preferredAssetSourceIndex,
          });

          return {
            img,
            objectUrl,
            width,
            height,
            pixels,
            bytes: blob.size,
            sourceUrl,
          };
        } catch (error) {
          lastError = error;
          if (
            error?.name === 'AbortError' &&
            record.controller.signal.aborted
          ) throw error;
          diagnostics('image source failed; trying fallback', {
            index: record.index,
            sourceUrl,
            attempt,
            error: error.message,
          });
          if (
            performance.now() - attemptStartedAt >=
            CONFIG.imageTimeoutMs
          ) break;
        }
      }

      const foreground = record.priority === 'foreground';
      if (!foreground || attempt >= 3) break;
      await sleep(attempt === 1 ? 500 : 1000);
    }

    throw lastError || new Error('图片读取失败');
  }

  function ensureImage(index, priority = 'background') {
    if (index < 0 || index >= state.frames.length) {
      return Promise.reject(new Error('frame out of range'));
    }

    const frame = state.frames[index];
    const url = frame._url;
    const existing = cache.get(url);

    if (existing?.state === 'ready') {
      existing.lastUsed = performance.now();
      return Promise.resolve(existing);
    }

    if (existing?.state === 'loading') {
      if (priority === 'foreground') promoteRecord(existing);
      return existing.promise;
    }

    if (existing) {
      releaseRecord(existing);
      if (priority !== 'foreground') {
        return Promise.reject(existing.error || new Error('background preload failed'));
      }
    }

    const taskId = Symbol(url);
    const record = {
      url,
      state: 'loading',
      taskId,
      index,
      frame,
      priority,
      controller: new AbortController(),
      cancelled: false,
      lastUsed: performance.now(),
      promise: null,
      task: null,
      objectUrl: null,
    };

    const queued = enqueue(async () => {
      try {
        const prepared = await prepareImage(record);
        if (
          record.cancelled ||
          cache.get(url)?.taskId !== taskId
        ) {
          URL.revokeObjectURL(prepared.objectUrl);
          throw new DOMException('Stale resource', 'AbortError');
        }

        Object.assign(record, prepared, {
          state: 'ready',
          lastUsed: performance.now(),
        });
        trimCache(state.displayedIndex ?? record.index);
        return record;
      } catch (error) {
        if (cache.get(url)?.taskId === taskId) {
          Object.assign(record, {
            state: 'failed',
            error,
          });
        }
        throw error;
      }
    }, priority);

    record.task = queued.task;
    record.promise = queued.promise;
    cache.set(url, record);
    return record.promise;
  }

  function desiredIndices(center) {
    const total = state.frames.length;
    if (!total) return [];
    const raw = [center - 1, center, center + 1, center + 2, center + 3];
    const values = [];
    for (const n of raw) {
      const wrapped = ((n % total) + total) % total;
      if (!values.includes(wrapped)) values.push(wrapped);
    }
    return values;
  }

  function trimCache(center = state.displayedIndex ?? 0) {
    const protectedUrls = new Set(
      desiredIndices(center)
        .map((index) => state.frames[index]?._url)
        .filter(Boolean),
    );
    if (state.targetIndex != null) {
      protectedUrls.add(state.frames[state.targetIndex]?._url);
    }
    if (state.displayedIndex != null) {
      protectedUrls.add(state.frames[state.displayedIndex]?._url);
    }

    let readyPixels = [...cache.values()]
      .filter((record) => record.state === 'ready')
      .reduce((sum, record) => sum + (record.pixels || 0), 0);

    const evict = [...cache.values()]
      .filter(
        (record) =>
          record.state !== 'loading' &&
          !protectedUrls.has(record.url),
      )
      .sort((a, b) => a.lastUsed - b.lastUsed);

    for (const record of evict) {
      if (
        cache.size <= 5 &&
        readyPixels <= CONFIG.cacheMaxPixels
      ) break;

      readyPixels -= record.pixels || 0;
      releaseRecord(record);
    }

    if (readyPixels > CONFIG.cacheMaxPixels) {
      const order = desiredIndices(center).map(
        (index, distance) => ({
          url: state.frames[index]._url,
          distance,
        }),
      );

      const candidates = [...cache.values()]
        .filter(
          (record) =>
            record.state === 'ready' &&
            record.index !== state.displayedIndex &&
            record.index !== state.targetIndex,
        )
        .sort(
          (a, b) =>
            (order.find((item) => item.url === b.url)?.distance ?? 99) -
            (order.find((item) => item.url === a.url)?.distance ?? 99),
        );

      for (const record of candidates) {
        if (readyPixels <= CONFIG.cacheMaxPixels) break;
        readyPixels -= record.pixels || 0;
        releaseRecord(record);
      }
    }
  }

  function cancelBackgroundLoads() {
    for (const record of [...cache.values()]) {
      if (
        record.state === 'loading' &&
        record.priority === 'background'
      ) {
        releaseRecord(record);
      }
    }
  }

  function makeRoomForForeground(index) {
    const targetUrl = state.frames[index]?._url;
    for (const record of [...cache.values()]) {
      if (record.state === 'loading' && record.url !== targetUrl) {
        releaseRecord(record);
      }
    }

    const displayedUrl = state.displayedIndex == null
      ? null
      : state.frames[state.displayedIndex]?._url;
    const existingTarget = cache.get(targetUrl);
    const targetReservation = existingTarget
      ? 0
      : (framePixels(state.frames[index]) ?? CONFIG.maxLegacyPixels);
    let projectedPixels = [...cache.values()].reduce(
      (sum, record) => sum + (
        record.state === 'ready'
          ? (record.pixels || 0)
          : record.state === 'loading'
            ? (framePixels(record.frame) ?? CONFIG.maxLegacyPixels)
            : 0
      ),
      targetReservation,
    );
    const candidates = [...cache.values()]
      .filter(record =>
        record.state === 'ready' &&
        record.url !== displayedUrl &&
        record.url !== targetUrl
      )
      .sort((a, b) => a.lastUsed - b.lastUsed);

    for (const record of candidates) {
      if (projectedPixels <= CONFIG.cacheMaxPixels) break;
      projectedPixels -= record.pixels || 0;
      releaseRecord(record);
    }
  }

  function warmBuffer(center) {
    if (
      state.frames.length <= 1 ||
      state.power !== 'on' ||
      state.window !== 'open'
    ) return;

    const ordered = [];
    for (const delta of [1, 2, 3, -1]) {
      const index =
        ((center + delta) % state.frames.length +
          state.frames.length) %
        state.frames.length;
      if (!ordered.includes(index)) ordered.push(index);
    }

    let reservedPixels = [...cache.values()].reduce((sum, record) => {
      if (record.state === 'ready') return sum + (record.pixels || 0);
      if (record.state === 'loading') {
        return sum + (framePixels(record.frame) ?? CONFIG.maxLegacyPixels);
      }
      return sum;
    }, 0);

    for (const [position, index] of ordered.entries()) {
      const url = state.frames[index]._url;
      if (cache.has(url)) continue;
      const pixels = framePixels(state.frames[index]);
      if (pixels == null && position !== 0) continue;
      const reservation = pixels ?? CONFIG.maxLegacyPixels;
      if (
        (pixels && pixels > CONFIG.maxPlaybackPixels) ||
        reservedPixels + reservation > CONFIG.cacheMaxPixels
      ) continue;

      reservedPixels += reservation;
      ensureImage(index, 'background').catch((error) => {
        if (error?.name !== 'AbortError') {
          diagnostics('background preload failed', {
            index,
            error: error.message,
          });
        }
      });
    }

    trimCache(center);
  }

  function syncScrollbar() {
    const maxScroll = viewport.scrollHeight - viewport.clientHeight;
    const maxThumbTravel = scrollTrack.clientHeight - scrollThumb.clientHeight;
    if (maxScroll <= 0 || maxThumbTravel <= 0) {
      scrollThumb.style.top = '0px';
      return;
    }
    const ratio = Math.min(Math.max(viewport.scrollTop / maxScroll, 0), 1);
    scrollThumb.style.top = `${ratio * maxThumbTravel}px`;
  }

  function markUserIntent() {
    if (state.pendingTargetOrigin === 'auto') {
      state.requestId += 1;
      state.targetIndex = state.displayedIndex;
      state.pendingTargetOrigin = null;
      updateControls();
    }
    state.recentUserIntentAt = performance.now();
    state.reading = true;
    setStatus('[阅读中 暂停切页]');
    clearTimeout(readingTimer);
    readingTimer = setTimeout(() => {
      if (state.pointerHeld) return;
      state.reading = false;
      if (state.playMode === 'playing') resetPlaybackProgress();
      renderStatus();
    }, CONFIG.readReleaseMs);
  }

  function resetScroll() {
    state.programmaticScroll = true;
    viewport.scrollTop = 0;
    syncScrollbar();
    requestAnimationFrame(() => { state.programmaticScroll = false; });
  }

  viewport.addEventListener('wheel', markUserIntent, { passive: true });
  viewport.addEventListener('pointerdown', () => { state.pointerHeld = true; markUserIntent(); }, { passive: true });
  viewport.addEventListener('pointerup', () => { state.pointerHeld = false; markUserIntent(); }, { passive: true });
  viewport.addEventListener('pointercancel', () => { state.pointerHeld = false; markUserIntent(); }, { passive: true });
  viewport.addEventListener('scroll', () => {
    syncScrollbar();
    if (!state.programmaticScroll && performance.now() - state.recentUserIntentAt < 500) markUserIntent();
  }, { passive: true });

  function scrollByUser(delta) {
    markUserIntent();
    viewport.scrollBy({ top: delta, behavior: 'smooth' });
  }
  arrowUp.addEventListener('click', () => scrollByUser(-140));
  arrowDown.addEventListener('click', () => scrollByUser(140));

  scrollThumb.addEventListener('pointerdown', (event) => {
    draggedPointerId = event.pointerId;
    state.pointerHeld = true;
    markUserIntent();
    dragStartY = event.clientY;
    dragStartThumbTop = parseFloat(scrollThumb.style.top || 0);
    scrollThumb.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  scrollThumb.addEventListener('pointermove', (event) => {
    if (draggedPointerId !== event.pointerId) return;
    const maxThumbTravel = scrollTrack.clientHeight - scrollThumb.clientHeight;
    const maxScroll = viewport.scrollHeight - viewport.clientHeight;
    const top = Math.max(0, Math.min(dragStartThumbTop + event.clientY - dragStartY, maxThumbTravel));
    scrollThumb.style.top = `${top}px`;
    if (maxThumbTravel > 0) viewport.scrollTop = (top / maxThumbTravel) * maxScroll;
  });
  const finishThumbDrag = (event) => {
    if (draggedPointerId !== event.pointerId) return;
    draggedPointerId = null;
    state.pointerHeld = false;
    try { scrollThumb.releasePointerCapture(event.pointerId); } catch {}
    markUserIntent();
  };
  scrollThumb.addEventListener('pointerup', finishThumbDrag);
  scrollThumb.addEventListener('pointercancel', finishThumbDrag);
  scrollThumb.addEventListener('lostpointercapture', () => {
    draggedPointerId = null;
    state.pointerHeld = false;
  });
  scrollTrack.addEventListener('click', (event) => {
    if (event.target === scrollThumb) return;
    markUserIntent();
    const rect = scrollTrack.getBoundingClientRect();
    const ratio = Math.max(0, Math.min((event.clientY - rect.top) / rect.height, 1));
    viewport.scrollTo({ top: ratio * (viewport.scrollHeight - viewport.clientHeight), behavior: 'smooth' });
  });

  function renderStatus() {
    if (state.power !== 'on') return;
    if (state.frameError) { setStatus('[这份档案读取失败]'); return; }
    if (state.window === 'closed') { setStatus('[双击桌面图标重新打开]'); return; }
    if (state.viewMode === 'snapshot') {
      setStatus('● 正在浏览历史');
      return;
    }
    if (state.reading || state.pointerHeld) { setStatus('[阅读中 暂停切页]'); return; }
    if (state.targetIndex != null && state.targetIndex !== state.displayedIndex) { setStatus('[正在读取下一份档案…]'); return; }
    if (state.playMode !== 'playing') { setStatus('[已暂停]'); return; }
    if (state.loopPhase === 'hold') {
      setStatus('[ 已抵达最新纪元 · 即将开启新一轮时光穿梭 ]');
      return;
    }
    if (state.loopPhase === 'rewind') {
      setStatus('[ 磁头归位 · 返回最初纪元… ]');
      return;
    }
    setStatus('滚轮上下浏览');
  }

  function updateControls() {
    const count = state.frames.length;
    const displayed = state.displayedIndex;
    counterEl.textContent = displayed == null ? `0/${count}` : `${displayed + 1}/${count}`;
    const target = state.targetIndex ?? displayed ?? 0;
    prevBtn.disabled = count <= 1 || target <= 0;
    nextBtn.disabled = count <= 1 || target >= count - 1;
    togglePlayBtn.disabled = count <= 1;
    const mobile = matchMedia('(max-width: 600px)').matches;
    const paused = state.playMode !== 'playing';
    togglePlayBtn.textContent = mobile
      ? (paused ? '▶' : '❚❚')
      : (paused ? '▶ 播放' : '❚❚ 暂停');
    togglePlayBtn.title = paused ? '播放' : '暂停';
    togglePlayBtn.setAttribute('aria-label', paused ? '播放' : '暂停');
  }

  function commitFrame(index, resource, context) {
    if (context.sessionId !== state.sessionId || context.requestId !== state.requestId) return false;
    if (state.power !== 'on' && state.power !== 'booting') return false;
    if (context.origin === 'auto' && (state.playMode !== 'playing' || context.playGeneration !== state.playGeneration || state.reading || state.pointerHeld || state.documentHidden)) return false;
    const frame = state.frames[index];
    const img = resource.img;
    img.id = 'mainImg';
    img.alt = '快照截图';
    img.style.opacity = '1';
    contentBox.replaceChildren(img);
    mainImg = img;
    state.displayedIndex = index;
    state.targetIndex = index;
    state.pendingTargetOrigin = null;
    state.frameError = null;
    loadingTip.style.display = 'none';
    loadingTip.onclick = null;
    timeEl.textContent = formatTime(frame.deployed_at);
    resetScroll();
    updateControls();
    state.frameElapsedMs = 0;
    state.frameTickAt = performance.now();
    state.loopPhase = 'normal';
    progressFill.style.width = '0%';
    requestAnimationFrame(syncScrollbar);
    warmBuffer(index);
    renderStatus();
    return true;
  }

  async function showFrame(
    index,
    origin = 'manual',
    playGeneration = state.playGeneration,
    { flicker = true } = {},
  ) {
    if (index < 0 || index >= state.frames.length) return false;
    const context = {
      sessionId: state.sessionId,
      requestId: ++state.requestId,
      origin,
      playGeneration,
    };
    state.targetIndex = index;
    state.pendingTargetOrigin = origin;
    state.frameError = null;
    updateControls();
    renderStatus();
    if (flicker) triggerLedFlicker(650);
    try {
      makeRoomForForeground(index);
      const resource = await ensureImage(index, 'foreground');
      return commitFrame(index, resource, context);
    } catch (error) {
      if (context.sessionId !== state.sessionId || context.requestId !== state.requestId || error?.name === 'AbortError') return false;
      state.targetIndex = state.displayedIndex;
      state.pendingTargetOrigin = null;
      state.frameError = { index, error };
      if (origin === 'auto') stopAutoPlay(false);
      loadingTip.style.display = 'block';
      loadingTip.textContent = '这份档案读取失败 · 点击重试';
      loadingTip.onclick = async () => {
        loadingTip.style.display = 'none';
        cache.delete(state.frames[index]._url);
        await showFrame(index, 'manual');
      };
      diagnostics('foreground frame failed', { index, error: error.message });
      updateControls();
      renderStatus();
      return false;
    }
  }

  function resetPlaybackProgress() {
    state.frameElapsedMs = 0;
    state.frameTickAt = performance.now();
    state.loopPhase = 'normal';
    progressFill.style.transition = '';
    progressFill.style.width = '0%';
  }

  function stopAutoPlay(resetProgress = true) {
    state.playMode = 'paused';
    state.playGeneration += 1;
    cancelAnimationFrame(playRaf);
    playRaf = null;
    state.requestId += 1; // invalidate pending automatic commit
    state.pendingTargetOrigin = null;
    if (resetProgress) resetPlaybackProgress();
    updateControls();
    renderStatus();
  }

  function playbackContextValid(generation) {
    return (
      generation === state.playGeneration &&
      state.playMode === 'playing' &&
      state.power === 'on' &&
      state.window === 'open'
    );
  }

  async function flashDriveSeek(generation, times = 3) {
    const session = state.sessionId;

    for (let index = 0; index < times; index += 1) {
      if (
        !playbackContextValid(generation) ||
        session !== state.sessionId ||
        driveLed.classList.contains('off')
      ) return false;

      driveLed.classList.remove('standby');
      driveLed.classList.add('active');
      await sleep(120);

      if (
        !playbackContextValid(generation) ||
        session !== state.sessionId
      ) return false;

      driveLed.classList.remove('active');
      driveLed.classList.add('standby');
      await sleep(index === times - 1 ? 160 : 105);
    }

    return true;
  }

  async function rewindProgressToZero(generation) {
    if (!playbackContextValid(generation)) return false;

    progressFill.style.transition = 'width 350ms ease-in-out';

    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });

    if (!playbackContextValid(generation)) {
      progressFill.style.transition = '';
      return false;
    }

    progressFill.style.width = '0%';
    await sleep(380);
    progressFill.style.transition = '';

    return playbackContextValid(generation);
  }

  async function rewindToBeginning(generation) {
    if (!playbackContextValid(generation)) return false;

    const requestMarker = state.requestId;
    state.pendingTargetOrigin = 'auto';
    state.loopPhase = 'rewind';
    renderStatus();

    // Frame 0 should normally already be warm from the sliding buffer.
    // Promote it now so the ritual never ends on an unloaded frame.
    try {
      await ensureImage(0, 'foreground');
    } catch (error) {
      if (error?.name === 'AbortError') return false;
      state.frameError = { index: 0, error };
      stopAutoPlay(false);
      diagnostics('rewind target failed', { error: error.message });
      renderStatus();
      return false;
    }

    if (
      !playbackContextValid(generation) ||
      requestMarker !== state.requestId
    ) return false;
    if (!(await flashDriveSeek(generation, 3))) return false;
    if (requestMarker !== state.requestId) return false;
    if (!(await rewindProgressToZero(generation))) return false;
    if (requestMarker !== state.requestId) return false;

    return showFrame(
      0,
      'auto',
      generation,
      { flicker: false },
    );
  }

  function startAutoPlay() {
    if (
      state.frames.length <= 1 ||
      state.displayedIndex == null ||
      state.power !== 'on' ||
      state.window !== 'open'
    ) return;

    state.playMode = 'playing';
    const generation = ++state.playGeneration;
    state.frameTickAt = performance.now();

    const initialDuration = Number(speedSelect.value) || 4500;
    const initialIsLast =
      state.displayedIndex === state.frames.length - 1;
    state.loopPhase =
      initialIsLast &&
      state.frameElapsedMs >= initialDuration
        ? 'hold'
        : 'normal';

    updateControls();
    renderStatus();
    cancelAnimationFrame(playRaf);

    const tick = async (now) => {
      if (!playbackContextValid(generation)) return;

      if (
        state.reading ||
        state.pointerHeld ||
        state.documentHidden
      ) {
        // Freeze elapsed time while the user is reading, dragging,
        // or the tab is hidden.
        state.frameTickAt = now;
        playRaf = requestAnimationFrame(tick);
        return;
      }

      const duration = Number(speedSelect.value) || 4500;
      const isLast =
        state.displayedIndex === state.frames.length - 1;
      const totalDuration = isLast
        ? duration * 2
        : duration;

      const delta = Math.max(0, now - state.frameTickAt);
      state.frameTickAt = now;
      state.frameElapsedMs = Math.min(
        state.frameElapsedMs + delta,
        totalDuration,
      );

      // The last frame fills normally, then stays at 100% for one
      // additional frame duration as a deliberate Hold phase.
      const progress = Math.min(
        state.frameElapsedMs / duration,
        1,
      );
      progressFill.style.width = `${progress * 100}%`;

      if (
        isLast &&
        state.frameElapsedMs >= duration &&
        state.loopPhase !== 'hold' &&
        state.loopPhase !== 'rewind'
      ) {
        state.loopPhase = 'hold';
        renderStatus();
      }

      if (state.frameElapsedMs < totalDuration) {
        playRaf = requestAnimationFrame(tick);
        return;
      }

      progressFill.style.width = '100%';

      if (isLast) {
        const ok = await rewindToBeginning(generation);

        if (
          !ok ||
          !playbackContextValid(generation)
        ) {
          if (
            playbackContextValid(generation) &&
            !state.frameError
          ) {
            playRaf = requestAnimationFrame(tick);
          }
          return;
        }

        playRaf = requestAnimationFrame(tick);
        return;
      }

      const nextIndex = state.displayedIndex + 1;
      const ok = await showFrame(
        nextIndex,
        'auto',
        generation,
      );

      if (
        !ok ||
        !playbackContextValid(generation)
      ) {
        if (
          playbackContextValid(generation) &&
          !state.frameError
        ) {
          playRaf = requestAnimationFrame(tick);
        }
        return;
      }

      playRaf = requestAnimationFrame(tick);
    };

    playRaf = requestAnimationFrame(tick);
  }

  teleportBtn.addEventListener('click', openCurrentSnapshot);
  backToTimeline.addEventListener('click', () => returnToTimeline());

  togglePlayBtn.addEventListener('click', () => {
    if (state.playMode === 'playing') {
      stopAutoPlay(false);
    } else {
      startAutoPlay();
    }
  });
  prevBtn.addEventListener('click', async () => {
    stopAutoPlay();
    const base = state.targetIndex ?? state.displayedIndex ?? 0;
    await showFrame(Math.max(0, base - 1), 'manual');
  });
  nextBtn.addEventListener('click', async () => {
    stopAutoPlay();
    const base = state.targetIndex ?? state.displayedIndex ?? 0;
    await showFrame(Math.min(state.frames.length - 1, base + 1), 'manual');
  });
  function syncSpeedLabels() {
    const mobile = matchMedia('(max-width: 600px)').matches;
    for (const option of speedSelect.options) {
      const label = mobile
        ? option.dataset.mobileLabel
        : option.dataset.desktopLabel;
      if (label) option.textContent = label;
    }
  }

  const speedLabelMedia = matchMedia('(max-width: 600px)');

  function syncMobileControlLabels() {
    syncSpeedLabels();
    updateControls();
  }

  syncMobileControlLabels();
  if (speedLabelMedia.addEventListener) {
    speedLabelMedia.addEventListener('change', syncMobileControlLabels);
  } else if (speedLabelMedia.addListener) {
    speedLabelMedia.addListener(syncMobileControlLabels);
  }

  speedSelect.addEventListener('change', () => {
    if (state.playMode === 'playing') { stopAutoPlay(); startAutoPlay(); }
  });

  function closeAppWindow() {
    stopAutoPlay(false);
    cancelBackgroundLoads();
    state.window = 'closing';
    const generation = ++state.windowGeneration;
    mainAppWindow.classList.remove('window-opening');
    mainAppWindow.classList.add('window-closing');
    renderStatus();
    setTimeout(() => {
      if (generation !== state.windowGeneration || state.window !== 'closing') return;
      mainAppWindow.classList.add('window-hidden');
      mainAppWindow.classList.remove('window-closing');
      state.window = 'closed';
      renderStatus();
    }, 220);
  }

  function openAppWindow() {
    if (state.window === 'open' || state.window === 'opening') return;
    const generation = ++state.windowGeneration;
    state.window = 'opening';
    mainAppWindow.classList.remove('window-hidden', 'window-closing');
    mainAppWindow.classList.add('window-opening');
    desktopAppIcon.classList.remove('selected');
    setTimeout(() => {
      if (generation !== state.windowGeneration || state.window !== 'opening') return;
      mainAppWindow.classList.remove('window-opening');
      state.window = 'open';
      syncScrollbar();
      if (state.viewMode === 'timeline') {
        if (state.displayedIndex != null) {
          warmBuffer(state.displayedIndex);
        }
        if (state.frames.length > 1) startAutoPlay();
      }
      renderStatus();
    }, 240);
  }

  windowCloseBox.addEventListener('click', event => { event.stopPropagation(); closeAppWindow(); });
  let lastDesktopClick = 0;
  desktopAppIcon.tabIndex = 0;
  desktopAppIcon.setAttribute('role', 'button');
  desktopAppIcon.setAttribute('aria-label', '打开博客时光机');
  desktopAppIcon.addEventListener('click', event => {
    const now = Date.now();
    desktopAppIcon.classList.add('selected');
    const coarse = matchMedia('(pointer: coarse)').matches;
    if (coarse || now - lastDesktopClick < 350) openAppWindow();
    lastDesktopClick = now;
  });
  desktopAppIcon.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openAppWindow(); }
  });
  document.querySelector('.screen-workspace').addEventListener('click', event => {
    if (!desktopAppIcon.contains(event.target)) desktopAppIcon.classList.remove('selected');
  });

  function closeAllDropdowns() {
    for (const [button, dropdown] of [[appleMenuBtn, appleDropdown], [specialMenuBtn, specialDropdown], [tmMenuBtn, tmDropdown]]) {
      dropdown.classList.remove('show');
      button.classList.remove('active');
    }
  }
  function toggleDropdown(button, dropdown, event) {
    event.stopPropagation();
    const open = dropdown.classList.contains('show');
    closeAllDropdowns();
    if (!open) { dropdown.classList.add('show'); button.classList.add('active'); }
  }
  appleMenuBtn.addEventListener('click', event => toggleDropdown(appleMenuBtn, appleDropdown, event));
  specialMenuBtn.addEventListener('click', event => toggleDropdown(specialMenuBtn, specialDropdown, event));
  tmMenuBtn.addEventListener('click', event => toggleDropdown(tmMenuBtn, tmDropdown, event));
  document.addEventListener('click', closeAllDropdowns);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeAllDropdowns(); });
  aboutMacBtn.addEventListener('click', () => { closeAllDropdowns(); aboutMacDialog.classList.add('show'); });
  closeAboutMacBtn.addEventListener('click', () => aboutMacDialog.classList.remove('show'));
  aboutTmBtn.addEventListener('click', () => { closeAllDropdowns(); aboutTmDialog.classList.add('show'); });
  closeAboutTmBtn.addEventListener('click', () => aboutTmDialog.classList.remove('show'));

  function clearImageResources() {
    for (const record of [...cache.values()]) {
      releaseRecord(record);
    }
    for (const task of loadQueue.splice(0)) {
      task.cancel(new DOMException('Resource cache cleared', 'AbortError'));
    }
  }

  function invalidateSession({ releaseImages = false } = {}) {
    state.sessionId += 1;
    state.requestId += 1;
    state.playGeneration += 1;
    state.windowGeneration += 1;
    cancelAnimationFrame(playRaf);
    playRaf = null;
    clearTimeout(readingTimer);
    state.reading = false;
    state.pointerHeld = false;
    state.loopPhase = 'normal';
    state.pendingTargetOrigin = null;
    if (releaseImages) clearImageResources();
  }

  async function performBootSequence({ forceIndex = false } = {}) {
    invalidateSession({ releaseImages: false });
    const session = state.sessionId;
    state.power = 'booting';
    state.window = 'open';
    historyFrame.src = 'about:blank';
    state.viewMode = 'timeline';
    state.snapshotIndex = null;
    state.resumeAfterSnapshot = false;
    syncViewModeDom();
    state.frameError = null;
    state.displayedIndex = null;
    state.targetIndex = null;
    state.playMode = 'paused';
    state.loopPhase = 'normal';
    closeAllDropdowns();
    const retryButton = $('bootRetryButton');
    if (retryButton) retryButton.style.display = 'none';
    loadingTip.style.display = 'none';
    systemScreenOverlay.style.display = 'flex';
    systemScreenOverlay.style.opacity = '1';
    bootContainer.style.display = 'flex';
    shuttingDownContainer.style.display = 'none';
    shutdownContainer.style.display = 'none';
    mainAppWindow.classList.remove('window-hidden', 'window-closing', 'window-opening');
    driveLed.className = 'drive-led standby';
    triggerLedFlicker(1000);
    bootStatusText.textContent = 'Starting System 1.0...';
    bootProgressBar.style.width = '20%';
    try {
      await sleep(350);
      if (session !== state.sessionId) return;
      bootStatusText.textContent = 'Loading IPFS Index...';
      bootProgressBar.style.width = '50%';
      await loadIndex(forceIndex);
      if (session !== state.sessionId) return;
      bootStatusText.textContent = 'Loading First Snapshot...';
      bootProgressBar.style.width = '72%';
      state.targetIndex = 0;
      const resource = await ensureImage(0, 'foreground');
      if (session !== state.sessionId) return;

      state.requestId += 1;
      const context = {
        sessionId: session,
        requestId: state.requestId,
        origin: 'boot',
        playGeneration: state.playGeneration,
      };
      if (!commitFrame(0, resource, context)) {
        throw new Error('首份档案提交失败');
      }

      state.power = 'on';
      bootProgressBar.style.width = '88%';
      warmBuffer(0);
      bootStatusText.textContent = 'Welcome to Macintosh.';
      bootProgressBar.style.width = '100%';
      await sleep(300);
      if (session !== state.sessionId) return;
      systemScreenOverlay.style.opacity = '0';
      setTimeout(() => {
        if (session !== state.sessionId || state.power !== 'on') return;
        systemScreenOverlay.style.display = 'none';
        state.frameTickAt = performance.now();
        if (state.frames.length > 1) startAutoPlay(); else updateControls();
      }, 300);
    } catch (error) {
      if (session !== state.sessionId || error?.name === 'AbortError') return;
      state.power = 'bootError';
      bootProgressBar.style.width = '75%';
      bootStatusText.textContent = state.indexLoaded ? '首份档案读取失败' : '档案清单读取失败';
      let retry = $('bootRetryButton');
      if (!retry) {
        retry = document.createElement('button');
        retry.id = 'bootRetryButton';
        retry.className = 'mac-btn';
        retry.style.marginTop = '10px';
        retry.textContent = '重试';
        bootContainer.appendChild(retry);
      }
      retry.onclick = () => performBootSequence({ forceIndex: !state.indexLoaded });
      retry.style.display = 'inline-flex';
      diagnostics('boot failed', error.message);
    }
  }

  async function performShutDown() {
    if (state.power === 'shuttingDown' || state.power === 'off') return;

    if (state.viewMode === 'snapshot') {
      returnToTimeline({ resume: false });
    }

    state.power = 'shuttingDown';
    closeAllDropdowns();
    aboutMacDialog.classList.remove('show');
    aboutTmDialog.classList.remove('show');
    systemScreenOverlay.style.display = 'flex';
    systemScreenOverlay.style.opacity = '1';

    // Cover the CRT before revoking the object URL used by the visible frame.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    invalidateSession({ releaseImages: true });
    bootContainer.style.display = 'none';
    shuttingDownContainer.style.display = 'flex';
    shutdownContainer.style.display = 'none';
    shutdownStatusText.textContent = 'Flushing Memory Buffers...';
    shutdownProgressBar.style.width = '30%';
    driveLed.className = 'drive-led standby';
    triggerLedFlicker(400);
    await sleep(550);
    if (state.power !== 'shuttingDown') return;
    shutdownStatusText.textContent = 'Disconnecting IPFS Gateways...';
    shutdownProgressBar.style.width = '75%';
    await sleep(650);
    if (state.power !== 'shuttingDown') return;
    shutdownStatusText.textContent = 'Unmounting Virtual Disk...';
    shutdownProgressBar.style.width = '100%';
    await sleep(400);
    if (state.power !== 'shuttingDown') return;
    driveLed.className = 'drive-led off';
    shuttingDownContainer.style.display = 'none';
    shutdownContainer.style.display = 'flex';
    state.power = 'off';
  }

  function performRestart() {
    performBootSequence({ forceIndex: false });
  }

  menuShutdown.addEventListener('click', performShutDown);
  menuRestart.addEventListener('click', performRestart);
  rebootBtn.addEventListener('click', () => performBootSequence({ forceIndex: false }));

  document.addEventListener('visibilitychange', () => {
    state.documentHidden = document.hidden;
    if (document.hidden && state.pendingTargetOrigin === 'auto') {
      state.requestId += 1;
      state.targetIndex = state.displayedIndex;
      state.pendingTargetOrigin = null;
      updateControls();
    }
    if (!document.hidden && state.playMode === 'playing') {
      resetPlaybackProgress();
    }
  });
  window.addEventListener('resize', syncScrollbar);
  if ('ResizeObserver' in window) {
    new ResizeObserver(syncScrollbar).observe(viewport);
  }

  window.addEventListener('pagehide', () => {
    historyFrame.src = 'about:blank';
    invalidateSession({ releaseImages: true });
    if (clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  });

  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    startClock();
    performBootSequence({ forceIndex: false });
  });

  document.addEventListener('DOMContentLoaded', () => {
    startClock();
    performBootSequence();
  });
})();
