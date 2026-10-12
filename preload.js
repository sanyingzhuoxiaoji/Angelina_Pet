// 桌宠窗口 preload(contextBridge 不能叫 api,照便签坑点2)
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('angelinaApi', {
  // 渲染端 → 主进程
  mouseMode: (ignore) => ipcRenderer.send('pet:mouse-mode', { ignore }),
  dragBegin: () => ipcRenderer.send('pet:drag-begin'),
  dragMove: () => ipcRenderer.send('pet:drag-move'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  togglePanel: () => ipcRenderer.send('pet:toggle-panel'),
  // 主进程 → 渲染端
  onForm: (cb) => ipcRenderer.on('form:set', (_e, form) => cb(form)),
  onBubble: (cb) => ipcRenderer.on('bubble:show', (_e, payload) => cb(payload)),
});
