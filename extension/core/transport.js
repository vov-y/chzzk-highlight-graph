const RETRY = new Set([408, 425, 429, 500, 502, 503, 504]);
export const API = "https://api.chzzk.naver.com";
export const SHARD_SECONDS = 300;
const shardMilliseconds = SHARD_SECONDS * 1000;
const maxWorkers = 8;
const maxBuffered = 16;
export function videoId(value) {
  if (!/^\d{1,16}$/.test(String(value))) throw Error("잘못된 영상 번호입니다.");
  return String(value);
}
const abort = () => new DOMException("취소되었습니다.", "AbortError");
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abort());
    const done = () => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const cancel = () => {
      clearTimeout(timer);
      reject(abort());
    };
    signal?.addEventListener("abort", cancel, { once: true });
  });
}
export async function request(
  path,
  {
    signal,
    fetcher = fetch,
    stats = { requests: 0, retries: 0 },
    sleep = delay,
  } = {},
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (signal?.aborted) throw abort();
    let retryAfter = 0;
    try {
      stats.requests++;
      const response = await fetcher(API + path, {
        signal: AbortSignal.any([
          ...(signal ? [signal] : []),
          AbortSignal.timeout(25000),
        ]),
        credentials: "include",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (RETRY.has(response.status)) {
        const header = response.headers.get("Retry-After");
        retryAfter = header
          ? Math.max(
              0,
              Number.isFinite(Number(header))
                ? Number(header) * 1000
                : Date.parse(header) - Date.now(),
            )
          : 0;
        if (retryAfter > 30000)
          throw Object.assign(
            Error("요청 제한입니다. 잠시 후 다시 분석하세요."),
            { fatal: true },
          );
        throw Error(`채팅 서버에 연결하지 못했습니다 (${response.status}).`);
      }
      if (!response.ok)
        throw Object.assign(
          Error(
            `채팅을 불러오지 못했습니다 (${response.status}). 영상에 접근할 수 있는지 확인하세요.`,
          ),
          { fatal: true },
        );
      const body = await response.json();
      if (body.code !== 200 || !body.content)
        throw Object.assign(
          Error(body.code == null ? "치지직 응답을 읽을 수 없습니다." : `치지직에서 오류가 발생했습니다 (${body.code}).`),
          { fatal: true },
        );
      return body.content;
    } catch (error) {
      if (signal?.aborted) throw abort();
      if (error.fatal || attempt === 4) throw error;
      stats.retries++;
      await sleep(
        Math.max(
          retryAfter,
          Math.min(8000, 500 * 2 ** attempt + Math.random() * 250),
        ),
        signal,
      );
    }
  }
}
const key = (m) =>
  JSON.stringify([
    m.playerMessageTime,
    m.messageTime ?? null,
    m.userIdHash ?? null,
    "content" in m ? m.content : "",
    m.messageTypeCode ?? null,
  ]);
export async function collectShard(id, start, end, options = {}) {
  const path = `/service/v1/videos/${videoId(id)}/chats`;
  let cursor = Math.max(0, start - 1),
    first = true,
    pendingTime = null;
  const pending = new Map();
  const output = [];
  for (;;) {
    const includePrevious = start === 0 && first;
    const page = await request(
      `${path}?playerMessageTime=${cursor}${includePrevious ? "&previousVideoChatSize=50" : ""}`,
      options,
    );
    if (
      !Object.hasOwn(page, "videoChats") ||
      !Object.hasOwn(page, "nextPlayerMessageTime") ||
      (page.videoChats !== null && !Array.isArray(page.videoChats))
    )
      throw Error("채팅 목록을 읽을 수 없습니다.");
    const current = page.videoChats || [],
      lower = Math.max(start, pendingTime ?? start);
    const rows = includePrevious ? [...(page.previousVideoChats || []), ...current] : current;
    if (rows.some((m) => !m || !Number.isFinite(m.playerMessageTime)))
      throw Error("채팅의 재생 시간을 읽을 수 없습니다.");
    const candidates = rows
      .filter((m) => m.playerMessageTime >= lower && m.playerMessageTime < end)
      .sort(
        (a, b) =>
          a.playerMessageTime - b.playerMessageTime ||
          (a.messageTime || 0) - (b.messageTime || 0),
      );
    for (const m of candidates) {
      if (pendingTime !== null && m.playerMessageTime > pendingTime) {
        output.push(...pending.values());
        pending.clear();
      }
      pendingTime = m.playerMessageTime;
      pending.set(key(m), m);
    }
    const next = page.nextPlayerMessageTime;
    if (
      next === null ||
      current.some((m) => m.playerMessageTime >= end) ||
      next >= end
    ) {
      output.push(...pending.values());
      return output;
    }
    if (!Number.isFinite(next) || next - 1 <= cursor)
      throw Error(
        "채팅을 일부만 받았습니다. 다시 분석해 주세요.",
      );
    cursor = next - 1;
    first = false;
  }
}
// At most 16 shards can be buffered or in flight ahead of ordered consumption.
export async function collect(id, duration, onShard, onProgress, options = {}) {
  const endTime = duration * 1000 + 1;
  const total = Math.ceil(endTime / shardMilliseconds);
  const stats = options.stats ?? { requests: 0, retries: 0 };
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const shardOptions = { ...options, signal, stats };
  let claim = 0,
    emit = 0,
    done = 0,
    count = 0;
  const ready = new Map(),
    waiters = [];
  function wake() {
    for (const fn of waiters.splice(0)) fn();
  }
  async function worker() {
    for (;;) {
      while (claim >= emit + maxBuffered && claim < total && !signal.aborted)
        await new Promise((r) => waiters.push(r));
      if (signal.aborted) throw abort();
      if (claim >= total) return;
      const index = claim++,
        start = index * shardMilliseconds,
        end = Math.min((index + 1) * shardMilliseconds, endTime);
      const messages = await collectShard(id, start, end, shardOptions);
      ready.set(index, messages);
      done++;
      count += messages.length;
      while (ready.has(emit)) {
        const batch = ready.get(emit);
        ready.delete(emit);
        onShard(batch, Math.min((emit + 1) * SHARD_SECONDS, duration));
        emit++;
      }
      wake();
      onProgress({ done, total, messages: count, ...stats });
    }
  }
  // Abort remaining workers on first failure, including waiters and active fetches.
  signal.addEventListener("abort", wake);
  try {
    await Promise.all(Array.from({ length: Math.min(maxWorkers, total) }, worker));
    return { messages: count, ...stats };
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    signal.removeEventListener("abort", wake);
  }
}
