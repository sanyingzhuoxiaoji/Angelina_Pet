// 计时小窗 preload
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('timerApi', {
  onPomodoroTick: (cb) => ipcRenderer.on('pomodoro:tick', (_e, st) => cb(st)),
});
