// 桌宠窗口渲染端:GIF 形态切换、气泡、点击穿透、拖动、点击开面板
'use strict';

const pet = document.getElementById('pet');
const bubble = document.getElementById('bubble');

// 状态 → GIF 路径(与 main.js GIFS 保持一致)
const FORM_SRC = {
  idle: 'Angelina/GIF/坐坐.gif',
  work: 'Angelina/GIF/看书.gif',
  workEnd: 'Angelina/GIF/拍照.gif',
  rest: 'Angelina/GIF/海边.gif',
  restAlt: 'Angelina/GIF/潜水.gif',
  restEnd: 'Angelina/GIF/纸飞机.gif',
  wander: 'Angelina/GIF/骑行.gif',      // v2 预留
  wanderAlt: 'Angelina/GIF/探险.gif',   // v2 预留
  wanderAlt2: 'Angelina/GIF/购物.gif',  // v2 预留
  carry: 'Angelina/GIF/送货.gif',       // v2 预留
};

// ---------------------------------------------------------------------------
// 形态切换 + 方向镜像
// ---------------------------------------------------------------------------
window.angelinaApi.onForm((form) => {
  const src = FORM_SRC[form] || FORM_SRC.idle;
  if (pet.getAttribute('src') !== src) pet.setAttribute('src', src);
  pet.style.transform = '';          // 换形态复位镜像,由 form:dir 重新决定
});

window.angelinaApi.onDir(({ flip }) => {
  pet.style.transform = flip ? 'scaleX(-1)' : '';
});

// ---------------------------------------------------------------------------
// 气泡
// ---------------------------------------------------------------------------
let bubbleTimer = null;
window.angelinaApi.onBubble(({ text, duration }) => {
  bubble.textContent = text;
  bubble.classList.remove('hidden');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.add('hidden'), duration || 5000);
});

// ---------------------------------------------------------------------------
// 点击穿透:鼠标不在可交互元素上时,让窗口透明区域放行点击
// (setIgnoreMouseEvents forward:true 模式下 mousemove 仍会送达渲染端)
// ---------------------------------------------------------------------------
let ignoring = true;
document.addEventListener('mousemove', (e) => {
  const overInteractive = !!(e.target.closest && e.target.closest('.interactive')) ||
    !bubble.classList.contains('hidden');
  if (overInteractive !== !ignoring) {
    ignoring = !overInteractive;
    window.angelinaApi.mouseMode(ignoring);
  }
  if (mouseDown) window.angelinaApi.dragMove();
});

// ---------------------------------------------------------------------------
// 拖动 + 点击(拖动超过阈值不算点击;判定范围限定在角色主体,透明边角不算)
// ---------------------------------------------------------------------------
let mouseDown = false;
let downX = 0;
let downY = 0;

// 角色主体判定:img 中央竖向区域(素材左右各有透明留白,不含发梢/扫帚尖等突出物)
function withinCharacter(e) {
  const r = pet.getBoundingClientRect();
  return e.clientX >= r.left + r.width * 0.15 &&
         e.clientX <= r.left + r.width * 0.85 &&
         e.clientY >= r.top + r.height * 0.05;
}

pet.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (!withinCharacter(e)) return;   // 透明边角不触发拖动/点击
  mouseDown = true;
  downX = e.screenX;
  downY = e.screenY;
  window.angelinaApi.dragBegin();
});

document.addEventListener('mouseup', () => {
  if (!mouseDown) return;
  mouseDown = false;
  window.angelinaApi.dragEnd();
});

pet.addEventListener('click', (e) => {
  if (!withinCharacter(e)) return;   // 缩小判定范围
  // 拖动过的松手不触发面板开关
  if (Math.abs(e.screenX - downX) + Math.abs(e.screenY - downY) > 4) return;
  window.angelinaApi.togglePanel();
});

// ---------------------------------------------------------------------------
// 文件搬运:拖文件到安洁莉娜身上 → 主进程移动到送货文件夹
// (光标经过桌宠本体时点击穿透已关闭,窗口可正常接收拖放)
// ---------------------------------------------------------------------------
document.addEventListener('dragover', (e) => {
  if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }
});

document.addEventListener('drop', (e) => {
  if (!e.dataTransfer || !e.dataTransfer.files.length) return;
  e.preventDefault();
  const paths = [...e.dataTransfer.files]
    .map((f) => window.angelinaApi.pathForFile(f))
    .filter(Boolean);
  if (paths.length) window.angelinaApi.deliverFiles(paths);
});
