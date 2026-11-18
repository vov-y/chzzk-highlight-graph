import { WindowEngine, scoreWindows, rankingBasis, settings, VERSION } from "./core/model.js";
import { request, collect, videoId, SHARD_SECONDS } from "./core/transport.js";
import { ChatRecorder, loadReplay, storeReplay, readChat } from "./core/chat-cache.js";

const jobs = new Map();
self.onmessage = async ({ data }) => {
  const { type, id, job, config } = data;
  if (type === "cancel") {
    jobs.get(job)?.abort();
    return;
  }
  if (type !== "start" || jobs.has(job)) return;
  const controller = new AbortController();
  jobs.set(job, controller);
  const send = payload => self.postMessage({ job, id, ...payload });
  const progress = (phase, detail = {}) => send({ type: "progress", progress: { phase, ...detail } });
  let recorder;
  try {
    videoId(id);
    const input = settings(config), started = performance.now();
    const options = { signal: controller.signal, stats: { requests: 0, retries: 0 } };
    const cache = await loadReplay(id).catch(() => null);
    let recording = !data.force && cache?.chat;
    let replaySaved = Boolean(recording), engine;
    if (recording) {
      progress("replaying");
      engine = new WindowEngine(recording.duration, input);
      try {
        await readChat(recording.blob, (time, user, text) => engine.push({
          playerMessageTime: time, userIdHash: user, content: text,
          messageTypeCode: 1, messageStatusType: "NORMAL",
        }), controller.signal);
      } catch (error) {
        if (controller.signal.aborted) throw error;
        recording = null;
        replaySaved = false;
      }
    }
    if (!recording) {
      progress("starting");
      const metadata = await request(`/service/v3/videos/${id}`, options);
      const duration = Number(metadata.duration);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 7 * 24 * 3600)
        throw Error("영상 길이를 확인할 수 없습니다.");
      engine = new WindowEngine(duration, input);
      recorder = new ChatRecorder();
      progress("collecting", { done: 0, total: Math.ceil(duration / SHARD_SECONDS), messages: 0 });
      const stats = await collect(id, duration, (messages, end) => {
        for (const m of messages) if (engine.push(m)) recorder.add(m);
        engine.flushThrough(end);
      }, p => progress("collecting", p), options);
      recording = { id, duration, title: String(metadata.videoTitle || `다시보기 ${id}`),
        stats, created: Date.now(), blob: await recorder.finish() };
      if (cache) replaySaved = await storeReplay(recording, cache.epoch).catch(() => false);
    }
    progress("scoring");
    const scores = scoreWindows(engine.finish(), input);
    send({ type: "result", result: {
      id, duration: recording.duration, title: recording.title, version: VERSION, step: 5, window: 30,
      basis: rankingBasis(scores), strong_reaction: input.strong_reaction,
      stats: { ...recording.stats, analyzed: engine.analyzed, seconds: (performance.now() - started) / 1000 },
      replaySaved, created: Date.now(),
    } });
  } catch (error) {
    send({ type: error.name === "AbortError" ? "cancelled" : "error", error: error.message || "분석에 실패했습니다." });
  } finally {
    jobs.delete(job);
    if (recorder) recorder.finish().catch(() => {});
  }
};
