// 计时小窗渲染端:手账纸片显示 MM:SS,FOCUS/BREAK 标签,工作橘红/休息青绿
'use strict';

const chip = document.getElementById('chip');
const tag = document.getElementById('tag');
const el = document.getElementById('timer-text');

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

window.timerApi.onPomodoroTick((st) => {
  const running = st.phase !== 'idle';
  chip.style.display = running ? 'block' : 'none';
  if (!running) return;
  el.textContent = fmt(st.remaining);
  const isRest = ['rest', 'restEnd'].includes(st.phase);
  chip.classList.toggle('resting', isRest);
  tag.textContent = isRest ? 'BREAK' : 'FOCUS';
});
