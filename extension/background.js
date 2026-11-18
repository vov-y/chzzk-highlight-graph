import { settings, cacheKey } from "./core/ranking.js";
import { clearReplays } from "./core/chat-cache.js";
import { videoId } from "./core/transport.js";
const jobsByVideo = new Map();
const maxJobs = 2;
let creating, closing, idleTimer;
let cacheWrites = Promise.resolve(), cacheGeneration = 0;
function changeCache(action) {
  const next = cacheWrites.then(action);
  cacheWrites = next.catch(() => {});
  return next;
}
function clearCache() {
  cacheGeneration++;
  return changeCache(async () => {
    const values = await chrome.storage.local.get(null);
    await Promise.all([
      chrome.storage.local.remove(Object.keys(values).filter(k => k.startsWith("graph:"))),
      clearReplays(),
    ]);
  });
}
async function offscreen() {
  clearTimeout(idleTimer);
  await closing;
  if (
    (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }))
      .length
  )
    return;
  if (!creating)
    creating = chrome.offscreen
      .createDocument({
        url: "offscreen.html",
        reasons: ["WORKERS"],
        justification:
          "긴 다시보기의 채팅 수집과 점수 계산을 페이지 UI와 분리해 실행합니다.",
      })
      .finally(() => (creating = null));
  await creating;
}
const send = (port, message) => {
  try {
    port.postMessage(message);
  } catch {}
};
function joinJob(id, port) {
  const job = jobsByVideo.get(id);
  if (!job) return false;
  job.ports.add(port);
  send(port, { type: "progress", id, progress: job.progress });
  return true;
}
function requireJobSlot() {
  if (jobsByVideo.size >= maxJobs)
    throw Error("다른 영상 분석이 진행 중입니다. 완료 후 다시 시도하세요.");
}
async function store(key, result) {
  const values = await chrome.storage.local.get(null),
    entries = Object.entries(values)
      .filter(([k]) => k.startsWith("graph:"))
      .sort((a, b) => a[1].created - b[1].created);
  let bytes = JSON.stringify(result).length * 2;
  if (bytes > 4000000) {
    await chrome.storage.local.remove("graph:" + key);
    return;
  }
  const remove = [];
  let count = 1;
  for (let i = entries.length - 1; i >= 0; i--) {
    const [priorKey, prior] = entries[i];
    if (priorKey === "graph:" + key) continue;
    if (priorKey.startsWith("graph:" + result.id + ":")) { remove.push(priorKey); continue; }
    bytes += JSON.stringify(prior).length * 2;
    if (bytes > 4000000 || ++count > 12) remove.push(priorKey);
  }
  if (remove.length) await chrome.storage.local.remove(remove);
  await chrome.storage.local.set({ ["graph:" + key]: result });
}
async function receive(port, message) {
  if (message.type === "options") {
    await chrome.runtime.openOptionsPage();
    return;
  }
  if (message.type === "clear") {
    await clearCache();
    send(port, { type: "cleared" });
    return;
  }
  const id = videoId(message.id);
  if (message.type === "cancel") {
    const job = jobsByVideo.get(id);
    if (job?.ports.has(port)) {
      await chrome.runtime.sendMessage({
        target: "offscreen",
        type: "cancel",
        job: job.job,
      });
    }
    return;
  }
  if (message.type !== "start" && message.type !== "watch") return;
  const input = settings(message.config ?? (await chrome.storage.local.get("settings")).settings);
  const key = cacheKey(id, input);
  const storageKey = "graph:" + key;
  for (const state of jobsByVideo.values())
    if (state.key !== key) state.ports.delete(port);
  const cached = (await chrome.storage.local.get(storageKey))[storageKey];
  if (joinJob(id, port)) return;
  if (cached && !message.force) {
    send(port, { type: "result", id, result: cached, cached: true });
    return;
  }
  if (message.type === "watch") {
    send(port, { type: "idle", id });
    return;
  }
  requireJobSlot();
  await offscreen();
  // Another tab may have started the same job while the document was created.
  if (joinJob(id, port)) return;
  requireJobSlot();
  const job = crypto.randomUUID(),
    state = {
      job,
      key,
      id,
      generation: cacheGeneration,
      ports: new Set([port]),
      progress: { phase: "starting" },
    };
  jobsByVideo.set(id, state);
  try {
    await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "start",
      job,
      id,
      force: Boolean(message.force),
      config: input,
    });
  } catch (error) {
    if (jobsByVideo.get(id) === state) jobsByVideo.delete(id);
    throw error;
  }
}
chrome.runtime.onConnect.addListener((port) => {
  if (
    port.name !== "highlight-graph" ||
    port.sender?.id !== chrome.runtime.id ||
    !port.sender?.url?.startsWith("https://chzzk.naver.com/")
  ) {
    port.disconnect();
    return;
  }
  port.onDisconnect.addListener(() => {
    for (const job of jobsByVideo.values()) job.ports.delete(port);
  });
  port.onMessage.addListener((message) =>
    receive(port, message).catch((error) =>
      send(port, { type: "error", id: message.id, error: error.message }),
    ),
  );
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === "clear-cache" && sender.id === chrome.runtime.id &&
      sender.url === chrome.runtime.getURL("options.html")) {
    clearCache().then(() => respond({ ok: true }), e => respond({ ok: false, error: e.message }));
    return true;
  }
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL("offscreen.html") ||
    message.target !== "background"
  )
    return;
  const state = [...jobsByVideo.values()].find((x) => x.job === message.job);
  if (!state) return;
  if (message.type === "progress") state.progress = message.progress;
  if (message.type === "result" && state.generation === cacheGeneration) {
    changeCache(() => store(state.key, message.result)).catch(() => {});
  }
  for (const port of state.ports) send(port, { ...message, id: state.id });
  if (["result", "error", "cancelled"].includes(message.type)) {
    jobsByVideo.delete(state.id);
    if (!jobsByVideo.size)
      idleTimer = setTimeout(() => {
        if (!jobsByVideo.size)
          closing = chrome.offscreen
            .closeDocument()
            .catch(() => {})
            .finally(() => (closing = null));
      }, 10000);
  }
});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
