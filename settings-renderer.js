// 设置窗口渲染端
'use strict';

const $ = (id) => document.getElementById(id);

function renderSettings(s) {
  $('set-spring').checked = s.springDrag;
  $('set-autostart').checked = s.autoStart;
  // 实际生效与期望不符(被拦截)时提示
  $('autostart-hint').classList.toggle('hidden', !s.autoStart || !!s.autoStartOk);
  $('set-sedentary-on').checked = s.sedentaryOn;
  $('set-sedentary').value = s.sedentaryMin;
  $('set-wander-on').checked = s.wanderOn;
  $('set-wander-idle').value = s.wanderIdleMin || 1;
  $('set-cooldown').value = s.idleCooldownMin || 3;
  const dirEl = $('delivery-dir');
  dirEl.textContent = s.deliveryDir || '未设置';
  dirEl.title = s.deliveryDir || '';
}

function collectAndSave() {
  window.appSettingsApi.save({
    springDrag: $('set-spring').checked,
    autoStart: $('set-autostart').checked,
    sedentaryOn: $('set-sedentary-on').checked,
    sedentaryMin: $('set-sedentary').value,
    wanderOn: $('set-wander-on').checked,
    wanderIdleMin: $('set-wander-idle').value,
    idleCooldownMin: $('set-cooldown').value,
  });
}
for (const id of ['set-spring', 'set-autostart', 'set-sedentary-on', 'set-sedentary', 'set-wander-on', 'set-wander-idle', 'set-cooldown']) {
  $(id).addEventListener('change', collectAndSave);
}

$('choose-dir-btn').addEventListener('click', async () => {
  const dir = await window.appSettingsApi.chooseDir();
  const dirEl = $('delivery-dir');
  dirEl.textContent = dir || '未设置';
  dirEl.title = dir || '';
});

$('close-btn').addEventListener('click', () => window.appSettingsApi.close());

window.appSettingsApi.onSettings(renderSettings);
window.appSettingsApi.ready();
