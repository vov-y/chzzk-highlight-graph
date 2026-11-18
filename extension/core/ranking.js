export const VERSION = "within_video_weighted_top_k_families_v3-browser-2";
export const FAMILIES = {
  activity: [
    "volume_slope",
    "local_volume",
    "unique_user_burst",
    "sustained_excess",
  ],
  reaction: [
    "laughter_shift",
    "surprise_question_shift",
    "emote_shift",
    "strong_reaction_shift",
  ],
  returning_participants: ["returning_participant_shift"],
  expression_consensus: ["expression_consensus"],
};
export const REACTIONS = [
  "laughter",
  "surprise_question",
  "emote",
  "strong_reaction",
];
export const DEFAULTS = {
  top_families: 3,
  family_weights: {
    ...Object.fromEntries(Object.keys(FAMILIES).map((k) => [k, 1])),
    activity: 1.5,
  },
  strong_reaction: [],
  peak_percent: 5,
  recommend_mode: "count",
  recommend_count: 20,
  recommend_percent: 5,
};
export function settings(input = {}) {
  const family_weights = {
    ...DEFAULTS.family_weights,
    ...input.family_weights,
  };
  if (
    Object.keys(family_weights).some((k) => !Object.hasOwn(FAMILIES, k)) ||
    Object.values(family_weights).some(
      (v) => typeof v !== "number" || !Number.isFinite(v) || v < 0,
    ) ||
    !Object.values(family_weights).some((v) => v > 0)
  )
    throw Error("가중치는 0 이상이어야 합니다. 지표 하나에는 0보다 큰 값을 입력하세요.");
  const top_families = input.top_families ?? 3;
  if (!Number.isInteger(top_families) || top_families < 1 || top_families > 4)
    throw Error("반영할 지표 수를 1~4로 입력하세요.");
  const forms = input.strong_reaction ?? [];
  if (
    !Array.isArray(forms) ||
    forms.some((x) => typeof x !== "string" || !x.trim()) ||
    forms.length > 1000 ||
    forms.some((x) => x.length > 200)
  )
    throw Error("키워드는 한 줄에 하나씩, 최대 1,000개까지 입력할 수 있습니다. 한 줄은 200자까지입니다.");
  const peak_percent = input.peak_percent ?? DEFAULTS.peak_percent;
  const recommend_mode = input.recommend_mode ?? DEFAULTS.recommend_mode;
  const recommend_count = input.recommend_count ?? DEFAULTS.recommend_count;
  const recommend_percent = input.recommend_percent ?? DEFAULTS.recommend_percent;
  if (!Number.isFinite(peak_percent) || peak_percent < 0 || peak_percent > 100)
    throw Error("봉우리 강조는 0~100%로 입력하세요.");
  if (!["count", "percent"].includes(recommend_mode) ||
      !Number.isSafeInteger(recommend_count) || recommend_count < 0 ||
      !Number.isFinite(recommend_percent) || recommend_percent < 0 || recommend_percent > 100)
    throw Error("추천 개수는 0 이상의 정수로, 비율은 0~100%로 입력하세요.");
  return { top_families, family_weights, strong_reaction: [...new Set(forms)],
    peak_percent, recommend_mode, recommend_count, recommend_percent };
}
export function cacheKey(id, config) {
  return `${id}:${VERSION}:${JSON.stringify(settings(config).strong_reaction)}`;
}

export const LABELS = {
  activity: "채팅 활동", reaction: "반응 변화",
  returning_participants: "다시 채팅한 시청자", expression_consensus: "반복 표현",
};

function sumTop(values, count) {
  values.sort((a, b) => b - a);
  let total = 0;
  for (let i = 0; i < count; i++) total += values[i];
  return total;
}

export function weightFamilies(families, config) {
  const names = Object.keys(FAMILIES);
  const scale = Math.max(...Object.values(config.family_weights)),
    weights = Object.fromEntries(
      names.map((k) => [k, config.family_weights[k] / scale]),
    );
  const enabled = names.filter((k) => weights[k] > 0);
  const count = Math.min(config.top_families, enabled.length);
  const values = enabled.map(k => weights[k]);
  const denominator = sumTop(values, count);
  const combined = families.activity.map((_, i) => {
    for (let j = 0; j < enabled.length; j++) {
      const name = enabled[j];
      values[j] = families[name][i] * weights[name];
    }
    return sumTop(values, count) / denominator;
  });
  return { combined, weights, enabled, count };
}

export function frameTime(index, { step, window }) {
  return index * step + window / 2;
}

export function rankCandidates(basis, weighted, timing) {
  const { combined, enabled, weights, count } = weighted;
  const { families } = basis;
  const peaks = [], spans = [];
  for (let start = 0; start < combined.length; ) {
    let end = start;
    const score = combined[start];
    while (end + 1 < combined.length && combined[end + 1] === score) end++;
    if (score > (combined[start - 1] ?? 0) && score > (combined[end + 1] ?? 0)) {
      peaks.push(Math.floor((start + end) / 2));
      spans.push({ start, end });
    }
    start = end + 1;
  }
  const ordered = peaks.map((_, i) => i);
  ordered.sort((a, b) => combined[peaks[b]] - combined[peaks[a]] || a - b);
  const ranked = [], occupied = new Map(), spacing = 120;
  const familyNames = Object.keys(FAMILIES);
  for (const peak of ordered) {
    const point = peaks[peak], start = point * timing.step, bucket = Math.floor(start / spacing);
    if ([bucket - 1, bucket, bucket + 1].some(b => Math.abs(start - occupied.get(b)) < spacing)) continue;
    const chosen = [...enabled]
      .sort((a, b) => weights[b] * families[b][point] - weights[a] * families[a][point])
      .slice(0, count);
    ranked.push({
      peak,
      seconds: frameTime(point, timing),
      score: combined[point],
      selected_families: chosen,
      families: Object.fromEntries(familyNames.map(k => [k, families[k][point]])),
    });
    occupied.set(bucket, start);
  }
  const peakSpans = ordered.map(index => spans[index]);
  return { peaks, peakSpans, ranked, combined, step: timing.step, window: timing.window };
}

// Search only the slopes next to shortlisted summits. Cache each visited valley
// so that two nearby recommendations share the same measured boundary.
export function recommendedCandidates(pool, config, duration) {
  const { peaks, ranked, combined } = pool;
  const limit = config.recommend_mode === "percent"
    ? Math.ceil(ranked.length * config.recommend_percent / 100) : config.recommend_count;
  const valleys = new Map(), selected = [], assigned = new Set();
  function valley(split) {
    if (valleys.has(split)) return valleys.get(split);
    const from = peaks[split - 1] ?? 0, to = peaks[split] ?? combined.length - 1;
    let first = from, last = from;
    for (let i = from + 1; i <= to; i++) {
      if (combined[i] < combined[first]) first = last = i;
      else if (combined[i] === combined[first]) last = i;
    }
    const edge = (split === 0 && combined[first] === combined[to]) ||
      (split === peaks.length && combined[first] === combined[from]);
    const base = { first, last, score: edge ? 0 : combined[first], edge };
    valleys.set(split, base);
    return base;
  }
  function shallow(saddle, firstBase, secondBase, leftHeight, rightHeight) {
    const floor = Math.max(firstBase.score, secondBase.score);
    const summit = Math.min(leftHeight, rightHeight);
    return saddle.score > floor && saddle.score >= floor + (summit - floor) / 2;
  }
  const lead = 5;
  for (const { peak, ...candidate } of ranked) {
    if (selected.length >= limit) break;
    if (assigned.has(peak)) continue;
    let left = peak, right = peak, height = candidate.score;
    while (!assigned.has(left) && !assigned.has(right)) {
      if (left > 0 && shallow(valley(left), valley(left - 1), valley(right + 1), combined[peaks[left - 1]], height)) {
        height = Math.max(height, combined[peaks[--left]]);
      } else if (right + 1 < peaks.length &&
          shallow(valley(right + 1), valley(left), valley(right + 2), height, combined[peaks[right + 1]])) {
        height = Math.max(height, combined[peaks[++right]]);
      } else break;
    }
    if (assigned.has(left) || assigned.has(right)) continue;
    for (let i = left; i <= right; i++) assigned.add(i);
    const leftBase = valley(left), rightBase = valley(right + 1);
    const start = leftBase.edge ? 0 : frameTime(leftBase.last, pool);
    const end = rightBase.edge ? duration : frameTime(rightBase.first, pool);
    const shiftedStart = Math.max(0, start - lead), shiftedEnd = end - lead;
    selected.push({
      ...candidate,
      rank: selected.length + 1,
      review_start_seconds: shiftedStart,
      review_end_seconds: shiftedEnd > shiftedStart ? shiftedEnd : end,
    });
  }
  return selected;
}
