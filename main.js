// 安洁莉娜桌宠 - 主进程
// 双窗口(桌宠+面板)、托盘、单实例、番茄钟状态机、久坐提醒、便签只读监听、设置持久化
'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, Notification, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { pick } = require('./lines');

// 数据目录钉死,开发期与打包后共用同一份设置
app.setPath('userData', path.join(app.getPath('appData'), 'angelina-pet'));
app.setAppUserModelId('com.angelina.pet');

let petWin = null;
let panelWin = null;
let settingsWin = null;
let timerWin = null;
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
  completedToday: 0,
  completedDate: '',         // 'YYYY-MM-DD'
  deliveryDir: null,         // 文件搬运目标文件夹(null = 未设置)
  wanderOn: true,            // 自由巡游开关
  springDrag: true,          // 弹簧(柔性)拖动开关,false = v1 的 1:1 跟手
  wanderIdleMin: 1,          // 闲置多少分钟后开始巡游/小动作
  idleCooldownMin: 3,        // 巡游/小动作结束后冷却分钟数(实际 ±1 随机,默认 2~4)
  pomodoroMode: 'down',      // 番茄钟模式:'down' 倒计时 | 'up' 正向(秒表)
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
  remaining: 0,            // 秒(down=剩余;up=已专注时长,面板直接显示)
  total: 0,
  mode: 'down',            // 'down' 倒计时 | 'up' 正向秒表
  elapsed: 0,              // up 模式已专注秒数
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
  const payload = {
    phase: pomodoro.phase,
    remaining: pomodoro.remaining,
    total: pomodoro.total,
    mode: pomodoro.phase === 'idle' ? (settings.pomodoroMode === 'up' ? 'up' : 'down') : pomodoro.mode,
    paused: pomodoro.paused,
    completedToday: completedToday(),
    todo: pomodoro.todo,
    pomodoroMin: settings.pomodoroMin,
    restMin: settings.restMin,
  };
  broadcast('pomodoro:tick', payload);
  if (timerWin && !timerWin.isDestroyed()) timerWin.webContents.send('pomodoro:tick', payload);
  updateTimerVisibility(pomodoro.phase);
}

function setPhase(phase, remainingSec) {
  pomodoro.phase = phase;
  pomodoro.remaining = remainingSec;
  pomodoro.total = remainingSec;
  if (phase === 'idle') pomodoro.elapsed = 0;
  pushPomodoro();
  applyPomodoroForm();
}

// ---------------------------------------------------------------------------
// 活动状态(wander 巡游 / carry 送货动画),与番茄钟阶段正交
// 形态优先级:手动 > carry > 拖动 > 番茄钟阶段 > wander > idle
// ---------------------------------------------------------------------------
let activity = null;   // null | 'wander' | 'carry'

// 方向类形态的原生朝向;移动方向与朝向相反时渲染端 scaleX(-1) 镜像
const FACING = {
  wander: 'right',     // 骑行
  restAlt: 'right',    // 潜水
  restEnd: 'left',     // 纸飞机
};

function resolveForm() {
  if (settings.manualForm) return settings.manualForm;
  if (activity === 'carry') return 'carry';
  if (activity === 'fly') return 'restEnd';   // 纸飞机回家
  if (['work', 'workEnd', 'rest', 'restEnd'].includes(pomodoro.phase)) {
    if (pomodoro.phase === 'work') return 'work';
    if (pomodoro.phase === 'workEnd') return 'workEnd';
    if (pomodoro.phase === 'rest') return Math.random() < 0.5 ? 'rest' : 'restAlt';
    return 'restEnd';
  }
  if (activity === 'idlePose') return currentIdleForm;
  if (activity === 'wander') return currentWanderForm;
  return 'idle';
}

function applyForm() {
  sendToPet('form:set', resolveForm());
  sendToPet('form:dir', { flip: false });   // 换形态时复位朝向
}

// 兼容旧调用点
function applyPomodoroForm() { applyForm(); }

function sendToPet(channel, payload) {
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send(channel, payload);
}

function startPomodoro(todo) {
  interruptIdleActivities();
  stopFlyHome(false);
  stopTicker();
  pomodoro.paused = false;
  pomodoro.todo = todo || null;
  pomodoro.mode = settings.pomodoroMode === 'up' ? 'up' : 'down';
  pomodoro.elapsed = 0;
  // up 模式:remaining 存已专注秒数,从 0 递增,永不自动归零
  setPhase('work', pomodoro.mode === 'up' ? 0 : settings.pomodoroMin * 60);
  startTicker();
  // 不在放置的位置 → 纸飞机飞回家,落地播报今日完成数(锁形态时不飞,只播报)
  if (!settings.manualForm && settings.petPos) {
    const [px, py] = petWin.getPosition();
    const home = settings.petPos;
    if (Math.hypot(px - home.x, py - home.y) > 10) startFlyHome();
    else showBubble(todayDoneLine(), 6000);
  } else {
    showBubble(pick('pomodoroStart'));
  }
}

// ---------------------------------------------------------------------------
// 纸飞机回家:番茄钟启动时飞回被放置的位置(settings.petPos 实时读取,不钳制工作区)
// ---------------------------------------------------------------------------
let fly = null;   // { poll, dirSign }

function startFlyHome() {
  if (!petWin || petWin.isDestroyed() || !settings.petPos) return;
  activity = 'fly';
  applyForm();
  const home = { x: settings.petPos.x, y: settings.petPos.y };
  const speed = (300 * 33) / 1000;   // 300 px/s
  fly = {
    poll: setInterval(() => {
      if (!fly || !petWin || petWin.isDestroyed()) { stopFlyHome(false); return; }
      const [px, py] = petWin.getPosition();
      const dx = home.x - px;
      const dy = home.y - py;
      const dist = Math.hypot(dx, dy);
      if (dist < 8) { stopFlyHome(true); return; }
      const movingSign = Math.sign(dx);
      if (movingSign !== 0 && movingSign !== fly.dirSign) {
        fly.dirSign = movingSign;
        const facing = FACING.restEnd;   // 纸飞机朝左
        sendToPet('form:dir', { flip: (movingSign > 0 && facing === 'left') || (movingSign < 0 && facing === 'right') });
      }
      petWin.setBounds({
        x: Math.round(px + (dx / dist) * speed),
        y: Math.round(py + (dy / dist) * speed),
        width: PET_SIZE,
        height: BUBBLE_H + PET_SIZE,
      });
      syncTimerPos(Math.round(px + (dx / dist) * speed), Math.round(py + (dy / dist) * speed));
    }, 33),
    dirSign: 0,
  };
}

function stopFlyHome(arrived) {
  if (fly) {
    clearInterval(fly.poll);
    fly = null;
    activity = null;
    applyForm();
    if (arrived) {
      showBubble(todayDoneLine(), 6000);
    }
  }
}

function todayDoneLine() {
  return doneTodayCount > 0
    ? pick('flyDone').replace('{n}', doneTodayCount)
    : pick('flyNone');
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

  // 正向模式:递增显示,永不触发归零;完成与否由"停止"时的时长决定
  if (pomodoro.mode === 'up' && pomodoro.phase === 'work') {
    pomodoro.elapsed += 1;
    pomodoro.remaining = pomodoro.elapsed;
    pushPomodoro();
    return;
  }

  pomodoro.remaining -= 1;

  if (pomodoro.remaining > 0) { pushPomodoro(); return; }

  switch (pomodoro.phase) {
    case 'work': {
      settings.completedDate = todayStr();
      settings.completedToday = completedToday() + 1;
      saveSettings();
      notify('番茄钟完成!', pomodoro.todo ? `「${pomodoro.todo.text}」做得好,休息一下吧~` : '做得好,休息一下吧~');
      showBubble(pick('workEnd'));
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
      showBubble(pick('restEnd'));
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
    // 正向模式"跳过"= 提前收工,时长可能不足,不计完成
    if (pomodoro.mode !== 'up') {
      settings.completedDate = todayStr();
      settings.completedToday = completedToday() + 1;
      saveSettings();
    }
    setPhase('rest', settings.restMin * 60);
  } else if (pomodoro.phase === 'rest' || pomodoro.phase === 'workEnd') {
    pomodoro.todo = null;
    setPhase('idle', 0);
    stopTicker();
  }
}

function stopPomodoro() {
  // 正向模式停止:满一个番茄时长算完成,走完成→休息流程;不足则静默回空闲
  if (pomodoro.mode === 'up' && pomodoro.phase === 'work' && pomodoro.elapsed >= settings.pomodoroMin * 60) {
    settings.completedDate = todayStr();
    settings.completedToday = completedToday() + 1;
    saveSettings();
    notify('正向专注完成!', `专注了 ${Math.round(pomodoro.elapsed / 60)} 分钟,休息一下吧~`);
    showBubble(pick('workEnd'));
    setPhase('workEnd', WORK_END_SEC);
    return;
  }
  pomodoro.todo = null;
  pomodoro.mode = settings.pomodoroMode === 'up' ? 'up' : 'down';
  pomodoro.paused = false;
  pomodoro.elapsed = 0;
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
    showBubble(pick('sedentary'), 6000);
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

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === todayStr();
}

let doneTodayCount = 0;   // 便签中今天完成的待办数(番茄钟落地播报用)

function readTodos() {
  try {
    const raw = fs.readFileSync(stickyDataFile(), 'utf8');
    const data = JSON.parse(raw);
    const items = Array.isArray(data.items) ? data.items : [];
    todoItems = items
      .filter((it) => it.status === 'todo')
      .map((it) => ({ id: it.id, text: it.text, remindAt: it.remindAt || null }))
      .filter((it) => it.text);
    doneTodayCount = items.filter((it) => it.status === 'done' && isToday(it.finishedAt)).length;
    todosAvailable = true;
  } catch (_) {
    // 文件不存在/被占用/脏帧:保留上次结果,只标记可用性
    todosAvailable = fs.existsSync(stickyDataFile());
  }
  pushTodos();
}

// 今日提醒数(status todo 且 remindAt 是今天)
function todayRemindCount() {
  return todoItems.filter((it) => isToday(it.remindAt)).length;
}

let fullscreenActive = false;   // 前台有全屏应用(看视频/F11/游戏),桌宠让位
// 每 30 分钟播报今日提醒(有提醒才说;全屏隐藏时不打扰)
setInterval(() => {
  if (fullscreenActive) return;
  if (!todosAvailable) return;
  const n = todayRemindCount();
  if (n <= 0) return;
  showBubble(pick('remindDaily').replace('{n}', n), 7000);
  notify('今日提醒', `博士,今天还有 ${n} 条提醒没处理哦~`);
}, 30 * 60 * 1000);
// 启动 1 分钟后先播一次
setTimeout(() => {
  if (fullscreenActive || !todosAvailable) return;
  const n = todayRemindCount();
  if (n > 0) {
    showBubble(pick('remindDaily').replace('{n}', n), 7000);
    notify('今日提醒', `博士,今天还有 ${n} 条提醒没处理哦~`);
  }
}, 60 * 1000);

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
const PANEL_GAP_RIGHT = 20;   // 面板贴右侧时与桌宠窗口的间距(避开发丝/饰品)
const PANEL_GAP_LEFT = 2;     // 面板贴左侧时的间距(左侧素材留白多,贴近些)

let panelOffset = null;   // 面板打开时相对桌宠窗口的偏移,拖动桌宠时面板跟随用

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
    petWin.setBounds({ x, y, width: PET_SIZE, height: BUBBLE_H + PET_SIZE });
  } else {
    const { workArea } = screen.getPrimaryDisplay();
    petWin.setBounds({
      x: workArea.x + workArea.width - PET_SIZE - 40,
      y: workArea.y + workArea.height - (BUBBLE_H + PET_SIZE) - 40,
      width: PET_SIZE,
      height: BUBBLE_H + PET_SIZE,
    });
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

  // 点击面板外部(失焦)自动隐藏
  panelWin.on('blur', () => {
    if (panelWin.isVisible()) panelWin.hide();
  });

  panelWin.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); panelWin.hide(); }
  });
}

// ---------------------------------------------------------------------------
// 计时小窗(桌宠左侧纯数字展示,整窗穿透,随桌宠移动)
// ---------------------------------------------------------------------------
const TIMER_W = 120;
const TIMER_H = 54;
let timerWasVisible = false;

function createTimerWindow() {
  timerWin = new BrowserWindow({
    width: TIMER_W,
    height: TIMER_H,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'timer-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  timerWin.setAlwaysOnTop(true, 'screen-saver');
  timerWin.setIgnoreMouseEvents(true);   // 纯展示,绝不挡点击
  timerWin.loadFile('timer.html');
}

// 计时窗贴桌宠左侧、人物上身高度;桌宠每次移动后调用
// 可传精确坐标(拖动/巡游/飞行的本帧值),避免二次取整;setBounds 显式带尺寸防漂移
function syncTimerPos(px, py) {
  if (!timerWin || timerWin.isDestroyed() || !timerWin.isVisible()) return;
  if (!petWin || petWin.isDestroyed()) return;
  if (px === undefined || py === undefined) { [px, py] = petWin.getPosition(); }
  timerWin.setBounds({
    x: Math.round(px) - TIMER_W - 6,
    y: Math.round(py) + 120,
    width: TIMER_W,
    height: TIMER_H,
  });
}

function updateTimerVisibility(phase) {
  const show = phase !== 'idle';
  if (!timerWin || timerWin.isDestroyed()) return;
  if (show && !timerWin.isVisible()) {
    timerWin.showInactive();
    syncTimerPos();
  } else if (!show && timerWin.isVisible()) {
    timerWin.hide();
  }
}

// ---------------------------------------------------------------------------
// 设置窗口(单例,托盘"设置…"弹出)
// ---------------------------------------------------------------------------
const SETTINGS_W = 300;
const SETTINGS_H = 430;

function createSettingsWindow() {
  settingsWin = new BrowserWindow({
    width: SETTINGS_W,
    height: SETTINGS_H,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.loadFile('settings.html');
  settingsWin.setAlwaysOnTop(true, 'screen-saver');

  settingsWin.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); settingsWin.hide(); }
  });
}

function toggleSettingsWindow() {
  if (!settingsWin) return;
  if (settingsWin.isVisible()) {
    settingsWin.hide();
    return;
  }
  // 贴桌宠弹出:与面板同样的右侧/左侧逻辑
  const { workArea } = screen.getPrimaryDisplay();
  let x = workArea.x;
  let y = workArea.y;
  if (petWin && !petWin.isDestroyed()) {
    const [px, py] = petWin.getPosition();
    const rightX = px + PET_SIZE + PANEL_GAP_RIGHT;
    const leftX = px - SETTINGS_W - PANEL_GAP_LEFT;
    x = (rightX + SETTINGS_W <= workArea.x + workArea.width) ? rightX : leftX;
    x = Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - SETTINGS_W);
    y = py;
  }
  y = Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - SETTINGS_H);
  settingsWin.setBounds({ x, y, width: SETTINGS_W, height: SETTINGS_H });
  settingsWin.show();
  settingsWin.focus();
  settingsWin.webContents.send('settings:push', publicSettings());
}

function togglePanel() {
  if (!panelWin) return;
  if (panelWin.isVisible()) {
    panelWin.hide();
    panelOffset = null;
    return;
  }
  // 紧贴桌宠弹出:默认贴右侧(间距避开发丝/饰品),右侧放不下(会出屏)就贴左侧
  // (左侧间距很小,抵消素材留白);垂直方向跟桌宠对齐并钳制到工作区
  const { workArea } = screen.getPrimaryDisplay();
  let x;
  let y;
  if (petWin && !petWin.isDestroyed()) {
    const [px, py] = petWin.getPosition();
    const rightX = px + PET_SIZE + PANEL_GAP_RIGHT;
    const leftX = px - PANEL_W - PANEL_GAP_LEFT;
    x = (rightX + PANEL_W <= workArea.x + workArea.width) ? rightX : leftX;
    // 左侧也放不下(桌宠贴着左边缘)时钳回工作区内
    x = Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - PANEL_W);
    y = py;
    panelOffset = { dx: x - px, dy: y - py };
  } else {
    panelOffset = null;
  }
  y = Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - PANEL_H);
  panelWin.setBounds({ x, y, width: PANEL_W, height: PANEL_H });
  panelWin.show();
  panelWin.focus();
  pushPomodoro();
  pushTodos();
}

function pushSettingsToPanel() {
  const payload = publicSettings();
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('settings:push', payload);
}

function publicSettings() {
  return {
    pomodoroMin: settings.pomodoroMin,
    restMin: settings.restMin,
    pomodoroMode: settings.pomodoroMode === 'up' ? 'up' : 'down',
    sedentaryMin: settings.sedentaryMin,
    sedentaryOn: settings.sedentaryOn,
    wanderOn: settings.wanderOn,
    deliveryDir: settings.deliveryDir,
    springDrag: settings.springDrag,
    wanderIdleMin: settings.wanderIdleMin || 1,
    idleCooldownMin: settings.idleCooldownMin || 3,
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

  rebuildTrayMenu();
  tray.on('click', () => togglePanel());
}

// 每次切换形态/设置后重建菜单:跟随状态是动作而非状态项——
// 未手动选形态时所有单选圆圈全空;选了具体形态则只有它亮
function rebuildTrayMenu() {
  if (!tray) return;

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
    { label: '设置…', click: () => toggleSettingsWindow() },
    { type: 'separator' },
    { label: '显示面板', click: () => { if (!panelWin.isVisible()) togglePanel(); } },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]);

  tray.setContextMenu(menu);
}

function setManualForm(key) {
  settings.manualForm = key;
  saveSettings();
  applyPomodoroForm();
  rebuildTrayMenu();
}

// ---------------------------------------------------------------------------
// 文件搬运:拖文件到桌宠 → 移动(非复制)到 settings.deliveryDir
// ---------------------------------------------------------------------------
function uniqueDest(dir, name) {
  // 同名追加 (1) (2)…绝不覆盖
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = path.join(dir, name);
  let i = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${i})${ext}`);
    i += 1;
  }
  return candidate;
}

function moveOne(src, destDir) {
  const dest = uniqueDest(destDir, path.basename(src));
  try {
    fs.renameSync(src, dest);
    return { ok: true };
  } catch (err) {
    if (err.code !== 'EXDEV') return { ok: false, err };
    // 跨盘:文件 copy+unlink 兜底;目录无法跨盘 rename,跳过并提示
    const stat = fs.statSync(src);
    if (stat.isDirectory()) return { ok: false, err: new Error('跨盘目录不支持,已跳过') };
    try {
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
      return { ok: true };
    } catch (err2) {
      try { fs.unlinkSync(dest); } catch (_) { /* 清理失败忽略 */ }
      return { ok: false, err: err2 };
    }
  }
}

let carrying = false;
function deliverFiles(paths) {
  if (!paths.length || carrying) return;
  if (!settings.deliveryDir || !fs.existsSync(settings.deliveryDir)) {
    showBubble(pick('noDir'), 5000);
    notify('还没设置送货地址', '在面板的设置里选择目标文件夹吧~');
    return;
  }
  carrying = true;
  activity = 'carry';
  applyForm();
  showBubble('包裹送达中,稍等~', 4000);

  // 稍作停顿让送货 GIF 播出来,再逐个移动
  setTimeout(() => {
    let okCount = 0;
    let failCount = 0;
    for (const p of paths) {
      try {
        const r = moveOne(p, settings.deliveryDir);
        r.ok ? okCount += 1 : failCount += 1;
      } catch (_) { failCount += 1; }
    }
    carrying = false;
    activity = null;
    applyForm();
    const dirName = path.basename(settings.deliveryDir);
    if (okCount && !failCount) {
      notify('包裹送达', `${okCount} 个文件已移动到「${dirName}」`);
      showBubble(pick('carryOk'), 4000);
    } else if (okCount && failCount) {
      notify('部分送达', `成功 ${okCount} 个,失败 ${failCount} 个(详见「${dirName}」)`);
      showBubble(pick('carryOk'), 4000);
    } else {
      notify('送达失败', '文件没有送出去,请检查权限或路径');
      showBubble(pick('carryFail'), 5000);
    }
  }, 1200);
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

// 桌宠:柔性牵引(渲染端只发开始/结束信号,主进程 16ms 轮询光标做弹簧积分,
// 跟随带轻微滞后与过冲;光标快速移出小窗口也不丢跟踪)
const SPRING_K = 0.15;        // 弹性系数
const SPRING_DAMPING = 0.75;  // 阻尼(每帧速度衰减)
let drag = null;
ipcMain.on('pet:drag-begin', () => {
  if (!petWin || petWin.isDestroyed()) return;
  if (drag) { endDrag(); }    // 防御:上一次拖动会话未正常收尾时先清掉,避免双弹簧叠加
  stopWander();               // 牵引打断巡游
  stopIdlePose();             // 牵引打断小动作
  if (activity === 'fly') stopFlyHome(false);   // 拖动打断回巢飞行:留在拖放处
  noteUserAction();
  const c = screen.getCursorScreenPoint();
  const [px, py] = petWin.getPosition();
  drag = { ox: c.x - px, oy: c.y - py, vx: 0, vy: 0, x: px, y: py, moved: false };
  drag.poll = setInterval(() => {
    if (!drag || !petWin || petWin.isDestroyed()) { endDrag(); return; }
    const cur = screen.getCursorScreenPoint();
    // 防御:显示器配置变化等瞬间光标值可能异常,跳过本帧
    if (!Number.isFinite(cur.x) || !Number.isFinite(cur.y)) return;
    const tx = cur.x - drag.ox;
    const ty = cur.y - drag.oy;
    if (Math.abs(tx - drag.x) + Math.abs(ty - drag.y) > 2) drag.moved = true;

    if (settings.springDrag) {
      // 弹簧跟随:带弹性滞后与轻微过冲
      drag.vx = (drag.vx + (tx - drag.x) * SPRING_K) * SPRING_DAMPING;
      drag.vy = (drag.vy + (ty - drag.y) * SPRING_K) * SPRING_DAMPING;
      drag.x += drag.vx;
      drag.y += drag.vy;
      // 数值一旦污染(NaN/Infinity)就复位到目标点,避免向系统传非法参数
      if (!Number.isFinite(drag.x) || !Number.isFinite(drag.y)) {
        drag.x = tx; drag.y = ty; drag.vx = 0; drag.vy = 0;
      }
    } else {
      // v1 模式:1:1 跟手
      drag.x = tx; drag.y = ty;
    }
    try {
      // setBounds 显式带尺寸:Windows 非整数缩放下 setPosition 会因取整误差让窗口越变越大
      petWin.setBounds({ x: Math.round(drag.x), y: Math.round(drag.y), width: PET_SIZE, height: BUBBLE_H + PET_SIZE });
      // 面板开着时跟随桌宠一起动
      if (panelWin && !panelWin.isDestroyed() && panelWin.isVisible() && panelOffset) {
        panelWin.setBounds({
          x: Math.round(drag.x) + panelOffset.dx,
          y: Math.round(drag.y) + panelOffset.dy,
          width: PANEL_W,
          height: PANEL_H,
        });
      }
      syncTimerPos(Math.round(drag.x), Math.round(drag.y));
    } catch (_) { /* 窗口销毁竞态:下帧 isDestroyed 恢复时会收尾 */ }
  }, 16);
});
ipcMain.on('pet:drag-move', () => { /* 兼容保留:轮询已覆盖 */ });
ipcMain.on('pet:drag-end', endDrag);

function endDrag() {
  if (drag) {
    clearInterval(drag.poll);
    if (drag.moved && petWin && !petWin.isDestroyed()) {
      settings.petPos = { x: Math.round(drag.x), y: Math.round(drag.y) };
      saveSettings();
      if (pomodoro.phase === 'idle' && activity === null && Math.random() < 0.5) {
        showBubble(pick('drag'), 3000);
      }
    }
  }
  drag = null;
}

// ---------------------------------------------------------------------------
// 自由巡游:pomodoro idle + 无手动形态 + 闲置 wanderIdleMin 后开始,
// 随机目标点全屏漫游(骑行/探险/购物 GIF 每轮随机),可被拖动/点击/番茄钟打断
// ---------------------------------------------------------------------------
const WANDER_IDLE_MS = () => settings.wanderIdleMin * 60 * 1000;   // 闲置多久开始巡游(托盘设置可调)
const WANDER_COOLDOWN_MS = () => {
  // 冷却 = 设置值 ±1 随机分钟(默认 3 → 2~4 分钟)
  const base = Math.max(1, settings.idleCooldownMin || 3);
  const min = Math.max(1, base - 1);
  return (min + Math.random() * 2) * 60 * 1000;
};
const WANDER_SPEED = 120;               // px/s
const WANDER_TICK_MS = 33;
const WANDER_FORMS = ['wander', 'restAlt', 'restEnd'];   // 骑行/潜水/纸飞机
let currentWanderForm = 'wander';
let wander = null;        // { phase: 'walk'|'pause', target, poll }
let lastUserActionAt = Date.now();
let wanderCooldownUntil = 0;

function noteUserAction() {
  lastUserActionAt = Date.now();
}
let lastPomodoroActionAt = Date.now();

function stopWander() {
  if (wander) {
    clearInterval(wander.poll);
    wander = null;
    wanderCooldownUntil = Date.now() + WANDER_COOLDOWN_MS();
    if (activity === 'wander') { activity = null; applyForm(); }
  }
}

// ---------------------------------------------------------------------------
// 闲置小动作:随机播一段海边/购物/拍照/探险,几秒后回坐坐(与巡游共享计时和冷却)
// ---------------------------------------------------------------------------
const IDLE_POSE_FORMS = ['rest', 'wanderAlt2', 'workEnd', 'wanderAlt'];   // 海边/购物/拍照/探险
let idlePoseTimer = null;
let currentIdleForm = 'rest';

function stopIdlePose() {
  if (activity !== 'idlePose') return;
  clearTimeout(idlePoseTimer);
  idlePoseTimer = null;
  activity = null;
  applyForm();
  wanderCooldownUntil = Date.now() + WANDER_COOLDOWN_MS();
}

function startIdlePose() {
  if (!petWin || petWin.isDestroyed()) return;
  activity = 'idlePose';
  currentIdleForm = IDLE_POSE_FORMS[Math.floor(Math.random() * IDLE_POSE_FORMS.length)];
  applyForm();
  idlePoseTimer = setTimeout(() => {
    idlePoseTimer = null;
    if (activity !== 'idlePose') return;
    activity = null;
    applyForm();
    wanderCooldownUntil = Date.now() + WANDER_COOLDOWN_MS();
  }, 6000 + Math.random() * 2000);   // 播 6~8 秒(约 7 秒)回坐坐
}

// 交互/番茄钟等打断所有闲置活动
function interruptIdleActivities() {
  stopWander();
  stopIdlePose();
}

function startWanderSession() {
  if (!petWin || petWin.isDestroyed()) return;
  activity = 'wander';
  currentWanderForm = WANDER_FORMS[Math.floor(Math.random() * WANDER_FORMS.length)];
  applyForm();
  const { workArea } = screen.getPrimaryDisplay();
  const marginX = 30, marginY = 10;   // 目标点可贴近屏幕边缘,只需保证窗口不出屏
  const randPoint = () => ({
    x: workArea.x + marginX + Math.random() * Math.max(1, workArea.width - marginX * 2 - PET_SIZE),
    y: workArea.y + marginY + Math.random() * Math.max(1, workArea.height - marginY * 2 - (BUBBLE_H + PET_SIZE)),
  });

  const session = { targetsLeft: 1 + Math.floor(Math.random() * 3), target: randPoint(), pauseUntil: 0, poll: null };
  wander = session;

  session.poll = setInterval(() => {
    if (!wander || !petWin || petWin.isDestroyed()) { stopWander(); return; }
    // 巡游条件失效(手动形态/番茄钟启动/关闭开关)→ 停
    if (settings.manualForm || !settings.wanderOn ||
        ['work', 'workEnd', 'rest', 'restEnd'].includes(pomodoro.phase)) { stopWander(); return; }

    const [px, py] = petWin.getPosition();
    if (session.pauseUntil > Date.now()) {
      // 停顿中:小概率闲聊一句
      if (Math.random() < 0.005) showBubble(pick('wander'), 4000);
      return;
    }
    const dx = session.target.x - px;
    const dy = session.target.y - py;
    const dist = Math.hypot(dx, dy);
    if (dist < 8) {
      // 到达一个目标
      session.targetsLeft -= 1;
      if (session.targetsLeft <= 0) { stopWander(); return; }
      session.pauseUntil = Date.now() + 2000 + Math.random() * 2000;
      session.target = randPoint();
      return;
    }
    const step = (WANDER_SPEED * WANDER_TICK_MS) / 1000;
    // 移动方向翻转时通知渲染端镜像(朝向表 FACING)
    const movingSign = Math.sign(dx);
    if (movingSign !== 0 && movingSign !== session.dirSign) {
      session.dirSign = movingSign;
      const facing = FACING[currentWanderForm];
      const flip = (movingSign > 0 && facing === 'left') || (movingSign < 0 && facing === 'right');
      sendToPet('form:dir', { flip });
    }
    petWin.setBounds({
      x: Math.round(px + (dx / dist) * step),
      y: Math.round(py + (dy / dist) * step),
      width: PET_SIZE,
      height: BUBBLE_H + PET_SIZE,
    });
    syncTimerPos(Math.round(px + (dx / dist) * step), Math.round(py + (dy / dist) * step));
  }, WANDER_TICK_MS);
}

// 巡游调度:每秒检查是否该出发
setInterval(() => {
  if (fullscreenActive) return;
  if (!settings.wanderOn) return;
  if (settings.manualForm) return;
  if (activity !== null) return;
  if (['work', 'workEnd', 'rest', 'restEnd'].includes(pomodoro.phase)) return;
  if (drag) return;
  if (Date.now() < wanderCooldownUntil) return;
  if (Date.now() - lastUserActionAt >= WANDER_IDLE_MS() && Date.now() - lastPomodoroActionAt >= WANDER_IDLE_MS()) {
    // 闲置达标:50% 巡游,50% 单次小动作(海边/购物/拍照/探险)
    if (Math.random() < 0.5) startWanderSession(); else startIdlePose();
  }
}, 1000);

// 闲置闲聊:pomodoro idle、非巡游、桌宠可见时,随机 5~12 分钟一句
let nextChatAt = Date.now() + (5 + Math.random() * 7) * 60 * 1000;
setInterval(() => {
  if (Date.now() < nextChatAt) return;
  nextChatAt = Date.now() + (5 + Math.random() * 7) * 60 * 1000;
  if (settings.manualForm || activity !== null) return;
  if (pomodoro.phase !== 'idle') return;
  if (petWin && !petWin.isDestroyed() && petWin.isVisible()) showBubble(pick('idle'), 6000);
}, 30 * 1000);

// 桌宠:点击(未拖动时)开关面板
ipcMain.on('pet:toggle-panel', () => {
  noteUserAction();
  togglePanel();
});

// 桌宠:拖来文件(渲染端 drop 转发路径)
ipcMain.on('pet:deliver-files', (_e, paths) => {
  noteUserAction();
  deliverFiles(Array.isArray(paths) ? paths.filter((p) => typeof p === 'string') : []);
});

// 选择送货目标文件夹(面板设置与托盘设置共用)
async function chooseDeliveryDir() {
  const res = await dialog.showOpenDialog(panelWin, {
    title: '选择送货目标文件夹',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (!res.canceled && res.filePaths.length) {
    settings.deliveryDir = res.filePaths[0];
    saveSettings();
    showBubble('收到!以后包裹就送到这里~', 3000);
  }
  pushSettingsToPanel();
  rebuildTrayMenu();   // 刷新"快递地址:xxx"标签
  return settings.deliveryDir;
}

// 面板:番茄钟控制
ipcMain.on('panel:pomodoro-start', (_e, todo) => {
  noteUserAction();
  lastPomodoroActionAt = Date.now();
  boundTodoId = todo ? todo.id : null;
  startPomodoro(todo);
});
ipcMain.on('panel:pomodoro-pause', () => { noteUserAction(); lastPomodoroActionAt = Date.now(); pausePomodoro(); });
ipcMain.on('panel:pomodoro-skip', () => { noteUserAction(); lastPomodoroActionAt = Date.now(); skipPomodoro(); });
ipcMain.on('panel:pomodoro-stop', () => { noteUserAction(); lastPomodoroActionAt = Date.now(); stopPomodoro(); });

// 面板:绑定待办(仅高亮;开始番茄钟时一并记录)
ipcMain.on('panel:bind-todo', (_e, todoId) => {
  boundTodoId = todoId;
  pushTodos();
});

// 面板:设置保存(模式/时长等)
ipcMain.on('panel:settings-save', (_e, patch) => applySettingsPatch(patch));

// 设置保存(面板与设置窗口共用)
function applySettingsPatch(patch) {
  const num = (v, min, max, dft) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dft;
  };
  if (patch) {
    settings.pomodoroMin = num(patch.pomodoroMin, 1, 180, settings.pomodoroMin);
    settings.restMin = num(patch.restMin, 1, 60, settings.restMin);
    if (patch.pomodoroMode === 'down' || patch.pomodoroMode === 'up') settings.pomodoroMode = patch.pomodoroMode;
    settings.sedentaryMin = num(patch.sedentaryMin, 5, 240, settings.sedentaryMin);
    // 仅在显式提供时覆盖(面板的部分保存不含这些字段,避免被误重置)
    if (typeof patch.sedentaryOn === 'boolean') settings.sedentaryOn = patch.sedentaryOn;
    // 仅在提供时覆盖(面板的保存请求不含这些字段,避免被重置)
    if (typeof patch.springDrag === 'boolean') settings.springDrag = patch.springDrag;
    settings.wanderIdleMin = num(patch.wanderIdleMin, 1, 60, settings.wanderIdleMin || 1);
    settings.idleCooldownMin = num(patch.idleCooldownMin, 1, 60, settings.idleCooldownMin || 3);
    if (typeof patch.wanderOn === 'boolean') {
      settings.wanderOn = patch.wanderOn;
      if (!settings.wanderOn) interruptIdleActivities();
    }
    saveSettings();
  }
  // 改时长立即反映到未开始的阶段显示
  if (pomodoro.phase === 'idle') pushPomodoro();
  pushSettingsToPanel();
}

// 设置窗口:保存 / 就绪 / 关闭 / 选目录
ipcMain.on('appsettings:save', (_e, patch) => applySettingsPatch(patch));
ipcMain.on('appsettings:ready', () => {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('settings:push', publicSettings());
  }
});
ipcMain.on('appsettings:close', () => {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.hide();
});
ipcMain.handle('appsettings:choose-dir', chooseDeliveryDir);

// 面板就绪:全量推一次
ipcMain.on('panel:ready', () => {
  pushPomodoro();
  pushTodos();
  panelWin && !panelWin.isDestroyed() && panelWin.webContents.send('settings:push', publicSettings());
});

// ---------------------------------------------------------------------------
// 全屏让位(移植便签方案):常驻 PowerShell 轮询前台窗口,600ms/拍
// 前台窗口完整覆盖显示器且非桌面类名 → 全屏应用,三窗口隐藏让位;退出自愈恢复
// ---------------------------------------------------------------------------
const FS_SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd']);   // 桌面/任务栏不算全屏
let fsWatcher = null;
let panelWasVisible = false;
let settingsWasVisible = false;

function startFullscreenWatcher() {
  const ps = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
public class FW {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
}
"@
while ($true) {
  $h = [FW]::GetForegroundWindow()
  if ($h -ne [IntPtr]::Zero) {
    $r = New-Object RECT
    [void][FW]::GetWindowRect($h, [ref]$r)
    $ex = [FW]::GetWindowLong($h, -20)
    $sb = New-Object System.Text.StringBuilder 256
    [void][FW]::GetClassName($h, $sb, 256)
    Write-Output "$($r.Left),$($r.Top),$($r.Right),$($r.Bottom),$(($ex -band 8) -ne 0),$($sb.ToString())"
  }
  Start-Sleep -Milliseconds 600
}`;
  const b64 = Buffer.from(ps, 'utf16le').toString('base64');
  fsWatcher = spawn('powershell.exe', ['-NoProfile', '-EncodedCommand', b64], {
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });
  fsWatcher.stdout.setEncoding('utf8');
  let buf = '';
  fsWatcher.stdout.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) handleForegroundLine(line);
    }
  });
}

function handleForegroundLine(line) {
  if (!petWin || petWin.isDestroyed()) return;
  const parts = line.split(',');
  if (parts.length < 6) return;
  const L = +parts[0], T = +parts[1], R = +parts[2], B = +parts[3];
  const cls = parts.slice(5).join(',');
  const b = petWin.getBounds();
  const monitor = screen.getDisplayNearestPoint({ x: b.x + (b.width >> 1), y: b.y + (b.height >> 1) }).bounds;
  // 前台窗口完整覆盖整块屏幕(非 workArea)→ 全屏应用;桌面/任务栏类名排除,
  // 否则点一下桌面(Progman 全屏覆盖)会被误判成全屏
  const fs = L <= monitor.x && T <= monitor.y
    && R >= monitor.x + monitor.width && B >= monitor.y + monitor.height
    && !FS_SHELL_CLASSES.has(cls);
  if (fs !== fullscreenActive) {
    fullscreenActive = fs;
    applyOverlayRule();
  }
}

function applyOverlayRule() {
  if (!petWin || petWin.isDestroyed()) return;
  if (fullscreenActive) {
    // 让位:记录面板/设置/计时窗可见性,全部隐藏(桌宠必现,直接藏)
    panelWasVisible = panelWin && !panelWin.isDestroyed() && panelWin.isVisible();
    settingsWasVisible = settingsWin && !settingsWin.isDestroyed() && settingsWin.isVisible();
    timerWasVisible = timerWin && !timerWin.isDestroyed() && timerWin.isVisible();
    if (panelWin && !panelWin.isDestroyed() && panelWin.isVisible()) panelWin.hide();
    if (settingsWin && !settingsWin.isDestroyed() && settingsWin.isVisible()) settingsWin.hide();
    if (timerWin && !timerWin.isDestroyed() && timerWin.isVisible()) timerWin.hide();
    if (petWin.isVisible()) petWin.hide();
    return;
  }
  // 自愈:退出全屏后恢复(不抢焦点)
  if (!petWin.isVisible()) petWin.showInactive();
  if (panelWasVisible && panelWin && !panelWin.isDestroyed() && !panelWin.isVisible()) {
    panelWin.showInactive();
    panelWasVisible = false;
  }
  if (settingsWasVisible && settingsWin && !settingsWin.isDestroyed() && !settingsWin.isVisible()) {
    settingsWin.showInactive();
    settingsWasVisible = false;
  }
  if (timerWasVisible && timerWin && !timerWin.isDestroyed() && !timerWin.isVisible()) {
    timerWin.showInactive();
    timerWasVisible = false;
  }
}

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
    createSettingsWindow();
    createTimerWindow();
    buildTray();
    watchTodos();
    startFullscreenWatcher();
  });

  app.on('before-quit', () => { isQuitting = true; });

  app.on('window-all-closed', () => {
    // 托盘常驻:不主动退出,只有托盘"退出"才结束
  });
}
