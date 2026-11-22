/**
 * Rikai On // 理解音 — Expanded Top Japanese Artists Pool by Genre (140 Artists)
 */
self.GENRE_ARTISTS = {
  jpop: [
    "YOASOBI", "米津玄師", "Official髭男dism", "Ado", "Vaundy",
    "あいみょん", "藤井風", "Mrs. GREEN APPLE", "宇多田ヒカル", "星野源",
    "椎名林檎", "SEKAI NO OWARI", "いきものがかり", "ゆず", "Perfume",
    "嵐", "Mr.Children", "サザンオールスターズ", "MISIA", "YUI",
    "西野カナ", "JUJU", "優里", "Saucy Dog", "マカロニえんぴつ",
  ],
  anime: [
    "LiSA", "Aimer", "ReoNa", "ClariS", "FLOW",
    "ASIAN KUNG-FU GENERATION", "UVERworld", "藍井エイル", "水樹奈々", "KANA-BOON",
    "緑黄色社会", "milet", "MYTH & ROID", "茅原実里", "fripSide",
    "EGOIST", "SawanoHiroyuki[nZk]", "キタニタツヤ", "yama", "Kroi",
    "UNISON SQUARE GARDEN", "GRANRODEO", "fhána", "OxT", "鈴木雅之",
  ],
  jrock: [
    "King Gnu", "RADWIMPS", "BUMP OF CHICKEN", "スピッツ", "ONE OK ROCK",
    "ヨルシカ", "ずっと真夜中でいいのに。", "美波", "凛として時雨", "サカナクション",
    "MAN WITH A MISSION", "back number", "SUPER BEAVER", "ポルノグラフィティ", "L'Arc~en~Ciel",
    "GLAY", "B'z", "ELLEGARDEN", "マキシマム ザ ホルモン", "THE ORAL CIGARETTES",
    "04 Limited Sazabys", "MY FIRST STORY", "WANIMA", "フジファブリック", "東京事変",
  ],
  vocaloid: [
    "DECO*27", "ピノキオピー", "wowaka", "supercell", "ハチ",
    "まふまふ", "Eve", "稲葉曇", "Giga", "Kanaria",
    "Orangestar", "いよわ", "Neru", "ナユタン星人", "sasakure.UK",
    "バルーン", "そらる", "天月", "Kairiki bear", "Mitchie M",
    "40mP", "OSTER project", "きくお", "ツミキ", "じん",
  ],
  citypop: [
    "山下達郎", "竹内まりや", "松原みき", "杏里", "大貫妙子",
    "角松敏生", "松任谷由実", "中森明菜", "菊池桃子", "中原めいこ",
    "松田聖子", "大滝詠一", "細野晴臣", "坂本龍一", "八神純子",
    "大橋純子", "泰葉", "間宮貴子", "高橋幸宏", "稲垣潤一",
  ],
  hiphop: [
    "Creepy Nuts", "ちゃんみな", "SIRUP", "清水翔太", "Kvi Baba",
    "ZORN", "PUNPEE", "Awich", "KREVA", "Nujabes",
    "BAD HOP", "RHYMESTER", "KICK THE CAN CREW", "m-flo", "RIP SLYME",
    "平井堅", "久保田利伸", "SALU", "LEX", "JP THE WAVY",
  ],
};

function decodeHtmlEntities(str) {
  return String(str || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#039;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .trim();
}

function extractBillboardJapanArtists(html) {
  return [...String(html || "").matchAll(/class="artist_name"[^>]*>([\s\S]*?)<\/p>/g)]
    .map((m) => decodeHtmlEntities(m[1].replace(/<[^>]+>/g, "")))
    .filter(Boolean);
}

function extractWikipediaBillboardArtists(json) {
  const html = json?.parse?.text?.["*"] || "";
  const tables = [...html.matchAll(/<table class="wikitable[^"]*">([\s\S]*?)<\/table>/g)].map((m) => m[1]);
  const out = [];
  for (const tbl of tables) {
    const rows = [...tbl.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
    for (const row of rows) {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
        decodeHtmlEntities(m[1].replace(/<[^>]+>/g, "").replace(/\[\d+\]/g, ""))
      );
      if (cells.length >= 3) {
        const cand = cells[cells.length - 1];
        if (cand && cand.length >= 2 && cand.length <= 40 && !/^\d+$/.test(cand) && !cand.includes("月") && !cand.includes("日")) {
          out.push(cand);
        }
      }
    }
  }
  return out.reverse();
}

const CHART_SOURCES = [
  {
    name: "itunes-songs",
    url: "https://itunes.apple.com/jp/rss/topsongs/limit=100/json",
    type: "json",
    extract: (json) => (json?.feed?.entry || []).map((e) => e?.["im:artist"]?.label),
  },
  {
    name: "billboard-japan",
    url: "https://www.billboard-japan.com/charts/detail?a=hot100",
    type: "text",
    extract: extractBillboardJapanArtists,
  },
  {
    name: "apple-rss-50",
    url: "https://rss.marketingtools.apple.com/api/v2/jp/music/most-played/50/songs.json",
    type: "json",
    extract: (json) => (json?.feed?.results || []).map((r) => r?.artistName),
  },
  {
    name: "wikipedia-billboard-jp",
    url: "https://ja.wikipedia.org/w/api.php?action=parse&page=Billboard_Japan_Hot_100&prop=text&format=json&origin=*",
    type: "json",
    extract: extractWikipediaBillboardArtists,
  },
  {
    name: "itunes-albums",
    url: "https://itunes.apple.com/jp/rss/topalbums/limit=50/json",
    type: "json",
    extract: (json) => (json?.feed?.entry || []).map((e) => e?.["im:artist"]?.label),
  },
];

async function fetchWithTimeout(url, responseType = "json", timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return responseType === "text" ? await res.text() : await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches and caches Japan Top Charts artists with multi-source fallback.
 * Shared across the MV3 service worker and extension options page.
 */
self.fetchJapanChartArtists = async function (force = false) {
  const CHART_KEY = "jpDojoChartArtists_v1";
  self.fetchJapanChartArtists.lastError = "";
  let cached = null;
  try {
    const obj = await chrome.storage.local.get(CHART_KEY);
    cached = obj[CHART_KEY] || null;
  } catch {
    cached = null;
  }

  if (!force && cached && Date.now() - cached.ts < 24 * 60 * 60 * 1000 && Array.isArray(cached.artists)) {
    return cached.artists;
  }

  const artists = new Set();
  const errors = [];

  for (const src of CHART_SOURCES) {
    try {
      const payload = await fetchWithTimeout(src.url, src.type, 10000);
      src.extract(payload).forEach((name) => {
        if (typeof name === "string" && /[\u3040-\u30ff\u4e00-\u9fafA-Za-z0-9]/.test(name)) {
          artists.add(name.trim());
        }
      });
      if (artists.size >= 15) break;
    } catch (err) {
      errors.push(`${src.name}: ${err?.message || "failed"}`);
    }
  }

  const list = [...artists];
  if (list.length) {
    try {
      await chrome.storage.local.set({ [CHART_KEY]: { ts: Date.now(), artists: list } });
    } catch {
      // storage failure shouldn't break returning fetched list
    }
    return list;
  }

  self.fetchJapanChartArtists.lastError = errors.join("; ");
  return Array.isArray(cached?.artists) ? cached.artists : [];
};
