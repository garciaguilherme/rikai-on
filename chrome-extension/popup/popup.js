const toggleBtn = document.getElementById("toggle-enabled");
let isEnabled = true;

function renderToggle() {
  toggleBtn.textContent = isEnabled ? "ON" : "OFF";
  toggleBtn.setAttribute("aria-pressed", String(isEnabled));
  toggleBtn.classList.toggle("is-active", isEnabled);
}

chrome.storage.local.get("jpDojoExtEnabled", (res) => {
  isEnabled = res.jpDojoExtEnabled !== false;
  renderToggle();
});

toggleBtn.addEventListener("click", () => {
  isEnabled = !isEnabled;
  chrome.storage.local.set({ jpDojoExtEnabled: isEnabled }, renderToggle);
});

document.getElementById("open-settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

const FAV_SONGS_KEY = "jpDojoFavoriteSongs_v1";
const modeLeechBtn = document.getElementById("mode-leech");
const modeMatureBtn = document.getElementById("mode-mature");
const modeFavBtn = document.getElementById("mode-fav");
let searchMode = "mature";
let uiLang = "en";
let favoriteSongs = [];
let favVideoIdSet = new Set();

function syncFavSet(list) {
  favoriteSongs = Array.isArray(list) ? list : [];
  favVideoIdSet = new Set(favoriteSongs.map((s) => s.videoId).filter(Boolean));
}

function toggleFavoriteSong(song) {
  if (!song?.videoId) return;
  chrome.storage.local.get(FAV_SONGS_KEY, (res) => {
    const cur = Array.isArray(res[FAV_SONGS_KEY]) ? res[FAV_SONGS_KEY] : [];
    const exists = cur.some((s) => s.videoId === song.videoId);
    const next = exists
      ? cur.filter((s) => s.videoId !== song.videoId)
      : [
          {
            videoId: song.videoId,
            title: song.title || song.videoId,
            artist: song.artist || "",
            ...(Number.isFinite(song.comprehensionPct) ? { comprehensionPct: song.comprehensionPct } : {}),
            ...(Number.isFinite(song.chorusTime) ? { chorusTime: song.chorusTime } : {}),
            ...(Array.isArray(song.hits) ? { hits: song.hits } : {}),
            addedAt: Date.now(),
          },
          ...cur,
        ];
    syncFavSet(next);
    chrome.storage.local.set({ [FAV_SONGS_KEY]: next }, () => {
      if (searchMode === "favorites") {
        setSourceSongs(next);
      } else {
        setSourceSongs(allModeSongs);
      }
    });
  });
}

function t(k, vars) {
  return window.rikaiT ? window.rikaiT(uiLang, k, vars) : k;
}

function applyPopupLang() {
  document.documentElement.lang = uiLang || "en";
  modeMatureBtn.textContent = t("modeMature");
  modeLeechBtn.textContent = t("modeLeech");
  if (modeFavBtn) modeFavBtn.textContent = t("modeFavorites");
  openPlaylistBtn.textContent = t("openPlaylist");
  syncAnkiBtn.title = t("syncTitle");
  syncAnkiBtn.setAttribute("aria-label", t("syncTitle"));
  const donateBtn = document.getElementById("donate-btn");
  if (donateBtn) {
    donateBtn.title = t("donateTitle");
    donateBtn.setAttribute("aria-label", t("donateTitle"));
  }
  const settingsBtn = document.getElementById("open-settings");
  settingsBtn.title = t("settingsBtnTitle");
  settingsBtn.setAttribute("aria-label", t("settingsBtnTitle"));
  const statusEl = document.getElementById("status");
  if (statusEl && statusEl.textContent === "Loading...") {
    statusEl.textContent = t("loadingMsg");
  }
  const filterLbl = document.getElementById("lbl-artist-filter");
  if (filterLbl) filterLbl.textContent = t("filterArtistLabel");
  if (artistFilterSelect) {
    artistFilterSelect.setAttribute("aria-label", t("filterArtistLabel"));
    updateArtistFilterOptions(allModeSongs);
  }
}

function renderModeButtons() {
  const isLeech = searchMode === "leech";
  const isMature = searchMode === "mature";
  const isFav = searchMode === "favorites";
  modeLeechBtn.classList.toggle("is-active", isLeech);
  modeMatureBtn.classList.toggle("is-active", isMature);
  if (modeFavBtn) modeFavBtn.classList.toggle("is-active", isFav);
  modeLeechBtn.setAttribute("aria-pressed", String(isLeech));
  modeMatureBtn.setAttribute("aria-pressed", String(isMature));
  if (modeFavBtn) modeFavBtn.setAttribute("aria-pressed", String(isFav));
}

const syncAnkiBtn = document.getElementById("sync-anki-btn");
const openPlaylistBtn = document.getElementById("open-playlist-btn");
const progressWrap = document.getElementById("sync-progress-wrap");
const progressLabel = document.getElementById("sync-progress-label");
const progressPct = document.getElementById("sync-progress-pct");
const progressFill = document.getElementById("sync-progress-fill");
const progressRole = document.getElementById("sync-progress-role");
const artistFilterWrap = document.getElementById("artist-filter-wrap");
const artistFilterSelect = document.getElementById("artist-filter-select");
let allModeSongs = [];
let selectedArtistFilter = "";
let lastMinedSongs = [];

function updateArtistFilterOptions(songs) {
  if (!artistFilterWrap || !artistFilterSelect) return;
  const list = Array.isArray(songs) ? songs : [];
  const counts = new Map();
  list.forEach((s) => {
    const a = String(s?.artist || "").trim();
    if (a) counts.set(a, (counts.get(a) || 0) + 1);
  });

  if (!list.length || !counts.size) {
    artistFilterWrap.hidden = true;
    selectedArtistFilter = "";
    artistFilterSelect.innerHTML = "";
    return;
  }

  if (selectedArtistFilter && !counts.has(selectedArtistFilter)) {
    selectedArtistFilter = "";
  }

  artistFilterWrap.hidden = false;
  const sorted = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  artistFilterSelect.innerHTML = "";

  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = `${t("allArtistsOpt")} (${list.length})`;
  artistFilterSelect.appendChild(allOpt);

  for (const [artist, cnt] of sorted) {
    const opt = document.createElement("option");
    opt.value = artist;
    opt.textContent = `${artist} (${cnt})`;
    artistFilterSelect.appendChild(opt);
  }
  artistFilterSelect.value = selectedArtistFilter;
}

function setSourceSongs(songs) {
  allModeSongs = Array.isArray(songs) ? songs : [];
  updateArtistFilterOptions(allModeSongs);
  const filtered = selectedArtistFilter
    ? allModeSongs.filter((s) => String(s?.artist || "").trim() === selectedArtistFilter)
    : allModeSongs;
  renderSongsList(filtered);
}

function setProgress(pct, label, show = true) {
  progressWrap.hidden = !show;
  if (!show) return;
  const val = Math.max(0, Math.min(100, Math.round(pct)));
  progressFill.style.width = `${val}%`;
  progressPct.textContent = `${val}%`;
  progressLabel.textContent = label || "Sincronizando...";
  progressRole.setAttribute("aria-valuenow", String(val));
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "SYNC_PROGRESS") {
    setProgress(msg.pct, msg.label, true);
  }
});

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderSongsList(songs) {
  const status = document.getElementById("status");
  const list = document.getElementById("leech-list");
  list.innerHTML = "";
  lastMinedSongs = songs || [];

  if (!lastMinedSongs.length) {
    openPlaylistBtn.hidden = true;
    status.textContent = searchMode === "favorites" ? t("noFavoritesMsg") : t("clickSyncPrompt");
    return;
  }

  openPlaylistBtn.hidden = false;
  status.textContent =
    searchMode === "favorites"
      ? t("favoritesHeader")
      : searchMode === "mature"
      ? t("matureHeader")
      : t("leechHeader");

  lastMinedSongs.forEach((s) => {
    const row = document.createElement("div");
    row.className = "song-row";

    const btn = document.createElement("button");
    btn.className = "pill";
    btn.type = "button";
    const chorusTag = s.chorusTime ? ` · ${t("chorusWord")} ${s.chorusTime}s` : "";
    const vid = encodeURIComponent(s.videoId || "");
    const titleSafe = escapeHtml(s.title);
    const artistSafe = escapeHtml(s.artist);
    const hitsSafe = escapeHtml((s.hits || []).slice(0, 3).join(", "));
    const hasMeta = !s.captionOnly && (Number.isFinite(s.comprehensionPct) || (Array.isArray(s.hits) && s.hits.length));
    const metaHtml = s.captionOnly
      ? `<small style="color:var(--rk-accent);">${escapeHtml(t("ytManualCcBadge"))}</small>`
      : hasMeta
      ? `<small style="color:var(--rk-accent);">${Number(s.comprehensionPct || 0)}% ${escapeHtml(t("compWord"))}${escapeHtml(chorusTag)}</small>
         ${hitsSafe ? `<small style="display:block;color:var(--rk-muted);">${(s.hits || []).length} ${escapeHtml(t("targetsWord"))}: ${hitsSafe}</small>` : ""}`
      : "";
    btn.innerHTML = `
      <img src="https://i.ytimg.com/vi/${vid}/mqdefault.jpg" alt="" width="56" height="32" style="object-fit:cover;border-radius:2px;flex-shrink:0;">
      <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;">
        <strong style="display:block;font-size:12px;color:var(--rk-text);">${titleSafe}${artistSafe ? ` — ${artistSafe}` : ""}</strong>
        ${metaHtml}
      </span>
    `;
    btn.addEventListener("click", () => {
      const tParam = s.chorusTime ? `&t=${s.chorusTime}s` : "";
      chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${vid}${tParam}` });
    });

    const isFav = favVideoIdSet.has(s.videoId);
    const favLabel = isFav ? t("favRemoveTitle") : t("favAddTitle");
    const favBtn = document.createElement("button");
    favBtn.type = "button";
    favBtn.className = `rk-btn fav-item-btn${isFav ? " is-active" : ""}`;
    favBtn.textContent = isFav ? "★" : "☆";
    favBtn.setAttribute("aria-pressed", String(isFav));
    favBtn.setAttribute("aria-label", favLabel);
    favBtn.title = favLabel;
    favBtn.addEventListener("click", () => toggleFavoriteSong(s));

    row.appendChild(btn);
    row.appendChild(favBtn);
    list.appendChild(row);
  });
}

function loadCachedSongs() {
  if (searchMode === "favorites") {
    setSourceSongs(favoriteSongs);
    return;
  }
  const cacheKey = `jpDojoLastMined_${searchMode}`;
  chrome.storage.local.get(cacheKey, (res) => {
    setSourceSongs(res[cacheKey] || []);
  });
}

function syncAndMine() {
  if (searchMode === "favorites") {
    searchMode = "mature";
    chrome.storage.local.set({ jpDojoExtMode: searchMode });
    renderModeButtons();
  }
  selectedArtistFilter = "";
  setSourceSongs([]);
  const status = document.getElementById("status");
  const list = document.getElementById("leech-list");
  list.innerHTML = "";
  openPlaylistBtn.hidden = true;
  syncAnkiBtn.disabled = true;

  const msgType = "GET_ANKI_WORDS";
  setProgress(2, t("syncInitMsg"), true);
  status.textContent = searchMode === "mature" ? t("syncMatureMsg") : t("syncLeechMsg");

  chrome.runtime.sendMessage({ type: msgType, force: true }, (res) => {
    if (chrome.runtime.lastError || !res || !res.connected) {
      syncAnkiBtn.disabled = false;
      setProgress(0, "", false);
      status.textContent = chrome.runtime.lastError?.message || t("offlineMsg");
      return;
    }
    const countCheck = searchMode === "mature" ? res.knownWords?.length : res.words?.length;
    if (!countCheck) {
      syncAnkiBtn.disabled = false;
      setProgress(0, "", false);
      status.textContent = t("noWordsMsg");
      return;
    }

    status.textContent =
      searchMode === "mature"
        ? t("miningMatureMsg", { known: res.knownWords.length, mature: res.matureWords.length })
        : t("miningLeechMsg", { leech: res.leechWords?.length || 0, hard: res.hardWords?.length || 0 });

    chrome.runtime.sendMessage({ type: "MINE_SONGS", mode: searchMode, vocab: res }, (songs) => {
      syncAnkiBtn.disabled = false;
      setProgress(100, t("syncDoneMsg"), true);
      setTimeout(() => setProgress(0, "", false), 700);
      if (chrome.runtime.lastError) {
        status.textContent = chrome.runtime.lastError.message;
        return;
      }
      if (!songs || !songs.length) {
        status.textContent = t("noSongsMsg");
        return;
      }
      chrome.storage.local.set({ [`jpDojoLastMined_${searchMode}`]: songs });
      setSourceSongs(songs);
    });
  });
}

syncAnkiBtn.addEventListener("click", syncAndMine);

modeLeechBtn.addEventListener("click", () => {
  searchMode = "leech";
  chrome.storage.local.set({ jpDojoExtMode: searchMode });
  renderModeButtons();
  loadCachedSongs();
});

modeMatureBtn.addEventListener("click", () => {
  searchMode = "mature";
  chrome.storage.local.set({ jpDojoExtMode: searchMode });
  renderModeButtons();
  loadCachedSongs();
});

if (modeFavBtn) {
  modeFavBtn.addEventListener("click", () => {
    searchMode = "favorites";
    chrome.storage.local.set({ jpDojoExtMode: searchMode });
    renderModeButtons();
    loadCachedSongs();
  });
}

openPlaylistBtn.addEventListener("click", () => {
  if (!lastMinedSongs.length) return;
  const ids = lastMinedSongs.map((s) => encodeURIComponent(s.videoId)).join(",");
  chrome.tabs.create({ url: `https://www.youtube.com/watch_videos?video_ids=${ids}` });
});

if (artistFilterSelect) {
  artistFilterSelect.addEventListener("change", () => {
    selectedArtistFilter = artistFilterSelect.value;
    setSourceSongs(allModeSongs);
  });
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes[FAV_SONGS_KEY]) {
    syncFavSet(changes[FAV_SONGS_KEY].newValue || []);
    if (searchMode === "favorites") {
      setSourceSongs(favoriteSongs);
    } else if (allModeSongs.length) {
      setSourceSongs(allModeSongs);
    }
  }
});

chrome.storage.local.get(["jpDojoExtMode", "jpDojoExtSettings_v1", FAV_SONGS_KEY], (res) => {
  const cfg = res.jpDojoExtSettings_v1 || {};
  syncFavSet(res[FAV_SONGS_KEY] || []);
  uiLang = cfg.lang || "en";
  applyPopupLang();
  if (window.rikaiApplyTheme) {
    window.rikaiApplyTheme(document.documentElement, cfg.theme || "rikai-red", cfg.customTheme);
  } else {
    document.documentElement.setAttribute("data-theme", cfg.theme || "rikai-red");
  }
  searchMode = res.jpDojoExtMode || "mature";
  renderModeButtons();
  loadCachedSongs();

  if (cfg.ankiUiImmersion && window.RikaiUIImmersion) {
    chrome.runtime.sendMessage({ type: "GET_ANKI_WORDS", force: false }, (ankiRes) => {
      if (ankiRes?.matureWords) {
        window.RikaiUIImmersion.applyToDOM(document.body, ankiRes.matureWords, true);
      }
    });
  }
});
