// 安洁莉娜桌宠 - 主进程
// 双窗口(桌宠+面板)、托盘、单实例、番茄钟状态机、久坐提醒、便签只读监听、设置持久化
'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

// 数据目录钉死,开发期与打包后共用同一份设置
app.setPath('userData', path.join(app.getPath('appData'), 'angelina-pet'));
app.setAppUserModelId('com.angelina.pet');

let petWin = null;
let panelWin = null;
let tray = null;
let isQuitting = false;

// ---------------------------------------------------------------------------
// 设置持久化(主进程唯一写入口,tmp + renameSync 原子替换,防抖 300ms)
// ---------------------------------------------------------------------------
const SETTINGS_DEFAULTS = {
  pomodoroMin: 25,
  restMin: 5,
  sedentaryMin: 60,
  sedentaryOn: true,
  manualForm: null,          // null = 跟随状态;否则为 GIFS 键名
  petPos: null,              // {x, y}
  panelPos: null,
  completedToday: 0,
  completedDate: '',         // 'YYYY-MM-DD'
};

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsFile(), 'utf8');
    return Object.assign({}, SETTINGS_DEFAULTS, JSON.parse(raw));
  } catch (_) {
    return Object.assign({}, SETTINGS_DEFAULTS);
  }
}

let settings = loadSettings();
let saveTimer = null;

function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(app.getPath('userData'), { recursive: true });
      const file = settingsFile();
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error('[settings] 保存失败:', err);
    }
  }, 300);
}

// ---------------------------------------------------------------------------
// GIF 形态表(状态 → 素材相对路径;wander/carry 为 v2 预留,v1 不触发)
// ---------------------------------------------------------------------------
const GIFS = {
  idle:    { file: 'Angelina/GIF/坐坐.gif',   label: '坐坐' },
  work:    { file: 'Angelina/GIF/看书.gif',   label: '看书' },
  workEnd: { file: 'Angelina/GIF/拍照.gif',   label: '拍照' },
  rest:    { file: 'Angelina/GIF/海边.gif',   label: '海边' },
  restAlt: { file: 'Angelina/GIF/潜水.gif',   label: '潜水' },
  restEnd: { file: 'Angelina/GIF/纸飞机.gif', label: '纸飞机' },
  wander:  { file: 'Angelina/GIF/骑行.gif',   label: '骑行' },   // v2 预留
  wanderAlt: { file: 'Angelina/GIF/探险.gif', label: '探险' },   // v2 预留
  wanderAlt2: { file: 'Angelina/GIF/购物.gif', label: '购物' },  // v2 预留
  carry:   { file: 'Angelina/GIF/送货.gif',   label: '送货' },   // v2 预留
};
const MANUAL_FORMS = ['idle', 'work', 'rest', 'restAlt', 'restEnd', 'wander', 'wanderAlt', 'wanderAlt2', 'carry'];

// ---------------------------------------------------------------------------
// 番茄钟状态机(主进程计时,不受窗口隐藏/节流影响)
// phase: idle | work | workEnd | rest | restEnd
// ---------------------------------------------------------------------------
const WORK_END_SEC = 3;   // workEnd/restEnd 提示停留时长
const pomodoro = {
  phase: 'idle',
  remaining: 0,            // 秒
  total: 0,
  paused: false,
  timer: null,
  todo: null,              // 绑定的待办 {id, text}(仅记录显示,不写回便签)
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function completedToday() {
  if (settings.completedDate !== todayStr()) return 0;
  return settings.completedToday;
}

function broadcast(channel, payload) {
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send(channel, payload);
  if (panelWin && !panelWin.isDestroyed()) panelWin.webContents.send(channel, payload);
}

function pushPomodoro() {
  broadcast('pomodoro:tick', {
    phase: pomodoro.phase,
    remaining: pomodoro.remaining,
    total: pomodoro.total,
    paused: pomodoro.paused,
    completedToday: completedToday(),
    todo: pomodoro.todo,
  });
}

function setPhase(phase, remainingSec) {
  pomodoro.phase = phase;
  pomodoro.remaining = remainingSec;
  pomodoro.total = remainingSec;
  pushPomodoro();
  applyPomodoroForm();
}

function applyPomodoroForm() {
  // 手动形态优先;否则按阶段映射(休息随机海边/潜水)
  if (settings.manualForm) {
    sendToPet('form:set', settings.manualForm);
    return;
  }
  let form = 'idle';
  if (pomodoro.phase === 'work') form = 'work';
  else if (pomodoro.phase === 'workEnd') form = 'workEnd';
  else if (pomodoro.phase === 'rest') form = Math.random() < 0.5 ? 'rest' : 'restAlt';
  else if (pomodoro.phase === 'restEnd') form = 'restEnd';
  sendToPet('form:set', form);
}

function sendToPet(channel, payload) {
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send(channel, payload);
}

function startPomodoro(todo) {
  stopTicker();
  pomodoro.paused = false;
  pomodoro.todo = todo || null;
  setPhase('work', settings.pomodoroMin * 60);
  startTicker();
}

function startTicker() {
  stopTicker();
  pomodoro.timer = setInterval(onTick, 1000);
}

function stopTicker() {
  if (pomodoro.timer) { clearInterval(pomodoro.timer); pomodoro.timer = null; }
}

function onTick() {
  if (pomodoro.paused || pomodoro.phase === 'idle') return;
  pomodoro.remaining -= 1;

  if (pomodoro.remaining > 0) { pushPomodoro(); return; }

  switch (pomodoro.phase) {
    case 'work': {
      settings.completedDate = todayStr();
      settings.completedToday = completedToday() + 1;
      saveSettings();
      notify('番茄钟完成!', pomodoro.todo ? `「${pomodoro.todo.text}」做得好,休息一下吧~` : '做得好,休息一下吧~');
      showBubble('博士,工作辛苦了!休息一下吧~');
      setPhase('workEnd', WORK_END_SEC);
      break;
    }
    case 'workEnd': {
      setPhase('rest', settings.restMin * 60);
      showBubble(`休息 ${settings.restMin} 分钟~`);
      break;
    }
    case 'rest': {
      notify('休息结束', '准备好继续工作了吗?');
      setPhase('restEnd', WORK_END_SEC);
      break;
    }
    case 'restEnd': {
      pomodoro.todo = null;
      setPhase('idle', 0);
      stopTicker();
      break;
    }
  }
}

function pausePomodoro() {
  if (pomodoro.phase === 'idle') return;
  pomodoro.paused = !pomodoro.paused;
  pushPomodoro();
}

function skipPomodoro() {
  if (pomodoro.phase === 'work') {
    settings.completedDate = todayStr();
    settings.completedToday = completedToday() + 1;
    saveSettings();
    setPhase('rest', settings.restMin * 60);
  } else if (pomodoro.phase === 'rest' || pomodoro.phase === 'workEnd') {
    pomodoro.todo = null;
    setPhase('idle', 0);
    stopTicker();
  }
}

function stopPomodoro() {
  pomodoro.todo = null;
  pomodoro.paused = false;
  setPhase('idle', 0);
  stopTicker();
}

// ---------------------------------------------------------------------------
// 久坐提醒(独立计时;番茄钟工作/休息期间不计时)
// ---------------------------------------------------------------------------
let sedentaryMinutes = 0;

setInterval(() => {
  if (!settings.sedentaryOn) { sedentaryMinutes = 0; return; }
  if (['work', 'workEnd', 'rest', 'restEnd'].includes(pomodoro.phase)) { sedentaryMinutes = 0; return; }
  sedentaryMinutes += 1;
  if (sedentaryMinutes >= settings.sedentaryMin) {
    sedentaryMinutes = 0;
    notify('久坐提醒', '博士,已经坐了很久啦,起来活动一下吧~');
    showBubble('博士,坐久了对身体不好,起来走走吧~');
  }
}, 60 * 1000);

// ---------------------------------------------------------------------------
// 便签待办只读监听(%APPDATA%\desktop-sticky-note\sticky-note-data.json)
// ---------------------------------------------------------------------------
let stickyWatcher = null;
let watchDebounce = null;
let todosAvailable = false;
let todoItems = [];
let boundTodoId = null;

function stickyDataFile() {
  return path.join(app.getPath('appData'), 'desktop-sticky-note', 'sticky-note-data.json');
}

function readTodos() {
  try {
    const raw = fs.readFileSync(stickyDataFile(), 'utf8');
    const data = JSON.parse(raw);
    todoItems = (Array.isArray(data.items) ? data.items : [])
      .filter((it) => it.status === 'todo')
      .map((it) => ({ id: it.id, text: it.text }))
      .filter((it) => it.text);
    todosAvailable = true;
  } catch (_) {
    // 文件不存在/被占用/脏帧:保留上次结果,只标记可用性
    todosAvailable = fs.existsSync(stickyDataFile());
  }
  pushTodos();
}

function pushTodos() {
  if (panelWin && !panelWin.isDestroyed()) {
    panelWin.webContents.send('todos:push', {
      available: todosAvailable,
      items: todoItems,
      boundTodoId,
      pomodoroTodo: pomodoro.todo,
    });
  }
}

function watchTodos() {
  const file = stickyDataFile();
  if (!fs.existsSync(file)) {
    todosAvailable = false;
    todoItems = [];
    pushTodos();
    return;
  }
  readTodos();
  try {
    stickyWatcher = fs.watch(path.dirname(file), () => {
      clearTimeout(watchDebounce);
      watchDebounce = setTimeout(readTodos, 200);
    });
  } catch (err) {
    console.error('[todos] 监听失败:', err);
  }
}

// ---------------------------------------------------------------------------
// 通知与气泡
// ---------------------------------------------------------------------------
function notify(title, body) {
  try {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  } catch (_) { /* 通知失败不影响主流程 */ }
}

let bubbleTimer = null;
function showBubble(text, duration = 5000) {
  sendToPet('bubble:show', { text, duration });
  clearTimeout(bubbleTimer);
  // 由渲染端自行淡出;这里只兜底重置(无需额外处理)
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------
const PET_SIZE = 240;      // 桌宠窗口宽(GIF 方形)
const BUBBLE_H = 110;      // 气泡区高度(窗口总高 = BUBBLE_H + PET_SIZE)
const PANEL_W = 320;
const PANEL_H = 480;

function clampToWorkArea(x, y, w, h) {
  const { x: wx, y: wy, width: ww, height: wh } = screen.getPrimaryDisplay().workArea;
  return [
    Math.min(Math.max(x, wx - w + 60), wx + ww - 60),
    Math.min(Math.max(y, wy), wy + wh - 60),
  ];
}

function createPetWindow() {
  petWin = new BrowserWindow({
    width: PET_SIZE,
    height: BUBBLE_H + PET_SIZE,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // floating 等级在本机(Win11 26200)会被"插到任务栏后"导致置顶失效,必须 screen-saver
  petWin.setAlwaysOnTop(true, 'screen-saver');
  // 初始即开启点击穿透(透明区域放行鼠标),渲染端 mousemove 命中可交互元素时再关闭
  petWin.setIgnoreMouseEvents(true, { forward: true });
  petWin.loadFile('pet.html');

  if (settings.petPos) {
    const [x, y] = clampToWorkArea(settings.petPos.x, settings.petPos.y, PET_SIZE, PET_SIZE);
    petWin.setPosition(x, y);
  } else {
    const { workArea } = screen.getPrimaryDisplay();
    petWin.setPosition(
      workArea.x + workArea.width - PET_SIZE - 40,
      workArea.y + workArea.height - (BUBBLE_H + PET_SIZE) - 40
    );
  }

  petWin.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); petWin.hide(); }
  });
}

function createPanelWindow() {
  panelWin = new BrowserWindow({
    width: PANEL_W,
    height: PANEL_H,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'panel-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  panelWin.loadFile('panel.html');
  panelWin.setAlwaysOnTop(true, 'screen-saver');

  panelWin.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); panelWin.hide(); savePanelPos(); }
  });
  panelWin.on('hide', savePanelPos);
}

function savePanelPos() {
  if (!panelWin || panelWin.isDestroyed()) return;
  settings.panelPos = panelWin.getPosition();
  saveSettings();
}

function togglePanel() {
  if (!panelWin) return;
  if (panelWin.isVisible()) {
    panelWin.hide();
    savePanelPos();
  } else {
    // 默认弹在桌宠旁边,越界钳制到工作区
    let [x, y] = settings.panelPos || [0, 0];
    if (!settings.panelPos && petWin && !petWin.isDestroyed()) {
      const [px, py] = petWin.getPosition();
      x = px + PET_SIZE + 8;
      y = py;
    }
    const { workArea } = screen.getPrimaryDisplay();
    x = Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - PANEL_W);
    y = Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - PANEL_H);
    panelWin.setPosition(x, y);
    panelWin.show();
    panelWin.focus();
    pushPomodoro();
    pushTodos();
    panelWin.webContents.send('settings:push', publicSettings());
  }
}

function publicSettings() {
  return {
    pomodoroMin: settings.pomodoroMin,
    restMin: settings.restMin,
    sedentaryMin: settings.sedentaryMin,
    sedentaryOn: settings.sedentaryOn,
  };
}

// ---------------------------------------------------------------------------
// 托盘(左键面板显隐;右键形态手动切换/面板/退出)
// ---------------------------------------------------------------------------
function buildTray() {
  // v1 用静态 PNG 缩放当托盘图标(后续可换 ICO)
  const icon = nativeImage.createFromPath(path.join(__dirname, 'Angelina', 'PNG', '坐坐.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('安洁莉娜桌宠');

  const formMenu = [
    { label: '跟随状态', type: 'radio', checked: !settings.manualForm, click: () => setManualForm(null) },
    { type: 'separator' },
    ...MANUAL_FORMS.map((key) => ({
      label: GIFS[key].label,
      type: 'radio',
      checked: settings.manualForm === key,
      click: () => setManualForm(key),
    })),
  ];

  const menu = Menu.buildFromTemplate([
    { label: '形态', submenu: formMenu },
    { type: 'separator' },
    { label: '显示面板', click: () => { if (!panelWin.isVisible()) togglePanel(); } },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]);

  tray.setContextMenu(menu);
  tray.on('click', () => togglePanel());
}

function setManualForm(key) {
  settings.manualForm = key;
  saveSettings();
  applyPomodoroForm();
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
// 桌宠:鼠标命中切换点击穿透(透明区域放行点击)
let ignoringMouse = true;
ipcMain.on('pet:mouse-mode', (_e, { ignore }) => {
  if (!petWin || petWin.isDestroyed()) return;
  if (ignore !== ignoringMouse) {
    ignoringMouse = ignore;
    petWin.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

// 桌宠:拖动(渲染端只发开始/结束信号,主进程 16ms 轮询光标算位置,
// 光标快速移出小窗口也不丢跟踪)
let drag = null;
ipcMain.on('pet:drag-begin', () => {
  if (!petWin || petWin.isDestroyed()) return;
  const c = screen.getCursorScreenPoint();
  const [px, py] = petWin.getPosition();
  drag = { startX: c.x, startY: c.y, winX: px, winY: py, moved: false };
  drag.poll = setInterval(() => {
    if (!drag || !petWin || petWin.isDestroyed()) { endDrag(); return; }
    const p = screen.getCursorScreenPoint();
    const dx = p.x - drag.startX;
    const dy = p.y - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    petWin.setPosition(drag.winX + dx, drag.winY + dy);
  }, 16);
});
ipcMain.on('pet:drag-move', () => { /* 兼容保留:轮询已覆盖 */ });
ipcMain.on('pet:drag-end', endDrag);

function endDrag() {
  if (drag) {
    clearInterval(drag.poll);
    if (drag.moved && petWin && !petWin.isDestroyed()) {
      const [x, y] = petWin.getPosition();
      settings.petPos = { x, y };
      saveSettings();
    }
  }
  drag = null;
}

// 桌宠:点击(未拖动时)开关面板
ipcMain.on('pet:toggle-panel', () => {
  if (drag && drag.moved) return; // 拖动结束的松手不算点击
  togglePanel();
});

// 面板:关闭(隐藏,不退出)
ipcMain.on('panel:close-panel', () => {
  if (panelWin && !panelWin.isDestroyed()) { panelWin.hide(); savePanelPos(); }
});

// 面板:番茄钟控制
ipcMain.on('panel:pomodoro-start', (_e, todo) => {
  boundTodoId = todo ? todo.id : null;
  startPomodoro(todo);
});
ipcMain.on('panel:pomodoro-pause', pausePomodoro);
ipcMain.on('panel:pomodoro-skip', skipPomodoro);
ipcMain.on('panel:pomodoro-stop', stopPomodoro);

// 面板:绑定待办(仅高亮;开始番茄钟时一并记录)
ipcMain.on('panel:bind-todo', (_e, todoId) => {
  boundTodoId = todoId;
  pushTodos();
});

// 面板:设置保存
ipcMain.on('panel:settings-save', (_e, patch) => {
  const num = (v, min, max, dft) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dft;
  };
  if (patch) {
    settings.pomodoroMin = num(patch.pomodoroMin, 1, 180, settings.pomodoroMin);
    settings.restMin = num(patch.restMin, 1, 60, settings.restMin);
    settings.sedentaryMin = num(patch.sedentaryMin, 5, 240, settings.sedentaryMin);
    settings.sedentaryOn = !!patch.sedentaryOn;
    saveSettings();
  }
  // 改时长立即反映到未开始的阶段显示
  if (pomodoro.phase === 'idle') pushPomodoro();
  panelWin && !panelWin.isDestroyed() && panelWin.webContents.send('settings:push', publicSettings());
});

// 面板就绪:全量推一次
ipcMain.on('panel:ready', () => {
  pushPomodoro();
  pushTodos();
  panelWin && !panelWin.isDestroyed() && panelWin.webContents.send('settings:push', publicSettings());
});

// ---------------------------------------------------------------------------
// 应用生命周期
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (panelWin && !panelWin.isVisible()) togglePanel();
  });

  app.whenReady().then(() => {
    createPetWindow();
    createPanelWindow();
    buildTray();
    watchTodos();
  });

  app.on('before-quit', () => { isQuitting = true; });

  app.on('window-all-closed', () => {
    // 托盘常驻:不主动退出,只有托盘"退出"才结束
  });
}
