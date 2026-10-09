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
  powerMonitor,
  Notification
} = require('electron');
const path = require('path');
const fs = require('fs');
const { loadConfig, POSITIONS, DEFAULTS, OVERRIDE_KEYS } = require('./defaults');
const { fetchAQI, fetchForecast, configure: configureFetcher } = require('./fetcher');

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

const CONFIG_PATH = path.join(__dirname, 'config.json');
const STARTUP_LNK_PATH = path.join(
  process.env.APPDATA || '',
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  'Startup',
  'KL AQI.lnk'
);
const SOURCE_LABELS = { iqair: 'IQAir', proxy: 'proxy', est: 'est.' };

app.setAppUserModelId('andrewung2009.kl-aqi');

let win = null;
let tray = null;
let settingsWin = null;
let timer = null;
let busy = false;
let pendingRefresh = null;
let lastAttemptAt = 0;
let lastError = null;
let lastGood = null;
let visible = true;
let clickThrough = false;
let overrides = {};
let forecast = null;
let lastNotified = null;
let forecastTask = null;

const initialState = readState();
const loaded = loadConfig(__dirname, initialState.overrides);
const config = loaded.config;
visible = initialState.visible;
clickThrough = typeof initialState.clickThrough === 'boolean' ? initialState.clickThrough : config.clickThrough;
lastGood = initialState.lastGood;
overrides = initialState.overrides;
forecast = initialState.forecast;
lastNotified = initialState.lastNotified;

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

function isForecast(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof value.date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
      Number.isFinite(Number(value.high)) &&
      Number.isFinite(Number(value.low))
  );
}

function isLastNotified(value) {
  return Boolean(value && typeof value === 'object' && typeof value.category === 'string');
}

function readState() {
  const empty = {
    visible: true,
    clickThrough: null,
    lastGood: null,
    overrides: {},
    forecast: null,
    lastNotified: null
  };
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
      forecast: isForecast(parsed.forecast) ? parsed.forecast : null,
      lastNotified: isLastNotified(parsed.lastNotified) ? parsed.lastNotified : null,
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
      JSON.stringify({ visible, clickThrough, overrides, lastGood, forecast, lastNotified }, null, 2)
    );
  } catch (err) {
    log('save state failed:', err.message);
  }
}

function currentSettings() {
  return {
    staleMinutes: config.staleMinutes,
    timeZone: config.timeZone,
    clickThrough,
    forecast: config.forecast,
    notifications: config.notifications
  };
}

function buildPayload() {
  return {
    ok: !lastError && Boolean(lastGood),
    error: lastError,
    data: lastGood,
    lastGood,
    forecast,
    settings: currentSettings()
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
    { label: 'Settings…', click: () => openSettings() },
    { label: 'Notifications: ' + (config.notifications ? 'on' : 'off'), click: () => toggleNotifications() },
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

let lastMenuAt = 0;

function popupWidgetMenu() {
  const now = Date.now();
  if (now - lastMenuAt < 500) return;
  if (clickThrough || !win || win.isDestroyed()) return;
  lastMenuAt = now;
  const menu = Menu.buildFromTemplate([
    { label: 'Refresh now', click: () => refresh('manual') },
    { label: 'Hide widget', click: () => setVisible(false) },
    {
      label: 'Click-through: ' + (clickThrough ? 'on' : 'off'),
      click: () => toggleClickThrough()
    },
    { label: 'Settings…', click: () => openSettings() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  if (!win.isFocused()) win.focus();
  log('widget menu opened');
  menu.popup({ window: win });
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

  win.on('system-context-menu', (event) => {
    event.preventDefault();
    setImmediate(() => popupWidgetMenu());
  });

  win.webContents.on('context-menu', () => {
    popupWidgetMenu();
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
  const payload = buildPayload();
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
    maybeNotify(data);
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
    loadForecast();
    if (pendingRefresh) {
      const next = pendingRefresh;
      pendingRefresh = null;
      setImmediate(() => refresh(next));
    }
  }
}

function loadForecast() {
  if (!config.forecast || forecastTask) return;
  forecastTask = (async () => {
    try {
      const data = await fetchForecast(Date.now() + 15000);
      forecast = data;
      saveState();
      send();
      log('forecast ok high=' + data.high + ' low=' + data.low);
    } catch (err) {
      log('forecast failed:', err.message);
    } finally {
      forecastTask = null;
    }
  })();
}

function clockNow() {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: config.timeZone
    }).format(new Date());
  } catch (err) {
    return '';
  }
}

function maybeNotify(data) {
  const category = data.category && data.category.label ? data.category.label : '';
  if (!category) return;
  const threshold = Number(config.notifyAbove) > 0 ? Number(config.notifyAbove) : 0;
  const above = threshold > 0 && data.aqi >= threshold;
  const previous = lastNotified;
  let reason = null;
  if (!previous) {
    reason = null;
  } else if (previous.category !== category) {
    reason = 'category';
  } else if (above && !previous.above) {
    reason = 'threshold';
  }
  lastNotified = { category, above };
  if (!reason || !config.notifications) return;
  showNotification(data);
}

function showNotification(data) {
  try {
    if (!Notification.isSupported()) {
      log('notifications not supported on this system');
      return;
    }
    const source = SOURCE_LABELS[data.source] || data.source;
    const time = clockNow();
    const parts = [];
    if (data.pm25 !== null && data.pm25 !== undefined) parts.push('PM2.5 ' + data.pm25 + ' µg/m³');
    parts.push(source);
    if (time) parts.push(time);
    const toast = new Notification({
      title: 'US AQI ' + data.aqi + ' — ' + data.category.label,
      body: parts.join(' · '),
      icon: path.join(__dirname, 'tray.png')
    });
    toast.on('click', () => {
      setVisible(true);
      if (win && !win.isDestroyed()) win.focus();
    });
    toast.show();
    log('notification shown aqi=' + data.aqi, 'category=' + data.category.label);
  } catch (err) {
    log('notification failed:', err.message);
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

function snapshotConfig() {
  return {
    url: config.url,
    latitude: config.latitude,
    longitude: config.longitude,
    refreshMinutes: config.refreshMinutes,
    staleMinutes: config.staleMinutes,
    position: config.position,
    inset: config.inset,
    width: config.width,
    height: config.height,
    timeZone: config.timeZone,
    fallbacks: config.fallbacks,
    notifications: config.notifications,
    notifyAbove: config.notifyAbove,
    forecast: config.forecast
  };
}

function readConfigFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, ''));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (err) {
    // fall through to an empty object
  }
  return {};
}

function startupShortcutExists() {
  return Boolean(process.env.APPDATA) && fs.existsSync(STARTUP_LNK_PATH);
}

function getAutoStart() {
  if (startupShortcutExists()) return true;
  if (!app.isPackaged) return false;
  try {
    return app.getLoginItemSettings().openAtLogin === true;
  } catch (err) {
    return false;
  }
}

function setAutoStart(enabled) {
  const on = Boolean(enabled);
  if (on) {
    if (!startupShortcutExists() && app.isPackaged) {
      try {
        app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args: [] });
      } catch (err) {
        log('setLoginItemSettings(true) failed:', err.message);
      }
    }
  } else {
    if (app.isPackaged) {
      try {
        app.setLoginItemSettings({ openAtLogin: false, path: process.execPath, args: [] });
      } catch (err) {
        log('setLoginItemSettings(false) failed:', err.message);
      }
    }
    try {
      if (startupShortcutExists()) fs.rmSync(STARTUP_LNK_PATH);
    } catch (err) {
      log('startup shortcut removal failed:', err.message);
    }
  }
  const state = getAutoStart();
  log('auto-start:', state);
  return state;
}

function applyLive(before) {
  const sizeChanged = before.width !== config.width || before.height !== config.height;
  const anchorChanged = before.position !== config.position || before.inset !== config.inset;
  if (win && !win.isDestroyed() && (sizeChanged || anchorChanged)) {
    if (sizeChanged) {
      const bounds = win.getBounds();
      win.setBounds({ x: bounds.x, y: bounds.y, width: config.width, height: config.height });
    }
    positionWindow(win);
  }
  if (before.refreshMinutes !== config.refreshMinutes) schedule();
  if (
    before.url !== config.url ||
    before.latitude !== config.latitude ||
    before.longitude !== config.longitude
  ) {
    refresh('settings');
  }
}

function saveConfigPartial(partial) {
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
    return { ok: false, error: 'invalid settings payload' };
  }
  const known = {};
  for (const key of Object.keys(partial)) {
    if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) known[key] = partial[key];
  }
  const before = snapshotConfig();
  const file = readConfigFile();
  Object.assign(file, known);
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(file, null, 2) + '\n');
  } catch (err) {
    return { ok: false, error: 'could not write config.json: ' + err.message };
  }
  const has = (key) => Object.prototype.hasOwnProperty.call(known, key);
  if (has('position')) overrides.position = known.position;
  if (has('refreshMinutes')) overrides.refreshMinutes = known.refreshMinutes;
  const reloaded = loadConfig(__dirname, overrides);
  Object.assign(config, reloaded.config);
  if (has('position')) overrides.position = config.position;
  if (has('refreshMinutes')) overrides.refreshMinutes = config.refreshMinutes;
  saveState();
  applyLive(before);
  updateTray();
  send();
  for (const warning of reloaded.warnings) log('config:', warning);
  log('settings saved:', Object.keys(known).join(', ') || '(none)');
  return { ok: true, warnings: reloaded.warnings, config: snapshotConfig() };
}

function toggleNotifications() {
  const result = saveConfigPartial({ notifications: !config.notifications });
  if (!result.ok) log('notifications toggle failed:', result.error);
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 460,
    height: 640,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    title: 'KL AQI Settings',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  settingsWin.webContents.setWindowOpenHandler(() => ({ action: 'ignore' }));
  settingsWin.webContents.on('will-navigate', (e) => e.preventDefault());
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
  settingsWin.loadFile('settings.html');
  log('settings window opened');
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
    configureFetcher(config);
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
ipcMain.handle('get-state', () => buildPayload());
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
ipcMain.handle('settings:get', () => ({
  ok: true,
  config: snapshotConfig(),
  defaults: DEFAULTS,
  positions: POSITIONS,
  packaged: app.isPackaged,
  autoStart: getAutoStart()
}));
ipcMain.handle('settings:save', (_event, values) => {
  const result = saveConfigPartial(values);
  if (result.ok) result.autoStart = getAutoStart();
  return result;
});
ipcMain.handle('settings:autostart', (_event, enabled) => ({ autoStart: setAutoStart(enabled) }));
ipcMain.handle('settings:close', () => {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
  return true;
});
