# Rikai On // 理解ON

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/C0C62BIE0)

Synchronize Japanese song lyrics on YouTube with real-time **AnkiConnect** vocabulary highlights (`Leech`, `Hard`, `Young`, `Mature`), comprehension stats, favorites, and smart Japanese music mining.

- **Homepage:** https://garciaguilherme.github.io/rikai-on/
- **Privacy Policy:** https://garciaguilherme.github.io/rikai-on/privacy.html
- **Support on Ko-fi:** https://ko-fi.com/C0C62BIE0

---

## Features

- **Live Synchronized Lyrics & Smart Fallbacks:** Fetches synced Japanese LRC lyrics from **LRCLIB**, with automatic validated fallbacks to **Kugou Music**, **NetEase Cloud Music**, and YouTube's own Japanese captions (supports covers and dual-language titles), showing the active lyrics source inside the panel.
- **Real-Time Anki Highlights:** Connects locally to desktop Anki via **AnkiConnect** (`http://127.0.0.1:8765`, add-on code `2055492159`) — no third-party account or external server required.
- **Click-to-Mark Known & Sync Controls:** Click (or press `Enter`/`Space`) on any word to toggle known status, adjust timing (`-2s`, `-0.5s`, `0.0s`, `+0.5s`, `+2s`, `1st = Now`), loop lines, or filter only leeches.
- **Music Mining Popup, ★ Favorites & Artist Filter:** Rank Japanese songs by **Comprehensible (%)** or **Leeches + Hard**, include cached & discovered non-automatic YouTube Japanese captions, bookmark favorite tracks (`★ Favorites`), filter by artist, and launch instant YouTube playlists.
- **14+ Themes, Custom Studio & 5 Languages:** Includes Rikai Red, Catppuccin (Mocha & Latte), Dracula, Nord, Gruvbox Dark, Tokyo Night, Rosé Pine, Vocaloid Cyber, Sakura Nocturne, Neo-Tokyo 01, Sumi-e Washi, YouTube Native, plus live Custom Theme editing in English, Português, Español, 日本語, and Français.

---

## Local Installation (Developer Mode)

1. Install [Anki](https://apps.ankiweb.net/) and the **AnkiConnect** add-on (`2055492159`).
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select the [`chrome-extension`](./chrome-extension) directory.
4. Open any Japanese music video on YouTube to see the **Rikai On** lyric panel and floating subtitle overlay.
