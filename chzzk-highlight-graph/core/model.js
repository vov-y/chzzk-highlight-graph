import { emojiSequences } from "./emoji-data.js";

import { DEFAULTS, FAMILIES, REACTIONS, settings, weightFamilies } from "./ranking.js";
export { DEFAULTS, FAMILIES, REACTIONS, settings, VERSION, cacheKey } from "./ranking.js";

const stop = new Set(
  "이거 저거 그거 그냥 근데 그래서 아니 진짜 너무 이게 뭔가 지금 오늘 저는 이제 하는 하고 있어".split(
    " ",
  ),
);
// Generated from the same emoji package used by the Python model; longest match wins.
const trie = new Map();
for (const sequence of emojiSequences) {
  let node = trie;
  for (const char of sequence) {
    if (!node.has(char)) node.set(char, new Map());
    node = node.get(char);
  }
  node.set("", sequence);
}
function emojis(text) {
  const chars = [...text],
    found = new Set();
  for (let i = 0; i < chars.length; i++) {
    let node = trie,
      end = i,
      match;
    for (let j = i; j < chars.length && node.has(chars[j]); j++) {
      node = node.get(chars[j]);
      if (node.has("")) {
        match = node.get("");
        end = j;
      }
    }
    if (match) {
      found.add(`emoji:${match}`);
      i = end;
    }
  }
  return found;
}
export function parser(config = DEFAULTS) {
  const custom = settings(config).strong_reaction.map(
    (x) =>
      new RegExp(
        `(?<![가-힣a-zA-Z0-9])(?:${x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![가-힣a-zA-Z0-9])`,
        "u",
      ),
  );
  const cache = new Map();
  return (text) => {
    if (cache.has(text)) {
      const v = cache.get(text);
      cache.delete(text);
      cache.set(text, v);
      return v;
    }
    const tokens = new Set(
      [...text.matchAll(/\{:([^}]+):\}/g)].map((x) => `emote:${x[1]}`),
    );
    const platform = tokens.size > 0;
    const clean = text.replace(/\{:([^}]+):\}/g, " ").toLowerCase();
    const unicode = emojis(clean);
    for (const token of unicode) tokens.add(token);
    for (const [word] of clean.matchAll(/[가-힣ㄱ-ㅎㅏ-ㅣa-z]+/g))
      if (!stop.has(word)) tokens.add(word.replace(/(.)\1{2,}/gu, "$1$1"));
    const reactions = [];
    if (/ㅋ{2,}|ㅎ{2,}|lol|lmao|rofl/i.test(clean)) reactions.push("laughter");
    if (
      /대박|미쳤|레전드|뭐야|뭐지|헐|ㄷ{2,}|ㅁㅊ|소름|[?!？！]{2,}|(?<![가-힣])와[아우]*(?![가-힣])/.test(
        clean,
      )
    )
      reactions.push("surprise_question");
    if (platform || unicode.size) reactions.push("emote");
    if (custom.some((pattern) => pattern.test(text)))
      reactions.push("strong_reaction");
    const result = { tokens, reactions };
    cache.set(text, result);
    if (cache.size > 16384) cache.delete(cache.keys().next().value);
    return result;
  };
}
function change(map, key, delta) {
  const n = (map.get(key) || 0) + delta;
  if (n) map.set(key, n);
  else map.delete(key);
}

// Ordered shards feed this engine. Only a sliding 30-second chat window is retained.
export class WindowEngine {
  constructor(duration, config = DEFAULTS) {
    this.duration = duration;
    this.parse = parser(config);
    this.frames = [];
    this.active = [];
    this.head = 0;
    this.start = 0;
    this.seen = new Map();
    this.authors = new Map();
    this.reactors = Object.fromEntries(REACTIONS.map((k) => [k, new Map()]));
    this.terms = new Map();
    this.returners = new Map();
    this.emotes = 0;
    this.analyzed = 0;
    this.previous = -Infinity;
  }
  update(entry, delta) {
    const { user, tokens, reactions, returning } = entry;
    this.emotes += delta * Number(reactions.includes("emote"));
    if (!user) return;
    change(this.authors, user, delta);
    for (const name of reactions) change(this.reactors[name], user, delta);
    if (returning) change(this.returners, user, delta);
    for (const token of tokens) {
      if (!this.terms.has(token)) this.terms.set(token, new Map());
      const counts = this.terms.get(token);
      change(counts, user, delta);
      if (!counts.size) this.terms.delete(token);
    }
  }
  flushThrough(watermark) {
    while (this.start + 30 <= Math.min(watermark, this.duration)) {
      this.frames.push({
        start: this.start,
        messages: this.active.length - this.head,
        authors: this.authors.size,
        reactions: Object.fromEntries(
          REACTIONS.map((k) => [k, this.reactors[k].size]),
        ),
        terms: Object.fromEntries([...this.terms].map(([k, v]) => [k, v.size])),
        returning: this.returners.size,
        emote_messages: this.emotes,
      });
      this.start += 5;
      while (
        this.head < this.active.length &&
        this.active[this.head].t < this.start
      )
        this.update(this.active[this.head++], -1);
      if (this.head > 2048) {
        this.active = this.active.slice(this.head);
        this.head = 0;
      }
    }
  }
  push(message) {
    const t = message.playerMessageTime / 1000;
    if (!Number.isFinite(t) || t < this.previous)
      throw Error("정렬되지 않은 채팅 응답입니다.");
    this.previous = t;
    if (
      message.messageTypeCode !== 1 ||
      message.messageStatusType !== "NORMAL" ||
      t < 0 ||
      t >= this.duration
    )
      return;
    this.flushThrough(t);
    const user = message.userIdHash || null,
      last = this.seen.get(user);
    const entry = {
      t,
      user,
      ...this.parse(message.content || ""),
      returning: !!user && last !== undefined && t - last >= 300,
    };
    if (user) this.seen.set(user, t);
    this.analyzed++;
    this.active.push(entry);
    this.update(entry, 1);
    return true;
  }
  finish() {
    this.flushThrough(this.duration);
    this.seen.clear();
    this.active = [];
    this.terms.clear();
    return this.frames;
  }
}

export function wilson(k, n) {
  if (!n) return [0, 1];
  const z = 1.959963984540054,
    z2 = z * z,
    p = k / n,
    den = 1 + z2 / n,
    center = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}
const increase = (k, n, b, m) => Math.max(0, wilson(k, n)[0] - wilson(b, m)[1]);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b),
    n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
function excess(value, history) {
  const c = median(history);
  return Math.max(
    0,
    (value - c) /
      Math.max(
        1.4826 * median(history.map((v) => Math.abs(v - c))),
        Math.sqrt(c),
        5,
      ),
  );
}
export function percentiles(values, eligible) {
  const out = values.map(() => 0),
    sample = values
      .map((v, i) => [v, i])
      .filter((_, i) => eligible[i])
      .sort((a, b) => a[0] - b[0]);
  if (
    !sample.length ||
    (sample.length > 1 && sample[0][0] === sample.at(-1)[0])
  )
    return out;
  for (let lo = 0; lo < sample.length; ) {
    let hi = lo + 1;
    while (hi < sample.length && sample[hi][0] === sample[lo][0]) hi++;
    if (sample[lo][0] > 0)
      for (let j = lo; j < hi; j++)
        out[sample[j][1]] = (lo + hi) / (2 * sample.length);
    lo = hi;
  }
  return out;
}
export function scoreWindows(frames, input = DEFAULTS) {
  const config = settings(input),
    signals = Object.values(FAMILIES).flat(),
    n = frames.length;
  const raw = Object.fromEntries(signals.map((k) => [k, Array(n).fill(0)])),
    eligible = Array(n).fill(false);
  const history = (i) => {
    const out = [];
    for (let j = i - 6; j >= 0 && j > i - 66; j -= 6) out.push(j);
    return out;
  };
  const sum = (indices, fn) => indices.reduce((s, j) => s + fn(frames[j]), 0);
  for (let i = 0; i < n; i++) {
    const frame = frames[i],
      previous = history(i);
    if (!previous.length) continue;
    eligible[i] = true;
    if (frame.authors < 5) continue;
    const baselineAuthors = sum(previous, (f) => f.authors);
    raw.volume_slope[i] =
      Math.max(0, frame.messages - frames[i - 6].messages) / 30;
    raw.local_volume[i] = excess(
      frame.messages,
      previous.map((j) => frames[j].messages),
    );
    raw.unique_user_burst[i] = excess(
      frame.authors,
      previous.map((j) => frames[j].authors),
    );
    for (const name of REACTIONS)
      raw[name + "_shift"][i] = increase(
        frame.reactions[name],
        frame.authors,
        sum(previous, (f) => f.reactions[name]),
        baselineAuthors,
      );
    raw.returning_participant_shift[i] = increase(
      frame.returning,
      frame.authors,
      sum(previous, (f) => f.returning),
      baselineAuthors,
    );
    for (const [term, count] of Object.entries(frame.terms))
      if (count >= 5)
        raw.expression_consensus[i] = Math.max(
          raw.expression_consensus[i],
          increase(
            count,
            frame.authors,
            sum(previous, (f) =>
              Object.hasOwn(f.terms, term) ? f.terms[term] : 0,
            ),
            baselineAuthors,
          ),
        );
    if (i >= 18) {
      const baseline = median(history(i - 12).map((j) => frames[j].messages)),
        segment = [
          frames[i - 12].messages,
          frames[i - 6].messages,
          frame.messages,
        ];
      if (segment.filter((c) => c > baseline).length >= 2)
        raw.sustained_excess[i] = segment.reduce(
          (s, c) => s + Math.max(0, c - baseline),
          0,
        );
    }
  }
  const normalized = Object.fromEntries(
      signals.map((k) => [k, percentiles(raw[k], eligible)]),
    ),
    families = {},
    representatives = {};
  for (const [name, members] of Object.entries(FAMILIES)) {
    const active = members.filter((k) => normalized[k].some((v) => v > 0));
    representatives[name] = frames.map((_, i) =>
      members.reduce(
        (best, k) => (normalized[k][i] > normalized[best][i] ? k : best),
        members[0],
      ),
    );
    families[name] = percentiles(
      frames.map((_, i) =>
        active.length
          ? active.reduce((s, k) => s + normalized[k][i], 0) / active.length
          : 0,
      ),
      eligible,
    );
  }
  const { combined, weights, enabled, count } = weightFamilies(families, config);
  return {
    raw,
    normalized,
    families,
    representatives,
    combined,
    eligible,
    weights,
    enabled,
    count,
  };
}
export function rankingBasis(scores) {
  return { families: scores.families };
}
