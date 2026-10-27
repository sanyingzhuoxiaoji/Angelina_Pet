'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');

// Electron windows and OS services are replaced so the real main-process state
// transitions can run without touching the user's settings or launching a pet.
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const appRequire = createRequire(path.join(root, 'main.js'));

function createHarness() {
  let now = new Date(2026, 9, 26, 23, 59, 59).getTime();
  const ipcMain = new EventEmitter();
  ipcMain.handle = () => {};
  const electron = {
    app: { setPath() {}, setAppUserModelId() {}, getPath: () => root,
      requestSingleInstanceLock: () => false, quit() {} },
    ipcMain,
    Notification: { isSupported: () => false },
    screen: { getDisplayNearestPoint: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  };
  const context = vm.createContext({
    __dirname: root, console, process, Buffer,
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    },
    require: (name) => name === 'electron' ? electron
      : name === 'fs' ? { readFileSync: () => '{}' } : appRequire(name),
    setInterval: () => 1, clearInterval() {},
    setTimeout: () => 1, clearTimeout() {},
  });
  vm.runInContext(source, context, { filename: 'main.js' });
  vm.runInContext(`
    function testWindow() {
      return {
        visible: true, messages: [],
        isDestroyed: () => false,
        isVisible() { return this.visible; },
        showInactive() { this.visible = true; },
        hide() { this.visible = false; },
        getPosition: () => [500, 100],
        getBounds: () => ({ x: 500, y: 100, width: 240, height: 390 }),
        setBounds() {},
        webContents: { send() {} },
      };
    }
    petWin = testWindow();
    timerWin = testWindow();
    panelWin = testWindow();
    panelWin.webContents.send = (channel, payload) => panelWin.messages.push({ channel, payload });
    settingsWin = testWindow();
  `, context);
  return {
    run: (code) => vm.runInContext(code, context),
    midnight: () => { now = new Date(2026, 9, 27, 0, 0, 1).getTime(); },
  };
}

for (const [name, prepare, finish] of [
  ['countdown completion', "pomodoro.mode = 'down'; pomodoro.remaining = 1;", 'onTick()'],
  ['countdown skip', "pomodoro.mode = 'down'; pomodoro.remaining = 30;", 'skipPomodoro()'],
  ['count-up completion', "pomodoro.mode = 'up'; pomodoro.elapsed = 60;", 'stopPomodoro()'],
]) {
  test(`${name}: midnight resets yesterday's count before adding a completion`, () => {
    const h = createHarness();
    h.run("settings.completedDate = todayStr(); settings.completedToday = 8; settings.pomodoroMin = 1;");
    h.midnight();
    assert.equal(h.run('completedToday()'), 0);
    for (const expected of [1, 2]) {
      h.run(`pomodoro.phase = 'work'; pomodoro.total = 60; pomodoro.paused = false; ${prepare} ${finish};`);
      assert.equal(h.run('completedToday()'), expected);
      assert.equal(h.run('settings.completedToday'), expected);
      assert.equal(h.run('settings.completedDate'), '2026-10-27');
    }
  });
}

test('fullscreen keeps pet and timer hidden across ticks and restores an active timer', () => {
  const h = createHarness();
  h.run("pomodoro.phase = 'work'; pomodoro.remaining = 60; pomodoro.total = 60;");
  h.run("handleForegroundLine('0,0,1920,1080,false,FullscreenGame')");
  assert.equal(h.run('petWin.isVisible()'), false);
  assert.equal(h.run('timerWin.isVisible()'), false);
  h.run('onTick(); pausePomodoro();');
  assert.equal(h.run('timerWin.isVisible()'), false);
  h.run("handleForegroundLine('100,100,1400,900,false,NormalWindow')");
  assert.equal(h.run('petWin.isVisible()'), true);
  assert.equal(h.run('timerWin.isVisible()'), true);
  assert.equal(h.run('pomodoro.remaining'), 59);
});

test('a session ending during fullscreen does not restore a stale timer on exit', () => {
  const h = createHarness();
  h.run("pomodoro.phase = 'restEnd'; pomodoro.remaining = 1;");
  h.run("handleForegroundLine('0,0,1920,1080,false,FullscreenGame'); onTick();");
  assert.equal(h.run('pomodoro.phase'), 'idle');
  h.run("handleForegroundLine('100,100,1400,900,false,NormalWindow')");
  assert.equal(h.run('petWin.isVisible()'), true);
  assert.equal(h.run('timerWin.isVisible()'), false);
});
