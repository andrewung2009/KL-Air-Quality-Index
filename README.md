# KL Air Quality Index — Desktop Overlay

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Electron](https://img.shields.io/badge/Electron-33-blue)
![Node](https://img.shields.io/badge/Node-%3E%3D18-green)

A tiny always-on-top Windows widget that shows the live **US AQI for Kuala Lumpur** — no API
key, no account, no browser tab. Data is read from IQAir's public page and refreshed every
10 minutes, with automatic fallbacks if the page is rate-limited.

![Widget screenshot](assets/screenshot.png)

## Features

- **Always on top** — pinned to the bottom-right corner, draggable, frameless 224×96 card
- **Live US AQI + PM2.5** with colour-coded category (Good → Hazardous) and local time
- **No API key** — scrapes the IQAir observation from the public page's structured data
- **Resilient fetch chain** — IQAir → jina reader proxy → Open-Meteo (clearly labelled `est.`)
- **System tray icon** — hide/show, live reading, *Refresh now*, quit
- **Hotkeys** — toggle visibility, toggle click-through, force refresh (work even while hidden)
- **Remembers state** — stays hidden or visible across restarts (`state.json`)
- **Single instance** — relaunching shows the existing widget instead of a second copy
- **Optional auto-start** — drop the shortcut into `shell:startup`

## Quick start

Requirements: **Node.js ≥ 18** (uses built-in `fetch`) and Windows.

```bash
git clone https://github.com/andrewung2009/KL-Air-Quality-Index.git
cd KL-Air-Quality-Index
npm install
npm start
```

Sanity-check the data pipeline on its own:

```bash
npm run test:fetch
```

## Hotkeys

| Shortcut | Action |
| --- | --- |
| `Ctrl+Alt+H` | Hide / show the widget (works even while hidden) |
| `Ctrl+Alt+A` | Toggle click-through (mouse passes to windows underneath) |
| `Ctrl+Alt+R` | Refresh now |

Right-clicking the widget opens a menu (Refresh, Hide, click-through, Quit), and the tray
icon offers the same controls plus the current reading.

## Data sources

The fetcher tries each source in order until one succeeds (3 attempts with jittered backoff
on the first source):

1. **IQAir page** (primary) — parses the `ld+json` `Observation` node for US AQI and PM2.5.
   Detected and skipped when IQAir returns `429` or its bot-challenge page.
2. **`r.jina.ai` reader** — fetches the same page through a text-extraction proxy.
3. **Open-Meteo Air Quality API** — modelled estimate, shown with an `est.` badge so you
   always know when the number is not a measurement.

Categories follow the **US AQI** breakpoints (Good 0–50 → Hazardous 301+), each with its
standard colour and an accessibility-safe text contrast.

## Configuration

Edit `config.json` (restart to apply):

| Key | Default | Meaning |
| --- | --- | --- |
| `url` | IQAir Kuala Lumpur | Page to read |
| `refreshMinutes` | `10` | Refresh cadence |
| `staleMinutes` | `20` | After this, the reading is flagged stale |
| `position` | `bottom-right` | Anchor corner |
| `inset` | `16` | Distance from the screen edge (px) |
| `width` / `height` | `224` / `96` | Widget size |
| `timeZone` | `Asia/Kuala_Lumpur` | Timestamps shown in this zone |
| `fallbacks` | `true` | Enable the jina / Open-Meteo chain |
| `clickThrough` | `false` | Start in click-through mode |
| `transparent` / `focusable` | `false` / `true` | Window rendering options |

Runtime state (visibility preference) lives in `state.json` beside it.

## Building the standalone Windows app

The packaged build is a plain folder with an `Electron.exe` renamed to `KL AQI.exe` — it is
**not** committed (binaries exceed GitHub's 100 MB limit). To rebuild:

```bash
# 1. Extract the Electron runtime (cached by npm install)
#    %LOCALAPPDATA%\electron\Cache\...\electron-vXX-win32-x64.zip  →  "KL AQI\"

# 2. Copy the app files into  "KL AQI\resources\app\"
#    package.json main.js preload.js renderer.js fetcher.js index.html styles.css config.json tray.png

# 3. Rename  electron.exe  →  "KL AQI.exe"  and stamp icon + metadata
npx rcedit "KL AQI\KL AQI.exe" --set-icon icon.ico \
  --set-version-string ProductName "KL AQI" \
  --set-file-version 1.0.0.0 --set-product-version 1.0.0.0
```

> Note: `electron-packager` currently fails silently on Node 26 (its `extract-zip` dependency
> dies mid-extraction), which is why the manual steps above are used.

## Project structure

```
aqi-overlay/
├── main.js          # BrowserWindow, tray, scheduler, hotkeys, IPC
├── fetcher.js       # 3-source fetch chain + AQI classification
├── renderer.js      # DOM updates for ok / loading / error / stale states
├── preload.js       # Context-isolated bridge (onUpdate, getState, …)
├── index.html       # Widget markup
├── styles.css       # Colour-coded card layout
├── config.json      # User configuration
├── debug_capture.js # Offscreen renderer → assets/screenshot.png
├── icon.ico         # App icon (multi-size, PNG-compressed)
└── tray.png         # 16×16 tray icon
```

## License

[MIT](LICENSE) © 2026 andrewung2009
