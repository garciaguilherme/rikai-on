/**
 * RikaiUIImmersion — Standalone Reusable Module (Chrome Extension copy)
 * Replaces interface words with Japanese ONLY when the user has that word as Mature in Anki.
 */
((globalScope) => {
  const DEFAULT_GLOSSARY = [
    { jp: "ホーム", patterns: ["Início", "Home", "Inicio", "Accueil"] },
    { jp: "ゲーム", patterns: ["Jogos", "Games", "Juegos", "Jeux"] },
    { jp: "ドリル", patterns: ["Drills", "Treinos"] },
    { jp: "レポート", patterns: ["Relatórios", "Reports", "Reportes", "Rapports"] },
    { jp: "設定", patterns: ["Configurações", "Settings", "Configuración", "Paramètres"] },
    { jp: "一般", patterns: ["Geral", "General", "Général"] },
    { jp: "アーティスト", patterns: ["Artistas", "Artists", "Artistes"] },
    { jp: "保存", patterns: ["Salvar", "Save", "Guardar", "Enregistrer"] },
    { jp: "同期", patterns: ["Sincronizar", "Sync", "Synchroniser"] },
    { jp: "更新", patterns: ["Atualizar", "Refresh", "Actualizar", "Actualiser"] },
    { jp: "検索", patterns: ["Buscar", "Search", "Filtro", "Filter", "Filtrer"] },
    { jp: "開く", patterns: ["Abrir", "Open", "Ouvrir"] },
    { jp: "閉じる", patterns: ["Fechar", "Close", "Cerrar", "Fermer"] },
    { jp: "遊ぶ", patterns: ["Jogar", "Play", "Jugar", "Jouer"] },
    { jp: "言葉", patterns: ["Palavras", "Palavra", "Words", "Word", "Mots", "Mot"] },
    { jp: "漢字", patterns: ["Kanji", "Kanjis"] },
    { jp: "音楽", patterns: ["Músicas", "Música", "Music", "Songs", "Song", "Canciones", "Chansons"] },
    { jp: "字幕", patterns: ["Legendas", "Legenda", "Subtitles", "Subtitle", "Subtítulos", "Sous-titres"] },
    { jp: "歌詞", patterns: ["Letras", "Letra", "Lyrics", "Paroles"] },
    { jp: "サビ", patterns: ["Refrão", "Chorus", "Estribillo", "Refrain"] },
    { jp: "速度", patterns: ["Velocidade", "Speed", "Velocidad", "Vitesse"] },
    { jp: "言語", patterns: ["Idioma", "Language", "Langue"] },
    { jp: "テーマ", patterns: ["Temas", "Tema", "Themes", "Theme", "Thème"] },
    { jp: "日本", patterns: ["Japão", "Japan", "Japón", "Japon"] },
    { jp: "今日", patterns: ["Hoje", "Today", "Hoy", "Aujourd'hui"] },
    { jp: "時間", patterns: ["Tempo", "Time", "Tiempo", "Temps"] },
    { jp: "学習", patterns: ["Aprendendo", "Learning", "Estudos", "Study"] },
    { jp: "成熟", patterns: ["Maduros", "Maduras", "Mature", "Maturidade", "Maturity"] },
    { jp: "難しい", patterns: ["Difíceis", "Difícil", "Hard", "Difficiles"] },
    { jp: "既知", patterns: ["Conhecidas", "Conhecida", "Known", "Conocidas", "Connus"] },
    { jp: "動画", patterns: ["Vídeo", "Video", "Vidéo"] },
    { jp: "行", patterns: ["Linhas", "Linha", "Lines", "Line", "Líneas", "Línea", "Lignes", "Ligne", "Verso"] },
    { jp: "日本語", patterns: ["Japonês", "Japonesa", "Japanese", "Japonés", "Japonaise"] },
    { jp: "ループ", patterns: ["Loop", "Bucle", "Boucle"] },
    { jp: "読み込み", patterns: ["Carregando", "Loading", "Cargando", "Chargement"] },
  ];

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  let cachedKey = null;
  let cachedCompiler = null;

  function getCompiler(matureSet) {
    // Cache compiled single-pass regexes for the current matureSet size & identity
    const cacheSig = `${matureSet.size}`;
    if (cachedCompiler && cachedCompiler.ref === matureSet && cachedKey === cacheSig) {
      return cachedCompiler;
    }

    const bilingualMap = new Map();
    const bilingualParts = [];
    const wordMap = new Map();
    const wordParts = [];

    for (const entry of DEFAULT_GLOSSARY) {
      if (!matureSet.has(entry.jp)) continue;
      for (const pat of entry.patterns) {
        const biKey = `${pat.toLowerCase()} / ${entry.jp}`;
        if (!bilingualMap.has(biKey)) {
          bilingualMap.set(biKey, entry.jp);
          bilingualParts.push(`${escapeRegex(pat)}\\s*\\/\\s*${escapeRegex(entry.jp)}`);
        }
        const wKey = pat.toLowerCase();
        if (!wordMap.has(wKey)) {
          wordMap.set(wKey, entry.jp);
          wordParts.push(escapeRegex(pat));
        }
      }
    }

    bilingualParts.sort((a, b) => b.length - a.length);
    wordParts.sort((a, b) => b.length - a.length);

    cachedKey = cacheSig;
    cachedCompiler = {
      ref: matureSet,
      bilingualRe: bilingualParts.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${bilingualParts.join("|")})(?![\\p{L}\\p{N}])`, "giu") : null,
      wordRe: wordParts.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${wordParts.join("|")})(?![\\p{L}\\p{N}])`, "giu") : null,
      bilingualMap,
      wordMap,
    };
    return cachedCompiler;
  }

  function immersionizeText(text, matureSet, enabled = true) {
    if (!enabled || !text || !matureSet || matureSet.size === 0) return text;
    const comp = getCompiler(matureSet);
    let result = text;
    if (comp.bilingualRe) {
      result = result.replace(comp.bilingualRe, (m) => {
        const norm = m.toLowerCase().replace(/\s*\/\s*/, " / ");
        return comp.bilingualMap.get(norm) || m;
      });
    }
    if (comp.wordRe) {
      result = result.replace(comp.wordRe, (m) => comp.wordMap.get(m.toLowerCase()) || m);
    }
    return result;
  }

  function applyToDOM(root, matureWords, enabled = true) {
    if (!root) return;
    const matureSet = matureWords instanceof Set ? matureWords : new Set(matureWords || []);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || tag === "INPUT" || tag === "CODE") {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.closest(".jp-dojo-text, #jp-dojo-video-subtitle, .lyrics-scroll")) {
          return NodeFilter.FILTER_REJECT;
        }
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const nodes = [];
    let cur;
    while ((cur = walker.nextNode())) nodes.push(cur);

    nodes.forEach((node) => {
      if (node._rikaiOrigText === undefined) {
        node._rikaiOrigText = node.nodeValue;
      }
      node.nodeValue = enabled
        ? immersionizeText(node._rikaiOrigText, matureSet, true)
        : node._rikaiOrigText;
    });
  }

  globalScope.RikaiUIImmersion = {
    GLOSSARY: DEFAULT_GLOSSARY,
    immersionizeText,
    applyToDOM,
  };
})(typeof window !== "undefined" ? window : globalThis);
