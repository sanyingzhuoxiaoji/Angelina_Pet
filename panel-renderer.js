// 面板渲染端:番茄钟显示/控制、待办只读列表(点击绑定)、设置
'use strict';

const $ = (id) => document.getElementById(id);
const timeDisplay = $('time-display');
const phaseLabel = $('phase-label');
const bindLabel = $('bind-label');
const completedLabel = $('completed-label');
const btnStart = $('btn-start');
const btnSkip = $('btn-skip');
const btnStop = $('btn-stop');
const todoList = $('todo-list');
const todoEmpty = $('todo-empty');
const closeBtn = $('close-btn');

const PHASE_TEXT = {
  idle: '待机中',
  work: '专注工作中',
  workEnd: '干得漂亮!',
  rest: '休息中',
  restEnd: '休息结束,准备继续~',
};

let current = {
  phase: 'idle',
  remaining: 25 * 60,
  total: 25 * 60,
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

function renderPomodoro(st) {
  current = st;
  timeDisplay.textContent = fmt(st.remaining);
  timeDisplay.className =
    st.phase === 'work' || st.phase === 'workEnd' ? 'working'
      : st.phase === 'rest' || st.phase === 'restEnd' ? 'resting' : '';

  phaseLabel.textContent = (PHASE_TEXT[st.phase] || '待机中') + (st.paused && st.phase !== 'idle' ? '(已暂停)' : '');

  bindLabel.classList.toggle('hidden', !st.todo);
  if (st.todo) bindLabel.textContent = `🎯 ${st.todo.text}`;

  completedLabel.textContent = `今日完成 🍅 × ${st.completedToday}`;

  const running = st.phase !== 'idle';
  btnStart.textContent = running && st.paused ? '继续' : running ? '暂停' : '开始';
  btnSkip.disabled = !running;
  btnStop.disabled = !running;
}

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
    if (item.id === boundTodoId) li.classList.add('bound');
    li.addEventListener('click', () => {
      window.panelApi.bindTodo(item.id === boundTodoId ? null : item.id);
    });
    todoList.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------
function renderSettings(s) {
  $('set-pomodoro').value = s.pomodoroMin;
  $('set-rest').value = s.restMin;
  $('set-sedentary').value = s.sedentaryMin;
  $('set-sedentary-on').checked = s.sedentaryOn;
}

function collectAndSave() {
  window.panelApi.saveSettings({
    pomodoroMin: $('set-pomodoro').value,
    restMin: $('set-rest').value,
    sedentaryMin: $('set-sedentary').value,
    sedentaryOn: $('set-sedentary-on').checked,
  });
}
for (const id of ['set-pomodoro', 'set-rest', 'set-sedentary', 'set-sedentary-on']) {
  $(id).addEventListener('change', collectAndSave);
}

// ---------------------------------------------------------------------------
// 其他
// ---------------------------------------------------------------------------
closeBtn.addEventListener('click', () => window.panelApi.close());

window.panelApi.onPomodoroTick(renderPomodoro);
window.panelApi.onTodos(renderTodos);
window.panelApi.onSettings(renderSettings);
window.panelApi.ready();
