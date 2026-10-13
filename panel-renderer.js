// 面板渲染端:番茄钟显示/控制(含模式与时长)、待办只读列表(点击绑定)
'use strict';

const $ = (id) => document.getElementById(id);
const timeDigit = $('time-digit');
const phaseText = $('phase-text');
const completedLabel = $('completed-label');
const btnStart = $('btn-start');
const btnSkip = $('btn-skip');
const btnStop = $('btn-stop');
const todoList = $('todo-list');
const todoEmpty = $('todo-empty');
const setPomodoro = $('set-pomodoro');
const setRest = $('set-rest');
const bindHint = $('bind-hint');
const timechip = document.getElementById('timechip');
const modeButtons = [...document.querySelectorAll('.mode-btn')];

const PHASE_TEXT = {
  idle: '',
  work: 'FOCUS',
  workEnd: 'DONE!',
  rest: 'BREAK',
  restEnd: 'GO!',
};

let current = {
  phase: 'idle',
  remaining: 0,
  total: 0,
  mode: 'down',
  paused: false,
  completedToday: 0,
  todo: null,
};
let todos = [];
let boundTodoId = null;

// ---------------------------------------------------------------------------
// 番茄钟状态渲染
// ---------------------------------------------------------------------------
function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function renderMode(mode, running) {
  for (const btn of modeButtons) {
    btn.classList.toggle('active', btn.dataset.mode === mode);
    btn.disabled = running;   // 运行中锁定,空闲时可切
  }
}

function renderPomodoro(st) {
  current = st;
  renderMode(st.mode || 'down', st.phase !== 'idle');
  timeDigit.textContent = fmt(st.remaining);
  timechip.classList.toggle('resting', ['rest', 'restEnd'].includes(st.phase));

  let chipText = PHASE_TEXT[st.phase] || 'FOCUS';
  if (st.paused && st.phase !== 'idle') chipText += ' · PAUSED';
  phaseText.textContent = chipText;

  bindHint.classList.toggle('hidden', !st.todo);
  if (st.todo) bindHint.textContent = `🎯 ${st.todo.text}`;

  completedLabel.textContent = `今日完成 🍅 × ${st.completedToday}`;

  // 时长回填:仅空闲且输入框未聚焦,避免打断输入
  const fill = (input, val) => {
    if (document.activeElement !== input && input.value !== String(val)) input.value = val;
  };
  fill(setPomodoro, st.pomodoroMin);
  fill(setRest, st.restMin);
  setPomodoro.disabled = setRest.disabled = st.phase !== 'idle';

  const running = st.phase !== 'idle';
  btnStart.textContent = running && st.paused ? '继续' : running ? '暂停' : '开始';
  btnSkip.disabled = !running;
  btnStop.disabled = !running;
}

// ---------------------------------------------------------------------------
// 待办列表(只读;点击=绑定/解绑)
// ---------------------------------------------------------------------------
function renderTodos(payload) {
  todos = payload.items || [];
  boundTodoId = payload.boundTodoId;

  todoList.textContent = '';
  if (!payload.available) {
    todoEmpty.textContent = '未找到便签数据(需要先运行桌面便签一次)';
    todoEmpty.classList.remove('hidden');
    return;
  }
  if (!todos.length) {
    todoEmpty.textContent = '没有进行中的待办,休息一下吧~';
    todoEmpty.classList.remove('hidden');
    return;
  }
  todoEmpty.classList.add('hidden');

  for (const item of todos) {
    const li = document.createElement('li');
    li.textContent = item.text;
    li.title = '点击绑定为本次番茄钟目标';
    const mark = document.createElement('span');
    mark.className = 'tomato';
    mark.textContent = item.id === boundTodoId ? '🍅 目标' : (item.remindAt ? '🔔' : '');
    if (item.id === boundTodoId) li.classList.add('bound');
    li.appendChild(mark);
    li.addEventListener('click', () => {
      window.panelApi.bindTodo(item.id === boundTodoId ? null : item.id);
    });
    todoList.appendChild(li);
  }
}

function boundTodoItemKey(item) { return item.id; }

// ---------------------------------------------------------------------------
// 控制
// ---------------------------------------------------------------------------
btnStart.addEventListener('click', () => {
  if (current.phase === 'idle') {
    const todo = todos.find((t) => t.id === boundTodoId) || null;
    window.panelApi.pomodoroStart(todo);
  } else {
    window.panelApi.pomodoroPause();
  }
});
btnSkip.addEventListener('click', () => window.panelApi.pomodoroSkip());
btnStop.addEventListener('click', () => window.panelApi.pomodoroStop());

// 时长修改(空闲时可改,change 即保存)
setPomodoro.addEventListener('change', () => {
  window.panelApi.saveSettings({ pomodoroMin: setPomodoro.value });
});
setRest.addEventListener('change', () => {
  window.panelApi.saveSettings({ restMin: setRest.value });
});

// ---------------------------------------------------------------------------
// 主进程推送接入
// ---------------------------------------------------------------------------
window.panelApi.onPomodoroTick(renderPomodoro);
window.panelApi.onTodos(renderTodos);
window.panelApi.ready();
