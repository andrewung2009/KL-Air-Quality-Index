'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { classify } = require('./fetcher');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 224,
    height: 96,
    frame: false,
    show: false,
    backgroundColor: classify(198).color,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false
    }
  });
  await win.loadFile('index.html');
  win.webContents.send('aqi', {
    ok: true,
    data: {
      aqi: 198,
      pm25: 123,
      category: classify(198),
      observedAt: '2026-10-06T02:00:00.000Z',
      source: 'iqair',
      fetchedAt: new Date().toISOString()
    },
    settings: { staleMinutes: 20, timeZone: 'Asia/Kuala_Lumpur' }
  });
  await new Promise((r) => setTimeout(r, 700));

  const metrics = await win.webContents.executeJavaScript(`
    (function () {
      const r = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
      };
      return JSON.stringify({
        innerW: window.innerWidth,
        innerH: window.innerHeight,
        docScrollH: document.documentElement.scrollHeight,
        bodyH: Math.round(document.body.getBoundingClientRect().height),
        card: r('#card'),
        top: r('.row-top'),
        main: r('.row-main'),
        aqi: r('#aqi'),
        bottom: r('.row-bottom'),
        pm: r('#pm'),
        cat: r('#category'),
        catText: document.getElementById('category').textContent,
        bodyOverflowY: document.body.scrollHeight - document.body.clientHeight
      });
    })()
  `);
  console.log('METRICS ' + metrics);
  fs.writeFileSync(path.join(__dirname, 'debug_metrics.json'), metrics);

  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, 'debug_render.png'), image.toPNG());
  console.log('captured');
  app.quit();
});
