const workers = new Map();
const send = (message) =>
  chrome.runtime
    .sendMessage({ target: "background", ...message })
    .catch(() => {});
function release(job) {
  workers.get(job)?.terminate();
  workers.delete(job);
}
// Offscreen messages reset the service worker's idle timer during slow pages/backoff.
setInterval(() => {
  if (workers.size) send({ type: "heartbeat" });
}, 15000);
chrome.runtime.onMessage.addListener((message, sender) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.tab ||
    message.target !== "offscreen"
  )
    return;
  if (message.type === "cancel") {
    if (workers.has(message.job)) {
      release(message.job);
      send({ type: "cancelled", job: message.job });
    }
    return;
  }
  if (message.type !== "start" || workers.has(message.job) || workers.size >= 2)
    return;
  const worker = new Worker("compute-worker.js", { type: "module" });
  workers.set(message.job, worker);
  worker.onmessage = ({ data }) => {
    if (["result", "error", "cancelled"].includes(data.type)) release(data.job);
    send(data);
  };
  worker.onerror = () => {
    release(message.job);
    send({
      type: "error",
      job: message.job,
      error: "분석이 멈췄습니다. 다시 시도하세요.",
    });
  };
  worker.postMessage(message);
});
