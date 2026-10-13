// 计时小窗渲染端:显示 MM:SS,工作橘红/休息青绿
'use strict';

const el = document.getElementById('timer-text');

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

window.timerApi.onPomodoroTick((st) => {
  const running = st.phase !== 'idle';
  el.style.display = running ? 'flex' : 'none';
  if (!running) return;
  el.textContent = fmt(st.remaining);
  el.className = ['rest', 'restEnd'].includes(st.phase) ? 'resting' : '';
});
