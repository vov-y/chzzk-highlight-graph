const budget = 128 * 1024 * 1024;
let opening;
function database() {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open("kirinuki-chat-replay", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("videos", { keyPath: "id" });
      request.result.createObjectStore("state");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => { opening = null; throw error; });
  return opening;
}
async function transaction(mode, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["videos", "state"], mode);
    const value = action(tx.objectStore("videos"), tx.objectStore("state"));
    tx.oncomplete = () => resolve(value?.());
    tx.onabort = () => reject(tx.error || Error("채팅 캐시를 열 수 없습니다."));
  });
}
export function loadReplay(id) {
  return transaction("readonly", (videos, state) => {
    const chat = videos.get(id), epoch = state.get("epoch");
    return () => ({ chat: chat.result, epoch: epoch.result });
  });
}
export function storeReplay(record, epoch) {
  return transaction("readwrite", (videos, state) => {
    let stored = false;
    const current = state.get("epoch");
    current.onsuccess = () => {
      if (current.result !== epoch) return;
      const all = videos.getAll();
      all.onsuccess = () => {
        let bytes = record.blob.size, count = 1;
        for (const other of all.result.filter(r => r.id !== record.id).sort((a,b) => b.created - a.created)) {
          bytes += other.blob.size;
          if (++count > 12 || bytes > budget) videos.delete(other.id);
        }
        videos.put(record);
        stored = true;
      };
    };
    return () => stored;
  });
}
export function clearReplays() {
  return transaction("readwrite", (videos, state) => {
    videos.clear();
    state.put(crypto.randomUUID(), "epoch");
  });
}

// A gzip stream of small JSON batches. Author numbers are local to this recording.
export class ChatRecorder {
  constructor() {
    this.authors = new Map();
    this.rows = [];
    this.previous = 0;
    this.encoder = new TextEncoder();
    const stream = new ReadableStream({ start: controller => { this.controller = controller; } });
    this.blob = new Response(stream.pipeThrough(new CompressionStream("gzip"))).blob();
  }
  add(m) {
    let author = 0;
    if (m.userIdHash) {
      author = this.authors.get(m.userIdHash);
      if (author === undefined) {
        author = this.authors.size + 1;
        this.authors.set(m.userIdHash, author);
      }
    }
    this.rows.push([m.playerMessageTime - this.previous, author, m.content || ""]);
    this.previous = m.playerMessageTime;
    if (this.rows.length === 1024) this.flush();
  }
  flush() {
    if (this.rows.length) this.controller.enqueue(this.encoder.encode(JSON.stringify(this.rows) + "\n"));
    this.rows = [];
  }
  finish() {
    if (this.controller) {
      this.flush();
      this.controller.close();
      this.controller = null;
      this.authors.clear();
    }
    return this.blob;
  }
}
export async function readChat(blob, visit, signal) {
  let tail = "", time = 0;
  const stream = blob.stream().pipeThrough(new DecompressionStream("gzip")).pipeThrough(new TextDecoderStream());
  const reader = stream.getReader();
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      const lines = (tail + value).split("\n");
      tail = lines.pop();
      for (const line of lines) {
        for (const [delta, author, text] of JSON.parse(line)) {
          time += delta;
          visit(time, author || null, text);
        }
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (tail) throw Error("채팅 캐시가 완전하지 않습니다.");
}
