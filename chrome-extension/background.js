/**
 * Background Service Worker — Rikai On (MV3)
 * Handles AnkiConnect (8765), JLPT baseline, and LRCLIB
 */
importScripts("jlpt-vocab.js", "artists-pool.js");

const CACHE_KEY = "jpDojoExtAnki_v2";
const CACHE_TTL = 5 * 60 * 1000;

async function ankiCall(action, params = {}, baseUrl = "http://127.0.0.1:8765") {
  const endpoint = String(baseUrl || "http://127.0.0.1:8765").trim() || "http://127.0.0.1:8765";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version: 6, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.result;
}

function stripHtml(html) {
  return String(html || "")
    .replace(/\[sound:[^\]]*\]/gi, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractWords(card) {
  const fields = card.fields || {};
  const order = ["Expression", "Word", "Vocabulary", "Vocab", "Target", "Kanji", "Front", "Back"];
  let rawFront = "";
  for (const k of order) {
    if (fields[k]?.value) {
      const cleaned = stripHtml(fields[k].value);
      if (cleaned && /[\u3040-\u30ff\u4e00-\u9faf]/.test(cleaned)) {
        rawFront = cleaned;
        break;
      }
    }
  }
  const words = [];
  const noPunct = rawFront.replace(/[。、！？「」『』（）\(\)\[\]]/g, " ").trim();
  if (noPunct.length >= 2 && noPunct.length <= 8 && !/\s/.test(noPunct) && /[\u4e00-\u9faf]/.test(noPunct)) {
    words.push(noPunct);
  } else {
    const chunks = rawFront.match(/[\u4e00-\u9faf]+[\u3040-\u309f]*/g) || [];
    chunks.forEach((c) => {
      if (c.length >= 2 && c.length <= 6) words.push(c);
    });
  }
  return words;
}

function emitProgress(pct, label) {
  chrome.runtime.sendMessage({ type: "SYNC_PROGRESS", pct: Math.min(100, Math.round(pct)), label }).catch(() => { });
}

const JAPANESE_PARTICLES = [
  "は", "が", "を", "に", "へ", "で", "と", "や", "の", "か", "も", "ね", "よ", "わ", "ぞ", "ぜ", "な", "さ",
  "から", "まで", "より", "ほど", "だけ", "しか", "ばかり", "ながら", "ので", "のに", "けど", "けれど", "けれども", "でも", "って",
];
const PARTICLE_SET = new Set(JAPANESE_PARTICLES);

async function withExtraKnownWords(data) {
  const extra = await chrome.storage.local.get(["jpDojoCustomKnown_v1", "jpDojoExtSettings_v1"]);
  const customKnown = Array.isArray(extra.jpDojoCustomKnown_v1) ? extra.jpDojoCustomKnown_v1 : [];
  const settings = extra.jpDojoExtSettings_v1 || {};
  const jlptLevel = settings.jlptLevel || "none";
  const particlesKnown = settings.particlesKnown !== false;
  const jlptWords = typeof self.getCumulativeJlptWords === "function" ? self.getCumulativeJlptWords(jlptLevel) : [];
  const particleWords = particlesKnown ? JAPANESE_PARTICLES : [];

  const leechAndHard = new Set([...(data.leechWords || []), ...(data.hardWords || [])]);
  const mergedMature = [...new Set([...(data.matureWords || []), ...customKnown, ...jlptWords, ...particleWords])].filter(
    (w) => !leechAndHard.has(w)
  );
  const matureSet = new Set(mergedMature);
  const mergedYoung = (data.youngWords || []).filter((w) => !leechAndHard.has(w) && !matureSet.has(w));
  const mergedKnown = [...new Set([...(data.knownWords || []), ...customKnown, ...jlptWords, ...particleWords])];

  return {
    ...data,
    matureWords: mergedMature,
    youngWords: mergedYoung,
    knownWords: mergedKnown,
    particlesKnown,
  };
}

async function getVocabularyBuckets(force = false) {
  const VOCAB_STORE_KEY = "jpDojoExtVocabFull_v4";
  const storedObj = await chrome.storage.local.get(VOCAB_STORE_KEY);
  const stored = storedObj[VOCAB_STORE_KEY] || null;

  // Return persisted query immediately unless refresh (force=true) is requested
  if (!force && stored && stored.data) {
    return await withExtraKnownWords(stored.data);
  }

  try {
    const cfgObj = await chrome.storage.local.get("jpDojoExtSettings_v1");
    const settings = cfgObj.jpDojoExtSettings_v1 || {};
    const ankiUrl = settings.ankiUrl || "http://127.0.0.1:8765";
    const leechQuery = settings.leechQuery || "tag:leech";

    emitProgress(5, "Consultando IDs no AnkiConnect...");
    await ankiCall("version", {}, ankiUrl);

    const [tagIds, autoLeechIds, hardIds, reviewIds] = await Promise.all([
      ankiCall("findCards", { query: leechQuery }, ankiUrl).catch(() => []),
      ankiCall("findCards", { query: "prop:lapses>=8 OR (prop:lapses>=4 prop:ease<1.8)" }, ankiUrl).catch(() => []),
      ankiCall("findCards", {
        query: "(prop:lapses>=2 OR rated:7:1 OR prop:ease<2.1)",
      }, ankiUrl).catch(() => []),
      ankiCall("findCards", { query: "is:review -is:suspended" }, ankiUrl).catch(() => []),
    ]);

    const leechSet = new Set([...tagIds, ...autoLeechIds]);
    const hardSet = new Set(hardIds);
    const allIds = [...new Set([...leechSet, ...hardSet, ...reviewIds])];

    if (!allIds.length) {
      return { connected: true, words: [], leechWords: [], hardWords: [], matureWords: [], youngWords: [], knownWords: [] };
    }

    // Reuse previously extracted words per cardId; only fetch cardsInfo for new cards or recently rated/status-changed cards
    const prevCardsMap = stored?.cardsById || {};
    let idsToFetch = allIds;

    if (stored && Object.keys(prevCardsMap).length > 0) {
      const recentIds = await ankiCall("findCards", { query: "rated:7" }, ankiUrl).catch(() => []);
      const refreshSet = new Set([...recentIds, ...leechSet, ...hardSet]);
      idsToFetch = allIds.filter((id) => !prevCardsMap[id] || refreshSet.has(id));
    }

    for (let i = 0; i < idsToFetch.length; i += 500) {
      const pct = 15 + ((i + 500) / Math.max(1, idsToFetch.length)) * 55;
      emitProgress(Math.min(70, pct), `Lendo cartões (${Math.min(i + 500, idsToFetch.length)}/${idsToFetch.length})...`);
      const chunk = await ankiCall("cardsInfo", { cards: idsToFetch.slice(i, i + 500) }, ankiUrl).catch(() => []);
      chunk.forEach((c) => {
        prevCardsMap[c.cardId] = {
          w: extractWords(c),
          l: Number(c.lapses ?? 0),
          f: Number(c.factor ?? 2500),
          i: Number(c.interval ?? 0),
          t: Number(c.type ?? 0),
        };
      });
    }
    emitProgress(74, "Classificando vocabulário...");

    const leechScores = new Map();
    const hardScores = new Map();
    const matureSet = new Set();
    const youngSet = new Set();

    allIds.forEach((id) => {
      const entry = prevCardsMap[id];
      if (!entry || !entry.w.length) return;
      const isLeech = leechSet.has(id) || entry.l >= 8 || (entry.l >= 4 && entry.f < 1800);
      const score = entry.l * 100 + Math.max(0, 2600 - entry.f) / 10;

      if (isLeech) {
        entry.w.forEach((w) => {
          if (score > (leechScores.get(w) || 0)) leechScores.set(w, score);
        });
      } else if (hardSet.has(id) || entry.l >= 2 || entry.f < 2100) {
        entry.w.forEach((w) => {
          if (score > (hardScores.get(w) || 0)) hardScores.set(w, score);
        });
      }

      if (entry.i >= 21) {
        entry.w.forEach((w) => matureSet.add(w));
      } else if (entry.t === 2 || entry.i > 0) {
        entry.w.forEach((w) => youngSet.add(w));
      }
    });

    const leechWords = [...leechScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([w]) => w);

    const hardWords = [...hardScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([w]) => w)
      .filter((w) => !leechScores.has(w));

    const customKnownObj = await chrome.storage.local.get("jpDojoCustomKnown_v1");
    const customKnownList = Array.isArray(customKnownObj.jpDojoCustomKnown_v1)
      ? customKnownObj.jpDojoCustomKnown_v1
      : [];
    const customKnownSet = new Set(customKnownList);

    const matureWords = [...new Set([...matureSet, ...customKnownList])].filter(
      (w) => !leechScores.has(w) && !hardScores.has(w)
    );
    const youngWords = [...youngSet].filter(
      (w) => !leechScores.has(w) && !hardScores.has(w) && !matureSet.has(w) && !customKnownSet.has(w)
    );
    const knownWords = [...new Set([...matureSet, ...youngSet, ...customKnownList])];

    const data = {
      connected: true,
      words: [...new Set([...leechWords, ...hardWords])],
      leechWords,
      hardWords,
      matureWords,
      youngWords,
      knownWords,
      totalCardsScanned: allIds.length,
    };

    await chrome.storage.local.set({
      [VOCAB_STORE_KEY]: { ts: Date.now(), data, cardsById: prevCardsMap },
    });
    return await withExtraKnownWords(data);
  } catch {
    if (stored && stored.data) return await withExtraKnownWords(stored.data);
    return await withExtraKnownWords({ connected: false, words: [], leechWords: [], hardWords: [], matureWords: [], youngWords: [], knownWords: [] });
  }
}

function isJapaneseLyrics(text) {
  const s = String(text || "");
  const hira = (s.match(/[\u3040-\u309f]/g) || []).length;
  const kana = (s.match(/[\u3040-\u30ff]/g) || []).length;
  const hangul = (s.match(/[\uac00-\ud7af]/g) || []).length;
  return hira >= 15 && kana >= 20 && hangul === 0;
}

function cleanYouTubeTitle(raw) {
  return String(raw || "")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/^\(\d+\)\s*/, "")
    .replace(/ - YouTube$/i, "")
    .replace(/【[^】]*】|\[[^\]]*\]|\([^)]*(official|mv|music video|lyric|audio|live|ver\.?)[^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanChannelArtist(raw) {
  const s = String(raw || "")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s*-\s*Topic$/i, "")
    .replace(/\s*(?:Official\s*YouTube\s*Channel|Official\s*Channel|Official)$/i, "")
    .trim();
  if (!s || s.length < 2 || /^(?:youtube|various artists|unknown)$/i.test(s)) return "";
  return s;
}

let watchedArtistQueue = Promise.resolve();

function recordWatchedArtists(artistNames) {
  const cleaned = (Array.isArray(artistNames) ? artistNames : [artistNames])
    .map((a) => String(a || "").trim())
    .filter((a) => a.length >= 2);
  if (!cleaned.length) return watchedArtistQueue;
  watchedArtistQueue = watchedArtistQueue
    .then(async () => {
      const obj = await chrome.storage.local.get("jpDojoWatchedArtists_v1");
      let list = Array.isArray(obj.jpDojoWatchedArtists_v1) ? obj.jpDojoWatchedArtists_v1 : [];
      let changed = false;
      for (let i = cleaned.length - 1; i >= 0; i--) {
        const name = cleaned[i];
        if (!list.includes(name)) {
          list = [name, ...list];
          changed = true;
        }
      }
      if (changed) {
        await chrome.storage.local.set({ jpDojoWatchedArtists_v1: list.slice(0, 100) });
      }
    })
    .catch(() => { });
  return watchedArtistQueue;
}

async function recordWatchedArtist(artistName) {
  return recordWatchedArtists([artistName]);
}

async function fetchYouTubeOEmbed(videoId) {
  if (!videoId) return null;
  try {
    const res = await fetchWithAbort(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
      3500
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
      title: String(data?.title || "").trim(),
      author: cleanChannelArtist(data?.author_name || ""),
    };
  } catch {
    return null;
  }
}

async function refreshTopJapanArtists(force = false) {
  if (typeof self.fetchJapanChartArtists === "function") {
    return self.fetchJapanChartArtists(force);
  }
  return [];
}

async function fetchWithAbort(url, timeoutMs = 8000, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function decodeUtf8Base64(b64) {
  try {
    const bin = atob(String(b64 || "").replace(/\s+/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

function cleanExternalLrc(raw) {
  const out = [];
  String(raw || "").split(/\r?\n/).forEach((row) => {
    const m = row.match(/^\[(\d{1,2}:\d{2})(?:[.:](\d{1,3}))?\]\s*(.+)$/);
    if (!m) return;
    const text = m[3].trim();
    if (!text || /^(?:作?[词曲詞]|编曲|編曲|制作人|歌詞|歌手|专辑|Ti|Ar|Al)\s*[:：]/i.test(text)) return;
    const frac = m[2] ? `.${m[2].slice(0, 2).padEnd(2, "0")}` : "";
    out.push(`[${m[1]}${frac}] ${text}`);
  });
  return out.join("\n");
}

function formatLrcStamp(sec) {
  const safe = Math.max(0, Number(sec || 0));
  const m = Math.floor(safe / 60);
  const s = (safe % 60).toFixed(2).padStart(5, "0");
  return `${String(m).padStart(2, "0")}:${s}`;
}

function decodeXmlEntities(str) {
  return String(str || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#039;", "'");
}

function captionPayloadToLrc(rawText) {
  const txt = String(rawText || "").trim();
  if (!txt) return "";
  const lines = [];
  if (txt.startsWith("{")) {
    try {
      const json = JSON.parse(txt);
      (json.events || []).forEach((ev) => {
        if (!Array.isArray(ev.segs) || ev.tStartMs === undefined) return;
        const line = ev.segs.map((s) => s.utf8 || "").join("").replace(/\s+/g, " ").trim();
        if (line && /[\u3040-\u30ff\u4e00-\u9faf]/.test(line)) {
          lines.push(`[${formatLrcStamp(ev.tStartMs / 1000)}] ${line}`);
        }
      });
    } catch {
      return "";
    }
  } else {
    for (const m of txt.matchAll(/<(?:text|p)\b[^>]*\b(start|t)="([\d.]+)"[^>]*>([\s\S]*?)<\/(?:text|p)>/g)) {
      const sec = m[1] === "t" ? Number(m[2]) / 1000 : Number(m[2]);
      const line = decodeXmlEntities(m[3].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
      if (line && /[\u3040-\u30ff\u4e00-\u9faf]/.test(line)) {
        lines.push(`[${formatLrcStamp(sec)}] ${line}`);
      }
    }
  }
  return lines.join("\n");
}

const TITLE_STOP_WORDS = new Set([
  "ft", "feat", "featuring", "vs", "ver", "version", "official", "mv", "pv",
  "video", "audio", "lyric", "lyrics", "music", "cover", "short", "full",
  "the", "of", "in", "on", "to", "and", "by", "with", "sub", "eng", "jp", "jpn", "romaji",
]);

function stripFeaturedArtists(str) {
  return String(str || "")
    .replace(/\b(?:ft\.?|feat\.?|featuring)\s+[^/|()[\]「」『』]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const COVER_TAG_RE = /(?:歌いました|歌ってみた|歌って見た|弾き語り|叩いてみた|カバーしました|utattemita|covered\s+by\s+\S+|\bcover\b(?:\s+ver\.?)?)/gi;
const META_BRACKET_RE = /^(?:mv|pv|official|music\s*video|lyric|lyrics|audio|live|hd|4k|full|short|sub|eng|jp|jpn|original|cover|ver\.?|歌ってみた|歌いました|歌詞付き?|日本語字幕|vocaloid|初音ミク|重音テト)$/i;

function extractBracketArtists(raw) {
  const cleaned = String(raw || "")
    .replace(/^\(\d+\)\s*/, "")
    .replace(/ - YouTube$/i, "");
  const out = [];
  for (const m of cleaned.matchAll(/[【\[]([^】\]]+)[】\]]/g)) {
    const inner = m[1].trim();
    if (inner.length >= 2 && inner.length <= 32 && !META_BRACKET_RE.test(inner) && !/mv|official|lyric|歌詞|字幕|歌って|ver\./i.test(inner)) {
      out.push(inner);
    }
  }
  return out;
}

function stripCoverTags(str) {
  return String(str || "")
    .replace(COVER_TAG_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCoreTitleVariants(query) {
  const cleaned = cleanYouTubeTitle(query);
  const noFeat = stripFeaturedArtists(cleaned);
  const noCover = stripCoverTags(noFeat);
  const bracketArtists = extractBracketArtists(query);
  const rawParts = [];

  if (bracketArtists.length && noCover && !noCover.toLowerCase().includes(bracketArtists[0].toLowerCase())) {
    rawParts.push(`${bracketArtists[0]} ${noCover}`);
  }
  if (noCover) rawParts.push(noCover);
  if (noFeat && noFeat !== noCover) rawParts.push(noFeat);

  for (const seg of (noCover || noFeat).split(/[\/|｜]/)) {
    const s = stripCoverTags(seg);
    if (s && s.length >= 2) rawParts.push(s);
    for (const sub of s.split(/\s+[-－—~～]\s+/)) {
      const t = stripCoverTags(sub);
      if (t && t.length >= 2) rawParts.push(t);
    }
  }
  const bracketMatches = noFeat.match(/[「『]([^」』]{2,})[」』]/g) || [];
  for (const m of bracketMatches) {
    const inner = stripCoverTags(m.slice(1, -1));
    if (inner.length >= 2) rawParts.push(inner);
  }

  const seen = new Set();
  const out = [];
  for (const p of rawParts) {
    const k = p.toLowerCase();
    if (p.length >= 2 && !seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  }
  return out.length ? out : [cleaned];
}

function compactJapaneseChars(str) {
  return String(str || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\u3040-\u30ff\u4e00-\u9faf]/g, "");
}

function extractLatinTokens(str) {
  const matches = String(str || "").normalize("NFKC").toLowerCase().match(/[a-z0-9]{2,}/g) || [];
  return matches.filter((t) => !TITLE_STOP_WORDS.has(t));
}

function isSongMatch(query, trackName, artistName, itemDurationSec = 0, videoDurationSec = 0) {
  const d1 = Number(itemDurationSec) || 0;
  const d2 = Number(videoDurationSec) || 0;
  if (d1 > 0 && d2 > 0 && Math.abs(d1 - d2) > 35) return false;

  const tName = String(trackName || "").trim();
  if (!tName) return false;

  const tJa = compactJapaneseChars(tName);
  const aJa = compactJapaneseChars(artistName);
  const tLat = extractLatinTokens(tName);
  const aLat = extractLatinTokens(artistName);
  const segments = extractCoreTitleVariants(query);

  for (const seg of segments) {
    const sJa = compactJapaneseChars(seg);
    if (tJa.length >= 2 && sJa.length >= 2) {
      const minLen = Math.min(tJa.length, sJa.length);
      const maxLen = Math.max(tJa.length, sJa.length);
      if (
        (tJa.includes(sJa) && minLen / maxLen >= 0.6) ||
        (sJa.includes(tJa) && (minLen / maxLen >= 0.6 || (aJa.length >= 2 && sJa.includes(aJa))))
      ) {
        return true;
      }
    }

    const sLat = extractLatinTokens(seg);
    if (tLat.length > 0 && sLat.length > 0) {
      const sSet = new Set(sLat);
      const tSet = new Set(tLat);
      const common = [...tSet].filter((w) => sSet.has(w));
      const coverage = common.length / Math.max(sSet.size, tSet.size);
      const joinedLen = common.join("").length;
      const artistMatches = aLat.length > 0 && aLat.some((w) => sSet.has(w));
      if (
        (coverage >= 0.6 && joinedLen >= 4) ||
        (tSet.size === common.length && joinedLen >= 4 && artistMatches)
      ) {
        return true;
      }
    }
  }
  return false;
}

async function fetchKugouLyrics(query, rawQuery = query, durationSec = 0) {
  try {
    const sr = await fetchWithAbort(
      `https://mobileservice.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(query)}&page=1&pagesize=5`,
      6500
    );
    if (!sr.ok) return null;
    const sj = await sr.json();
    const songs = (sj?.data?.info || []).filter(
      (s) => s?.hash && isSongMatch(rawQuery, s.songname, s.singername, s.duration, durationSec)
    );
    for (const song of songs.slice(0, 3)) {
      const lr = await fetchWithAbort(
        `https://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=&duration=&hash=${encodeURIComponent(song.hash)}`,
        6500
      );
      if (!lr.ok) continue;
      const lj = await lr.json();
      const cand = (lj?.candidates || [])[0];
      if (!cand?.id || !cand?.accesskey) continue;

      const dr = await fetchWithAbort(
        `https://lyrics.kugou.com/download?ver=1&client=pc&id=${encodeURIComponent(cand.id)}&accesskey=${encodeURIComponent(cand.accesskey)}&fmt=lrc&charset=utf8`,
        6500
      );
      if (!dr.ok) continue;
      const dj = await dr.json();
      const lrc = cleanExternalLrc(decodeUtf8Base64(dj?.content));
      if (lrc && isJapaneseLyrics(lrc)) {
        return {
          trackName: song.songname || query,
          artistName: song.singername || "",
          syncedLyrics: lrc,
          source: "kugou",
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchNetEaseLyrics(query, rawQuery = query, durationSec = 0) {
  try {
    const sr = await fetchWithAbort("https://music.163.com/api/search/get", 6500, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: "https://music.163.com/" },
      body: `s=${encodeURIComponent(query)}&type=1&limit=5`,
    });
    if (!sr.ok) return null;
    const sj = await sr.json();
    const songs = (sj?.result?.songs || []).filter(
      (s) =>
        s?.id &&
        isSongMatch(rawQuery, s.name, s.artists?.[0]?.name || "", Math.round((s.duration || 0) / 1000), durationSec)
    );
    for (const song of songs.slice(0, 3)) {
      const lr = await fetchWithAbort(
        `https://music.163.com/api/song/lyric?id=${encodeURIComponent(song.id)}&lv=1&kv=1&tv=-1`,
        6500,
        { headers: { Referer: "https://music.163.com/" } }
      );
      if (!lr.ok) continue;
      const lj = await lr.json();
      const lrc = cleanExternalLrc(lj?.lrc?.lyric || "");
      if (lrc && isJapaneseLyrics(lrc)) {
        return {
          trackName: song.name || query,
          artistName: song.artists?.[0]?.name || "",
          syncedLyrics: lrc,
          source: "netease",
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchYouTubeJapaneseCaptions(videoId, query) {
  if (!videoId) return null;
  try {
    const wr = await fetchWithAbort(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, 7500);
    if (!wr.ok) return null;
    const html = await wr.text();
    const m = html.match(/"captionTracks":(\[.*?\])/);
    if (!m) return null;
    const tracks = JSON.parse(m[1]);
    const jaTrack =
      tracks.find((t) => String(t.languageCode).startsWith("ja") && t.kind !== "asr") ||
      tracks.find((t) => String(t.languageCode).startsWith("ja"));
    if (!jaTrack?.baseUrl) return null;

    const cr = await fetchWithAbort(`${jaTrack.baseUrl}&fmt=json3`, 6500);
    const body = cr.ok ? await cr.text() : "";
    const lrc = captionPayloadToLrc(body);
    if (lrc && /[\u3040-\u30ff\u4e00-\u9faf]/.test(lrc)) {
      return {
        trackName: query || videoId,
        artistName: "",
        syncedLyrics: lrc,
        source: "youtube-captions",
        captionKind: jaTrack.kind === "asr" ? "asr" : "manual",
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchLyrics(query, videoId = "", durationSec = 0, skipYtFallback = false) {
  const cleaned = cleanYouTubeTitle(query);
  const variants = extractCoreTitleVariants(query);
  const searchTerms = [variants[0]];
  const jaVariant = variants.find((v) => v !== variants[0] && /[\u3040-\u30ff\u4e00-\u9faf]/.test(v));
  if (jaVariant) searchTerms.push(jaVariant);
  if (variants[1] && !searchTerms.includes(variants[1])) {
    searchTerms.push(variants[1]);
  }

  // 1. Primary: LRCLIB
  const kanaScore = (t) => (String(t).match(/[\u3040-\u30ff]/g) || []).length;
  for (const term of searchTerms) {
    try {
      const res = await fetchWithAbort(`https://lrclib.net/api/search?q=${encodeURIComponent(term)}`, 7500);
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list)) {
          const hit = list
            .filter(
              (item) =>
                item.syncedLyrics &&
                isJapaneseLyrics(item.syncedLyrics) &&
                isSongMatch(query, item.trackName, item.artistName, item.duration, durationSec)
            )
            .sort((a, b) => kanaScore(b.syncedLyrics) - kanaScore(a.syncedLyrics))[0];
          if (hit) {
            return { trackName: hit.trackName, artistName: hit.artistName, syncedLyrics: hit.syncedLyrics, source: "lrclib" };
          }
        }
      }
    } catch {
      // fallback next
    }
  }

  // 2. Fallback service(s): Kugou LRC then NetEase Cloud Music LRC (validated for title & duration)
  for (const term of searchTerms) {
    const kugouHit = await fetchKugouLyrics(term, query, durationSec);
    if (kugouHit) {
      return kugouHit;
    }
  }

  for (const term of searchTerms) {
    const neteaseHit = await fetchNetEaseLyrics(term, query, durationSec);
    if (neteaseHit) {
      return neteaseHit;
    }
  }

  // 3. Fallback: Video's own Japanese YouTube captions
  if (!skipYtFallback) {
    const ytCapHit = await fetchYouTubeJapaneseCaptions(videoId, cleaned);
    if (ytCapHit) return ytCapHit;
  }

  return null;
}

async function fetchYouTubeVideoManualCaptionMeta(videoId) {
  if (!videoId) return null;
  try {
    const wr = await fetchWithAbort(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, 5500);
    if (!wr.ok) return null;
    const html = await wr.text();
    const cm = html.match(/"captionTracks":(\[.*?\])/);
    if (!cm) return null;
    const tracks = JSON.parse(cm[1]);
    const hasManualJa =
      Array.isArray(tracks) &&
      tracks.some((t) => String(t.languageCode || "").toLowerCase().startsWith("ja") && t.kind !== "asr");
    if (!hasManualJa) return null;

    const lengthSec = Number((html.match(/"lengthSeconds":"(\d+)"/) || [])[1] || 0);
    if (lengthSec > 0 && (lengthSec < 45 || lengthSec > 660)) return null;

    const rawTitle = (html.match(/<title>([^<]+)<\/title>/) || [])[1] || "";
    const title = decodeXmlEntities(rawTitle).replace(/ - YouTube$/i, "").trim();
    const rawAuthor = (html.match(/"author":"([^"]+)"/) || [])[1] || "";
    const author = cleanChannelArtist(decodeXmlEntities(rawAuthor));
    return { videoId, title: title || videoId, author, lengthSec };
  } catch {
    return null;
  }
}

async function findYouTubeManualCaptionSongs(artists) {
  const sampleArtists = [...artists].slice(0, 4);
  const discoveredIds = new Set();
  await Promise.allSettled(
    sampleArtists.map(async (artist) => {
      try {
        const res = await fetchWithAbort(
          `https://www.youtube.com/results?search_query=${encodeURIComponent(artist)}&sp=EgIoAQ%253D%253D`,
          5500
        );
        if (!res.ok) return;
        const html = await res.text();
        let count = 0;
        for (const m of html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)) {
          if (!discoveredIds.has(m[1])) {
            discoveredIds.add(m[1]);
            count++;
            if (count >= 2) break;
          }
        }
      } catch {
        // continue
      }
    })
  );

  const metas = await Promise.all([...discoveredIds].slice(0, 8).map(fetchYouTubeVideoManualCaptionMeta));
  return metas.filter(Boolean);
}

async function findYouTubeVideoId(query) {
  try {
    const res = await fetchWithAbort(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, 8000);
    const html = await res.text();
    const m = html.match(/"videoId":"([A-Za-z0-9_-]{11})"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const jaSegmenter =
  typeof Intl !== "undefined" && Intl.Segmenter
    ? new Intl.Segmenter("ja", { granularity: "word" })
    : null;

function tokenizeJapanese(text) {
  const clean = String(text || "").replace(/\[[^\]]*\]/g, " ");
  if (!jaSegmenter) return clean.match(/[\u4e00-\u9faf]+[\u3040-\u309f]*/g) || [];
  const tokens = [];
  for (const seg of jaSegmenter.segment(clean)) {
    const s = seg.segment;
    if (seg.isWordLike && (s.length >= 2 || /[\u4e00-\u9faf]/.test(s) || PARTICLE_SET.has(s)) && /[\u3040-\u30ff\u4e00-\u9faf]/.test(s)) {
      tokens.push(s);
    }
  }
  return tokens;
}

function analyzeLyrics(syncedLyrics, knownSet, chorusTargetList, precomputedUniqueTokens) {
  const lines = [];
  const lineCounts = new Map();
  String(syncedLyrics || "")
    .split(/\r?\n/)
    .forEach((row) => {
      const m = row.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,2}))?\]\s*(.+)$/);
      if (!m) return;
      const time = Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 100 : 0);
      const jp = m[4].split("|")[0].trim();
      if (jp && /[\u3040-\u30ff\u4e00-\u9faf]/.test(jp)) {
        lines.push({ time, jp });
        lineCounts.set(jp, (lineCounts.get(jp) || 0) + 1);
      }
    });

  // Cap target scan for chorus detection to avoid O(lines * 10k) in mature mode
  const chorusTargets = (chorusTargetList || []).filter((w) => w.length >= 2).slice(0, 250);
  let chorusTime = null;
  for (const l of lines) {
    const isRepeated = (lineCounts.get(l.jp) || 0) >= 2;
    if (isRepeated && chorusTargets.some((w) => l.jp.includes(w))) {
      chorusTime = Math.floor(l.time);
      break;
    }
  }
  if (chorusTime === null) {
    const rep = lines.find((l) => (lineCounts.get(l.jp) || 0) >= 2);
    if (rep) chorusTime = Math.floor(rep.time);
  }

  // Reuse tokenized array from mineSongs when provided
  const uniqueTokens = precomputedUniqueTokens || [...new Set(tokenizeJapanese(lines.map((l) => l.jp).join(" ")))];
  let knownCount = 0;
  for (let i = 0; i < uniqueTokens.length; i++) {
    if (knownSet.has(uniqueTokens[i])) knownCount++;
  }
  const comprehensionPct = uniqueTokens.length
    ? Math.round((knownCount / uniqueTokens.length) * 100)
    : 0;

  return { comprehensionPct, chorusTime };
}

function normalizeMusicPart(str, stripBrackets = false) {
  let s = String(str || "").normalize("NFKC").toLowerCase();
  if (stripBrackets) {
    s = s
      .replace(/\([^)]*\)|\[[^\]]*\]|【[^】]*】/g, " ")
      .replace(/\s*[-–—]\s*(tv\s*size|short\s*ver\.?|live|acoustic|remix|inst\.?|instrumental|off\s*vocal).*$/i, "")
      .replace(/\s*(feat\.?|ft\.?|×|with)\s+.+$/i, "");
  }
  return s.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function scoreCandidateLyrics(item, validTargetSet, knownSet, matureSet, chorusTargetList) {
  if (!item?.syncedLyrics || !isJapaneseLyrics(item.syncedLyrics)) return null;
  const uniqueLyricTokens = [...new Set(tokenizeJapanese(item.syncedLyrics))];
  const hits = uniqueLyricTokens.filter((tok) => validTargetSet.has(tok));
  if (!hits.length) return null;

  const { comprehensionPct, chorusTime } = analyzeLyrics(
    item.syncedLyrics,
    knownSet,
    chorusTargetList,
    uniqueLyricTokens
  );
  let matureCount = 0;
  for (let i = 0; i < hits.length; i++) {
    if (matureSet.has(hits[i])) matureCount++;
  }
  return {
    item,
    hits,
    comprehensionPct,
    chorusTime,
    knownCount: hits.length,
    matureCount,
  };
}

async function mineSongs(mode, rawVocab) {
  const GENRE_ARTISTS = self.GENRE_ARTISTS || {};
  const vocab = await withExtraKnownWords(rawVocab || {});
  const knownSet = new Set(vocab.knownWords || []);
  const matureSet = new Set(vocab.matureWords || []);
  const targetWords =
    mode === "mature"
      ? vocab.knownWords || []
      : [...(vocab.leechWords || []), ...(vocab.hardWords || [])];
  const validTargetSet = new Set(targetWords.filter((w) => w.length >= 2 || /[\u4e00-\u9faf]/.test(w)));
  const chorusTargetList = vocab.leechWords?.length ? vocab.leechWords : targetWords;

  const cfgObj = await chrome.storage.local.get(null);
  const settings = cfgObj.jpDojoExtSettings_v1 || {};
  const selectedGenres = settings.genres;
  const activeGenreKeys =
    Array.isArray(selectedGenres) && selectedGenres.length
      ? selectedGenres.filter((g) => GENRE_ARTISTS[g])
      : Object.keys(GENRE_ARTISTS);

  const chartArtists = await refreshTopJapanArtists(false).catch(() => []);
  const watchedArtists = Array.isArray(cfgObj.jpDojoWatchedArtists_v1) ? cfgObj.jpDojoWatchedArtists_v1 : [];
  const customArtists = Array.isArray(settings.customArtists) ? settings.customArtists : [];

  const genreArtists = activeGenreKeys.flatMap((g) => GENRE_ARTISTS[g] || []);
  const artistsPool = [...new Set([...customArtists, ...watchedArtists, ...chartArtists, ...genreArtists])];
  const picked = [...artistsPool].sort(() => Math.random() - 0.5).slice(0, 15);
  const candidates = [];
  const seen = new Set();

  // Option 1: Include locally cached songs that have non-automatic Japanese YouTube captions
  for (const [k, entry] of Object.entries(cfgObj)) {
    if (!k.startsWith("lrc_") || entry?.source !== "youtube-captions" || entry?.captionKind !== "manual") continue;
    const vid = k.slice(4);
    const scored = scoreCandidateLyrics(entry, validTargetSet, knownSet, matureSet, chorusTargetList);
    if (!scored) continue;
    const normKey = `yt::${vid}`;
    seen.add(normKey);
    candidates.push({ ...scored, presetVideoId: vid });
  }

  emitProgress(78, `Buscando letras (${picked.length} de ${artistsPool.length} artistas)...`);
  const manualCcExtras = [];
  await Promise.all([
    Promise.allSettled(
      picked.map(async (artist) => {
        try {
          const res = await fetchWithAbort(`https://lrclib.net/api/search?q=${encodeURIComponent(artist)}`, 8000);
          if (!res.ok) return;
          const list = await res.json();
          if (!Array.isArray(list)) return;

          for (const item of list) {
            const normArtist = normalizeMusicPart(item.artistName, true);
            const normTrack = normalizeMusicPart(item.trackName, true);
            const key = `${normArtist}::${normTrack}`;
            if (!normTrack || seen.has(key)) continue;
            const scored = scoreCandidateLyrics(item, validTargetSet, knownSet, matureSet, chorusTargetList);
            if (!scored) continue;
            seen.add(key);
            candidates.push({ ...scored, source: "lrclib" });
          }
        } catch {
          // continue
        }
      })
    ),
    // Option 2: Discover YouTube songs with non-automatic Japanese captions (CC filter)
    (async () => {
      const ytManualMetas = await findYouTubeManualCaptionSongs(picked);
      await Promise.allSettled(
        ytManualMetas.map(async (meta) => {
          const hit = await fetchLyrics(meta.title, meta.videoId, meta.lengthSec, true);
          if (hit?.syncedLyrics) {
            const normArtist = normalizeMusicPart(hit.artistName || meta.author, true);
            const normTrack = normalizeMusicPart(hit.trackName || meta.title, true);
            const key = `${normArtist}::${normTrack}`;
            if (!seen.has(key)) {
              const scored = scoreCandidateLyrics(
                { ...hit, artistName: hit.artistName || meta.author },
                validTargetSet,
                knownSet,
                matureSet,
                chorusTargetList
              );
              if (scored) {
                seen.add(key);
                candidates.push({ ...scored, presetVideoId: meta.videoId, source: hit.source || "lrclib" });
                return;
              }
            }
          }
          manualCcExtras.push({
            title: cleanYouTubeTitle(meta.title) || meta.title,
            artist: meta.author || extractBracketArtists(meta.title)[0] || "",
            videoId: meta.videoId,
            source: "youtube-captions",
            captionKind: "manual",
            captionOnly: true,
          });
        })
      );
    })(),
  ]);

  // Different ranking rules per mode!
  if (mode === "mature") {
    candidates.sort((a, b) => {
      if (b.comprehensionPct !== a.comprehensionPct) return b.comprehensionPct - a.comprehensionPct;
      if (b.knownCount !== a.knownCount) return b.knownCount - a.knownCount;
      return b.matureCount - a.matureCount;
    });
  } else {
    candidates.sort((a, b) => b.hits.length - a.hits.length);
  }

  const results = [];
  const seenVideoIds = new Set();
  const topCandidates = candidates.slice(0, 16);
  emitProgress(86, `Localizando vídeos no YouTube (${topCandidates.length})...`);
  const ytResolved = await Promise.all(
    topCandidates.map(async (c) => ({
      c,
      videoId: c.presetVideoId || (await findYouTubeVideoId(`${c.item.artistName} ${c.item.trackName}`)),
    }))
  );
  const lrcBatch = {};
  for (const { c, videoId } of ytResolved) {
    if (!videoId || seenVideoIds.has(videoId)) continue;
    seenVideoIds.add(videoId);

    lrcBatch[`lrc_${videoId}`] = {
      trackName: c.item.trackName,
      artistName: c.item.artistName,
      syncedLyrics: c.item.syncedLyrics,
      source: c.source || c.item.source || "lrclib",
      ...(c.item.captionKind ? { captionKind: c.item.captionKind } : {}),
    };

    results.push({
      title: c.item.trackName,
      artist: c.item.artistName,
      videoId,
      hits: c.hits,
      comprehensionPct: c.comprehensionPct,
      chorusTime: c.chorusTime,
      knownCount: c.knownCount,
      matureCount: c.matureCount,
      source: c.source || c.item.source || "lrclib",
    });
    if (results.length >= 8) break;
  }

  // Append up to 2 discovered YouTube songs with non-automatic Japanese captions (without external LRC)
  for (const extra of manualCcExtras) {
    if (results.length >= 10) break;
    if (!extra.videoId || seenVideoIds.has(extra.videoId)) continue;
    seenVideoIds.add(extra.videoId);
    results.push(extra);
  }
  if (Object.keys(lrcBatch).length) {
    await chrome.storage.local.set(lrcBatch);
  }

  return results;
}

function replyAsync(sendResponse, promise, fallback) {
  let replied = false;
  const finish = (val) => {
    if (replied) return;
    replied = true;
    try {
      sendResponse(val);
    } catch {
      // ignore if caller tab closed
    }
  };
  Promise.resolve(promise)
    .then(finish)
    .catch(() => finish(fallback));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_ANKI_WORDS") {
    replyAsync(sendResponse, getVocabularyBuckets(Boolean(msg.force)), {
      connected: false,
      words: [],
      leechWords: [],
      hardWords: [],
      matureWords: [],
      youngWords: [],
      knownWords: [],
    });
    return true;
  }
  if (msg.type === "GET_LYRICS") {
    replyAsync(
      sendResponse,
      (async () => {
        const [cacheObj, oembed] = await Promise.all([
          msg.videoId ? chrome.storage.local.get(`lrc_${msg.videoId}`) : Promise.resolve({}),
          msg.videoId ? fetchYouTubeOEmbed(msg.videoId) : Promise.resolve(null),
        ]);
        const effectiveQuery = oembed?.title || msg.query || "";
        const cached = msg.videoId ? cacheObj[`lrc_${msg.videoId}`] : null;
        const bracketArtists = extractBracketArtists(effectiveQuery);
        const channelArtist = cleanChannelArtist(oembed?.author || msg.channel || "");

        const recordIfJapaneseVideo = async (hitObj) => {
          const isJaVideo =
            Boolean(hitObj?.syncedLyrics) ||
            /[\u3040-\u30ff\u4e00-\u9faf]/.test(effectiveQuery) ||
            bracketArtists.length > 0;
          if (!isJaVideo) return;
          const names = [...bracketArtists];
          if (channelArtist && !names.includes(channelArtist)) names.push(channelArtist);
          if (hitObj?.artistName && !names.includes(hitObj.artistName)) names.push(hitObj.artistName);
          if (names.length) await recordWatchedArtists(names);
        };

        if (
          cached?.syncedLyrics &&
          (cached.source === "youtube-captions" ||
            isSongMatch(effectiveQuery, cached.trackName, cached.artistName, 0, msg.duration) ||
            (msg.query && isSongMatch(msg.query, cached.trackName, cached.artistName, 0, msg.duration)))
        ) {
          await recordIfJapaneseVideo(cached);
          return cached;
        }

        let hit = await fetchLyrics(effectiveQuery, msg.videoId, msg.duration);
        if (!hit && msg.query && msg.query !== effectiveQuery) {
          hit = await fetchLyrics(msg.query, msg.videoId, msg.duration);
        }
        await recordIfJapaneseVideo(hit);

        if (hit?.syncedLyrics && msg.videoId) {
          chrome.storage.local.set({ [`lrc_${msg.videoId}`]: hit }).catch(() => { });
        } else if (msg.videoId) {
          chrome.storage.local.remove(`lrc_${msg.videoId}`).catch(() => { });
        }
        return hit;
      })(),
      null
    );
    return true;
  }
  if (msg.type === "MINE_SONGS") {
    replyAsync(
      sendResponse,
      mineSongs(msg.mode || "leech", msg.vocab || { leechWords: msg.words || [] }),
      []
    );
    return true;
  }
  if (msg.type === "REFRESH_CHART_ARTISTS") {
    replyAsync(sendResponse, refreshTopJapanArtists(true), []);
    return true;
  }
  if (msg.type === "OPEN_OPTIONS") {
    replyAsync(
      sendResponse,
      new Promise((resolve) => {
        if (typeof chrome.runtime.openOptionsPage === "function") {
          chrome.runtime.openOptionsPage(() => {
            if (!chrome.runtime.lastError) {
              resolve({ ok: true });
              return;
            }
            chrome.tabs.create({ url: chrome.runtime.getURL("options/options.html") }, () => {
              resolve({ ok: !chrome.runtime.lastError });
            });
          });
        } else {
          chrome.tabs.create({ url: chrome.runtime.getURL("options/options.html") }, () => {
            resolve({ ok: !chrome.runtime.lastError });
          });
        }
      }),
      { ok: false }
    );
    return true;
  }
});
