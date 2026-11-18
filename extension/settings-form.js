import { DEFAULTS, LABELS, settings } from "./core/ranking.js";

export const videoSettingsKey = id => "videoSettings:" + id;
export const defaultHighlightShortcut = "h";
export const playerPreferencesKey = "playerPreferences";
export const defaultSettingsKeys = ["settings", "peakPercent", "highlightShortcut", playerPreferencesKey];
export const defaultPlayerPreferences = Object.freeze({
  overviewGraph: true,
  expandOnHover: true,
  autoAnalyze: true,
});
export function savedPlayerPreferences(value) {
  return Object.fromEntries(Object.entries(defaultPlayerPreferences).map(([key, fallback]) =>
    [key, typeof value?.[key] === "boolean" ? value[key] : fallback]));
}
// The player's own single-letter shortcuts for captions, fullscreen, playback, mute and theater.
export const highlightShortcutChoices = [..."abcdefghijklmnopqrstuvwxyz"].filter(key => !"cfkmt".includes(key));
export function savedHighlightShortcut(value) {
  return highlightShortcutChoices.includes(value) ? value : defaultHighlightShortcut;
}
export function savedDefaults(values) {
  return settings({ peak_percent: values.peakPercent ?? DEFAULTS.peak_percent, ...values.settings });
}

const familyTitles = {
  activity: "채팅량과 채팅에 참여한 시청자 수가 늘어난 구간을 반영합니다.",
  reaction: "웃음, 놀람, 이모티콘, 등록한 반응 키워드의 사용이 늘어난 구간을 반영합니다.",
  returning_participants: "한동안 채팅하지 않던 시청자가 다시 채팅한 비율이 늘어난 구간을 반영합니다.",
  expression_consensus: "여러 시청자가 같은 단어나 이모티콘을 더 자주 사용한 구간을 반영합니다.",
};

export function mountSettings(container) {
  container.innerHTML = `
    <fieldset class="signal-weights"><legend title="0으로 설정한 지표는 점수에서 제외됩니다.">지표별 가중치</legend>
      ${Object.entries(LABELS).map(([key, label]) =>
        `<label title="${familyTitles[key]}">${label}<input name="${key}" type="number" min="0" step="any" required aria-description="0이면 제외"></label>`).join("")}
    </fieldset>
    <label title="점수가 높은 지표부터 반영합니다.">반영할 지표 수<input name="top_families" type="number" min="1" max="4" required></label>
    <label title="전체 봉우리 중 점수가 높은 순으로 강조할 비율입니다. 0%면 강조하지 않습니다.">봉우리 강조 (%)<input id="peak-percent" name="peak_percent" type="number" min="0" max="100" step="any" required></label>
    <fieldset class="recommendation"><legend title="점수가 높은 구간부터 추천 목록에 표시합니다.">추천 구간</legend>
      <div class="recommendation-fields">
        <select name="recommend_mode" aria-label="추천 기준" title="추천 목록의 크기를 개수 또는 전체 후보 대비 비율로 정합니다."><option value="count">개수</option><option value="percent">비율</option></select>
        <label title="추천 구간을 최대 몇 개까지 표시할지 정합니다. 0이면 표시하지 않습니다."><input name="recommend_count" type="number" min="0" step="1" required aria-label="추천 개수"><span aria-hidden="true">개</span></label>
        <label title="전체 추천 후보 중 표시할 비율입니다. 0%면 표시하지 않습니다."><input name="recommend_percent" type="number" min="0" max="100" step="any" required aria-label="추천 비율 (%)"><span aria-hidden="true">%</span></label>
      </div>
    </fieldset>
    <label class="expressions" title="채팅에서 추가로 감지할 반응 표현을 한 줄에 하나씩 입력합니다.">반응 키워드<textarea id="strong" name="strong_reaction" rows="3" spellcheck="false" placeholder="한 줄에 하나씩" aria-description="한 줄에 하나씩 입력하세요."></textarea></label>`;
  const fields = Object.fromEntries([...container.querySelectorAll("[name]")].map(el => [el.name, el]));
  function showMode() {
    const count = fields.recommend_mode.value === "count";
    fields.recommend_count.closest("label").hidden = !count;
    fields.recommend_percent.closest("label").hidden = count;
    fields.recommend_count.disabled = !count;
    fields.recommend_percent.disabled = count;
  }
  function fill(config) {
    for (const key of Object.keys(LABELS)) fields[key].value = config.family_weights[key];
    for (const key of ["top_families", "peak_percent", "recommend_count", "recommend_percent", "recommend_mode"])
      fields[key].value = config[key];
    fields.strong_reaction.value = config.strong_reaction.join("\n");
    showMode();
  }
  function read(previous) {
    showMode();
    return settings({
      family_weights: Object.fromEntries(Object.keys(LABELS).map(k => [k, fields[k].valueAsNumber])),
      top_families: fields.top_families.valueAsNumber, peak_percent: fields.peak_percent.valueAsNumber,
      recommend_mode: fields.recommend_mode.value,
      recommend_count: fields.recommend_count.disabled ? previous.recommend_count : fields.recommend_count.valueAsNumber,
      recommend_percent: fields.recommend_percent.disabled ? previous.recommend_percent : fields.recommend_percent.valueAsNumber,
      strong_reaction: fields.strong_reaction.value.split("\n").map(x => x.trim()).filter(Boolean),
    });
  }
  container.addEventListener("input", showMode);
  return { fill, read };
}
