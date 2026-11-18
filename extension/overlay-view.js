// Static view for the player's isolated content-script world.
const kirinukiOverlayView = (() => {
  const shapes = {
    highlight: '<path d="M4 19v-6 M9.3 19V5 M14.7 19v-9 M20 19V8" stroke-width="3.4"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    tune: '<path d="M3 7h8m4 0h6M3 17h3m4 0h11"/><circle cx="13" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2 6.3M20 5v6h-6"/>',
    restore: '<path d="M4 11a8 8 0 1 1 2 6.3M4 5v6h6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M10 3h4l.6 2.5 1.9 1.1 2.5-.8 2 3.4-1.9 1.7v2.2l1.9 1.7-2 3.4-2.5-.8-1.9 1.1-.6 2.5h-4l-.6-2.5-1.9-1.1-2.5.8-2-3.4 1.9-1.7v-2.2L3 9.2l2-3.4 2.5.8 1.9-1.1Z"/>',
    scan: '<path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4M8 13v3m4-8v8m4-5v5"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    trash: '<path d="M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14M10 10v6m4-6v6"/>',
    left: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
    right: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
    previous: '<path d="M6 6v12m12-12-8 6 8 6"/>',
    next: '<path d="M18 6v12M6 6l8 6-8 6"/>',
    seek: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    locate: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
    fit: '<path d="M4 5v14m16-14v14M7 12h10m-7-3-3 3 3 3m4-6 3 3-3 3"/>',
    minus: '<path d="M5 12h14"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
  };
  const icon = (name) =>
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    shapes[name] + '</svg>';
  const iconButton = (id, name, label, attributes = "") =>
    '<button type="button" class="icon-button" id="' + id + '" aria-label="' + label +
    '" title="' + label + '" ' + attributes + '>' + icon(name) + '</button>';

  // Use the player's own light-DOM button and tooltip selectors for all hover effects.
  const button = `<button id="kirinuki-highlight-toggle" type="button" class="pzp-button pzp-pc-ui-button" aria-label="하이라이트 분석" aria-expanded="false" aria-controls="kirinuki-highlight-root">
    <span class="pzp-button__tooltip pzp-button__tooltip--top" aria-hidden="true">하이라이트 분석</span>
    <span class="pzp-ui-icon"><svg class="pzp-ui-icon__svg" viewBox="0 0 44 44" width="100%" height="100%" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><g transform="translate(10 10)">${shapes.highlight}</g></svg></span>
  </button>`;
  const panel = `<style>
    :host {
      font: 14px/1.45 "Sandoll Nemony2", "Pretendard Variable", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif;
      --ink-default: #dfe2ea;
      --quiet-default: #c9cedc;
      --ink: var(--sem-color-content-neutral-cool-stronger, var(--ink-default));
      --quiet: var(--sem-color-content-neutral-cool-strong, var(--quiet-default));
      --rule: color-mix(in srgb, var(--ink) 18%, transparent);
      --edge: color-mix(in srgb, var(--ink) 24%, transparent);
      --faint-rule: color-mix(in srgb, var(--ink) 11%, transparent);
      --hover-fill: color-mix(in srgb, var(--ink) 10%, transparent);
      --scroll-thumb: color-mix(in srgb, var(--quiet) 44%, transparent);
      --glass-rgb: 21 26 32;
      --inset-rgb: 12 16 22;
      --glass-alpha: .50;
      --glass-fallback-alpha: .78;
      --glass-tone: saturate(1.25) brightness(.93);
      --glass-solid: #252a30;
      --inset-solid: #1f242a;
      --text-halo: rgb(0 0 0 / .60);
      --plot-brightness: 1;
      --form-scheme: dark;
      --range-accent-dark: #00e693;
      --range-accent-light: #168f5c;
      --range-accent-fallback: var(--range-accent-dark);
      --range-accent: var(--sem-color-content-brand-base, var(--range-accent-fallback));
      --glass-time: 220ms;
      --glass-ease: cubic-bezier(.22,.7,.2,1);
      container-type: size;
    }
    :host-context([data-theme="light"]) {
      --ink-default: #202224;
      --quiet-default: #2e3033;
      --glass-rgb: 255 255 255;
      --inset-rgb: 255 255 255;
      --glass-alpha: .40;
      --glass-fallback-alpha: .88;
      --glass-tone: contrast(.32) saturate(1.6) brightness(1.6);
      --glass-solid: #f0f1f2;
      --inset-solid: #fff;
      --text-halo: rgb(255 255 255 / .45);
      --plot-brightness: .14;
      --form-scheme: light;
      --range-accent-fallback: var(--range-accent-light);
    }
    *, *::before, *::after { box-sizing: border-box }
    [hidden] { display: none !important }
    .sr-only { position: absolute; width: 1px; height: 1px; clip-path: inset(50%); overflow: hidden; white-space: nowrap }
    button, input, textarea, select { font: inherit; color: inherit }
    button { border: 0; padding: 0; background: transparent; cursor: pointer }
    button:disabled { opacity: .42; cursor: default }
    :is(button, canvas, input, select, textarea):focus-visible { outline: 2px solid currentColor; outline-offset: 1px }
    h2, h3, p { margin: 0 }
    svg { display: block; width: 17px; height: 17px; pointer-events: none }
    .icon-button { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 50% }
    #timeline { position: absolute }
    #overview-surface > *, #tooltip[data-overview] { opacity: var(--timeline-opacity,0) }
    #button-fallback { position: absolute; right: 0; bottom: calc(46px + var(--peak-room,0px)); display: block; pointer-events: auto }
    :host([data-hide-overview]) #button-fallback { bottom: 46px }
    .graph-surface { position: relative; user-select: none }
    #overview-surface {
      position: absolute; left: 0; bottom: 2px; width: 100%; height: calc(40px + var(--peak-room,0px));
      pointer-events: none; opacity: 0; transition: opacity var(--glass-time) var(--glass-ease);
    }
    :host([data-hide-overview]) #overview-surface { display: none }
    #timeline[data-exploring] #overview-surface { pointer-events: auto; opacity: 1 }
    /* Bridge the gap above the native seek bar while crossing into the graph. */
    #overview-surface::after { content: ""; position: absolute; inset: 100% 0 auto; height: 2px }
    #overview {
      display: block; width: 100%; height: 100%; color: white; cursor: default; touch-action: none; filter: drop-shadow(0 1px 2px #0009);
    }
    /* Move the drawing without moving the hit area or the bridge to the seek bar. */
    #overview-surface > * {
      translate: 0 6px; transition: translate var(--glass-time) var(--glass-ease);
    }
    #timeline[data-exploring] #overview-surface > * { translate: none }
    .recommendation-bands { position: absolute; inset: 0; overflow: hidden; pointer-events: none }
    .recommendation-band {
      position: absolute; inset-block: 0;
      left: calc((var(--band-start) - var(--domain-start)) * 100% / var(--domain-width));
      width: calc((var(--band-end) - var(--band-start)) * 100% / var(--domain-width));
      background: color-mix(in srgb, var(--range-accent) 20%, transparent);
      box-shadow: inset 0 -2px color-mix(in srgb, var(--range-accent) 72%, transparent);
      opacity: 0; transition: opacity var(--glass-time) var(--glass-ease);
    }
    .recommendation-band[data-active] { opacity: 1 }
    .overview-range {
      position: absolute; inset-block: 0; pointer-events: none;
      background: rgb(255 255 255 / .12); border: 1px solid rgb(255 255 255 / .62);
    }
    #timeline:not([data-exploring]) ~ #tooltip[data-overview] { visibility: hidden }
    .drag-box {
      position: absolute; inset-block: 0; pointer-events: none; border: 1px solid rgb(186 255 230 / .96);
      background: rgb(103 239 186 / .21); box-shadow: 0 0 0 1px rgb(0 0 0 / .34) inset;
    }
    .cursor-line {
      position: absolute; inset-block: 0; width: 1px; pointer-events: none;
      background: rgb(255 255 255 / .94); box-shadow: 0 0 0 1px rgb(0 0 0 / .38);
    }
    #overview-surface .cursor-line { bottom: -2px }
    #explore .drag-box {
      border-color: var(--range-accent); box-shadow: inset 0 0 0 1px var(--edge);
      background-color: color-mix(in srgb, var(--range-accent) 21%, transparent);
    }
    #explore .cursor-line {
      background-color: var(--ink); box-shadow: 0 0 0 1px var(--edge);
    }
    #panel, #tooltip {
      color: var(--ink);
      border: 1px solid var(--edge);
      box-shadow: 0 4px 16px rgb(0 0 0 / .16);
      background-color: rgb(var(--glass-rgb) / var(--glass-fallback-alpha));
    }
    .settings-content, .candidate::before { background-color: rgb(var(--inset-rgb) / .14) }
    @supports (backdrop-filter: blur(1px)) {
      /* The panel's opacity transition would isolate a descendant's backdrop. */
      #panel, #tooltip {
        background-color: rgb(var(--glass-rgb) / var(--glass-alpha));
        backdrop-filter: blur(12px) var(--glass-tone);
      }
      .settings-content, .candidate::before { backdrop-filter: blur(12px) }
    }
    @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
      #panel, #tooltip { background-color: var(--glass-solid); backdrop-filter: none }
      .settings-content, .candidate::before { background-color: var(--inset-solid); backdrop-filter: none }
    }
    #panel {
      --rest-width: min(88cqw, clamp(250px, 34cqw, 326px));
      --width-time: 0s;
      --hide-delay: var(--glass-time);
      position: absolute; top: var(--panel-top, 0px); left: 0; width: var(--rest-width);
      max-height: calc(100% - var(--panel-top, 0px) - var(--rail-space,54px) - var(--graph-gap,6px));
      display: flex; flex-direction: column; overflow: hidden; isolation: isolate;
      border-left: 0; border-radius: 0 16px 16px 0; font-variant-numeric: tabular-nums;
      text-shadow: 0 1px 2px var(--text-halo);
      transform: translateX(-6px); pointer-events: none;
      opacity: 0; visibility: hidden;
      transition: width var(--width-time) var(--glass-ease), transform var(--glass-time) var(--glass-ease),
        opacity var(--glass-time) var(--glass-ease), visibility 0s var(--hide-delay);
    }
    #panel[data-open] {
      --width-time: var(--glass-time);
      --hide-delay: 0s;
      opacity: 1; visibility: visible; transform: none; pointer-events: auto;
    }
    #panel:focus { outline: none }
    @media (hover: hover) {
      #panel[data-expanded] { width: max(var(--rest-width), 40cqw) }
    }
    :host(:not([data-hide-overview])) #panel[data-ready] { --graph-gap: calc(52px + var(--peak-room,0px)) }
    .panel-head, .section-head, .plot-tools, .group { display: flex; align-items: center; gap: 6px }
    .panel-head, .section-head, .plot-tools { justify-content: space-between }
    .panel-head { padding: 13px 16px 3px 20px; flex: none }
    .panel-head h2 { font-size: 16px; font-weight: 650; letter-spacing: -.035em }
    #panel .icon-button { color: var(--quiet) }
    #panel button:hover, #panel .icon-button[aria-expanded=true] { color: var(--ink); background-color: var(--hover-fill) }
    .panel-body {
      min-height: 0; overflow: auto; overflow-anchor: none; overscroll-behavior: contain;
      scrollbar-width: thin; scrollbar-color: var(--scroll-thumb) transparent;
      margin: 0 8px 10px 0; padding: 0 8px 6px 20px;
    }
    #status { margin-block: 5px; font-size: 13px; line-height: 1.4; color: var(--quiet); overflow-wrap: anywhere }
    #progress { display: block; width: 100%; height: 3px; margin: 8px 0; appearance: none; overflow: hidden; border-radius: 2px }
    #progress::-webkit-progress-bar { background-color: var(--rule) }
    #progress::-webkit-progress-value { background-color: var(--ink) }
    #progress:indeterminate { animation: progress 1s ease-in-out infinite alternate }
    #progress:indeterminate::-webkit-progress-bar { background-color: var(--scroll-thumb) }
    @keyframes progress { to { opacity: .4 } }
    .section-head { min-height: 32px; margin-top: 7px }
    h3 { font-size: 15px; font-weight: 650; letter-spacing: -.015em }
    #range-label, .count, .candidate .stamp, #tooltip, #live-settings :is(input, select, textarea) {
      font-family: "Pretendard Variable", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif;
      font-weight: 350;
    }
    #range-label, .count { color: var(--quiet) }
    #explore .graph-surface::before {
      content: ""; position: absolute; inset: 33.333% 0; pointer-events: none;
      border-block: 1px solid var(--faint-rule);
    }
    #detail {
      position: relative; display: block; width: 100%; height: calc(59px + var(--peak-room,0px)); cursor: default; touch-action: none;
      border-bottom: 1px solid var(--rule);
      filter: brightness(var(--plot-brightness));
    }
    #range-bar { padding: 0 14px }
    .range-track { position: relative; height: 22px; cursor: pointer }
    .range-track::before, .range-fill {
      position: absolute; inset-block: 8px; border-radius: 3px; pointer-events: none;
    }
    .range-track::before { content: ""; inset-inline: 0; background-color: var(--rule) }
    .range-fill { left: var(--range-from); right: calc(100% - var(--range-to)); background-color: var(--range-accent) }
    .range-handle {
      position: absolute; inset-block: 0; width: 14px; cursor: ew-resize; touch-action: none; border-radius: 3px;
    }
    .range-handle::before {
      content: ""; position: absolute; inset-block: 4px; width: 6px; border-radius: 2px;
      background-color: var(--ink);
    }
    #range-start { left: var(--range-from); translate: -100% }
    #range-start::before { right: 0 }
    #range-end { left: var(--range-to) }
    #range-end::before { left: 0 }
    .plot-tools { margin: 0 0 6px }
    .plot-tools .group, .section-head .group, .panel-head .group { gap: 2px }
    .plot-tools .icon-button, .section-head .icon-button { width: 27px; height: 27px }
    .plot-tools svg, .section-head svg { width: 15px; height: 15px }
    .section-head.list-head { border-top: 1px solid var(--rule); padding-top: 7px; margin-top: 0 }
    .count { margin-left: 4px; font-size: 13px }
    .candidate {
      position: relative; isolation: isolate; border-radius: 8px;
      display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px;
      width: 100%; padding: 8px 7px; text-align: left; align-items: center; border-bottom: 1px solid transparent;
    }
    .candidate::before {
      content: ""; position: absolute; inset: 0 0 -1px; z-index: -1; pointer-events: none;
      border-radius: inherit; box-shadow: inset 0 0 0 1px var(--edge);
      opacity: 0; transition: opacity var(--glass-time) var(--glass-ease);
    }
    .candidate::after {
      content: ""; position: absolute; inset: auto 0 -1px; height: 1px; pointer-events: none;
      background-color: var(--faint-rule); transition: opacity var(--glass-time) var(--glass-ease);
    }
    .candidate[aria-current=true]::before { opacity: 1 }
    .candidate[aria-current=true]::after { opacity: 0 }
    .candidate .stamp { font-size: 14px; line-height: 1.3; letter-spacing: .01em }
    .candidate svg { width: 15px; height: 15px; color: var(--quiet) }
    #candidates { font-size: 13px; color: inherit }
    /* Keep the backdrop in the same compositing context throughout the reveal. */
    #adjustments {
      display: grid; grid-template-rows: 0fr; transform: translateY(-4px); visibility: hidden;
      transition: grid-template-rows var(--glass-time) var(--glass-ease),
        transform var(--glass-time) var(--glass-ease), visibility 0s var(--glass-time);
    }
    #adjustments[data-open] { grid-template-rows: 1fr; transform: none; visibility: visible; transition-delay: 0s }
    .settings-clip { min-height: 0; overflow: hidden }
    .settings-content {
      margin: 5px 2px 8px; padding: 8px 10px;
      border: 1px solid var(--edge); border-radius: 11px;
      box-shadow: 0 2px 5px rgb(0 0 0 / .16);
    }
    .settings-actions { display: flex; align-items: center; justify-content: space-between }
    #clear { flex: none }
    #adjustments label { display: flex; gap: 8px; align-items: center; min-height: 28px; font-size: 14px }
    #live-settings label { justify-content: space-between; margin: 3px 0 }
    #live-settings fieldset { margin: 4px 0 8px; padding: 5px 0; border: 0; border-bottom: 1px solid var(--rule) }
    #live-settings legend { padding: 0; font-size: 16px; font-weight: 650 }
    #live-settings :is(input,select,textarea) {
      color-scheme: var(--form-scheme); border: 1px solid var(--edge); border-radius: 7px;
      background-color: rgb(var(--inset-rgb) / .53); padding: 3px 6px;
    }
    #live-settings input { width: 64px }
    .recommendation-fields { display: flex; align-items: center; gap: 8px }
    #live-settings .recommendation-fields label { margin: 0 }
    #live-settings .expressions { display: grid; justify-content: stretch; gap: 4px }
    #live-settings textarea { width: 100%; resize: vertical; min-height: 36px }
    #adjustments p:not(:empty) { margin-block: 5px; color: var(--quiet); font-size: 13px }
    #tooltip {
      position: absolute; z-index: 2; pointer-events: none; border-radius: 8px;
      padding: 5px 8px; font-size: 13px; width: max-content; max-width: calc(100% - 8px); text-align: center;
    }
    @container (max-height: 520px) {
      .panel-head { padding-top: 8px }
      #detail { height: calc(44px + var(--peak-room,0px)) }
      .section-head { min-height: 27px; margin-top: 3px }
      .candidate { padding-block: 5px }
    }
    @media (prefers-reduced-motion: reduce) {
      :host { --glass-time: 0ms }
      #progress:indeterminate { animation: none }
    }
  </style>
  <div id="timeline" hidden>
    <slot id="button-fallback" name="highlight-control"></slot>
    <div id="overview-surface" class="graph-surface">
      <canvas id="overview" hidden tabindex="0" role="slider" aria-label="전체 점수 그래프" aria-description="클릭한 위치로 이동합니다. 드래그한 구간을 확대합니다." aria-valuemin="0"></canvas>
      <span class="overview-range" aria-hidden="true" hidden></span>
      <span class="drag-box" aria-hidden="true" hidden></span>
      <span class="cursor-line" aria-hidden="true" hidden></span>
    </div>
  </div>
  <section id="panel" tabindex="-1" aria-labelledby="panel-title" aria-hidden="true" inert>
    <header class="panel-head">
      <h2 id="panel-title">하이라이트</h2>
      <div class="group">
        ${iconButton("analyze", "scan", "분석 시작")}
        ${iconButton("cancel", "stop", "분석 취소", "hidden")}
        ${iconButton("reanalyze", "refresh", "다시 분석", "hidden")}
        ${iconButton("tools", "tune", "영상 설정", 'aria-expanded="false" aria-controls="adjustments"')}
        ${iconButton("close", "close", "닫기")}
      </div>
    </header>
    <div class="panel-body">
      <p id="status" class="sr-only" role="status"></p>
      <progress id="progress" aria-label="분석 진행률" hidden></progress>
      <div id="adjustments" aria-hidden="true" inert><div class="settings-clip"><div class="settings-content">
        <div id="live-settings"></div>
        <p id="settings-status" role="status"></p>
        <div class="settings-actions">
          <div class="group">${iconButton("use-defaults", "restore", "영상 설정을 기본값으로 복원")}${iconButton("options", "settings", "기본 설정 열기")}</div>
          ${iconButton("clear", "trash", "분석 캐시 삭제")}
        </div>
      </div></div></div>
      <div id="explore" hidden>
        <div class="section-head"><h3>구간 탐색</h3><span id="range-label"></span></div>
        <span id="graph-help" hidden>클릭해 재생 위치를 옮기거나 드래그해 구간을 확대합니다. Shift+휠로 확대·축소하고 Alt+휠로 구간을 옮깁니다. 방향키는 5초, Shift+방향키는 1분씩 이동합니다.</span>
        <div class="graph-surface">
          <div class="recommendation-bands" aria-hidden="true"></div>
          <canvas id="detail" tabindex="0" role="slider" aria-label="구간 점수 그래프" aria-describedby="graph-help" aria-valuemin="0"></canvas>
          <span class="drag-box" aria-hidden="true" hidden></span>
          <span class="cursor-line" aria-hidden="true" hidden></span>
        </div>
        <div id="range-bar" role="group" aria-label="탐색 범위">
          <div class="range-track">
            <span class="range-fill" aria-hidden="true"></span>
            <button id="range-start" class="range-handle" type="button" role="slider" aria-label="탐색 범위 시작"></button>
            <button id="range-end" class="range-handle" type="button" role="slider" aria-label="탐색 범위 끝"></button>
          </div>
        </div>
        <div class="plot-tools">
          <div class="group">
            ${iconButton("pan-left", "left", "이전 구간")}${iconButton("pan-right", "right", "다음 구간")}
            ${iconButton("zoom-out", "minus", "구간 축소")}${iconButton("zoom-in", "plus", "구간 확대")}
          </div>
          <div class="group">${iconButton("near", "locate", "현재 위치 앞뒤 5분")}${iconButton("reset", "fit", "전체 범위")}</div>
        </div>
        <div class="section-head list-head">
          <h3>추천 구간 <span class="count" id="candidate-count"></span></h3>
          <div class="group">${iconButton("previous", "previous", "이전 추천 구간")}${iconButton("next", "next", "다음 추천 구간")}</div>
        </div>
        <div id="candidates"></div>
      </div>
    </div>
  </section>
  <div id="tooltip" hidden></div>`;
  return { button, panel, icon };
})();
