const KEY = "jpDojoExtSettings_v1";
const WATCHED_KEY = "jpDojoWatchedArtists_v1";
const CHART_KEY = "jpDojoChartArtists_v1";

const themeSelect = document.getElementById("theme-select");
const langSelect = document.getElementById("ui-lang");
const genreAllChk = document.getElementById("genre-all");
const genreChks = [...document.querySelectorAll(".genre-chk")];
const particlesChk = document.getElementById("particles-known");
const customDetails = document.getElementById("custom-theme-advanced");

const TABS = [
  { key: "general", btn: document.getElementById("tab-general-btn"), panel: document.getElementById("tab-general-panel") },
  { key: "theme", btn: document.getElementById("tab-theme-btn"), panel: document.getElementById("tab-theme-panel") },
  { key: "artists", btn: document.getElementById("tab-artists-btn"), panel: document.getElementById("tab-artists-panel") },
  { key: "credits", btn: document.getElementById("tab-credits-btn"), panel: document.getElementById("tab-credits-panel") },
];

const CUSTOM_FIELDS = [
  "bg", "surface", "elevated", "text", "muted", "accent", "accentContrast", "accent2",
  "border", "overlayBg", "overlayText", "leechBorder", "hardBorder", "youngBorder", "matureBorder",
  "borderStyle", "overlayOpacity", "radius", "rowRadius", "btnRadius", "font", "extraCss",
];

const statusTimers = new Map();
function flashStatus(elId, text, autoClearMs = 3500) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = text;
  if (statusTimers.has(elId)) clearTimeout(statusTimers.get(elId));
  if (autoClearMs > 0 && text) {
    statusTimers.set(
      elId,
      setTimeout(() => {
        el.textContent = "";
      }, autoClearMs)
    );
  }
}

function switchTab(activeKey) {
  TABS.forEach(({ key, btn, panel }) => {
    const active = key === activeKey;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", String(active));
    btn.setAttribute("tabindex", active ? "0" : "-1");
    panel.hidden = !active;
  });
}

TABS.forEach(({ key, btn }, idx) => {
  btn.addEventListener("click", () => switchTab(key));
  btn.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const nextIdx = (idx + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    switchTab(TABS[nextIdx].key);
    TABS[nextIdx].btn.focus();
  });
});

function applyOptionsLang(lang) {
  const t = (k, vars) => window.rikaiT(lang, k, vars);
  document.documentElement.lang = lang || "en";
  document.title = t("settingsTitle");
  document.getElementById("opt-heading").textContent = `⚙ ${t("settingsTitle")}`;
  document.getElementById("tab-general-btn").textContent = t("tabGeneral");
  document.getElementById("tab-theme-btn").textContent = t("tabTheme");
  document.getElementById("tab-artists-btn").textContent = t("tabArtists");
  const tabCreditsBtn = document.getElementById("tab-credits-btn");
  if (tabCreditsBtn) tabCreditsBtn.textContent = t("tabCredits");
  document.getElementById("lbl-ui-lang").textContent = t("langLabel");
  document.querySelector('label[for="anki-url"]').textContent = t("ankiUrlLabel");
  document.querySelector('label[for="leech-query"]').textContent = t("leechQueryLabel");
  document.querySelector('label[for="jlpt-level"]').textContent = t("jlptLabel");
  document.querySelector('label[for="theme-select"]').textContent = t("themeLabel");
  document.querySelector('label[for="video-blur-mode"]').textContent = t("blurLabel");
  document.querySelector("#settings-form fieldset legend").textContent = t("genresLegend");
  document.getElementById("lbl-genre-all").textContent = t("genreAll");
  document.getElementById("lbl-particles-known").textContent = t("particlesKnownLabel");
  document.getElementById("lbl-anki-ui-immersion").textContent = t("ankiUiImmersionLabel");
  document.querySelector('#settings-form button[type="submit"]').textContent = t("saveBtn");
  document.querySelector('label[for="custom-artists-input"]').textContent = t("customArtistsLabel");
  document.getElementById("custom-artists-input").placeholder = t("customArtistsPlaceholder");
  document.getElementById("save-artists-btn").textContent = t("saveArtistsBtn");
  document.getElementById("refresh-charts-btn").textContent = t("refreshChartsBtn");
  document.getElementById("lbl-watched-artists").textContent = t("watchedLabel");
  document.getElementById("lbl-chart-artists").textContent = t("chartsLabel");

  // Theme tab & custom builder labels
  const labelMap = [
    ["lbl-theme-preview", "themePreviewTitle"],
    ["lbl-custom-advanced", "advancedCustomTitle"],
    ["clone-theme-btn", "cloneThemeBtn"],
    ["reset-theme-btn", "resetThemeBtn"],
    ["lbl-custom-colors", "customColorsLegend"],
    ["lbl-custom-geo", "customGeoLegend"],
    ["lbl-ct-bg", "ctBg"],
    ["lbl-ct-surface", "ctSurface"],
    ["lbl-ct-elevated", "ctElevated"],
    ["lbl-ct-text", "ctText"],
    ["lbl-ct-muted", "ctMuted"],
    ["lbl-ct-accent", "ctAccent"],
    ["lbl-ct-accentContrast", "ctAccentContrast"],
    ["lbl-ct-accent2", "ctAccent2"],
    ["lbl-ct-border", "ctBorder"],
    ["lbl-ct-overlayBg", "ctOverlayBg"],
    ["lbl-ct-overlayText", "ctOverlayText"],
    ["lbl-ct-overlayOpacity", "ctOverlayOp"],
    ["lbl-ct-leechBorder", "ctLeech"],
    ["lbl-ct-hardBorder", "ctHard"],
    ["lbl-ct-youngBorder", "ctYoung"],
    ["lbl-ct-matureBorder", "ctMature"],
    ["lbl-ct-borderStyle", "ctBorderStyle"],
    ["lbl-ct-radius", "ctRadius"],
    ["lbl-ct-rowRadius", "ctRowRadius"],
    ["lbl-ct-btnRadius", "ctBtnRadius"],
    ["lbl-ct-font", "ctFont"],
    ["lbl-ct-extraCss", "customCssLabel"],
    ["save-theme-btn", "saveThemeBtn"],
    ["lbl-credits-title", "creditsTitle"],
    ["lbl-credits-intro", "creditsIntro"],
    ["credit-anki-desc", "creditAnkiDesc"],
    ["credit-lrc-desc", "creditLrcDesc"],
    ["credit-fallback-desc", "creditFallbackDesc"],
    ["credit-youtube-desc", "creditYoutubeDesc"],
    ["credit-charts-desc", "creditChartsDesc"],
    ["credit-intl-desc", "creditIntlDesc"],
    ["credit-themes-desc", "creditThemesDesc"],
  ];
  labelMap.forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = t(key);
  });

  const optionMap = [
    ['#jlpt-level option[value="none"]', "jlptNone"],
    ['#jlpt-level option[value="N4"]', "jlptN4Inc"],
    ['#jlpt-level option[value="N3"]', "jlptN3Inc"],
    ['#jlpt-level option[value="N2"]', "jlptN2Inc"],
    ['#jlpt-level option[value="N1"]', "jlptN1Inc"],
    ['#theme-select option[value="youtube"]', "themeYoutube"],
    ['#theme-select option[value="rikai-red"]', "themeRikaiRed"],
    ['#theme-select option[value="vocaloid"]', "themeVocaloid"],
    ['#theme-select option[value="sakura"]', "themeSakura"],
    ['#theme-select option[value="eva"]', "themeEva"],
    ['#theme-select option[value="catppuccin"]', "themeCatppuccin"],
    ['#theme-select option[value="catppuccin-latte"]', "themeCatppuccinLatte"],
    ['#theme-select option[value="dracula"]', "themeDracula"],
    ['#theme-select option[value="nord"]', "themeNord"],
    ['#theme-select option[value="gruvbox"]', "themeGruvbox"],
    ['#theme-select option[value="tokyonight"]', "themeTokyoNight"],
    ['#theme-select option[value="rose-pine"]', "themeRosePine"],
    ['#theme-select option[value="sumi"]', "themeSumi"],
    ['#theme-select option[value="custom"]', "themeCustom"],
    ['#video-blur-mode option[value="box"]', "blurBox"],
    ['#video-blur-mode option[value="bottom"]', "blurBottom"],
    ['#video-blur-mode option[value="top"]', "blurTop"],
  ];
  optionMap.forEach(([sel, key]) => {
    const el = document.querySelector(sel);
    if (el) el.textContent = t(key);
  });

  const infoBox = document.querySelector(".info-box");
  if (infoBox) {
    infoBox.innerHTML = `<strong style="color:var(--rk-text);display:block;margin-bottom:0.35rem;">${t("artistsHowTitle")}</strong>${t("artistsHow1")}<br>${t("artistsHow2")}<br>${t("artistsHow3")}`;
  }
}

function renderArtistTags(containerId, countId, list) {
  const container = document.getElementById(containerId);
  const countEl = document.getElementById(countId);
  const items = Array.isArray(list) ? list : [];
  countEl.textContent = String(items.length);
  container.innerHTML = "";
  items.slice(0, 30).forEach((name) => {
    const span = document.createElement("span");
    span.className = "tag-pill";
    span.textContent = name;
    container.appendChild(span);
  });
}

function readCustomThemeInputs() {
  const defaults = window.RIKAI_CUSTOM_THEME_DEFAULTS || {};
  const obj = {};
  CUSTOM_FIELDS.forEach((field) => {
    const el = document.getElementById(`ct-${field}`);
    if (!el) return;
    if (el.type === "number") {
      const n = Number(el.value);
      obj[field] = Number.isFinite(n) && el.value !== "" ? n : defaults[field];
    } else {
      obj[field] = el.value || defaults[field] || "";
    }
  });
  return obj;
}

function writeCustomThemeInputs(customTheme) {
  const defaults = window.RIKAI_CUSTOM_THEME_DEFAULTS || {};
  const raw = customTheme && typeof customTheme === "object" ? customTheme : {};
  // Guard against corrupted all-black customTheme saved from uninitialized color inputs
  const isCorruptBlack = raw.bg === "#000000" && raw.surface === "#000000" && raw.text === "#000000";
  const data = isCorruptBlack ? { ...defaults } : { ...defaults, ...raw };
  CUSTOM_FIELDS.forEach((field) => {
    const el = document.getElementById(`ct-${field}`);
    if (!el) return;
    const val = data[field] !== undefined && data[field] !== "" ? data[field] : defaults[field];
    if (el.type === "color" && !/^#[0-9a-fA-F]{6}$/.test(String(val || ""))) {
      el.value = String(defaults[field] || "#12121a");
    } else if (val !== undefined) {
      el.value = String(val);
    }
  });
}

function applyOptionsTheme(theme, customTheme) {
  if (window.rikaiApplyTheme) {
    window.rikaiApplyTheme(document.documentElement, theme || "youtube", customTheme);
  } else {
    document.documentElement.setAttribute("data-theme", theme || "youtube");
  }
}

function colorToHex(cssColor, fallback) {
  if (!cssColor) return fallback;
  if (/^#[0-9a-fA-F]{6}$/.test(cssColor.trim())) return cssColor.trim();
  const m = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return fallback;
  return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
}

function cloneComputedPresetToInputs() {
  const prevTheme = themeSelect.value === "custom" ? "youtube" : themeSelect.value;
  applyOptionsTheme(prevTheme);
  const cs = getComputedStyle(document.documentElement);
  const d = window.RIKAI_CUSTOM_THEME_DEFAULTS;
  const g = (v, fb) => colorToHex(cs.getPropertyValue(v), fb);
  const px = (v, fb) => {
    const n = parseInt(cs.getPropertyValue(v), 10);
    return Number.isFinite(n) ? n : fb;
  };
  writeCustomThemeInputs({
    bg: g("--rk-bg", d.bg),
    surface: g("--rk-surface", d.surface),
    elevated: g("--rk-elevated", d.elevated),
    text: g("--rk-text", d.text),
    muted: g("--rk-muted", d.muted),
    accent: g("--rk-accent", d.accent),
    accentContrast: g("--rk-accent-contrast", d.accentContrast),
    accent2: g("--rk-accent2", d.accent2),
    border: g("--rk-border", d.border),
    borderStyle: cs.getPropertyValue("--rk-border-style").trim() || d.borderStyle,
    radius: px("--rk-radius", d.radius),
    rowRadius: px("--rk-row-radius", d.rowRadius),
    btnRadius: px("--rk-btn-radius", d.btnRadius),
    overlayBg: g("--rk-overlay-bg", d.overlayBg),
    overlayText: g("--rk-overlay-text", d.overlayText),
    overlayOpacity: d.overlayOpacity,
    leechBorder: g("--rk-leech-border", d.leechBorder),
    hardBorder: g("--rk-hard-border", d.hardBorder),
    youngBorder: g("--rk-young-border", d.youngBorder),
    matureBorder: g("--rk-mature-border", d.matureBorder),
    extraCss: "",
  });
  themeSelect.value = "custom";
  customDetails.open = true;
  applyOptionsTheme("custom", readCustomThemeInputs());
}

function syncAllCheckbox() {
  genreAllChk.checked = genreChks.every((c) => c.checked);
}

genreAllChk.addEventListener("change", () => {
  genreChks.forEach((c) => (c.checked = genreAllChk.checked));
});

genreChks.forEach((c) => c.addEventListener("change", syncAllCheckbox));

chrome.storage.local.get([KEY, WATCHED_KEY, CHART_KEY], (res) => {
  const cfg = res[KEY] || {};
  if (cfg.ankiUrl) document.getElementById("anki-url").value = cfg.ankiUrl;
  if (cfg.leechQuery) document.getElementById("leech-query").value = cfg.leechQuery;
  if (cfg.jlptLevel) document.getElementById("jlpt-level").value = cfg.jlptLevel;
  if (Array.isArray(cfg.genres) && cfg.genres.length) {
    genreChks.forEach((c) => (c.checked = cfg.genres.includes(c.value)));
    syncAllCheckbox();
  }
  particlesChk.checked = cfg.particlesKnown !== false;
  document.getElementById("video-blur-mode").value = cfg.videoBlurMode || "box";
  if (Array.isArray(cfg.customArtists)) {
    document.getElementById("custom-artists-input").value = cfg.customArtists.join("\n");
  }
  renderArtistTags("watched-artists-list", "watched-count", res[WATCHED_KEY] || []);
  renderArtistTags("chart-artists-list", "chart-count", res[CHART_KEY]?.artists || []);

  writeCustomThemeInputs(cfg.customTheme);
  const theme = cfg.theme || "rikai-red";
  themeSelect.value = theme;
  if (theme === "custom") customDetails.open = true;
  applyOptionsTheme(theme, cfg.customTheme);

  const lang = cfg.lang || "en";
  langSelect.value = lang;
  applyOptionsLang(lang);

  const uiImmersionChk = document.getElementById("anki-ui-immersion");
  uiImmersionChk.checked = Boolean(cfg.ankiUiImmersion);
  if (uiImmersionChk.checked && window.RikaiUIImmersion) {
    chrome.runtime.sendMessage({ type: "GET_ANKI_WORDS", force: false }, (ankiRes) => {
      if (ankiRes?.matureWords) window.RikaiUIImmersion.applyToDOM(document.body, ankiRes.matureWords, true);
    });
  }
});

langSelect.addEventListener("change", () => {
  applyOptionsLang(langSelect.value);
});

themeSelect.addEventListener("change", () => {
  if (themeSelect.value === "custom") customDetails.open = true;
  applyOptionsTheme(themeSelect.value, readCustomThemeInputs());
});

CUSTOM_FIELDS.forEach((field) => {
  const el = document.getElementById(`ct-${field}`);
  if (!el) return;
  el.addEventListener("input", () => {
    themeSelect.value = "custom";
    applyOptionsTheme("custom", readCustomThemeInputs());
  });
});

document.getElementById("clone-theme-btn").addEventListener("click", cloneComputedPresetToInputs);

document.getElementById("reset-theme-btn").addEventListener("click", () => {
  writeCustomThemeInputs(window.RIKAI_CUSTOM_THEME_DEFAULTS);
  themeSelect.value = "custom";
  applyOptionsTheme("custom", readCustomThemeInputs());
});

document.getElementById("save-theme-btn").addEventListener("click", () => {
  const customTheme = readCustomThemeInputs();
  chrome.storage.local.get(KEY, (prev) => {
    const prevCfg = prev[KEY] || {};
    chrome.storage.local.set(
      {
        [KEY]: {
          ...prevCfg,
          theme: themeSelect.value,
          videoBlurMode: document.getElementById("video-blur-mode").value,
          customTheme,
        },
      },
      () => {
        flashStatus("theme-saved-msg", window.rikaiT(langSelect.value, "savedMsg"));
      }
    );
  });
});

document.getElementById("settings-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const selectedGenres = genreChks.filter((c) => c.checked).map((c) => c.value);
  const immersionOn = document.getElementById("anki-ui-immersion").checked;
  chrome.storage.local.get(KEY, (prev) => {
    const prevCfg = prev[KEY] || {};
    chrome.storage.local.set(
      {
        [KEY]: {
          ...prevCfg,
          ankiUrl: document.getElementById("anki-url").value.trim(),
          leechQuery: document.getElementById("leech-query").value.trim(),
          jlptLevel: document.getElementById("jlpt-level").value,
          theme: themeSelect.value,
          customTheme: readCustomThemeInputs(),
          lang: langSelect.value,
          videoBlurMode: document.getElementById("video-blur-mode").value,
          particlesKnown: particlesChk.checked,
          ankiUiImmersion: immersionOn,
          genres: selectedGenres.length ? selectedGenres : genreChks.map((c) => c.value),
        },
      },
      () => {
        flashStatus("saved-msg", window.rikaiT(langSelect.value, "savedMsg"));
        if (window.RikaiUIImmersion) {
          if (immersionOn) {
            chrome.runtime.sendMessage({ type: "GET_ANKI_WORDS", force: false }, (ankiRes) => {
              if (ankiRes?.matureWords) window.RikaiUIImmersion.applyToDOM(document.body, ankiRes.matureWords, true);
            });
          } else {
            window.RikaiUIImmersion.applyToDOM(document.body, [], false);
          }
        }
      }
    );
  });
});

document.getElementById("save-artists-btn").addEventListener("click", () => {
  const raw = document.getElementById("custom-artists-input").value;
  const customArtists = raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  chrome.storage.local.get(KEY, (prev) => {
    const prevCfg = prev[KEY] || {};
    chrome.storage.local.set(
      { [KEY]: { ...prevCfg, customArtists } },
      () => {
        flashStatus(
          "artists-saved-msg",
          window.rikaiT(langSelect.value, "artistsSavedMsg", { n: customArtists.length })
        );
      }
    );
  });
});

function requestChartRefreshViaWorker() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("worker timeout")), 6000);
    chrome.runtime.sendMessage({ type: "REFRESH_CHART_ARTISTS" }, (list) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(Array.isArray(list) ? list : []);
    });
  });
}

document.getElementById("refresh-charts-btn").addEventListener("click", async () => {
  const btn = document.getElementById("refresh-charts-btn");
  const msg = document.getElementById("artists-saved-msg");
  const t = (k, vars) => window.rikaiT(langSelect.value, k, vars);
  btn.disabled = true;
  msg.textContent = t("fetchingChartsMsg");
  try {
    let list = [];
    if (typeof self.fetchJapanChartArtists === "function") {
      list = await self.fetchJapanChartArtists(true);
    }
    if (!list || !list.length) {
      try {
        list = await requestChartRefreshViaWorker();
      } catch {
        // already handled below
      }
    }
    renderArtistTags("chart-artists-list", "chart-count", list || []);
    if (list && list.length) {
      msg.textContent = t("chartsUpdatedMsg", { n: list.length });
    } else {
      const detail = self.fetchJapanChartArtists?.lastError;
      msg.textContent = detail ? `${t("chartsFailedMsg")} (${detail})` : t("chartsFailedMsg");
    }
  } catch (err) {
    msg.textContent = `Erro: ${err?.message || t("chartsFailedMsg")}`;
  } finally {
    btn.disabled = false;
  }
});
