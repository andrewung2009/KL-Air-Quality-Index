'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  Menu,
  globalShortcut,
  Tray,
  nativeImage,
  powerMonitor
} = require('electron');
const path = require('path');
const fs = require('fs');
const { loadConfig, POSITIONS } = require('./defaults');
const { fetchAQI } = require('./fetcher');

const LEGACY_STATE_PATH = path.join(__dirname, 'state.json');
const STATE_PATH = path.join(app.getPath('userData'), 'state.json');
const LOG_PATH = path.join(app.getPath('userData'), 'app.log');

const POSITION_LABELS = {
  'bottom-right': 'Bottom right',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'top-left': 'Top left'
};
const INTERVAL_OPTIONS = [5, 10, 15, 30];
const MANUAL_REASONS = ['manual', 'shortcut', 'tray', 'renderer', 'second-instance'];

const TOGGLE_CT_SHORTCUT = 'CommandOrControl+Alt+A';
const REFRESH_SHORTCUT = 'CommandOrControl+Alt+R';
const TOGGLE_VISIBLE_SHORTCUT = 'CommandOrControl+Alt+H';

let win = null;
let tray = null;
let timer = null;
let busy = false;
let pendingRefresh = null;
let lastAttemptAt = 0;
let lastError = null;
let lastGood = null;
let visible = true;
let clickThrough = false;
let overrides = {};

const initialState = readState();
const loaded = loadConfig(__dirname, initialState.overrides);
const config = loaded.config;
visible = initialState.visible;
clickThrough = typeof initialState.clickThrough === 'boolean' ? initialState.clickThrough : config.clickThrough;
lastGood = initialState.lastGood;
overrides = initialState.overrides;

function log(...args) {
  try {
    const line = new Date().toISOString() + ' ' + args.join(' ');
    console.log('[aqi]', line);
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch (err) {
    // logging must never throw
  }
}

function isReading(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      Number.isFinite(Number(value.aqi)) &&
      value.category &&
      typeof value.category.color === 'string' &&
      typeof value.source === 'string'
  );
}

function readState() {
  const empty = { visible: true, clickThrough: null, lastGood: null, overrides: {} };
  let raw = null;
  try {
    raw = fs.readFileSync(STATE_PATH, 'utf8').replace(/^\uFEFF/, '');
  } catch (err) {
    try {
      raw = fs.readFileSync(LEGACY_STATE_PATH, 'utf8').replace(/^\uFEFF/, '');
    } catch (err2) {
      return empty;
    }
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return empty;
    return {
      visible: parsed.visible !== false,
      clickThrough: typeof parsed.clickThrough === 'boolean' ? parsed.clickThrough : null,
      lastGood: isReading(parsed.lastGood) ? parsed.lastGood : null,
      overrides:
        parsed.overrides && typeof parsed.overrides === 'object' && !Array.isArray(parsed.overrides)
          ? parsed.overrides
          : {}
    };
  } catch (err) {
    log('state.json unreadable (' + err.message + '); starting fresh');
    return empty;
  }
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(
      STATE_PATH,
      JSON.stringify({ visible, clickThrough, overrides, lastGood }, null, 2)
    );
  } catch (err) {
    log('save state failed:', err.message);
  }
}

function currentSettings() {
  return {
    staleMinutes: config.staleMinutes,
    timeZone: config.timeZone,
    clickThrough
  };
}

function statusLabel() {
  if (!lastGood) return lastError ? 'AQI: unavailable' : 'AQI: loading…';
  const base = 'US AQI ' + lastGood.aqi + ' · ' + lastGood.category.label;
  return lastError ? base + ' (stale)' : base;
}

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: visible ? 'Hide widget' : 'Show widget', click: () => toggleVisibility() },
    { label: statusLabel(), enabled: false },
    { label: 'Refresh now', click: () => refresh('tray') },
    { label: 'Click-through: ' + (clickThrough ? 'on' : 'off'), click: () => toggleClickThrough() },
    { type: 'separator' },
    {
      label: 'Position',
      submenu: POSITIONS.map((value) => ({
        label: POSITION_LABELS[value],
        type: 'radio',
        checked: config.position === value,
        click: () => setPosition(value)
      }))
    },
    {
      label: 'Refresh every',
      submenu: INTERVAL_OPTIONS.map((minutes) => ({
        label: minutes + ' minutes',
        type: 'radio',
        checked: Number(config.refreshMinutes) === minutes,
        click: () => setRefreshMinutes(minutes)
      }))
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
}

function updateTray() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(trayMenu());
  tray.setToolTip(statusLabel());
}

function createTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.setContextMenu(trayMenu());
    tray.setToolTip(statusLabel());
    tray.on('click', () => toggleVisibility());
    log('tray created');
  } catch (err) {
    log('tray creation failed:', err.message);
    tray = null;
  }
}

function setVisible(value) {
  visible = value;
  if (win && !win.isDestroyed()) {
    if (visible) {
      win.show();
      positionWindow(win);
    } else {
      win.hide();
    }
  }
  saveState();
  updateTray();
  log('visible:', visible);
}

function toggleVisibility() {
  setVisible(!visible);
}

function setPosition(value) {
  if (!POSITIONS.includes(value)) return;
  config.position = value;
  overrides.position = value;
  saveState();
  if (win && !win.isDestroyed()) positionWindow(win);
  updateTray();
  log('position:', value);
}

function setRefreshMinutes(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value < 1) return;
  config.refreshMinutes = value;
  overrides.refreshMinutes = value;
  saveState();
  schedule();
  updateTray();
  log('refreshMinutes:', value);
}

function positionWindow(target) {
  if (!target || target.isDestroyed()) return;
  const area = screen.getPrimaryDisplay().workArea;
  const inset = Number.isFinite(Number(config.inset)) ? Number(config.inset) : 16;
  const bounds = target.getBounds();
  const right = config.position.endsWith('right');
  const bottom = config.position.startsWith('bottom');
  const x = right ? area.x + area.width - bounds.width - inset : area.x + inset;
  const y = bottom ? area.y + area.height - bounds.height - inset : area.y + inset;
  target.setPosition(Math.round(x), Math.round(y));
}

function reposition() {
  if (win && !win.isDestroyed()) positionWindow(win);
}

function createWindow() {
  const transparent = config.transparent === true;
  win = new BrowserWindow({
    width: config.width,
    height: config.height,
    x: 0,
    y: 0,
    frame: false,
    transparent,
    backgroundColor: transparent ? '#00000000' : '#4b5563',
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: config.focusable === true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  positionWindow(win);
  win.setIgnoreMouseEvents(clickThrough, { forward: true });

  win.loadFile('index.html');
  win.once('ready-to-show', () => {
    if (visible) {
      win.show();
    } else {
      log('started hidden (state.json)');
    }
  });

  win.webContents.on('context-menu', () => {
    if (clickThrough) return;
    const menu = Menu.buildFromTemplate([
      { label: 'Refresh now', click: () => refresh('manual') },
      { label: 'Hide widget', click: () => setVisible(false) },
      {
        label: 'Click-through: ' + (clickThrough ? 'on' : 'off'),
        click: () => toggleClickThrough()
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ]);
    menu.popup({ window: win });
  });

  win.webContents.on('did-finish-load', () => {
    log('renderer loaded');
    refresh('did-finish-load');
  });

  win.webContents.on('render-process-gone', (_e, details) => {
    log('renderer gone:', details && details.reason);
    if (!details || details.reason !== 'clean-exit') {
      setTimeout(() => {
        if (win && !win.isDestroyed()) win.reload();
      }, 500);
    }
  });

  win.webContents.on('console-message', (_e, level, message) => {
    log('renderer[' + level + ']:', message);
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'ignore' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => {
    win = null;
  });
}

function send() {
  if (!win || win.isDestroyed()) return;
  const payload = {
    ok: !lastError && Boolean(lastGood),
    error: lastError,
    data: lastGood,
    lastGood,
    settings: currentSettings()
  };
  let color = '#4b5563';
  if (lastGood && lastGood.category) color = lastGood.category.color;
  else if (lastError) color = '#374151';
  try {
    win.setBackgroundColor(color);
  } catch (err) {
    log('setBackgroundColor failed:', err.message);
  }
  win.webContents.send('aqi', payload);
}

async function refresh(reason) {
  if (busy) {
    pendingRefresh = reason;
    return;
  }
  busy = true;
  lastAttemptAt = Date.now();
  const bypassCircuit = MANUAL_REASONS.includes(reason);
  try {
    const data = await fetchAQI({ bypassCircuit });
    lastGood = data;
    lastError = null;
    log('ok source=' + data.source, 'aqi=' + data.aqi, 'pm25=' + data.pm25, 'via=' + reason);
    saveState();
    updateTray();
    send();
  } catch (err) {
    lastError = err.message;
    log('failed via=' + reason + ':', err.message);
    updateTray();
    send();
  } finally {
    busy = false;
    if (pendingRefresh) {
      const next = pendingRefresh;
      pendingRefresh = null;
      setImmediate(() => refresh(next));
    }
  }
}

function schedule() {
  if (timer) clearInterval(timer);
  const every = (Number(config.refreshMinutes) || 10) * 60 * 1000;
  timer = setInterval(() => {
    const lateBy = Date.now() - lastAttemptAt;
    refresh(lateBy > every + 60000 ? 'catch-up' : 'interval');
  }, every);
}

function toggleClickThrough(force) {
  clickThrough = typeof force === 'boolean' ? force : !clickThrough;
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(clickThrough, { forward: true });
  }
  saveState();
  updateTray();
  send();
  log('click-through:', clickThrough);
}

function registerShortcuts() {
  const pairs = [
    [TOGGLE_CT_SHORTCUT, () => toggleClickThrough()],
    [REFRESH_SHORTCUT, () => refresh('shortcut')],
    [TOGGLE_VISIBLE_SHORTCUT, () => toggleVisibility()]
  ];
  for (const [accelerator, handler] of pairs) {
    try {
      if (!globalShortcut.register(accelerator, handler)) {
        log('shortcut already in use:', accelerator);
      }
    } catch (err) {
      log('shortcut registration failed:', accelerator, err.message);
    }
  }
}

process.on('uncaughtException', (err) => {
  log('uncaughtException:', (err && err.stack) || err);
});
process.on('unhandledRejection', (reason) => {
  log('unhandledRejection:', (reason && reason.stack) || reason);
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    setVisible(true);
    refresh('second-instance');
  });

  app.whenReady().then(() => {
    for (const warning of loaded.warnings) log('config:', warning);
    createWindow();
    createTray();
    registerShortcuts();
    schedule();
    saveState();
    powerMonitor.on('resume', () => {
      log('system resume, refreshing');
      refresh('resume');
    });
    screen.on('display-added', reposition);
    screen.on('display-removed', reposition);
    screen.on('display-metrics-changed', reposition);
    log(
      'started, visible=' + visible,
      'position=' + config.position,
      'refresh=' + config.refreshMinutes + 'm',
      'clickThrough=' + clickThrough,
      lastGood ? 'cachedAQI=' + lastGood.aqi : 'no cached reading'
    );
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('will-quit', () => {
    if (timer) clearInterval(timer);
    globalShortcut.unregisterAll();
    if (tray && !tray.isDestroyed()) tray.destroy();
  });
}

ipcMain.handle('refresh-now', () => refresh('renderer'));
ipcMain.handle('get-state', () => ({
  ok: !lastError && Boolean(lastGood),
  error: lastError,
  data: lastGood,
  lastGood,
  settings: currentSettings()
}));
ipcMain.handle('quit', () => app.quit());
ipcMain.handle('toggle-clickthrough', () => {
  toggleClickThrough();
  return clickThrough;
});
ipcMain.handle('toggle-visibility', () => {
  toggleVisibility();
  return visible;
});
ipcMain.handle('get-visible', () => visible);
