/**
 * Main-world YouTube helper for Rikai On.
 * Captures player-authenticated /api/timedtext responses and triggers Japanese caption loading when needed.
 */
(() => {
  if (window.__rikaiOnYtMainLoaded) return;
  window.__rikaiOnYtMainLoaded = true;

  const MSG_SOURCE = "rikai-on-yt";
  const recentTimedText = [];
  let ensurePromise = null;

  function emit(payload) {
    window.postMessage({ source: MSG_SOURCE, ...payload }, window.location.origin);
  }

  function recordTimedText(url, body) {
    if (!url || !body || !String(url).includes("/api/timedtext")) return;
    const strBody = typeof body === "string" ? body : "";
    if (!strBody.trim()) return;
    const entry = { url: String(url), body: strBody };
    recentTimedText.push(entry);
    if (recentTimedText.length > 12) recentTimedText.shift();
    emit({ type: "TIMEDTEXT_DATA", url: entry.url, body: entry.body });
  }

  // Intercept player fetch() calls for /api/timedtext
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (...args) {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      const p = origFetch.apply(this, args);
      if (String(url).includes("/api/timedtext")) {
        p.then((res) => {
          if (res && res.ok) {
            return res.clone().text().then((txt) => recordTimedText(res.url || url, txt));
          }
        }).catch(() => {});
      }
      return p;
    };
  }

  // Intercept player XMLHttpRequest calls for /api/timedtext
  const OrigXhrOpen = XMLHttpRequest.prototype.open;
  const OrigXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__rikaiUrl = typeof url === "string" ? url : String(url || "");
    return OrigXhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (this.__rikaiUrl && this.__rikaiUrl.includes("/api/timedtext")) {
      this.addEventListener(
        "load",
        () => {
          try {
            let txt = "";
            if (typeof this.response === "string") {
              txt = this.response;
            } else if (this.response instanceof ArrayBuffer) {
              txt = new TextDecoder("utf-8").decode(this.response);
            } else if (this.response && typeof this.response === "object") {
              txt = JSON.stringify(this.response);
            }
            recordTimedText(this.responseURL || this.__rikaiUrl, txt);
          } catch {
            // ignore XHR decode issues
          }
        },
        { once: true }
      );
    }
    return OrigXhrSend.apply(this, args);
  };

  function getJapaneseTrack() {
    const player = document.getElementById("movie_player");
    let tracks = null;
    try {
      tracks = player?.getPlayerResponse?.()?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    } catch {
      tracks = null;
    }
    if (!Array.isArray(tracks) || !tracks.length) {
      try {
        tracks = window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      } catch {
        tracks = null;
      }
    }
    if (!Array.isArray(tracks) || !tracks.length) {
      try {
        tracks = player?.getOption?.("captions", "tracklist");
      } catch {
        tracks = null;
      }
    }
    if (!Array.isArray(tracks)) return null;
    return (
      tracks.find((t) => String(t.languageCode || "").toLowerCase().startsWith("ja") && t.kind !== "asr") ||
      tracks.find((t) => String(t.languageCode || "").toLowerCase().startsWith("ja")) ||
      null
    );
  }

  function hasCapturedJaForVideo(videoId) {
    return recentTimedText.some(
      (e) =>
        (!videoId || e.url.includes(videoId)) &&
        /([?&])lang=ja/i.test(e.url) &&
        !/([?&])tlang=/i.test(e.url)
    );
  }

  async function ensureJapaneseCaptions(videoId) {
    if (hasCapturedJaForVideo(videoId)) {
      for (const item of recentTimedText) {
        if ((!videoId || item.url.includes(videoId)) && /([?&])lang=ja/i.test(item.url)) {
          emit({ type: "TIMEDTEXT_DATA", url: item.url, body: item.body });
        }
      }
      return;
    }
    if (ensurePromise) return ensurePromise;

    ensurePromise = (async () => {
      const player = document.getElementById("movie_player");
      const subBtn = document.querySelector(".ytp-subtitles-button");
      const wasPressed = subBtn?.getAttribute("aria-pressed") === "true";
      const jaTrack = getJapaneseTrack();
      if (!jaTrack && !subBtn) return;

      try {
        try {
          player?.loadModule?.("captions");
        } catch {
          // ignore
        }

        if (jaTrack && player?.setOption) {
          const trackOpt = {
            languageCode: jaTrack.languageCode,
            ...(jaTrack.vssId ? { vssId: jaTrack.vssId } : {}),
            ...(jaTrack.kind ? { kind: jaTrack.kind } : {}),
          };
          try {
            player.setOption("captions", "track", trackOpt);
          } catch {
            // ignore
          }
        }

        if (subBtn && !subBtn.disabled && subBtn.getAttribute("aria-pressed") === "false") {
          subBtn.click();
          await new Promise((r) => setTimeout(r, 150));
          if (jaTrack && player?.setOption) {
            try {
              player.setOption("captions", "track", {
                languageCode: jaTrack.languageCode,
                ...(jaTrack.vssId ? { vssId: jaTrack.vssId } : {}),
                ...(jaTrack.kind ? { kind: jaTrack.kind } : {}),
              });
            } catch {
              // ignore
            }
          }
        }

        const deadline = Date.now() + 2600;
        while (Date.now() < deadline && !hasCapturedJaForVideo(videoId)) {
          await new Promise((r) => setTimeout(r, 120));
        }
      } finally {
        if (!wasPressed) {
          if (subBtn && subBtn.getAttribute("aria-pressed") === "true") {
            subBtn.click();
          }
          try {
            player?.unloadModule?.("captions");
          } catch {
            // ignore
          }
        }
        ensurePromise = null;
      }
    })();

    return ensurePromise;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== MSG_SOURCE) return;
    if (event.data.type === "RIKAI_READY") {
      for (const item of recentTimedText) {
        emit({ type: "TIMEDTEXT_DATA", url: item.url, body: item.body });
      }
    } else if (event.data.type === "ENSURE_JA_CAPTIONS") {
      ensureJapaneseCaptions(event.data.videoId || "");
    }
  });
})();
