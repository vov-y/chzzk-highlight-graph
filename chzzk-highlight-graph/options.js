import { DEFAULTS } from "./core/ranking.js";
import {
  mountSettings, savedDefaults, defaultHighlightShortcut, highlightShortcutChoices, savedHighlightShortcut,
  playerPreferencesKey, defaultPlayerPreferences, savedPlayerPreferences, defaultSettingsKeys,
} from "./settings-form.js";

const form = document.querySelector("form"), status = document.querySelector("#status");
const shortcut = document.querySelector("#highlight-shortcut");
const switches = [...form.querySelectorAll(".player-settings input[type=checkbox]")];
for (const key of highlightShortcutChoices) shortcut.add(new Option(key.toUpperCase(), key));
const fields = mountSettings(document.querySelector("#model-fields"));
const saved = await chrome.storage.local.get(defaultSettingsKeys);
let config = savedDefaults(saved);
shortcut.value = savedHighlightShortcut(saved.highlightShortcut);
const preferences = savedPlayerPreferences(saved[playerPreferencesKey]);
for (const field of switches) field.checked = preferences[field.name];
fields.fill(config);
form.onsubmit = async event => {
  event.preventDefault();
  try {
    config = fields.read(config);
    await chrome.storage.local.set({
      settings: config,
      highlightShortcut: shortcut.value,
      [playerPreferencesKey]: Object.fromEntries(switches.map(field => [field.name, field.checked])),
    });
    status.textContent = "저장했습니다.";
  } catch (error) { status.textContent = error.message; }
};
document.querySelector("#reset").onclick = () => {
  config = DEFAULTS;
  shortcut.value = defaultHighlightShortcut;
  for (const field of switches) field.checked = defaultPlayerPreferences[field.name];
  fields.fill(config);
  status.textContent = "저장하면 초기값이 적용됩니다.";
};
document.querySelector("#clear").onclick = async () => {
  try {
    const reply = await chrome.runtime.sendMessage({ type: "clear-cache" });
    if (!reply?.ok) throw Error(reply?.error || "분석 캐시를 삭제하지 못했습니다.");
    status.textContent = "분석 캐시를 삭제했습니다.";
  } catch (error) { status.textContent = error.message; }
};
