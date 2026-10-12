// 设置窗口 preload
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appSettingsApi', {
  ready: () => ipcRenderer.send('appsettings:ready'),
  save: (patch) => ipcRenderer.send('appsettings:save', patch),
  chooseDir: () => ipcRenderer.invoke('appsettings:choose-dir'),
  close: () => ipcRenderer.send('appsettings:close'),
  onSettings: (cb) => ipcRenderer.on('settings:push', (_e, s) => cb(s)),
});
