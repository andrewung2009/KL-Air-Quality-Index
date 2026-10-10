'use strict';

const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { PNG } = require('pngjs');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');
const { classify } = require('../fetcher');
const { loadConfig, POSITIONS } = require('../defaults');

const CANVAS_W = 700;
const CANVAS_H = 340;
const WIDGET_SCALE = 2;
const SETTINGS_H = 308;
const SETTINGS_X = 468;
const SETTINGS_Y = 16;
const OUT = path.join(__dirname, '..', 'assets', 'demo.gif');

const STATES = [
  { aqi: 42, pm25: 12, high: 68, low: 28, delay: 1100 },
  { aqi: 88, pm25: 35, high: 150, low: 60, delay: 1100 },
  { aqi: 145, pm25: 54, high: 180, low: 90, delay: 1100 },
  { aqi: 190, pm25: 111.5, high: 251, low: 189, delay: 1100 }
];

app.disableHardwareAcceleration();

function pngFrom(image) {
  return PNG.sync.read(image.toPNG());
}

function blit(canvas, src, x, y) {
  for (let row = 0; row < src.height; row++) {
    const dy = y + row;
    if (dy < 0 || dy >= canvas.height) continue;
    for (let col = 0; col < src.width; col++) {
      const dx = x + col;
      if (dx < 0 || dx >= canvas.width) continue;
      const si = (row * src.width + col) * 4;
      const di = (dy * canvas.width + dx) * 4;
      canvas.data[di] = src.data[si];
      canvas.data[di + 1] = src.data[si + 1];
      canvas.data[di + 2] = src.data[si + 2];
      canvas.data[di + 3] = src.data[si + 3];
    }
  }
}

function scalePng(png, width, height) {
  const image = nativeImage.createFromBuffer(PNG.sync.write(png));
  const scaled = image.resize({ width, height, quality: 'best' });
  return pngFrom(scaled);
}

function widgetPayload(state) {
  return {
    ok: true,
    data: {
      aqi: state.aqi,
      pm25: state.pm25,
      category: classify(state.aqi),
      observedAt: new Date().toISOString(),
      source: 'iqair',
      fetchedAt: new Date().toISOString()
    },
    forecast: {
      date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date()),
      high: state.high,
      low: state.low
    },
    settings: {
      staleMinutes: 20,
      timeZone: 'Asia/Kuala_Lumpur',
      clickThrough: false,
      forecast: true,
      notifications: true
    }
  };
}

function registerSettingsIpc() {
  const { config } = loadConfig(path.join(__dirname, '..'));
  ipcMain.handle('settings:get', () => ({
    ok: true,
    packaged: false,
    positions: [],
    config,
    autoStart: false
  }));
  ipcMain.handle('settings:save', () => ({ ok: true, config, autoStart: false, warnings: [] }));
  ipcMain.handle('settings:autostart', () => ({ autoStart: false }));
  ipcMain.handle('settings:close', () => {});
}

async function captureState(widgetWin, state) {
  widgetWin.setBackgroundColor(classify(state.aqi).color);
  widgetWin.webContents.send('aqi', widgetPayload(state));
  await new Promise((r) => setTimeout(r, 500));
  return pngFrom(await widgetWin.webContents.capturePage());
}

app.whenReady().then(async () => {
  registerSettingsIpc();

  const widgetWin = new BrowserWindow({
    width: 224,
    height: 96,
    frame: false,
    show: false,
    backgroundColor: classify(STATES[0].aqi).color,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      sandbox: false
    }
  });
  await widgetWin.loadFile(path.join(__dirname, '..', 'index.html'));
  await new Promise((r) => setTimeout(r, 400));

  const settingsWin = new BrowserWindow({
    width: 460,
    height: 640,
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      sandbox: false
    }
  });
  await settingsWin.loadFile(path.join(__dirname, '..', 'settings.html'));
  await new Promise((r) => setTimeout(r, 800));

  const frames = [];
  const widgetW = 224 * WIDGET_SCALE;
  const widgetH = 96 * WIDGET_SCALE;
  const widgetX = 16;
  const widgetY = Math.round((CANVAS_H - widgetH) / 2);

  for (const state of STATES) {
    const captured = await captureState(widgetWin, state);
    const canvas = new PNG({ width: CANVAS_W, height: CANVAS_H });
    blit(canvas, scalePng(captured, widgetW, widgetH), widgetX, widgetY);
    frames.push({ png: canvas, delay: state.delay });
  }

  const last = STATES[STATES.length - 1];
  const widgetFinal = await captureState(widgetWin, last);
  const settingsPng = scalePng(
    pngFrom(await settingsWin.webContents.capturePage()),
    Math.round((460 * SETTINGS_H) / 640),
    SETTINGS_H
  );
  const finalCanvas = new PNG({ width: CANVAS_W, height: CANVAS_H });
  blit(finalCanvas, scalePng(widgetFinal, widgetW, widgetH), widgetX, widgetY);
  blit(finalCanvas, settingsPng, SETTINGS_X, SETTINGS_Y);
  frames.push({ png: finalCanvas, delay: 1800 });

  const gif = GIFEncoder();
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (process.env.DEMO_DUMP) {
      fs.writeFileSync(path.join(os.tmpdir(), 'demo-frame-' + i + '.png'), PNG.sync.write(frame.png));
    }
    const palette = quantize(frame.png.data, 256, {
      format: 'rgba4444',
      oneBitAlpha: true,
      clearAlpha: true,
      clearAlphaThreshold: 1,
      clearAlphaColor: 0x00
    });
    const transparentIndex = palette.findIndex((color) => color[3] === 0);
    const index = applyPalette(frame.png.data, palette, 'rgba4444');
    gif.writeFrame(index, CANVAS_W, CANVAS_H, {
      palette,
      transparent: transparentIndex >= 0,
      transparentIndex: transparentIndex >= 0 ? transparentIndex : 0,
      dispose: 2,
      delay: frame.delay
    });
  }
  gif.finish();
  fs.writeFileSync(OUT, gif.bytes());
  console.log('wrote ' + OUT + ' (' + Math.round(fs.statSync(OUT).size / 1024) + ' KB, ' + frames.length + ' frames)');
  app.quit();
});
