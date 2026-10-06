'use strict';

const { app, BrowserWindow, ipcMain, screen, Menu, globalShortcut, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const config = require('./config.json');
const { fetchAQI } = require('./fetcher');

const STATE_PATH = path.join(__dirname, 'state.json');

let win = null;
let tray = null;
let timer = null;
let busy = false;
let clickThrough = config.clickThrough === true;
let lastGood = null;
let visible = loadState();

const TOGGLE_CT_SHORTCUT = 'CommandOrControl+Alt+A';
const REFRESH_SHORTCUT = 'CommandOrControl+Alt+R';
const TOGGLE_VISIBLE_SHORTCUT = 'CommandOrControl+Alt+H';

function log(...args) {
  console.log('[aqi]', ...args);
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return parsed.visible !== false;
  } catch (err) {
    return true;
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify({ visible }, null, 2));
  } catch (err) {
    log('save state failed:', err.message);
  }
}

function statusLabel() {
  if (!lastGood) return 'AQI: loading…';
  return 'US AQI ' + lastGood.aqi + ' · ' + lastGood.category.label;
}

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: visible ? 'Hide widget' : 'Show widget', click: () => toggleVisibility() },
    { label: statusLabel(), enabled: false },
    { label: 'Refresh now', click: () => refresh('tray') },
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

function positionWindow(target) {
  const area = screen.getPrimaryDisplay().workArea;
  const inset = Number(config.inset) || 16;
  const w = target.getBounds().width;
  const h = target.getBounds().height;
  let x = area.x + area.width - w - inset;
  let y = area.y + area.height - h - inset;
  if (config.position === 'top-right') y = area.y + inset;
  target.setPosition(Math.round(x), Math.round(y));
}

function createWindow() {
  const transparent = config.transparent !== false;
  win = new BrowserWindow({
    width: Number(config.width) || 208,
    height: Number(config.height) || 96,
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

  win.webContents.on('console-message', (_e, level, message) => {
    if (level <= 2) log('renderer:', message);
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'ignore' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function send(payload) {
  if (win && !win.isDestroyed()) {
    payload.settings = {
      staleMinutes: Number(config.staleMinutes) || 20,
      timeZone: config.timeZone || 'Asia/Kuala_Lumpur'
    };
    const shown = payload.data || payload.lastGood;
    const color = shown ? shown.category.color : '#374151';
    try {
      win.setBackgroundColor(color);
    } catch (err) {
      log('setBackgroundColor failed:', err.message);
    }
    win.webContents.send('aqi', payload);
  }
}

async function refresh(reason) {
  if (busy) return;
  busy = true;
  const startedAt = Date.now();
  try {
    const data = await fetchAQI();
    lastGood = data;
    log('ok source=' + data.source, 'aqi=' + data.aqi, 'pm25=' + data.pm25, 'via=' + reason);
    updateTray();
    send({ ok: true, data, lastGood });
  } catch (err) {
    log('failed via=' + reason + ':', err.message);
    send({ ok: false, error: err.message, lastGood });
  } finally {
    busy = false;
  }
}

function schedule() {
  if (timer) clearInterval(timer);
  const every = (Number(config.refreshMinutes) || 10) * 60 * 1000;
  timer = setInterval(() => refresh('interval'), every);
}

function toggleClickThrough() {
  clickThrough = !clickThrough;
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(clickThrough, { forward: true });
  }
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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    setVisible(true);
  });

  app.whenReady().then(() => {
    createWindow();
    createTray();
    registerShortcuts();
    schedule();
    log('started, visible=' + visible);
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
  ok: Boolean(lastGood),
  data: lastGood || null,
  lastGood,
  settings: {
    staleMinutes: Number(config.staleMinutes) || 20,
    timeZone: config.timeZone || 'Asia/Kuala_Lumpur'
  }
}));
ipcMain.handle('quit', () => app.quit());
ipcMain.handle('toggle-clickthrough', () => toggleClickThrough());
ipcMain.handle('toggle-visibility', () => {
  toggleVisibility();
  return visible;
});
ipcMain.handle('get-visible', () => visible);
