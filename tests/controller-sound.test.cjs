const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Sound = require('../static/controller/sound.js');
const C = require('../static/controller/core.js');

test('every sound the player can ask for exists in the bundled set', () => {
  for (const name of Sound.FILES) assert.ok(fs.existsSync(path.join(__dirname, '../static/sounds/dualsense', name + '.mp3')), name);
});

test('events map to the right files; create/options has no release sound', () => {
  assert.equal(Sound.fileFor('btn', true), 'btn-press');
  assert.equal(Sound.fileFor('dpad', false), 'dpad-release');
  assert.equal(Sound.fileFor('touch', true), 'touch-press');
  assert.equal(Sound.fileFor('stick', false), 'stick-release');
  assert.equal(Sound.fileFor('create_options', true), 'create_options-press');
  assert.equal(Sound.fileFor('create_options', false), null);
  assert.equal(Sound.fileFor('nonsense', true), null);
});

test('every category the core can emit has a press sound', () => {
  for (let i = 0; i < 18; i++) assert.ok(Sound.fileFor(C.soundCategory(i), true), 'button ' + i);
});

test('a disabled player never plays and never throws', () => {
  const player = new Sound.Player({ enabled: false });
  assert.equal(player.play('btn', true), false);
  player.start();
});
