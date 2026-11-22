/**
 * Content Script — Injects synchronized Japanese lyrics & Anki Leech highlights into YouTube
 */
(() => {
  let lyrics = [];
  let priorityWords = [];
  let leechWords = [];
  let hardWords = [];
  let matureWords = [];
  let youngWords = [];
  let customKnownWords = new Set();
  let currentTheme = "rikai-red";
  let currentCustomTheme = null;
  let particlesKnown = true;
  let videoBlurMode = "box";
  let uiLang = "en";
  let uiImmersion = false;

  function t(k) {
    return window.rikaiT ? window.rikaiT(uiLang, k) : k;
  }

  const PARTICLE_SET = new Set([
    "は", "が", "を", "に", "へ", "で", "と", "や", "の", "か", "も", "ね", "よ", "わ", "ぞ", "ぜ", "な", "さ",
    "から", "まで", "より", "ほど", "だけ", "しか", "ばかり", "ながら", "ので", "のに", "けど", "けれど", "けれども", "でも", "って",
  ]);

  function applyTheme(theme, custom = currentCustomTheme) {
    currentTheme = theme || "rikai-red";
    currentCustomTheme = custom || null;
    const targets = ["jp-dojo-mining-panel", "jp-dojo-video-subtitle"]
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    if (window.rikaiApplyTheme) {
      window.rikaiApplyTheme(targets, currentTheme, currentCustomTheme);
    } else {
      targets.forEach((el) => el.setAttribute("data-rikai-theme", currentTheme));
    }
    const band = document.getElementById("jp-dojo-video-blur-band");
    if (band) {
      band.setAttribute("data-blur-mode", videoBlurMode);
      band.hidden = !extEnabled || !videoSubEnabled || videoBlurMode === "box";
    }
  }

  function applyImmersionToPanel() {
    if (!window.RikaiUIImmersion) return;
    const panel = document.getElementById("jp-dojo-mining-panel");
    if (panel) {
      window.RikaiUIImmersion.applyToDOM(panel, matureWords, uiImmersion);
    }
  }

  function applySettingsObject(cfg) {
    particlesKnown = cfg.particlesKnown !== false;
    videoBlurMode = cfg.videoBlurMode || "box";
    uiLang = cfg.lang || "en";
    uiImmersion = Boolean(cfg.ankiUiImmersion);
    applyTheme(cfg.theme || "rikai-red", cfg.customTheme || null);
    applyPanelLang();
    renderLyrics();
  }

  const settingsReadyPromise = new Promise((resolve) => {
    chrome.storage.local.get("jpDojoExtSettings_v1", (res) => {
      applySettingsObject(res.jpDojoExtSettings_v1 || {});
      resolve();
    });
  });

  const jaSeg =
    typeof Intl !== "undefined" && Intl.Segmenter
      ? new Intl.Segmenter("ja", { granularity: "word" })
      : null;

  chrome.storage.local.get("jpDojoCustomKnown_v1", (res) => {
    if (Array.isArray(res.jpDojoCustomKnown_v1)) {
      customKnownWords = new Set(res.jpDojoCustomKnown_v1);
    }
  });
  const FAV_SONGS_KEY = "jpDojoFavoriteSongs_v1";
  let lastIdx = -1;
  let syncOffset = 0;
  let currentVideoId = "";
  let currentSongTitle = "";
  let currentSongArtist = "";
  let currentLyricsSource = "";
  let favoriteVideoIds = new Set();
  let loopLine = false;
  let onlyLeeches = false;
  let videoEl = null;
  let extEnabled = true;
  let videoSubEnabled = true;
  let panelCollapsed = false;

  function updateFavoriteBtn() {
    const favBtn = document.getElementById("jp-dojo-fav-btn");
    if (!favBtn) return;
    const isFav = Boolean(currentVideoId) && favoriteVideoIds.has(currentVideoId);
    const label = isFav ? t("favRemoveTitle") : t("favAddTitle");
    favBtn.textContent = isFav ? "★" : "☆";
    favBtn.classList.toggle("is-active", isFav);
    favBtn.setAttribute("aria-pressed", String(isFav));
    favBtn.setAttribute("aria-label", label);
    favBtn.title = label;
  }

  function toggleCurrentVideoFavorite() {
    if (!currentVideoId) return;
    chrome.storage.local.get(FAV_SONGS_KEY, (res) => {
      const cur = Array.isArray(res[FAV_SONGS_KEY]) ? res[FAV_SONGS_KEY] : [];
      const exists = cur.some((s) => s.videoId === currentVideoId);
      const next = exists
        ? cur.filter((s) => s.videoId !== currentVideoId)
        : [
            {
              videoId: currentVideoId,
              title: currentSongTitle || getCurrentVideoTitle(),
              artist: currentSongArtist || "",
              addedAt: Date.now(),
            },
            ...cur,
          ];
      favoriteVideoIds = new Set(next.map((s) => s.videoId).filter(Boolean));
      updateFavoriteBtn();
      chrome.storage.local.set({ [FAV_SONGS_KEY]: next });
    });
  }

  chrome.storage.local.get(FAV_SONGS_KEY, (res) => {
    const list = Array.isArray(res[FAV_SONGS_KEY]) ? res[FAV_SONGS_KEY] : [];
    favoriteVideoIds = new Set(list.map((s) => s.videoId).filter(Boolean));
    updateFavoriteBtn();
  });

  function formatOffset(sec) {
    const rounded = Math.round(Number(sec || 0) * 10) / 10;
    return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}s`;
  }

  function updateSyncDisplay() {
    const resetBtn = document.getElementById("jp-dojo-sync-reset");
    if (resetBtn) {
      resetBtn.textContent = formatOffset(syncOffset);
      resetBtn.classList.toggle("is-active", syncOffset !== 0);
    }
    const rows = document.querySelectorAll("#jp-dojo-lyrics .jp-dojo-line");
    rows.forEach((row) => {
      const idx = Number(row.dataset.idx);
      const timeBtn = row.querySelector(".jp-dojo-time-btn");
      if (timeBtn && lyrics[idx]) {
        timeBtn.textContent = formatTime(Math.max(0, lyrics[idx].time + syncOffset));
      }
    });
  }

  function setSyncOffset(nextOffset, persist = true) {
    syncOffset = Math.round(Number(nextOffset || 0) * 10) / 10;
    lastIdx = -1;
    updateSyncDisplay();
    onTimeUpdate();
    if (persist && currentVideoId) {
      const key = `lrcOffset_${currentVideoId}`;
      if (syncOffset === 0) {
        chrome.storage.local.remove(key);
      } else {
        chrome.storage.local.set({ [key]: syncOffset });
      }
    }
  }

  function applyEnabledState() {
    const panel = document.getElementById("jp-dojo-mining-panel");
    const sub = document.getElementById("jp-dojo-video-subtitle");
    const band = document.getElementById("jp-dojo-video-blur-band");
    if (panel) panel.hidden = !extEnabled;
    if (sub && (!extEnabled || !videoSubEnabled)) {
      sub.hidden = true;
    }
    if (band) {
      band.hidden = !extEnabled || !videoSubEnabled || videoBlurMode === "box";
    }
  }

  chrome.storage.local.get("jpDojoExtEnabled", (res) => {
    extEnabled = res.jpDojoExtEnabled !== false;
    applyEnabledState();
  });

  function applyPanelLang() {
    const collapseBtn = document.getElementById("jp-dojo-collapse");
    if (collapseBtn) collapseBtn.title = t("collapseTitle");
    const settingsBtn = document.getElementById("jp-dojo-settings-btn");
    if (settingsBtn) {
      settingsBtn.title = t("settingsBtnTitle");
      settingsBtn.setAttribute("aria-label", t("settingsBtnTitle"));
    }
    const subBtn = document.getElementById("jp-dojo-sub-toggle");
    if (subBtn) subBtn.textContent = videoSubEnabled ? t("subOn") : t("subOff");
    const loopBtn = document.getElementById("jp-dojo-loop");
    if (loopBtn) loopBtn.textContent = t("loopBtn");
    const filterBtn = document.getElementById("jp-dojo-filter");
    if (filterBtn) filterBtn.textContent = t("onlyLeechesBtn");
    const syncLbl = document.getElementById("jp-dojo-sync-label");
    if (syncLbl) syncLbl.textContent = t("syncLabel");
    const m2 = document.getElementById("jp-dojo-sync-m2");
    const m05 = document.getElementById("jp-dojo-sync-m05");
    const p05 = document.getElementById("jp-dojo-sync-p05");
    const p2 = document.getElementById("jp-dojo-sync-p2");
    const rst = document.getElementById("jp-dojo-sync-reset");
    const fst = document.getElementById("jp-dojo-sync-first");
    if (m2) m2.title = t("syncEarlierTip");
    if (m05) m05.title = t("syncEarlierTip");
    if (p05) p05.title = t("syncLaterTip");
    if (p2) p2.title = t("syncLaterTip");
    if (rst) rst.title = t("syncResetTip");
    if (fst) {
      fst.textContent = t("syncFirstBtn");
      fst.title = t("syncFirstTip");
    }
    updateFavoriteBtn();
    updateSourceDisplay();
    updateSyncDisplay();
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.jpDojoExtEnabled) {
      extEnabled = changes.jpDojoExtEnabled.newValue !== false;
      applyEnabledState();
    }
    if (changes.jpDojoExtSettings_v1) {
      applySettingsObject(changes.jpDojoExtSettings_v1.newValue || {});
    }
    if (changes[FAV_SONGS_KEY]) {
      const list = Array.isArray(changes[FAV_SONGS_KEY].newValue) ? changes[FAV_SONGS_KEY].newValue : [];
      favoriteVideoIds = new Set(list.map((s) => s.videoId).filter(Boolean));
      updateFavoriteBtn();
    }
  });

  function parseLrc(raw) {
    const out = [];
    String(raw || "").split(/\r?\n/).forEach((row) => {
      const m = row.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,2}))?\]\s*(.+)$/);
      if (!m) return;
      const time = Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 100 : 0);
      const jp = m[4].split("|")[0].trim();
      if (jp && /[\u3040-\u30ff\u4e00-\u9faf]/.test(jp)) out.push({ time, jp });
    });
    return out.sort((a, b) => a.time - b.time);
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  let leechSetCache = new Set();
  let hardSetCache = new Set();
  let matureSetCache = new Set();
  let youngSetCache = new Set();

  function rebuildWordSets() {
    leechSetCache = new Set(leechWords);
    hardSetCache = new Set(hardWords);
    matureSetCache = new Set(matureWords);
    youngSetCache = new Set(youngWords);
  }

  function highlightLeeches(text) {
    if (!jaSeg) {
      let safe = escapeHtml(text);
      [
        ...leechWords.filter((w) => w.length >= 2 && text.includes(w)).map((w) => ({ w, cls: "jp-dojo-hit", title: t("leechTip") })),
        ...hardWords.filter((w) => w.length >= 2 && text.includes(w)).map((w) => ({ w, cls: "jp-dojo-hit-hard", title: t("hardTip") })),
        ...youngWords.filter((w) => w.length >= 2 && text.includes(w)).map((w) => ({ w, cls: "jp-dojo-hit-young", title: t("youngTip") })),
        ...matureWords.filter((w) => w.length >= 2 && text.includes(w)).map((w) => ({ w, cls: "jp-dojo-hit-mature", title: t("matureTip") })),
      ]
        .sort((a, b) => b.w.length - a.w.length)
        .forEach(({ w, cls, title }) => {
          const esc = escapeHtml(w);
          safe = safe.replaceAll(esc, `<mark class="${cls}" title="${title}">${esc}</mark>`);
        });
      return safe;
    }

    let html = "";
    for (const seg of jaSeg.segment(text)) {
      const tok = seg.segment;
      const esc = escapeHtml(tok);
      if (!seg.isWordLike || !/[\u3040-\u30ff\u4e00-\u9faf]/.test(tok)) {
        html += esc;
        continue;
      }

      let cls = "jp-dojo-word";
      let title = t("markKnownTip");
      if (leechSetCache.has(tok)) {
        cls += " jp-dojo-hit";
        title = t("leechTip");
      } else if (hardSetCache.has(tok)) {
        cls += " jp-dojo-hit-hard";
        title = t("hardTip");
      } else if (customKnownWords.has(tok)) {
        cls += " jp-dojo-hit-manual";
        title = t("manualKnownTip");
      } else if (particlesKnown && PARTICLE_SET.has(tok)) {
        cls += " jp-dojo-hit-mature";
        title = t("particleTip");
      } else if (matureSetCache.has(tok)) {
        cls += " jp-dojo-hit-mature";
        title = t("matureTip");
      } else if (youngSetCache.has(tok)) {
        cls += " jp-dojo-hit-young";
        title = t("youngTip");
      }

      html += `<span class="${cls}" tabindex="0" role="button" data-word="${esc}" title="${title}">${esc}</span>`;
    }
    return html;
  }

  function toggleCustomKnownWord(word) {
    if (!word) return;
    if (customKnownWords.has(word)) {
      customKnownWords.delete(word);
    } else {
      customKnownWords.add(word);
    }
    chrome.storage.local.set({ jpDojoCustomKnown_v1: [...customKnownWords] }, () => {
      renderLyrics();
      const overlay = document.getElementById("jp-dojo-video-subtitle");
      if (overlay && lastIdx >= 0 && lyrics[lastIdx]) {
        overlay.innerHTML = highlightLeeches(lyrics[lastIdx].jp);
      }
    });
  }

  function hasLeech(text) {
    if (jaSeg) {
      for (const seg of jaSeg.segment(text)) {
        if (seg.isWordLike && (leechSetCache.has(seg.segment) || hardSetCache.has(seg.segment))) {
          return true;
        }
      }
      return false;
    }
    return priorityWords.some((w) => w.length >= 2 && text.includes(w));
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  let cachedTokenLyricsRef = null;
  let cachedTokenParticles = null;
  let cachedSongTokens = null;

  function computeSongKnownPct() {
    if (!lyrics.length) return 0;
    if (cachedTokenLyricsRef !== lyrics || cachedTokenParticles !== particlesKnown || !cachedSongTokens) {
      const text = lyrics.map((l) => l.jp).join(" ");
      const tokens = new Set();
      if (jaSeg) {
        for (const seg of jaSeg.segment(text)) {
          const s = seg.segment;
          if (
            seg.isWordLike &&
            (s.length >= 2 || /[\u4e00-\u9faf]/.test(s) || (particlesKnown && PARTICLE_SET.has(s))) &&
            /[\u3040-\u30ff\u4e00-\u9faf]/.test(s)
          ) {
            tokens.add(s);
          }
        }
      } else {
        (text.match(/[\u4e00-\u9faf]+[\u3040-\u309f]*/g) || []).forEach((w) => tokens.add(w));
      }
      cachedTokenLyricsRef = lyrics;
      cachedTokenParticles = particlesKnown;
      cachedSongTokens = tokens;
    }

    const tokens = cachedSongTokens;
    if (!tokens.size) return 0;
    let known = 0;
    tokens.forEach((tok) => {
      if (leechSetCache.has(tok) || hardSetCache.has(tok)) return;
      if (
        customKnownWords.has(tok) ||
        matureSetCache.has(tok) ||
        youngSetCache.has(tok) ||
        (particlesKnown && PARTICLE_SET.has(tok))
      ) {
        known++;
      }
    });
    return Math.round((known / tokens.size) * 100);
  }

  let rowByIdx = new Map();
  let activeRowEl = null;

  function formatLyricsSource(src) {
    switch (src) {
      case "lrclib":
        return "LRCLIB";
      case "kugou":
        return "Kugou";
      case "netease":
        return "NetEase";
      case "youtube-captions":
        return t("sourceYtCaptions");
      default:
        return src ? String(src) : "";
    }
  }

  function updateSourceDisplay() {
    const bar = document.getElementById("jp-dojo-source-bar");
    if (!bar) return;
    const label = formatLyricsSource(currentLyricsSource);
    if (!lyrics.length || !label) {
      bar.hidden = true;
      bar.textContent = "";
      return;
    }
    bar.hidden = false;
    const meta =
      currentLyricsSource !== "youtube-captions" && currentSongTitle
        ? `${currentSongTitle}${currentSongArtist ? ` — ${currentSongArtist}` : ""}`
        : "";
    bar.innerHTML = `<span>${escapeHtml(t("lyricsSourceLabel"))}: <strong class="jp-dojo-source-name">${escapeHtml(label)}</strong></span>${meta ? `<span class="jp-dojo-source-meta" title="${escapeHtml(meta)}">${escapeHtml(meta)}</span>` : ""}`;
  }

  function updatePanelStatus() {
    const statusEl = document.getElementById("jp-dojo-status");
    if (!statusEl) return;
    if (!lyrics.length) {
      statusEl.textContent = t("noLyrics");
      return;
    }
    const pct = computeSongKnownPct();
    statusEl.textContent = `${pct}% ${t("compWord")} · ${lyrics.length} ${t("linesWord")}`;
  }

  function renderLyrics() {
    updatePanelStatus();
    updateSourceDisplay();
    const syncBar = document.querySelector("#jp-dojo-mining-panel .jp-dojo-sync-bar");
    if (syncBar) syncBar.hidden = !lyrics.length;
    const box = document.getElementById("jp-dojo-lyrics");
    if (!box) return;
    box.innerHTML = "";
    rowByIdx = new Map();
    activeRowEl = null;
    if (!lyrics.length) {
      box.innerHTML = `<div style="color:var(--rk-muted);font-size:12px;">${escapeHtml(t("noLyrics"))}</div>`;
      applyImmersionToPanel();
      return;
    }

    let renderedCount = 0;
    const frag = document.createDocumentFragment();
    lyrics.forEach((line, idx) => {
      if (onlyLeeches && !hasLeech(line.jp)) return;
      renderedCount++;
      const row = document.createElement("div");
      row.className = "jp-dojo-line";
      row.dataset.idx = String(idx);

      const timeBtn = document.createElement("button");
      timeBtn.type = "button";
      timeBtn.className = "jp-dojo-time-btn";
      timeBtn.textContent = formatTime(Math.max(0, line.time + syncOffset));
      timeBtn.title = t("jumpLineTitle");
      timeBtn.addEventListener("click", () => {
        if (videoEl) {
          videoEl.currentTime = Math.max(0, line.time + syncOffset);
          videoEl.play();
        }
      });

      const textSpan = document.createElement("span");
      textSpan.className = "jp-dojo-text";
      textSpan.lang = "ja";
      textSpan.innerHTML = highlightLeeches(line.jp);
      textSpan.addEventListener("click", (e) => {
        const sel = window.getSelection();
        if (sel && sel.toString().length > 0) return;
        const wordEl = e.target.closest(".jp-dojo-word");
        if (wordEl && wordEl.dataset.word) {
          toggleCustomKnownWord(wordEl.dataset.word);
        }
      });

      textSpan.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          const wordEl = e.target.closest(".jp-dojo-word");
          if (wordEl && wordEl.dataset.word) {
            e.preventDefault();
            toggleCustomKnownWord(wordEl.dataset.word);
          }
        }
      });

      row.appendChild(timeBtn);
      row.appendChild(textSpan);
      rowByIdx.set(idx, row);
      frag.appendChild(row);
    });
    if (onlyLeeches && renderedCount === 0) {
      box.innerHTML = `<div style="color:var(--rk-muted);font-size:12px;">${escapeHtml(t("noLeechLinesMsg"))}</div>`;
    } else {
      box.appendChild(frag);
    }
    applyImmersionToPanel();
  }

  function onTimeUpdate() {
    if (!videoEl || !lyrics.length) return;
    const effTime = videoEl.currentTime - syncOffset;

    if (loopLine && lastIdx >= 0 && lyrics[lastIdx]) {
      const cur = lyrics[lastIdx];
      const next = lyrics[lastIdx + 1];
      if (effTime >= (next ? next.time : cur.time + 5) - 0.15) {
        videoEl.currentTime = Math.max(0, cur.time + syncOffset);
        return;
      }
    }

    let lo = 0, hi = lyrics.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lyrics[mid].time <= effTime) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }

    if (ans !== lastIdx) {
      lastIdx = ans;
      const overlay = document.getElementById("jp-dojo-video-subtitle");
      if (overlay) {
        if (ans >= 0 && lyrics[ans]) {
          overlay.hidden = !extEnabled || !videoSubEnabled;
          overlay.innerHTML = highlightLeeches(lyrics[ans].jp);
        } else {
          overlay.hidden = true;
        }
      }
      if (activeRowEl) {
        activeRowEl.classList.remove("is-current");
        activeRowEl = null;
      }
      const nextRow = ans >= 0 ? rowByIdx.get(ans) : null;
      if (nextRow) {
        nextRow.classList.add("is-current");
        activeRowEl = nextRow;
        const box = document.getElementById("jp-dojo-lyrics");
        if (box && !panelCollapsed) {
          box.scrollTop = Math.max(0, nextRow.offsetTop - box.offsetTop - box.clientHeight / 2 + nextRow.clientHeight / 2);
        }
      }
    }
  }

  function ensureVideoOverlay() {
    const oldFab = document.getElementById("jp-dojo-fab");
    if (oldFab) oldFab.remove();

    const player = document.querySelector("#movie_player");
    if (player && !document.getElementById("jp-dojo-video-blur-band")) {
      const band = document.createElement("div");
      band.id = "jp-dojo-video-blur-band";
      band.hidden = true;
      player.appendChild(band);
    }
    if (player && !document.getElementById("jp-dojo-video-subtitle")) {
      const sub = document.createElement("div");
      sub.id = "jp-dojo-video-subtitle";
      sub.lang = "ja";
      sub.hidden = true;
      sub.addEventListener("click", (e) => {
        e.stopPropagation();
        const sel = window.getSelection();
        if (sel && sel.toString().length > 0) return;
        const wordEl = e.target.closest(".jp-dojo-word");
        if (wordEl && wordEl.dataset.word) {
          toggleCustomKnownWord(wordEl.dataset.word);
        }
      });
      sub.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          const wordEl = e.target.closest(".jp-dojo-word");
          if (wordEl && wordEl.dataset.word) {
            e.preventDefault();
            e.stopPropagation();
            toggleCustomKnownWord(wordEl.dataset.word);
          }
        }
      });
      player.appendChild(sub);
    }
    applyTheme(currentTheme);
  }

  function findYouTubeSidebar() {
    const candidates = [
      document.querySelector("#secondary #secondary-inner"),
      document.querySelector("#secondary"),
      document.querySelector("#below"),
    ];
    return candidates.find((el) => el && el.offsetParent !== null) || candidates.find(Boolean);
  }

  function ensurePanel() {
    const container = findYouTubeSidebar();
    if (!container || document.getElementById("jp-dojo-mining-panel")) return Boolean(document.getElementById("jp-dojo-mining-panel"));

    const panel = document.createElement("section");
    panel.id = "jp-dojo-mining-panel";
    panel.innerHTML = `
      <div class="jp-dojo-header">
        <span class="jp-dojo-title">Rikai On // 理解ON</span>
        <div style="display:flex;align-items:center;gap:6px;">
          <span id="jp-dojo-status" style="font-size:11px;color:var(--rk-muted);">${escapeHtml(t("loadingMsg"))}</span>
          <button id="jp-dojo-fav-btn" class="jp-dojo-btn" type="button" aria-pressed="false" title="${escapeHtml(t("favAddTitle"))}" aria-label="${escapeHtml(t("favAddTitle"))}">☆</button>
          <button id="jp-dojo-collapse" class="jp-dojo-btn" type="button" title="${escapeHtml(t("collapseTitle"))}" aria-expanded="true">▾</button>
          <button id="jp-dojo-settings-btn" class="jp-dojo-btn" type="button" title="${escapeHtml(t("settingsBtnTitle"))}" aria-label="${escapeHtml(t("settingsBtnTitle"))}">⚙</button>
        </div>
      </div>
      <div id="jp-dojo-body">
        <div class="jp-dojo-controls">
          <button id="jp-dojo-sub-toggle" class="jp-dojo-btn is-active" type="button" aria-pressed="true">${t("subOn")}</button>
          <button id="jp-dojo-loop" class="jp-dojo-btn" type="button" aria-pressed="false">${t("loopBtn")}</button>
          <button id="jp-dojo-filter" class="jp-dojo-btn" type="button" aria-pressed="false">${t("onlyLeechesBtn")}</button>
          <button id="jp-dojo-rate" class="jp-dojo-btn" type="button">1.0x</button>
        </div>
        <div class="jp-dojo-sync-bar">
          <span id="jp-dojo-sync-label" class="jp-dojo-sync-label">${escapeHtml(t("syncLabel"))}</span>
          <button id="jp-dojo-sync-m2" class="jp-dojo-btn is-sm" type="button" title="${escapeHtml(t("syncEarlierTip"))}">-2s</button>
          <button id="jp-dojo-sync-m05" class="jp-dojo-btn is-sm" type="button" title="${escapeHtml(t("syncEarlierTip"))}">-0.5s</button>
          <button id="jp-dojo-sync-reset" class="jp-dojo-btn is-sm" type="button" title="${escapeHtml(t("syncResetTip"))}">0.0s</button>
          <button id="jp-dojo-sync-p05" class="jp-dojo-btn is-sm" type="button" title="${escapeHtml(t("syncLaterTip"))}">+0.5s</button>
          <button id="jp-dojo-sync-p2" class="jp-dojo-btn is-sm" type="button" title="${escapeHtml(t("syncLaterTip"))}">+2s</button>
          <button id="jp-dojo-sync-first" class="jp-dojo-btn is-sm" type="button" title="${escapeHtml(t("syncFirstTip"))}">${escapeHtml(t("syncFirstBtn"))}</button>
        </div>
        <div id="jp-dojo-source-bar" class="jp-dojo-source-bar" hidden></div>
        <div id="jp-dojo-lyrics" class="jp-dojo-lyrics"></div>
      </div>
    `;
    container.prepend(panel);

    document.getElementById("jp-dojo-fav-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleCurrentVideoFavorite();
    });
    updateFavoriteBtn();

    document.getElementById("jp-dojo-collapse").addEventListener("click", (e) => {
      panelCollapsed = !panelCollapsed;
      const body = document.getElementById("jp-dojo-body");
      if (body) body.hidden = panelCollapsed;
      e.target.textContent = panelCollapsed ? "▸" : "▾";
      e.target.setAttribute("aria-expanded", String(!panelCollapsed));
    });

    document.getElementById("jp-dojo-sub-toggle").addEventListener("click", (e) => {
      videoSubEnabled = !videoSubEnabled;
      e.target.textContent = videoSubEnabled ? t("subOn") : t("subOff");
      e.target.setAttribute("aria-pressed", String(videoSubEnabled));
      e.target.classList.toggle("is-active", videoSubEnabled);
      applyImmersionToPanel();
      const sub = document.getElementById("jp-dojo-video-subtitle");
      if (sub) {
        sub.hidden = !extEnabled || !videoSubEnabled || lastIdx < 0;
      }
      const band = document.getElementById("jp-dojo-video-blur-band");
      if (band) {
        band.hidden = !extEnabled || !videoSubEnabled || videoBlurMode === "box";
      }
    });

    document.getElementById("jp-dojo-settings-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      try {
        chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" }, () => {
          if (chrome.runtime.lastError) {
            const statusEl = document.getElementById("jp-dojo-status");
            if (statusEl) statusEl.textContent = t("commErrorMsg");
          }
        });
      } catch {
        const statusEl = document.getElementById("jp-dojo-status");
        if (statusEl) statusEl.textContent = t("commErrorMsg");
      }
    });

    document.getElementById("jp-dojo-loop").addEventListener("click", (e) => {
      loopLine = !loopLine;
      e.target.setAttribute("aria-pressed", String(loopLine));
      e.target.classList.toggle("is-active", loopLine);
    });
    document.getElementById("jp-dojo-filter").addEventListener("click", (e) => {
      onlyLeeches = !onlyLeeches;
      e.target.setAttribute("aria-pressed", String(onlyLeeches));
      e.target.classList.toggle("is-active", onlyLeeches);
      renderLyrics();
    });
    const rates = [1.0, 0.85, 0.75];
    let rIdx = 0;
    document.getElementById("jp-dojo-rate").addEventListener("click", (e) => {
      rIdx = (rIdx + 1) % rates.length;
      if (videoEl) videoEl.playbackRate = rates[rIdx];
      e.target.textContent = `${rates[rIdx]}x`;
    });

    [
      ["jp-dojo-sync-m2", -2],
      ["jp-dojo-sync-m05", -0.5],
      ["jp-dojo-sync-p05", 0.5],
      ["jp-dojo-sync-p2", 2],
    ].forEach(([id, delta]) => {
      document.getElementById(id).addEventListener("click", () => {
        setSyncOffset(syncOffset + delta);
      });
    });
    document.getElementById("jp-dojo-sync-reset").addEventListener("click", () => {
      setSyncOffset(0);
    });
    document.getElementById("jp-dojo-sync-first").addEventListener("click", () => {
      if (videoEl && lyrics.length) {
        setSyncOffset(videoEl.currentTime - lyrics[0].time);
      }
    });
  }

  function decodeCaptionXml(str) {
    return String(str || "")
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&#039;", "'");
  }

  function parseYouTubeCaptionsPayload(rawText) {
    const txt = String(rawText || "").trim();
    if (!txt) return [];
    const out = [];
    if (txt.startsWith("{")) {
      try {
        const json = JSON.parse(txt);
        (json.events || []).forEach((ev) => {
          if (!Array.isArray(ev.segs) || ev.tStartMs === undefined) return;
          const jp = ev.segs.map((s) => s.utf8 || "").join("").replace(/\s+/g, " ").trim();
          if (jp && /[\u3040-\u30ff\u4e00-\u9faf]/.test(jp)) {
            out.push({ time: ev.tStartMs / 1000, jp });
          }
        });
      } catch {
        return [];
      }
    } else if (/^WEBVTT\b/i.test(txt)) {
      const blocks = txt.split(/\r?\n\r?\n+/);
      for (const blk of blocks) {
        const tm = blk.match(/(?:(\d+):)?(\d{2}):(\d{2}(?:\.\d+)?)\s*-->/);
        if (!tm) continue;
        const time = Number(tm[1] || 0) * 3600 + Number(tm[2]) * 60 + Number(tm[3]);
        const textLines = blk
          .split(/\r?\n/)
          .slice(blk.split(/\r?\n/).findIndex((l) => l.includes("-->")) + 1)
          .join(" ")
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (textLines && /[\u3040-\u30ff\u4e00-\u9faf]/.test(textLines)) {
          out.push({ time, jp: decodeCaptionXml(textLines) });
        }
      }
    } else {
      for (const m of txt.matchAll(/<(?:text|p)\b[^>]*\b(start|t)="([\d.]+)"[^>]*>([\s\S]*?)<\/(?:text|p)>/g)) {
        const time = m[1] === "t" ? Number(m[2]) / 1000 : Number(m[2]);
        const jp = decodeCaptionXml(m[3].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
        if (jp && /[\u3040-\u30ff\u4e00-\u9faf]/.test(jp)) {
          out.push({ time, jp });
        }
      }
    }
    return out.sort((a, b) => a.time - b.time);
  }

  const capturedTimedTextByVideo = new Map();
  const capturedCaptionKindByVideo = new Map();

  function getCurrentVideoTitle() {
    const titleEl = document.querySelector("h1.ytd-watch-metadata yt-formatted-string");
    const rawTitle = (titleEl && titleEl.textContent) || document.title;
    return rawTitle.replace(/^\(\d+\)\s*/, "").replace(" - YouTube", "").trim();
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "rikai-on-yt") return;
    if (event.data.type !== "TIMEDTEXT_DATA") return;
    const url = String(event.data.url || "");
    if (/([?&])tlang=/i.test(url)) return;
    let vid = currentVideoId;
    try {
      const vParam = new URL(url, location.origin).searchParams.get("v");
      if (vParam) vid = vParam;
    } catch {
      // ignore URL parse issues
    }
    if (!vid) return;
    const parsed = parseYouTubeCaptionsPayload(event.data.body);
    if (!parsed.length) return;
    capturedTimedTextByVideo.set(vid, parsed);
    capturedCaptionKindByVideo.set(vid, /([?&])kind=asr/i.test(url) ? "asr" : "manual");
    if (!lyrics.length && vid === currentVideoId) {
      applyLiveCaptionFallback(parsed, vid, getCurrentVideoTitle(), true);
    }
  });
  window.postMessage({ source: "rikai-on-yt", type: "RIKAI_READY" }, window.location.origin);

  function getTimedTextInfoForVideo(videoId) {
    const jaUrls = [];
    let potToken = "";
    if (typeof performance === "undefined" || !performance.getEntriesByType) {
      return { jaUrls, potToken };
    }
    const entries = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((u) => u.includes("/api/timedtext") && u.includes(videoId));
    for (const u of entries.reverse()) {
      if (/([?&])lang=ja/i.test(u)) jaUrls.push(u);
      if (!potToken) {
        try {
          const p = new URL(u).searchParams.get("pot");
          if (p) potToken = p;
        } catch {
          // ignore malformed URL
        }
      }
    }
    return { jaUrls, potToken };
  }

  async function extractYouTubeCaptionTracks(videoId) {
    try {
      const scripts = document.querySelectorAll("script");
      for (const sc of scripts) {
        const t = sc.textContent || "";
        if (t.includes(`"videoId":"${videoId}"`) && t.includes('"captionTracks":[')) {
          const m = t.match(/"captionTracks":(\[.*?\])/);
          if (m) return JSON.parse(m[1]);
        }
      }
      const hr = await fetch(location.href, { credentials: "include" });
      const html = hr.ok ? await hr.text() : "";
      const m = html.match(/"captionTracks":(\[.*?\])/);
      if (m) return JSON.parse(m[1]);
    } catch {
      // ignore
    }
    return [];
  }

  async function tryFetchCaptionUrls(baseUrl, potToken = "") {
    if (!baseUrl) return [];
    const candidates = [];
    if (potToken) {
      const sep = baseUrl.includes("?") ? "&" : "?";
      const withPot = baseUrl.includes("pot=")
        ? baseUrl
        : `${baseUrl}${sep}pot=${encodeURIComponent(potToken)}&c=WEB`;
      candidates.push(`${withPot}&fmt=json3`, withPot);
    }
    candidates.push(`${baseUrl}&fmt=json3`, baseUrl);

    for (const url of candidates) {
      try {
        const cr = await fetch(url, { credentials: "include" });
        const parsed = cr.ok ? parseYouTubeCaptionsPayload(await cr.text()) : [];
        if (parsed.length) return parsed;
      } catch {
        // continue
      }
    }
    return [];
  }

  async function triggerTimedTextPotViaPlayer(videoId) {
    const subBtn = document.querySelector(".ytp-subtitles-button");
    if (!subBtn || subBtn.disabled || subBtn.getAttribute("aria-pressed") !== "false") return;
    subBtn.click();
    const deadline = Date.now() + 2000;
    try {
      while (Date.now() < deadline) {
        const info = getTimedTextInfoForVideo(videoId);
        if (info.jaUrls.length || info.potToken) break;
        await new Promise((r) => setTimeout(r, 120));
      }
    } finally {
      if (subBtn.getAttribute("aria-pressed") === "true") {
        subBtn.click();
      }
    }
  }

  let captionRecoveryInFlight = "";

  async function fetchLiveYouTubeJapaneseCaptions(videoId, allowCcPulse = true) {
    if (!videoId) return [];
    if (capturedTimedTextByVideo.has(videoId)) {
      return capturedTimedTextByVideo.get(videoId);
    }
    // 1. Check active <video> TextTracks (Japanese track cues already in player)
    if (videoEl && videoEl.textTracks) {
      for (let i = 0; i < videoEl.textTracks.length; i++) {
        const tr = videoEl.textTracks[i];
        if (String(tr.language || "").toLowerCase().startsWith("ja") && tr.cues && tr.cues.length) {
          const out = [];
          for (let j = 0; j < tr.cues.length; j++) {
            const c = tr.cues[j];
            const jp = String(c.text || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
            if (jp && /[\u3040-\u30ff\u4e00-\u9faf]/.test(jp)) {
              out.push({ time: Number(c.startTime || 0), jp });
            }
          }
          if (out.length) return out;
        }
      }
    }

    // 2. Check existing timedtext requests in performance entries (already include YouTube pot token)
    let { jaUrls, potToken } = getTimedTextInfoForVideo(videoId);
    for (const url of jaUrls) {
      try {
        const r = await fetch(url, { credentials: "include" });
        const parsed = r.ok ? parseYouTubeCaptionsPayload(await r.text()) : [];
        if (parsed.length) return parsed;
      } catch {
        // continue
      }
    }

    // 3. Fallback: inspect captionTracks from live watch HTML with session cookies (+ pot if missing)
    const tracks = await extractYouTubeCaptionTracks(videoId);
    const jaTrack =
      tracks.find((tr) => String(tr.languageCode).startsWith("ja") && tr.kind !== "asr") ||
      tracks.find((tr) => String(tr.languageCode).startsWith("ja"));
    if (!jaTrack?.baseUrl) return [];
    capturedCaptionKindByVideo.set(videoId, jaTrack.kind === "asr" ? "asr" : "manual");

    let parsed = await tryFetchCaptionUrls(jaTrack.baseUrl, potToken);
    if (parsed.length) return parsed;

    // 4. Ask MAIN-world YouTube helper to trigger caption loading via #movie_player, then fallback to CC pulse
    if (allowCcPulse) {
      window.postMessage({ source: "rikai-on-yt", type: "ENSURE_JA_CAPTIONS", videoId }, window.location.origin);
      const deadline = Date.now() + 2800;
      while (Date.now() < deadline) {
        if (capturedTimedTextByVideo.has(videoId)) {
          return capturedTimedTextByVideo.get(videoId);
        }
        await new Promise((r) => setTimeout(r, 120));
      }
      if (!potToken) {
        await triggerTimedTextPotViaPlayer(videoId);
        if (capturedTimedTextByVideo.has(videoId)) {
          return capturedTimedTextByVideo.get(videoId);
        }
        const refreshed = getTimedTextInfoForVideo(videoId);
        for (const url of refreshed.jaUrls) {
          try {
            const r = await fetch(url, { credentials: "include" });
            const p = r.ok ? parseYouTubeCaptionsPayload(await r.text()) : [];
            if (p.length) return p;
          } catch {
            // continue
          }
        }
        if (refreshed.potToken) {
          parsed = await tryFetchCaptionUrls(jaTrack.baseUrl, refreshed.potToken);
          if (parsed.length) return parsed;
        }
      }
    }
    return [];
  }

  function applyLiveCaptionFallback(ytCaps, videoId, title, shouldRender = true) {
    if (!ytCaps.length || videoId !== currentVideoId) return;
    lyrics = ytCaps;
    currentLyricsSource = "youtube-captions";
    const asLrc = ytCaps
      .map((l) => {
        const mm = String(Math.floor(l.time / 60)).padStart(2, "0");
        const ss = (l.time % 60).toFixed(2).padStart(5, "0");
        return `[${mm}:${ss}] ${l.jp}`;
      })
      .join("\n");
    chrome.storage.local.set({
      [`lrc_${videoId}`]: {
        trackName: title,
        artistName: currentSongArtist || "",
        syncedLyrics: asLrc,
        source: "youtube-captions",
        captionKind: capturedCaptionKindByVideo.get(videoId) || "manual",
      },
    });
    if (shouldRender) {
      lastIdx = -1;
      renderLyrics();
      onTimeUpdate();
    }
  }

  if (typeof PerformanceObserver !== "undefined") {
    try {
      const perfObs = new PerformanceObserver((list) => {
        if (lyrics.length || !currentVideoId || captionRecoveryInFlight === currentVideoId) return;
        const hasMatch = list
          .getEntries()
          .some((e) => e.name.includes("/api/timedtext") && e.name.includes(currentVideoId));
        if (!hasMatch) return;
        const vid = currentVideoId;
        captionRecoveryInFlight = vid;
        const titleEl = document.querySelector("h1.ytd-watch-metadata yt-formatted-string");
        const rawTitle = (titleEl && titleEl.textContent) || document.title;
        const title = rawTitle.replace(/^\(\d+\)\s*/, "").replace(" - YouTube", "").trim();
        fetchLiveYouTubeJapaneseCaptions(vid, false)
          .then((caps) => applyLiveCaptionFallback(caps, vid, title))
          .finally(() => {
            if (captionRecoveryInFlight === vid) captionRecoveryInFlight = "";
          });
      });
      perfObs.observe({ type: "resource", buffered: false });
    } catch {
      // PerformanceObserver resource type unavailable
    }
  }

  let playingRetryVideoId = "";

  function onVideoPlayingFallback() {
    if (!currentVideoId || lyrics.length || playingRetryVideoId === currentVideoId) return;
    playingRetryVideoId = currentVideoId;
    if (capturedTimedTextByVideo.has(currentVideoId)) {
      applyLiveCaptionFallback(capturedTimedTextByVideo.get(currentVideoId), currentVideoId, getCurrentVideoTitle(), true);
      return;
    }
    window.postMessage({ source: "rikai-on-yt", type: "ENSURE_JA_CAPTIONS", videoId: currentVideoId }, window.location.origin);
  }

  async function initForCurrentVideo(attempt = 0) {
    if (location.pathname !== "/watch") return;
    await settingsReadyPromise;
    ensureVideoOverlay();
    applyEnabledState();
    applyTheme(currentTheme);
    const ok = ensurePanel();
    applyTheme(currentTheme);
    if (!ok && attempt < 20) {
      setTimeout(() => initForCurrentVideo(attempt + 1), 400);
      return;
    }
    applyPanelLang();

    videoEl = document.querySelector("video");
    if (videoEl) {
      videoEl.removeEventListener("timeupdate", onTimeUpdate);
      videoEl.addEventListener("timeupdate", onTimeUpdate);
      videoEl.removeEventListener("playing", onVideoPlayingFallback);
      videoEl.addEventListener("playing", onVideoPlayingFallback);
    }

    const titleEl = document.querySelector("h1.ytd-watch-metadata yt-formatted-string");
    const rawTitle = (titleEl && titleEl.textContent) || document.title;
    const title = rawTitle.replace(/^\(\d+\)\s*/, "").replace(" - YouTube", "").trim();
    const channelEl = document.querySelector("#owner #channel-name a, ytd-video-owner-renderer #channel-name a, #upload-info #channel-name yt-formatted-string");
    const channel = (channelEl && channelEl.textContent ? channelEl.textContent : "").trim();
    const statusEl = document.getElementById("jp-dojo-status");

    const videoId = new URLSearchParams(location.search).get("v") || "";
    currentVideoId = videoId;
    currentSongTitle = title;
    currentSongArtist = channel;
    currentLyricsSource = "";
    updateFavoriteBtn();
    updateSourceDisplay();
    syncOffset = 0;
    try {
      const offsetKey = videoId ? `lrcOffset_${videoId}` : null;
      const isAd = Boolean(document.querySelector("#movie_player.ad-showing, #movie_player.ad-interrupting"));
      const videoDuration = !isAd && videoEl && Number.isFinite(videoEl.duration) ? Math.round(videoEl.duration) : 0;
      const [ankiRes, lrcRes, offsetObj] = await Promise.all([
        chrome.runtime.sendMessage({ type: "GET_ANKI_WORDS" }),
        chrome.runtime.sendMessage({ type: "GET_LYRICS", query: title, videoId, duration: videoDuration, channel }),
        offsetKey ? chrome.storage.local.get(offsetKey) : Promise.resolve({}),
      ]);
      if (videoId !== currentVideoId) return;
      if (lrcRes?.trackName) currentSongTitle = lrcRes.trackName;
      if (lrcRes?.artistName) currentSongArtist = lrcRes.artistName;
      currentLyricsSource = lrcRes?.syncedLyrics ? (lrcRes.source || "") : "";

      priorityWords = ankiRes?.words || [];
      leechWords = ankiRes?.leechWords || priorityWords;
      hardWords = ankiRes?.hardWords || [];
      matureWords = ankiRes?.matureWords || [];
      youngWords = ankiRes?.youngWords || [];
      rebuildWordSets();
      lyrics = lrcRes?.syncedLyrics ? parseLrc(lrcRes.syncedLyrics) : [];
      if (!lyrics.length && videoId) {
        const ytCaps = await fetchLiveYouTubeJapaneseCaptions(videoId, true);
        if (ytCaps.length) {
          applyLiveCaptionFallback(ytCaps, videoId, title, false);
        }
      }
      syncOffset = offsetKey && Number.isFinite(offsetObj?.[offsetKey]) ? offsetObj[offsetKey] : 0;
      lastIdx = -1;
    } catch {
      if (statusEl) statusEl.textContent = t("commErrorMsg");
    }
    updateSyncDisplay();
    renderLyrics();
    onTimeUpdate();
  }

  window.addEventListener("yt-navigate-finish", () => setTimeout(() => initForCurrentVideo(0), 500));
  initForCurrentVideo(0);
  // Re-attach panel or video overlay if YouTube hydration replaces containers
  setInterval(() => {
    if (document.visibilityState === "hidden" || location.pathname !== "/watch") return;
    if (!document.getElementById("jp-dojo-video-subtitle") || !document.getElementById("jp-dojo-video-blur-band")) {
      ensureVideoOverlay();
      applyEnabledState();
      if (lastIdx >= 0 && lyrics[lastIdx]) {
        const sub = document.getElementById("jp-dojo-video-subtitle");
        if (sub) {
          sub.hidden = !extEnabled || !videoSubEnabled;
          sub.innerHTML = highlightLeeches(lyrics[lastIdx].jp);
        }
      }
    }
    if (!document.getElementById("jp-dojo-mining-panel")) {
      if (ensurePanel()) {
        applyTheme(currentTheme);
        applyPanelLang();
        renderLyrics();
      }
    }
  }, 2000);
})();
