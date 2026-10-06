'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aqiAPI', {
  onUpdate: (callback) => {
    ipcRenderer.on('aqi', (_event, payload) => callback(payload));
  },
  getState: () => ipcRenderer.invoke('get-state'),
  refreshNow: () => ipcRenderer.invoke('refresh-now'),
  toggleClickThrough: () => ipcRenderer.invoke('toggle-clickthrough'),
  quit: () => ipcRenderer.invoke('quit')
});
