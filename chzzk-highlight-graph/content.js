(async () => {
  "use strict";
  if (document.getElementById("kirinuki-highlight-root")) return;
  const { DEFAULTS, LABELS: labels, settings, weightFamilies, frameTime, rankCandidates, recommendedCandidates } =
    await import(chrome.runtime.getURL("core/ranking.js"));
  const {
    mountSettings, savedDefaults, videoSettingsKey, defaultHighlightShortcut, savedHighlightShortcut,
    playerPreferencesKey, defaultPlayerPreferences, savedPlayerPreferences, defaultSettingsKeys,
  } =
    await import(chrome.runtime.getURL("settings-form.js"));
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const cursorEvents = ["pointerenter", "pointermove", "pointerleave", "pointercancel"];
  const time = (s) => {
    s = Math.max(0, Math.floor(s));
    return (
      `${Math.floor(s / 3600)
        .toString()
        .padStart(2, "0")}:${Math.floor(s / 60) % 60}`.replace(
        /:(\d)$/,
        ":0$1",
      ) +
      ":" +
      (s % 60).toString().padStart(2, "0")
    );
  };
  const graphView = kirinukiGraphView(frameTime, time);
  const { fractionAt, peakLift } = graphView;
  let id = null,
    video = null,
    player = null,
    rail = null,
    host = null,
    shadow = null,
    toggleShell = null,
    toggle = null,
    port = null,
    result = null,
    range = null,
    recommendationRange = null,
    recommendationsByTime = false,
    candidatesByTime = [],
    viewingRecommendation = false,
    displayedRange = null,
    rangeMotion = null,
    rangeFrame = null,
    config = DEFAULTS,
    defaults = DEFAULTS,
    shortcut = defaultHighlightShortcut,
    playerPreferences = defaultPlayerPreferences,
    ready = false,
    fields = null,
    source = null,
    pool = null,
    expressionTimer = null,
    peakMask = null,
    drag = null,
    open = false,
    pending = false,
    progressInfo = null,
    statusText = "",
    statusDetail = "",
    oldPosition = null,
    connected = false;
  let observedControls = new Set(),
    detailObserver = null,
    nativePreview = null,
    panelExpansion = null,
    layoutFrame = null,
    lastRailWidth = null,
    playbackTime = null,
    playbackTimeRow = null,
    playerTitle = null,
    volumeControl = null,
    trailingControls = null;
  let preferenceWrites = Promise.resolve(), preferenceRead = 0;
  const post = (message) => {
    try {
      if (!connected) connect();
      if (!connected) throw Error("연결할 수 없습니다.");
      port.postMessage(message.type === "start" || message.type === "watch" ? { id, config, ...message } : { id, ...message });
    } catch {
      connected = false;
      pending = false;
      status("확장에 연결하지 못했습니다. 페이지를 새로고침하세요.");
      buttons();
    }
  };
  function connect() {
    try {
      const activePort = chrome.runtime.connect({ name: "highlight-graph" });
      port = activePort;
      connected = true;
      port.onMessage.addListener((message) => {
        if (port !== activePort) return;
        if (message.type === "cleared") {
          status("분석 캐시를 삭제했습니다.");
          return;
        }
        if (message.id !== id) return;
        if (message.type === "result") {
          pending = false;
          progressInfo = null;
          const keepRange = Boolean(result);
          if (!source || JSON.stringify(message.result.strong_reaction) === JSON.stringify(config.strong_reaction)) {
            source = message.result;
            rankSource(keepRange);
          }
          status(
            source.replaySaved === false ? "채팅 캐시를 저장하지 못했습니다." : "",
            `채팅 ${result.stats.messages.toLocaleString()}건 · 분석 ${result.stats.seconds.toFixed(1)}초${message.cached ? " · 캐시 사용" : ""}`,
          );
          buttons();
          render();
          refreshExpressions();
        } else if (message.type === "progress") {
          pending = true;
          const p = message.progress || {};
          progressInfo = p;
          status(
            p.phase === "replaying" ? "키워드 적용 중…" : p.phase === "scoring"
              ? "점수 계산 중…"
              : p.total
                ? `채팅 불러오는 중 · ${p.done}/${p.total}`
                : "분석 준비 중…",
          );
          buttons();
        } else if (message.type === "error" || message.type === "cancelled") {
          pending = false;
          progressInfo = null;
          status(
            message.type === "cancelled"
              ? "분석을 취소했습니다."
              : message.error,
          );
          buttons();
        } else if (message.type === "idle" && !pending && !result) {
          buttons();
        }
      });
      port.onDisconnect.addListener(() => {
        if (port !== activePort) return;
        if (pending) status("");
        connected = false;
        pending = false;
        progressInfo = null;
        buttons();
      });
    } catch {
      connected = false;
    }
  }
  function status(text, detail = "") {
    statusText = text;
    statusDetail = detail;
    const el = shadow?.querySelector("#status");
    if (!el) return;
    el.textContent = text || detail;
    el.classList.toggle("sr-only", !text);
    const heading = shadow.querySelector("#panel-title");
    if (detail) heading.title = detail;
    else heading.removeAttribute("title");
  }
  function buttons() {
    if (!shadow) return;
    const panel = shadow.querySelector("#panel");
    panel.toggleAttribute("data-ready", Boolean(result));
    shadow.querySelector("#explore").hidden = !result;
    shadow.querySelector("#analyze").hidden = pending || Boolean(result);
    shadow.querySelector("#reanalyze").hidden = pending || !result;
    shadow.querySelector("#cancel").hidden = !pending;
    shadow.querySelector("#cancel").disabled = !progressInfo;
    shadow.querySelector("#clear").disabled = pending;
    const progress = shadow.querySelector("#progress");
    progress.hidden = !pending;
    if (pending && progressInfo?.total && progressInfo.phase !== "scoring") {
      progress.max = progressInfo.total;
      progress.value = progressInfo.done;
    } else {
      progress.removeAttribute("value");
    }
    const action = open ? "하이라이트 닫기" : pending ? "분석 진행 보기"
      : result || !playerPreferences.autoAnalyze ? "하이라이트 열기" : "하이라이트 분석";
    const tooltip = `${action} (${shortcut.toUpperCase()})`;
    const tip = toggle.querySelector(".pzp-button__tooltip");
    if (tip.textContent !== tooltip) tip.textContent = tooltip;
    if (tip.hidden) toggle.title = tooltip;
    toggle.setAttribute("aria-label", action);
    toggle.setAttribute("aria-keyshortcuts", shortcut.toUpperCase());
    toggle.setAttribute("aria-expanded", String(open));
  }
  function startAnalysis() {
    if (pending) return;
    const force = Boolean(result);
    source = null;
    pool = null;
    setResult(null);
    pending = true;
    progressInfo = null;
    status("분석 준비 중…");
    buttons();
    post({ type: "start", force });
  }
  function compatible() {
    return (
      video &&
      result &&
      Number.isFinite(video.duration) &&
      Math.abs(video.duration - result.duration) <
        Math.max(10, result.duration * 0.01)
    );
  }
  function seek(seconds) {
    if (!compatible()) {
      status("영상이 준비되면 이동할 수 있습니다.");
      return;
    }
    try {
      video.currentTime = Math.max(0, Math.min(seconds, video.duration));
      render(true);
    } catch {
      status("이 시간으로 이동할 수 없습니다.");
    }
  }
  function focusRange(center, width) {
    if (!result) return;
    width = Math.min(result.duration, width);
    const start = Math.max(
      0,
      Math.min(result.duration - width, center - width / 2),
    );
    setRange([start, Math.min(result.duration, start + width)]);
  }
  function zoomRange(factor, anchor = 0.5) {
    if (!range) return;
    const width = range[1] - range[0];
    const next = Math.min(result.duration, Math.max(Math.min(60, width), width * factor));
    focusRange(range[0] + width * anchor + next * (0.5 - anchor), next);
  }
  function panRange(fraction) {
    if (!range) return;
    const width = range[1] - range[0];
    focusRange(range[0] + width * (0.5 + fraction), width);
  }
  function stopRangeMotion() {
    rangeMotion?.cancel();
    if (rangeFrame !== null) cancelAnimationFrame(rangeFrame);
    rangeMotion = rangeFrame = displayedRange = null;
  }
  function sameRange(a, b) {
    return a[0] === b[0] && a[1] === b[1];
  }
  function panelTiming() {
    const style = getComputedStyle(host);
    const duration = style.getPropertyValue("--glass-time").trim();
    return {
      duration: parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000),
      easing: style.getPropertyValue("--glass-ease").trim(),
    };
  }
  function setRange(next, { animate = true, fromRecommendation = false } = {}) {
    if (!range) return;
    viewingRecommendation = fromRecommendation;
    if (sameRange(next, range)) {
      renderRecommendationScope();
      return;
    }
    const from = displayedRange ?? range;
    stopRangeMotion();
    range = next;
    shadow.querySelector("#tooltip").hidden = true;
    updateRangeControls();
    renderRecommendationScope();
    if (!open || !animate || reducedMotion.matches) {
      paintRange();
      return;
    }
    displayedRange = from;
    // Use the same browser easing as the panel and apply it to the canvas time domain.
    rangeMotion = new Animation(new KeyframeEffect(null, [], {
      ...panelTiming(), fill: "both",
    }), document.timeline);
    rangeMotion.play();
    function frame() {
      const progress = rangeMotion.effect.getComputedTiming().progress ?? 0;
      if (progress === 1 || reducedMotion.matches) stopRangeMotion();
      else displayedRange = from.map((value, i) => value + (next[i] - value) * progress);
      paintRange();
      if (rangeMotion) rangeFrame = requestAnimationFrame(frame);
    }
    rangeFrame = requestAnimationFrame(frame);
  }
  function syncRecommendationBands() {
    const layer = shadow.querySelector(".recommendation-bands");
    if (!result) {
      layer.replaceChildren();
      return;
    }
    const missing = new Map();
    for (const { review_start_seconds: start, review_end_seconds: end } of result.candidates)
      missing.set(`${start}:${end}`, [start, end]);
    const added = [], removed = [];
    for (const band of layer.children) {
      if (missing.delete(band.dataset.interval)) {
        band.setAttribute("data-active", "");
      } else if (band.hasAttribute("data-active")) {
        band.removeAttribute("data-active");
        removed.push(band);
      }
    }
    for (const [interval, [start, end]] of missing) {
      const band = document.createElement("span");
      band.className = "recommendation-band";
      band.dataset.interval = interval;
      band.style.setProperty("--band-start", start);
      band.style.setProperty("--band-end", end);
      layer.append(band);
      added.push(band);
    }
    // Resolve the added bands' starting opacity before enabling their transition.
    added[0]?.getBoundingClientRect();
    for (const band of added) band.setAttribute("data-active", "");
    for (const band of removed) {
      const fade = band.getAnimations().find(animation => animation.transitionProperty === "opacity");
      const remove = () => {
        if (!band.hasAttribute("data-active") && Number(getComputedStyle(band).opacity) === 0) band.remove();
      };
      if (fade) fade.finished.then(remove, remove);
      else remove();
    }
  }
  function animatePanelSection(section, update) {
    const animate = open && !reducedMotion.matches && section.getClientRects().length;
    const timing = animate ? panelTiming() : null;
    const before = animate ? section.getBoundingClientRect().height : 0;
    for (const animation of section.getAnimations()) animation.cancel();
    update(timing);
    if (!timing) return;
    const after = section.getBoundingClientRect().height;
    if (before !== after) section.animate(
      [before, after].map(height => ({ height: `${height}px`, overflow: "clip" })),
      timing,
    );
  }
  function renderRecommendationScope() {
    const applied = Boolean(result && recommendationRange);
    const canApply = result && range && (range[0] > 0 || range[1] < result.duration) &&
      (!applied || (!viewingRecommendation && !sameRange(range, recommendationRange)));
    const label = shadow.getElementById("recommendation-range");
    const text = applied ? `추천 범위 ${time(recommendationRange[0])} – ${time(recommendationRange[1])}` : "";
    const apply = shadow.getElementById("recommend-in-range");
    const action = applied ? "이 범위로 변경" : "이 범위에서 추천";
    if (label.textContent === text && apply.hidden === !canApply) return;
    const scope = shadow.getElementById("recommendation-scope");
    animatePanelSection(scope.parentElement, () => {
      label.textContent = text;
      label.hidden = !applied;
      apply.lastElementChild.textContent = action;
      apply.hidden = !canApply;
      shadow.getElementById("recommend-all").hidden = !applied;
      scope.hidden = !applied && !canApply;
    });
  }
  function refreshRecommendations() {
    result.candidates = recommendedCandidates(pool, config, result.duration, recommendationRange);
    renderRecommendations();
  }
  function renderRecommendations() {
    if (!shadow) return;
    renderRecommendationScope();
    syncRecommendationBands();
    candidatesByTime = result
      ? [...result.candidates].sort((a, b) => a.review_start_seconds - b.review_start_seconds)
      : [];
    renderCandidateList();
  }
  function listedCandidates() {
    return recommendationsByTime ? candidatesByTime : result.candidates;
  }
  function renderCandidateList() {
    const sort = shadow.getElementById("recommend-sort");
    const order = recommendationsByTime ? "시간순" : "점수순";
    if (sort.textContent !== order) sort.textContent = order;
    const box = shadow.querySelector("#candidates");
    const count = result?.candidates.length || 0;
    shadow.querySelector("#candidate-count").textContent = count;
    shadow.querySelector("#previous").disabled = !count;
    shadow.querySelector("#next").disabled = !count;
    const candidates = result ? listedCandidates() : [];
    const list = box.parentElement;
    animatePanelSection(list, timing => {
      const peaks = new Set(candidates.map(candidate => String(candidate.seconds)));
      const previous = new Set(), exiting = [];
      for (const row of box.querySelectorAll(".candidate")) {
        previous.add(row.dataset.peak);
        if (timing && !peaks.has(row.dataset.peak))
          exiting.push({ row, top: row.offsetTop, opacity: getComputedStyle(row).opacity });
      }
      for (const row of [...list.children]) {
        if (row !== box && (!timing || peaks.has(row.dataset.peak))) row.remove();
      }
      for (const { row, top, opacity } of exiting) {
        const exit = row.cloneNode(true);
        exit.inert = true;
        exit.style.top = top + "px";
        list.append(exit);
        const fade = exit.animate([{ opacity }, { opacity: 0 }], { ...timing, fill: "forwards" });
        fade.onfinish = () => exit.remove();
      }
      box.replaceChildren();
      if (!result) return;
      for (const candidate of candidates) {
        const row = candidateButton(candidate);
        box.append(row);
        if (timing && !previous.has(row.dataset.peak)) row.animate([{ opacity: 0 }, { opacity: 1 }], timing);
      }
      if (!count) {
        const disabled = config.recommend_mode === "count" ? config.recommend_count === 0 : config.recommend_percent === 0;
        box.textContent = disabled && pool.ranked.length ? "추천 표시가 꺼져 있습니다."
          : recommendationRange ? "이 범위에 추천 구간이 없습니다." : "추천 구간이 없습니다.";
      }
    });
    if (result) markCurrentCandidates();
  }
  function candidateButton(c) {
    const button = document.createElement("button");
    button.className = "candidate";
    button.type = "button";
    button.dataset.peak = c.seconds;
    const stamp = document.createElement("span");
    stamp.className = "stamp";
    stamp.textContent = `${time(c.review_start_seconds)} – ${time(c.review_end_seconds)}`;
    const reasons = c.selected_families.map(k => labels[k]).join(", ");
    button.title = `${c.rank}위 · 최고점 ${time(c.seconds)} · 점수 ${c.score.toFixed(3)} · ${reasons}`;
    button.setAttribute("aria-label", `${stamp.textContent}로 이동`);
    button.setAttribute("aria-description", button.title);
    button.innerHTML = kirinukiOverlayView.icon("seek");
    button.prepend(stamp);
    button.addEventListener("click", () => reviewCandidate(c));
    return button;
  }
  function markCurrentCandidates() {
    const rows = shadow.querySelector("#candidates").children;
    const position = compatible() ? video.currentTime : -1;
    listedCandidates().forEach((candidate, i) => {
      const current = position >= candidate.review_start_seconds && position <= candidate.review_end_seconds;
      const row = rows[i];
      if (current === row.hasAttribute("aria-current")) return;
      if (current) row.setAttribute("aria-current", "true");
      else row.removeAttribute("aria-current");
    });
  }
  function reviewCandidate(candidate) {
    setRange([candidate.review_start_seconds, candidate.review_end_seconds], { fromRecommendation: true });
    seek(range[0]);
  }
  function updatePeakDisplay() {
    peakMask = result
      ? graphView.highlightMask(pool.peakSpans, result.scores.length, config.peak_percent)
      : null;
    if (!shadow) return;
    host.style.setProperty("--peak-room", (peakMask ? peakLift : 0) + "px");
  }
  function setResult(next, keepRange = false) {
    nativePreview?.hide();
    clearDrag();
    stopRangeMotion();
    result = next;
    if (!keepRange || !range || !next || range[1] > next.duration) {
      range = next ? [0, next.duration] : null;
      viewingRecommendation = false;
    }
    updatePeakDisplay();
    if (shadow) {
      shadow.querySelector("#overview").hidden = !next;
      shadow.querySelector("#tooltip").hidden = true;
      renderRecommendations();
      if (!next) shadow.querySelector(".overview-range").hidden = true;
      scheduleLayout();
    }
  }
  function rankSource(keepRange) {
    const weighted = weightFamilies(source.basis.families, config);
    pool = rankCandidates(source.basis, weighted, source);
    if (recommendationRange?.[1] > source.duration) recommendationRange = null;
    const candidates = recommendedCandidates(pool, config, source.duration, recommendationRange);
    setResult({ ...source, scores: weighted.combined, candidates }, keepRange);
  }
  function refreshExpressions() {
    if (!source || pending || JSON.stringify(source.strong_reaction) === JSON.stringify(config.strong_reaction)) return;
    pending = true;
    progressInfo = null;
    status("키워드 적용 중…");
    buttons();
    post({ type: "start" });
  }
  function applyConfig(next) {
    const prev = config;
    config = next;
    if (!source) return;
    if (prev.top_families !== next.top_families ||
        Object.keys(labels).some(k => prev.family_weights[k] !== next.family_weights[k])) {
      rankSource(true);
      render();
    } else {
      if (prev.recommend_mode !== next.recommend_mode || prev.recommend_count !== next.recommend_count ||
          prev.recommend_percent !== next.recommend_percent) {
        refreshRecommendations();
      }
      if (prev.peak_percent !== next.peak_percent) { updatePeakDisplay(); render(); }
    }
    if (JSON.stringify(prev.strong_reaction) !== JSON.stringify(next.strong_reaction)) {
      clearTimeout(expressionTimer);
      expressionTimer = setTimeout(refreshExpressions, 220);
    }
  }
  function drawDetail() {
    if (!open || !result) return;
    const detail = shadow.querySelector("#detail");
    if (drag?.canvas === detail) return;
    const [start, end] = displayedRange ?? range;
    if (detail._domain?.[0] !== start || detail._domain[1] !== end) {
      const bands = detail.previousElementSibling;
      bands.style.setProperty("--domain-start", start);
      bands.style.setProperty("--domain-width", end - start);
    }
    // Use the expanded width for the bitmap and the resting width for sampling.
    const size = getComputedStyle(shadow.getElementById("detail-size"));
    graphView.draw(detail, start, end, result, peakMask, video, {
      rasterWidth: parseFloat(size.width), sampleWidth: parseFloat(size.minWidth),
    });
  }
  function paintRange() {
    const [start, end] = displayedRange ?? range;
    const { duration } = result;
    const from = start / duration * 100, to = end / duration * 100;
    const track = shadow.querySelector(".range-track");
    track.style.setProperty("--range-from", from + "%");
    track.style.setProperty("--range-to", to + "%");
    const selection = shadow.querySelector(".overview-range");
    selection.hidden = start === 0 && end === duration;
    selection.style.left = from + "%";
    selection.style.width = to - from + "%";
    drawDetail();
    nativePreview?.refresh();
  }
  function edgeLimits(edge) {
    const minimum = Math.min(60, range[1] - range[0]);
    return edge === 0 ? [0, range[1] - minimum] : [range[0] + minimum, result.duration];
  }
  function updateRangeControls() {
    shadow.querySelector("#range-label").textContent = `${time(range[0])} – ${time(range[1])}`;
    for (const [edge, id] of ["range-start", "range-end"].entries()) {
      const handle = shadow.getElementById(id);
      const [min, max] = edgeLimits(edge);
      handle.setAttribute("aria-valuemin", min);
      handle.setAttribute("aria-valuemax", max);
      handle.setAttribute("aria-valuenow", range[edge]);
      handle.setAttribute("aria-valuetext", time(range[edge]));
    }
  }
  function render(visibleOnly = false) {
    if (!host || !result) return;
    const overview = shadow.querySelector("#overview");
    if (playerPreferences.overviewGraph &&
        (!visibleOnly || shadow.querySelector("#timeline").hasAttribute("data-exploring")))
      graphView.draw(overview, 0, result.duration, result, peakMask, video);
    if (open) markCurrentCandidates();
    if (visibleOnly) drawDetail();
    else {
      updateRangeControls();
      paintRange();
    }
  }
  function clearDrag() {
    if (!drag) return;
    const { canvas, box, pointerId } = drag;
    drag = null;
    if (canvas.id === "detail") {
      shadow.querySelector("#panel").style.removeProperty("width");
      drawDetail();
    }
    box.hidden = true;
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    shadow.querySelector("#tooltip").hidden = true;
    nativePreview?.refresh();
    scheduleLayout();
  }
  function scoreAt(seconds) {
    if (!result || !result.scores.length || !Number.isFinite(seconds)) return;
    const first = frameTime(0, result), last = frameTime(result.scores.length - 1, result);
    if (seconds >= first && seconds <= last)
      return result.scores[Math.round((seconds - first) / result.step)];
  }
  function trackCursor(event) {
    const target = event.currentTarget;
    if (target === rail && !playerPreferences.overviewGraph) return;
    const surface = target === rail ? shadow.querySelector("#overview-surface") : target;
    const line = surface.querySelector(".cursor-line");
    if (event.type === "pointerleave" && drag?.canvas.parentElement === surface) return;
    line.hidden = event.type === "pointerleave" || event.type === "pointercancel";
    if (target === rail) {
      if (line.hidden) nativePreview?.leave(rail);
      else nativePreview?.hover(event, null, { anchor: surface });
    }
    if (!line.hidden) {
      const percent = fractionAt(target, event.clientX) * 100;
      line.style.left = `min(${percent}%, calc(100% - 1px))`;
    }
  }
  function bindNativePreview(surface, pointAt, ownsDrag, options) {
    const preview = nativePreview;
    for (const event of ["pointerenter", "pointermove"]) {
      surface.addEventListener(event, pointer => {
        if (pointer.buttons && !ownsDrag(pointer.pointerId)) return preview.leave(surface);
        preview.hover(pointer, pointAt, options);
      });
    }
    surface.addEventListener("pointerleave", () => {
      if (drag?.canvas.parentElement !== surface) preview.leave(surface);
    });
    surface.addEventListener("pointercancel", () => preview.leave(surface));
  }
  function graph(canvas) {
    const surface = canvas.parentElement, box = surface.querySelector(".drag-box");
    for (const event of cursorEvents) surface.addEventListener(event, trackCursor);
    const dragRange = (end) => {
      const [start, stop] = drag.domain;
      return [Math.min(drag.anchor, end), Math.max(drag.anchor, end)]
        .map((f) => start + f * (stop - start));
    };
    const target = event => graphView.pointAt(canvas, event.clientX, result);
    const tip = shadow.getElementById("tooltip");
    bindNativePreview(surface, clientX => {
      const point = graphView.pointAt(canvas, clientX, result);
      return drag?.canvas === canvas && drag.selecting ? { ...point, selection: tip.textContent } : point;
    }, pointerId => drag?.canvas === canvas && drag.pointerId === pointerId, { expandRail: canvas.id === "overview" });
    canvas.addEventListener("pointermove", (event) => {
      if (drag?.canvas !== canvas || drag.pointerId !== event.pointerId) return;
      if (Math.abs(event.clientX - drag.x) > 6) drag.selecting = true;
      if (!drag.selecting) return;
      const end = fractionAt(canvas, event.clientX);
      box.style.left = Math.min(drag.anchor, end) * 100 + "%";
      box.style.width = Math.abs(end - drag.anchor) * 100 + "%";
      box.hidden = false;
      const [a, b] = dragRange(end);
      tip.textContent = `${time(a)} – ${time(b)}${b - a < 60 && result.duration >= 60 ? " · 최소 1분" : ""}`;
      tip.toggleAttribute("data-overview", canvas.id === "overview");
      tip.hidden = false;
      const frame = host.getBoundingClientRect(), plot = canvas.getBoundingClientRect();
      const localX = (event.clientX - frame.left) * host.clientWidth / frame.width;
      const scaleY = host.clientHeight / frame.height;
      const tipWidth = tip.offsetWidth, tipHeight = tip.offsetHeight;
      const panelTop = canvas.id === "detail" ? shadow.querySelector("#panel").offsetTop : 0;
      const above = (plot.top - frame.top) * scaleY - tipHeight - 8;
      const below = (plot.bottom - frame.top) * scaleY + 8;
      const y = above >= panelTop + 4 ? above : below;
      tip.style.left = Math.max(4, Math.min(host.clientWidth - tipWidth - 4, localX - tipWidth / 2)) + "px";
      tip.style.top = Math.max(panelTop + 4, Math.min(host.clientHeight - tipHeight - 4, y)) + "px";
    });
    canvas.addEventListener("pointerleave", () => {
      if (drag?.canvas !== canvas) shadow.querySelector("#tooltip").hidden = true;
    });
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !event.isPrimary || drag || !result || !canvas._domain) return;
      event.preventDefault();
      event.stopPropagation();
      if (canvas.id === "detail") {
        const panel = shadow.querySelector("#panel");
        panel.style.width = getComputedStyle(panel).width;
      }
      canvas.focus({ preventScroll: true });
      drag = { canvas, box, pointerId: event.pointerId, x: event.clientX,
        anchor: fractionAt(canvas, event.clientX), domain: canvas._domain, selecting: false };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointerup", (event) => {
      if (drag?.canvas !== canvas || drag.pointerId !== event.pointerId) return;
      event.stopPropagation();
      const p = target(event);
      const selecting = drag.selecting || Math.abs(event.clientX - drag.x) > 6;
      const [a, b] = dragRange(fractionAt(canvas, event.clientX));
      clearDrag();
      if (selecting) {
        if (!open) setOpen(true);
        focusRange((a + b) / 2, Math.max(60, b - a));
      } else if (p) seek(p.seconds);
    });
    for (const name of ["pointercancel", "lostpointercapture"])
      canvas.addEventListener(name, (event) => {
        if (drag?.canvas === canvas && drag.pointerId === event.pointerId) clearDrag();
      });
    canvas.addEventListener("keydown", (event) => {
      if (!result) return;
      if (drag && event.key === "Escape") {
        clearDrag();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const delta = event.shiftKey ? 60 : 5;
      let t;
      if (event.key === "ArrowLeft") t = (video?.currentTime || 0) - delta;
      else if (event.key === "ArrowRight")
        t = (video?.currentTime || 0) + delta;
      else if (event.key === "Home") t = 0;
      else if (event.key === "End") t = result.duration - 0.1;
      else return;
      event.preventDefault();
      event.stopPropagation();
      seek(t);
    });
  }
  function rangeBar(track, graphSurface) {
    const handles = [...track.querySelectorAll(".range-handle")];
    let pointer = null;
    bindNativePreview(track, (clientX, target) => {
      const edge = pointer?.edge ?? handles.indexOf(target);
      const seconds = edge < 0 ? fractionAt(track, clientX) * result?.duration : (displayedRange ?? range)?.[edge];
      return { seconds, score: scoreAt(seconds) };
    }, pointerId => pointer?.id === pointerId, { anchor: graphSurface });
    function adjust(edge, value, [min, max] = edgeLimits(edge), animate = true) {
      const next = [...range];
      next[edge] = Math.max(min, Math.min(max, value));
      setRange(next, { animate });
    }
    track.addEventListener("pointerdown", (event) => {
      if (!range || !event.isPrimary || event.button !== 0 || drag) return;
      const edge = handles.indexOf(event.target);
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, edge, result };
      if (edge < 0) return;
      if (displayedRange) setRange(displayedRange, { animate: false });
      const bounds = track.getBoundingClientRect();
      pointer.offset = event.clientX - (bounds.left + bounds.width * range[edge] / result.duration);
      pointer.limits = edgeLimits(edge);
      track.setPointerCapture(pointer.id);
    });
    track.addEventListener("pointermove", (event) => {
      if (!open || pointer?.id !== event.pointerId || pointer.result !== result) return;
      if (pointer.edge < 0) {
        if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 6) pointer = null;
        return;
      }
      const fraction = fractionAt(track, event.clientX - pointer.offset);
      adjust(pointer.edge, Math.round(fraction * result.duration), pointer.limits, false);
    });
    track.addEventListener("pointerup", (event) => {
      if (pointer?.id !== event.pointerId) return;
      const { edge, x, y, result: original } = pointer;
      pointer = null;
      if (!open || original !== result || edge >= 0 || Math.hypot(event.clientX - x, event.clientY - y) > 6) return;
      const value = Math.round(fractionAt(track, event.clientX) * result.duration);
      const [start, end] = displayedRange ?? range;
      const nearest = Math.abs(value - start) <= Math.abs(value - end) ? 0 : 1;
      handles[nearest].focus({ preventScroll: true });
      adjust(nearest, value);
    });
    for (const name of ["pointercancel", "lostpointercapture", "pointerleave"])
      track.addEventListener(name, (event) => {
        if (pointer?.id === event.pointerId && (name !== "pointerleave" || pointer.edge < 0)) pointer = null;
      });
    handles.forEach((handle, edge) => handle.addEventListener("keydown", (event) => {
      if (!range) return;
      const limits = edgeLimits(edge), step = event.shiftKey ? 60 : 5;
      let value;
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") value = range[edge] - step;
      else if (event.key === "ArrowRight" || event.key === "ArrowUp") value = range[edge] + step;
      else if (event.key === "Home") value = limits[0];
      else if (event.key === "End") value = limits[1];
      else return;
      event.preventDefault();
      adjust(edge, value, limits);
    }));
  }
  function disclose(element, visible) {
    element.inert = !visible;
    element.setAttribute("aria-hidden", String(!visible));
    element.toggleAttribute("data-open", visible);
  }
  function setOpen(value, focusTarget) {
    open = value;
    if (!value) {
      nativePreview?.hide();
      clearDrag();
      stopRangeMotion();
      panelExpansion?.stop();
    }
    const panel = shadow.querySelector("#panel");
    if (!value && panel.contains(shadow.activeElement))
      toggle.focus({ preventScroll: true });
    disclose(panel, value);
    if (!value && getComputedStyle(panel).visibility === "hidden") panelExpansion?.reset();
    shadow.querySelector("#tooltip").hidden = true;
    buttons();
    if (value) focusTarget?.focus({ preventScroll: true });
    render();
  }
  function dismissPanel() {
    const active = shadow.activeElement;
    if (shadow.getElementById("panel").contains(active)) active.blur();
    toggle.blur();
    setOpen(false);
  }
  function toggleHighlight(focusTarget) {
    setOpen(!open, focusTarget);
    if (open && !result && !pending && playerPreferences.autoAnalyze) startAnalysis();
  }
  function handleHighlightShortcut(event) {
    if (!host?.isConnected || event.defaultPrevented || event.isComposing || event.repeat ||
        event.shiftKey || event.altKey || event.ctrlKey || event.metaKey ||
        event.key.toLowerCase() !== shortcut) return;
    if (document.fullscreenElement && !document.fullscreenElement.contains(host)) return;
    if (event.composedPath().some(node => node instanceof HTMLElement &&
        (node.isContentEditable || node.matches("input, textarea, select, [role=textbox], [role=combobox]")))) return;
    event.preventDefault();
    event.stopPropagation();
    if (open) dismissPanel();
    else toggleHighlight(shadow.querySelector("#panel"));
  }
  function isPlayerFullscreen() {
    return document.fullscreenElement?.contains(player) || player.classList.contains("pzp-pc--fullscreen");
  }
  function forwardPanelMotion(event) {
    if (event.pointerType !== "mouse" || !player.classList.contains("pzp-pc") || !isPlayerFullscreen()) return;
    // CHZZK's fullscreen timer accepts movement from player-owned targets.
    player.dispatchEvent(new MouseEvent("mousemove", { clientX: event.clientX, clientY: event.clientY }));
  }
  function trackPanelExpansion(panel, scroller, actions) {
    const controller = new AbortController();
    const listener = { signal: controller.signal };
    const capture = { ...listener, capture: true };
    const exitMargin = 32, exitDelay = 1500;
    let collapseTimer = null, scrollbarPointer = null, outsidePointer;

    function cancelCollapse() {
      clearTimeout(collapseTimer);
      collapseTimer = null;
    }
    function collapse() {
      cancelCollapse();
      panel.removeAttribute("data-expanded");
    }
    function stop() {
      scrollbarPointer = null;
      cancelCollapse();
    }
    function reset() {
      stop();
      panel.removeAttribute("data-expanded");
    }
    function isInside(box, x, y) {
      return x >= box.left && x < box.right && y >= box.top && y < box.bottom;
    }
    function trackPointer(event) {
      if (event.pointerType !== "mouse" || !panel.hasAttribute("data-open")) return;
      if (scrollbarPointer !== null) {
        if (event.buttons & 1) return;
        scrollbarPointer = null;
      }
      const box = panel.getBoundingClientRect();
      const { clientX: x, clientY: y } = event;
      const expanded = panel.hasAttribute("data-expanded");
      if (isInside(box, x, y)) {
        cancelCollapse();
        if (!expanded && event.composedPath().includes(panel) && x < actions.getBoundingClientRect().left)
          panel.setAttribute("data-expanded", "");
      } else if (expanded) {
        if (x >= box.left && x <= box.right + exitMargin &&
            y >= box.top - exitMargin && y <= box.bottom + exitMargin) {
          outsidePointer = [x, y];
          if (collapseTimer === null) {
            collapseTimer = setTimeout(() => {
              collapseTimer = null;
              if (!isInside(panel.getBoundingClientRect(), ...outsidePointer)) collapse();
            }, exitDelay);
          }
        } else collapse();
      }
    }
    function grabScrollbar(event) {
      if (event.pointerType !== "mouse" || event.button !== 0 || event.composedPath()[0] !== scroller ||
          scroller.scrollHeight <= scroller.clientHeight) return;
      const bounds = scroller.getBoundingClientRect();
      // Native overlay scrollbars can have a thumb without consuming layout width.
      const gutter = (scroller.offsetWidth - scroller.clientWidth || 10) * bounds.width / scroller.offsetWidth;
      if (event.clientX < bounds.right - gutter || event.clientX >= bounds.right) return;
      scrollbarPointer = event.pointerId;
      cancelCollapse();
    }
    document.addEventListener("pointermove", trackPointer, capture);
    document.addEventListener("pointerdown", grabScrollbar, capture);
    document.addEventListener("pointerup", event => {
      if (event.pointerId === scrollbarPointer && event.button === 0) trackPointer(event);
    }, capture);
    document.addEventListener("pointercancel", event => {
      if (event.pointerId === scrollbarPointer) reset();
    }, capture);
    document.documentElement.addEventListener("pointerleave", event => {
      if (event.pointerType === "mouse" && scrollbarPointer === null) collapse();
    }, listener);
    window.addEventListener("blur", reset, listener);
    return { stop, reset, detach() { reset(); controller.abort(); } };
  }
  function applyPlayerPreferences() {
    if (!shadow) return;
    const hideOverview = !playerPreferences.overviewGraph;
    if (host.hasAttribute("data-hide-overview") !== hideOverview) {
      if (hideOverview) {
        const overview = shadow.getElementById("overview");
        nativePreview?.hide(overview.parentElement);
        nativePreview?.hide(rail);
        if (drag?.canvas === overview) clearDrag();
        if (shadow.activeElement === overview) toggle.focus({ preventScroll: true });
        overview.parentElement.querySelector(".cursor-line").hidden = true;
        const tip = shadow.getElementById("tooltip");
        if (tip.hasAttribute("data-overview")) tip.hidden = true;
      }
      host.toggleAttribute("data-hide-overview", hideOverview);
      lastRailWidth = null;
      scheduleLayout();
    }
    if (playerPreferences.expandOnHover) {
      panelExpansion ??= trackPanelExpansion(
        shadow.getElementById("panel"), shadow.querySelector(".panel-body"), shadow.querySelector(".panel-head .group"),
      );
    } else {
      panelExpansion?.detach();
      panelExpansion = null;
    }
  }
  function bindSettings(body) {
    const $ = (selector) => shadow.querySelector(selector);
    let listScroll = 0;
    $("#tools").onclick = () => {
      const settings = $("#adjustments"), show = !settings.hasAttribute("data-open");
      if (show) listScroll = body.scrollTop;
      if (!show && settings.contains(shadow.activeElement)) $("#tools").focus({ preventScroll: true });
      disclose(settings, show);
      body.scrollTop = show ? 0 : listScroll;
      $("#tools").setAttribute("aria-expanded", String(show));
      render();
    };
    const live = $("#live-settings");
    fields = mountSettings(live, { toggleRecommendationMode: true });
    fields.fill(config);
    const edit = event => {
      if (event.isComposing) return;
      try {
        const next = fields.read(config);
        $("#settings-status").textContent = "";
        if (JSON.stringify(next) !== JSON.stringify(config)) savePreferences(next, false);
      } catch (error) { $("#settings-status").textContent = error.message; }
    };
    live.addEventListener("input", edit);
    live.addEventListener("compositionend", edit);
    live.addEventListener("wheel", (event) => {
      const field = event.target;
      if (shadow.activeElement !== field || !event.deltaY || event.ctrlKey || event.metaKey ||
          !field.matches("input[type=number]:enabled:not([readonly])")) return;
      event.preventDefault();
      event.stopPropagation();
      const previous = field.value, direction = Math.sign(event.deltaY);
      if (field.step === "any") {
        const min = Number(field.min), max = field.max ? Number(field.max) : Infinity;
        const current = Number.isFinite(field.valueAsNumber) ? field.valueAsNumber : min;
        field.valueAsNumber = Math.max(min, Math.min(max, current - direction));
      } else if (direction < 0) {
        field.stepUp();
      } else {
        field.stepDown();
      }
      if (field.value !== previous) field.dispatchEvent(new Event("input", { bubbles: true }));
    }, { passive: false });
    $("#use-defaults").onclick = () => {
      savePreferences(defaults, true);
      fields.fill(config);
      $("#settings-status").textContent = "기본값으로 복원했습니다.";
    };
  }
  function bindNavigation(detail) {
    const $ = (selector) => shadow.querySelector(selector);
    $("#zoom-in").onclick = () => zoomRange(0.5);
    $("#zoom-out").onclick = () => zoomRange(2);
    $("#pan-left").onclick = () => panRange(-0.8);
    $("#pan-right").onclick = () => panRange(0.8);
    $("#near").onclick = () => focusRange(video?.currentTime || 0, 600);
    $("#reset").onclick = () => { if (result) setRange([0, result.duration]); };
    const apply = $("#recommend-in-range"), clear = $("#recommend-all");
    apply.onclick = () => {
      recommendationRange = range.slice();
      refreshRecommendations();
      clear.focus({ preventScroll: true });
    };
    clear.onclick = () => {
      recommendationRange = null;
      refreshRecommendations();
      (apply.hidden ? $("#reset") : apply).focus({ preventScroll: true });
    };
    $("#recommend-sort").onclick = () => {
      recommendationsByTime = !recommendationsByTime;
      renderCandidateList();
    };
    detail.addEventListener("wheel", (event) => {
      if (!range || drag || event.shiftKey === event.altKey || event.ctrlKey || event.metaKey) return;
      const scale = { 0: 0.01, 1: 0.2, 2: 1 }[event.deltaMode];
      const delta = (event.deltaY || event.deltaX) * scale;
      if (!delta) return;
      const ticks = Math.max(-3, Math.min(3, delta));
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) zoomRange(2 ** ticks, fractionAt(detail, event.clientX));
      else panRange(0.2 * ticks);
    }, { passive: false });
    for (const [name, direction] of [
      ["previous", -1],
      ["next", 1],
    ])
      $("#" + name).onclick = () => {
        if (!result) return;
        const t = video?.currentTime || 0;
        const candidate =
          direction < 0
            ? candidatesByTime.findLast((c) => c.review_start_seconds < t - 1 && c.review_end_seconds <= t)
            : candidatesByTime.find((c) => c.review_start_seconds > t + 1);
        if (candidate) reviewCandidate(candidate);
        else status(direction < 0 ? "이전 추천 구간이 없습니다." : "다음 추천 구간이 없습니다.");
      };
    rangeBar($(".range-track"), detail.parentElement);
  }
  function mount() {
    host = document.createElement("div");
    host.id = "kirinuki-highlight-root";
    host.style.cssText =
      "position:absolute;inset:0;z-index:0;pointer-events:none;";
    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = kirinukiOverlayView.panel;
    toggleShell = document.createElement("span");
    toggleShell.slot = "highlight-control";
    toggleShell.style.cssText = "display:inline-flex;align-self:center;flex:none;pointer-events:auto";
    toggleShell.innerHTML = kirinukiOverlayView.button;
    toggle = toggleShell.firstElementChild;
    if (!video.closest(".pzp-pc") && !player.querySelector(".pzp-button")) {
      toggle.style.cssText = "display:grid;place-items:center;padding:0;border:0;background:transparent;color:white;cursor:pointer";
      toggle.querySelector(".pzp-ui-icon").style.cssText = "display:block;width:100%;height:100%";
      toggle.querySelector(".pzp-button__tooltip").hidden = true;
    }
    host.append(toggleShell);
    if (getComputedStyle(player).position === "static") {
      oldPosition = player.style.position;
      player.style.position = "relative";
    }
    // Share the video's stacking level. Native controls and popups paint above it.
    const videoLayer = [...player.children].find((child) => child.contains(video));
    videoLayer.after(host);
    document.addEventListener("keydown", handleHighlightShortcut, true);
    player.addEventListener("pointerover", scheduleLayout);
    player.addEventListener("pointerout", scheduleLayout);
    player.addEventListener("transitionrun", onControlTransition);
    const $ = (s) => shadow.querySelector(s);
    const panel = $("#panel"), detail = $("#detail");
    nativePreview = kirinukiNativePreview(player, $("#tooltip"), () => rail,
      () => compatible() ? video.duration : 0, scoreAt);
    window.addEventListener("scroll", nativePreview.refresh, true);
    panel.addEventListener("pointermove", forwardPanelMotion, true);
    const sizing = $("#detail-size");
    let detailHeight;
    const detailSize = new ResizeObserver(entries => {
      nativePreview?.refresh();
      const height = entries.find(entry => entry.target === detail)?.contentRect.height ?? detailHeight;
      const changedHeight = height !== detailHeight;
      detailHeight = height;
      if (changedHeight || entries.some(entry => entry.target === sizing)) drawDetail();
    });
    detailSize.observe(detail);
    detailSize.observe(sizing);
    panel.addEventListener("transitionend", e => {
      if (e.target !== panel) return;
      if (e.propertyName === "opacity" && !open) panelExpansion?.reset();
    });
    detailObserver = detailSize;
    toggle.onpointerdown = (event) => event.stopPropagation();
    toggle.onkeydown = (event) => {
      if (open && event.key === "Escape") dismissPanel();
      if (["Escape", "Enter", " "].includes(event.key)) event.stopPropagation();
    };
    toggle.onclick = (event) => {
      event.stopPropagation();
      toggleHighlight(event.detail === 0 ? $("#close") : null);
    };
    $("#close").onclick = dismissPanel;
    const body = $(".panel-body");
    applyPlayerPreferences();
    bindSettings(body);
    $("#analyze").onclick = startAnalysis;
    $("#reanalyze").onclick = startAnalysis;
    $("#cancel").onclick = () => post({ type: "cancel" });
    $("#options").onclick = () => post({ type: "options" });
    $("#clear").onclick = () => {
      source = null;
      pool = null;
      setResult(null);
      buttons();
      post({ type: "clear" });
    };
    bindNavigation(detail);
    shadow.addEventListener("keydown", (event) => {
      if (open && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismissPanel();
      } else if ($("#panel").contains(event.target)) event.stopPropagation();
    });
    host.addEventListener("click", (event) => event.stopPropagation());
    host.addEventListener("pointerdown", (event) => event.stopPropagation());
    for (const event of ["pointerenter", "pointerleave", "focusin", "focusout"])
      $("#overview-surface").addEventListener(event, scheduleLayout);
    graph($("#overview"));
    graph($("#detail"));
    updatePeakDisplay();
    status(statusText, statusDetail);
    renderRecommendations();
    setOpen(open);
    post({ type: "watch" });
  }
  function detach() {
    if (nativePreview) window.removeEventListener("scroll", nativePreview.refresh, true);
    nativePreview?.hide();
    nativePreview = null;
    document.removeEventListener("keydown", handleHighlightShortcut, true);
    panelExpansion?.detach();
    panelExpansion = null;
    detailObserver?.disconnect();
    detailObserver = null;
    clearTimeout(expressionTimer);
    fields = null;
    clearDrag();
    stopRangeMotion();
    observeControls(null, null);
    if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
    layoutFrame = null;
    lastRailWidth = null;
    player?.removeEventListener("pointerover", scheduleLayout);
    player?.removeEventListener("pointerout", scheduleLayout);
    player?.removeEventListener("transitionrun", onControlTransition);
    toggleShell?.remove();
    toggleShell = toggle = null;
    host?.remove();
    if (oldPosition !== null && player) player.style.position = oldPosition;
    oldPosition = null;
    host = shadow = null;
  }
  function discover(v) {
    const pzp = v.closest(".pzp-pc");
    const progress = pzp?.querySelector(".pzp-pc__progress-slider");
    if (progress) return { player: pzp, rail: progress };

    const vr = v.getBoundingClientRect();
    let owner = v.parentElement, best = null;
    for (
      let depth = 0;
      owner && depth < 7;
      depth++, owner = owner.parentElement
    ) {
      const r = owner.getBoundingClientRect();
      if (r.height > vr.height + 180 || r.width > vr.width + 100) break;
      let bestRail = null, bestRailHeight = 60;
      for (const el of owner.querySelectorAll(
        '[role="slider"], [class*="progress-slider"], [class*="progress_bar"], [class*="progressbar"], [class*="progress-bar"]',
      )) {
        if (host?.contains(el)) continue;
        const bounds = el.getBoundingClientRect();
        if (bounds.width > vr.width * 0.5 && bounds.height < bestRailHeight &&
            bounds.bottom <= r.bottom + 5 && bounds.top > r.top + r.height * 0.55) {
          bestRail = el;
          bestRailHeight = bounds.height;
        }
      }
      if (bestRail) return { player: owner, rail: bestRail };
      if (r.width >= vr.width - 2 && r.height >= vr.height - 2) best = owner;
    }
    if (rail && player.contains(v) && player.contains(rail))
      return { player, rail };
    return { player: best || v.parentElement, rail: null };
  }
  function findVideo() {
    let best = null, largest = 0;
    for (const candidate of document.querySelectorAll("video")) {
      const { width, height } = candidate.getBoundingClientRect();
      if (width <= 200) continue;
      const area = width * height;
      if (!best || area > largest) {
        best = candidate;
        largest = area;
      }
    }
    return best;
  }
  function observeControls(next, nextTime, nextTitle = null) {
    const nextRow = nextTime?.parentElement ?? null;
    const nextVolume = nextRow?.querySelector(".pzp-pc__volume-control") ?? null;
    const nextTrailing =
      nextRow?.parentElement?.querySelector(".pzp-pc__bottom-buttons-right") ?? null;
    const controls = new Set();
    for (const control of [next, nextTime, nextVolume]) {
      for (let el = control; el && el !== player; el = el.parentElement)
        controls.add(el);
    }
    if (
      next === rail &&
      nextTime === playbackTime &&
      nextRow === playbackTimeRow &&
      nextTitle === playerTitle &&
      nextVolume === volumeControl &&
      nextTrailing === trailingControls &&
      controls.size === observedControls.size &&
      [...controls].every((el) => observedControls.has(el))
    )
      return;
    if (next !== rail) {
      nativePreview?.hide();
      for (const event of cursorEvents) {
        rail?.removeEventListener(event, trackCursor);
        next?.addEventListener(event, trackCursor);
      }
      const line = shadow?.querySelector("#overview-surface .cursor-line");
      if (line) line.hidden = true;
    }
    rail = next;
    observedControls = controls;
    playbackTime = nextTime;
    playbackTimeRow = nextRow;
    playerTitle = nextTitle;
    volumeControl = nextVolume;
    trailingControls = nextTrailing;
    railSize.disconnect();
    railStyle.disconnect();
    if (!rail && !playbackTime && !playerTitle) return;
    if (rail) railSize.observe(rail);
    if (playerTitle) railSize.observe(playerTitle);
    railSize.observe(host);
    if (playbackTime) {
      railSize.observe(playbackTime);
      railSize.observe(playbackTimeRow);
    }
    if (trailingControls) railSize.observe(trailingControls);
    for (const el of [...observedControls, player]) {
      railStyle.observe(el, { attributeFilter: ["class", "style", "hidden"] });
    }
  }
  function onControlTransition(event) {
    if (observedControls.has(event.target)) scheduleLayout();
  }
  function scheduleLayout() {
    if (!host || layoutFrame !== null) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = null;
      layout();
    });
  }
  function controlOpacity(control, stop = player) {
    if (getComputedStyle(control).visibility !== "visible") return 0;
    // The overlay already inherits styles from the player and its ancestors.
    let opacity = 1;
    for (let el = control; el && el !== stop; el = el.parentElement)
      opacity *= Number(getComputedStyle(el).opacity);
    return opacity;
  }
  function layout() {
    const timeline = shadow.querySelector("#timeline");
    const origin = host.getBoundingClientRect();
    const bounds = rail?.getBoundingClientRect();
    const timeBounds = playbackTime?.getBoundingClientRect();
    const trailingBounds = trailingControls?.getBoundingClientRect();
    if (!origin.width || !origin.height) {
      nativePreview?.hide();
      timeline.hidden = true;
      lastRailWidth = null;
      toggleShell.style.visibility = "hidden";
      toggle.inert = true;
      host.style.setProperty("--timeline-opacity", 0);
      return;
    }
    toggleShell.style.removeProperty("visibility");

    const hasRail = Boolean(bounds?.width && bounds.height);
    if (!hasRail || !compatible()) nativePreview?.hide();
    const hostStyle = getComputedStyle(host);
    const scaleX = parseFloat(hostStyle.width) / origin.width;
    const scaleY = parseFloat(hostStyle.height) / origin.height;
    const titleBounds = isPlayerFullscreen() && playerTitle?.getBoundingClientRect();
    // Reserve the measured title row even when the native controls fade out.
    const panelTop = titleBounds?.height ? Math.max(0, titleBounds.bottom - origin.top) * scaleY + 8 : 0;
    host.style.setProperty("--panel-top", panelTop + "px");
    host.style.setProperty("--rail-space", (hasRail ? (origin.bottom - bounds.top) * scaleY : 54) + "px");
    const buttonGap = 8;
    const nativeSize = trailingControls?.querySelector(".pzp-setting-button")?.offsetWidth || 32;
    const room =
      trailingBounds?.width && timeBounds?.width
        ? (trailingBounds.left - timeBounds.right) * scaleX - 2 * buttonGap
        : Infinity;
    const besideTime = Boolean(timeBounds?.width && timeBounds.height && room >= nativeSize);
    timeline.hidden = !hasRail;
    if (besideTime && playbackTime.nextElementSibling !== toggleShell)
      playbackTime.after(toggleShell);
    else if (!besideTime && toggleShell.parentElement !== host)
      host.append(toggleShell);
    toggleShell.style.marginLeft = besideTime ? buttonGap + "px" : "0";
    toggle.style.width = toggle.style.height = nativeSize + "px";

    const railOpacity = hasRail ? controlOpacity(rail) : 0;
    const nearbyControl = volumeControl?.getClientRects().length ? volumeControl : playbackTime;
    const buttonOpacity = besideTime ? controlOpacity(nearbyControl) : railOpacity;
    const overview = shadow.querySelector("#overview");
    host.style.setProperty("--timeline-opacity", railOpacity);
    const exploring = Boolean(playerPreferences.overviewGraph && result && railOpacity && (
      rail.matches(":hover") || overview.parentElement.matches(":hover") ||
      overview.matches(":focus-visible") || drag?.canvas === overview
    ));
    const revealing = exploring && !timeline.hasAttribute("data-exploring");
    timeline.toggleAttribute("data-exploring", exploring);
    // The inline control already shares the row's opacity with the native controls.
    toggleShell.style.opacity = besideTime ? controlOpacity(nearbyControl, playbackTimeRow) : railOpacity;
    toggle.inert = buttonOpacity === 0;
    overview.inert = !playerPreferences.overviewGraph || railOpacity === 0;
    overview.style.visibility = hasRail ? "" : "hidden";

    const left = hasRail ? bounds.left : origin.left;
    const top = hasRail ? bounds.top : origin.top;
    timeline.style.left = (left - origin.left) * scaleX + "px";
    timeline.style.top = (top - origin.top) * scaleY + "px";
    timeline.style.width = (hasRail ? bounds.width * scaleX : 0) + "px";

    // CSSOM rounds inline widths. Compare the rail measurements across frames.
    const width = hasRail ? bounds.width : null;
    if (hasRail && width !== lastRailWidth) render();
    else if (revealing) graphView.draw(overview, 0, result.duration, result, peakMask, video);
    lastRailWidth = width;
    if (
      [...observedControls].some((el) =>
        el.getAnimations().some((animation) => animation.playState === "running"),
      )
    ) scheduleLayout();
  }
  function savePreferences(next, useDefaults) {
    const videoId = id, key = videoSettingsKey(id);
    ++preferenceRead;
    applyConfig(next);
    preferenceWrites = preferenceWrites.then(() => useDefaults
      ? chrome.storage.local.remove(key) : chrome.storage.local.set({ [key]: next })
    ).catch(() => { if (id === videoId) status("설정을 저장하지 못했습니다. 현재 탭에만 적용됩니다."); });
  }
  async function loadPreferences(videoId) {
    const read = ++preferenceRead, key = videoSettingsKey(videoId);
    await preferenceWrites;
    const values = await chrome.storage.local.get([...defaultSettingsKeys, key])
      .catch(() => ({}));
    if (id !== videoId || read !== preferenceRead) return;
    const nextShortcut = savedHighlightShortcut(values.highlightShortcut);
    const nextPlayerPreferences = savedPlayerPreferences(values[playerPreferencesKey]);
    const toggleLabelChanged = shortcut !== nextShortcut || playerPreferences.autoAnalyze !== nextPlayerPreferences.autoAnalyze;
    shortcut = nextShortcut;
    playerPreferences = nextPlayerPreferences;
    applyPlayerPreferences();
    if (toggleLabelChanged) buttons();
    defaults = savedDefaults(values);
    const next = values[key] ? settings(values[key]) : defaults;
    if (!ready || JSON.stringify(next) !== JSON.stringify(config)) {
      applyConfig(next);
      fields?.fill(next);
    }
    ready = true;
    schedule();
  }
  function update() {
    const current = location.pathname.match(/^\/video\/(\d+)\/?$/)?.[1] || null;
    if (current !== id) {
      detach();
      id = current;
      source = null;
      pool = null;
      recommendationRange = null;
      recommendationsByTime = false;
      ready = false;
      setResult(null);
      pending = false;
      progressInfo = null;
      statusText = statusDetail = "";
      open = false;
      video = player = rail = null;
      if (id) loadPreferences(id);
    }
    if (!id || !ready) return;
    const next = findVideo();
    if (!next) return;
    const found = discover(next);
    if (next !== video || found.player !== player || !host?.isConnected) {
      detach();
      video = next;
      player = found.player;
      mount();
    }
    observeControls(found.rail, player.querySelector(".pzp-pc__vod-time"), player.querySelector(".player_header .header_info"));
    scheduleLayout();
  }
  const railSize = new ResizeObserver(() => {
    scheduleLayout();
    nativePreview?.refresh();
  });
  const railStyle = new MutationObserver(scheduleLayout);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (id && area === "local" &&
        (changes[videoSettingsKey(id)] || defaultSettingsKeys.some(key => changes[key])))
      loadPreferences(id);
  });
  connect();
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      update();
    });
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  window.addEventListener("resize", schedule);
  document.addEventListener("fullscreenchange", schedule);
  document.addEventListener("timeupdate", (event) => {
    if (event.target === video) render(true);
  }, true);
  document.addEventListener("loadedmetadata", schedule, true);
  // Isolated-world History API hooks do not observe the page's own pushState calls.
  const timer = setInterval(schedule, 1000);
  window.addEventListener(
    "pagehide",
    () => {
      observer.disconnect();
      clearInterval(timer);
      port?.disconnect();
      detach();
    },
    { once: true },
  );
  schedule();
})();
