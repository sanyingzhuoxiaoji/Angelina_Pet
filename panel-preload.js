// 面板窗口 preload
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('panelApi', {
  // 渲染端 → 主进程
  ready: () => ipcRenderer.send('panel:ready'),
  pomodoroStart: (todo) => ipcRenderer.send('panel:pomodoro-start', todo),
  pomodoroPause: () => ipcRenderer.send('panel:pomodoro-pause'),
  pomodoroSkip: () => ipcRenderer.send('panel:pomodoro-skip'),
  pomodoroStop: () => ipcRenderer.send('panel:pomodoro-stop'),
  bindTodo: (todoId) => ipcRenderer.send('panel:bind-todo', todoId),
  close: () => ipcRenderer.send('panel:close-panel'),
  // 主进程 → 渲染端
  onPomodoroTick: (cb) => ipcRenderer.on('pomodoro:tick', (_e, st) => cb(st)),
  onTodos: (cb) => ipcRenderer.on('todos:push', (_e, payload) => cb(payload)),
});
