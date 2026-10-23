const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../static/controller/core.js');

const pad = (pressed = [], axes = [0, 0, 0, 0], extra = {}) => ({
  index: 0, connected: true, axes,
  buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0, ...(extra[i] || {}) })),
});

test('detects the controller type from its name', () => {
  assert.equal(C.detectType('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)'), 'xbox');
  assert.equal(C.detectType('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'), 'xbox');
  assert.equal(C.detectType('Some Unknown Pad'), 'xbox');
  assert.equal(C.detectType(undefined), 'xbox');
});

test('radial deadzone removes drift and still reaches full tilt', () => {
  assert.deepEqual(C.stick(0.05, -0.05, 0.12), { x: 0, y: 0, magnitude: 0 });
  const full = C.stick(1, 0, 0.12);
  assert.equal(full.x, 1);
  const diagonal = C.stick(1, 1, 0.12);                       // a square gate reports up to 1.41; must clamp to the unit circle
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-9);
  const mid = C.stick(0.56, 0, 0.12);
  assert.ok(mid.x > 0.4 && mid.x < 0.6);
  assert.deepEqual(C.stick(NaN, undefined, 0.1), { x: 0, y: 0, magnitude: 0 });
});

test('buttons are grouped into the recorded sound categories', () => {
  assert.equal(C.soundCategory(C.BUTTONS.south), 'btn');
  assert.equal(C.soundCategory(C.BUTTONS.lt), 'btn');
  assert.equal(C.soundCategory(C.BUTTONS.l3), 'btn');
  assert.equal(C.soundCategory(C.BUTTONS.home), 'btn');
  assert.equal(C.soundCategory(C.BUTTONS.up), 'dpad');
  assert.equal(C.soundCategory(C.BUTTONS.right), 'dpad');
  assert.equal(C.soundCategory(C.BUTTONS.extra), 'touch');
  assert.equal(C.soundCategory(C.BUTTONS.view), 'create_options');
  assert.equal(C.soundCategory(C.BUTTONS.menu), 'create_options');
});

test('diff reports presses and releases once, not every frame', () => {
  assert.deepEqual(C.diff(pad(), pad([0])), [{ type: 'button', index: 0, pressed: true, category: 'btn' }]);
  assert.deepEqual(C.diff(pad([0]), pad([0])), []);
  assert.deepEqual(C.diff(pad([0]), pad()), [{ type: 'button', index: 0, pressed: false, category: 'btn' }]);
  assert.equal(C.diff(null, pad([12])).length, 1);          // first sample with a held button
  assert.equal(C.diff(pad(), pad([12, 0])).length, 2);
});

test('analog triggers count as pressed past a threshold', () => {
  const light = pad([], [0, 0, 0, 0], { 7: { value: 0.2, pressed: false } });
  const firm = pad([], [0, 0, 0, 0], { 7: { value: 0.8, pressed: false } });
  assert.deepEqual(C.diff(pad(), light), []);
  assert.equal(C.diff(light, firm)[0].index, 7);
  assert.equal(C.isPressed(0.9), true);
  assert.equal(C.isPressed(undefined), false);
});

test('stick moves produce one event on leaving and one on returning to centre', () => {
  const moved = C.diff(pad(), pad([], [0.9, 0, 0, 0]));
  assert.deepEqual(moved, [{ type: 'stick', side: 'left', active: true, category: 'stick' }]);
  assert.deepEqual(C.diff(pad([], [0.9, 0, 0, 0]), pad([], [0.95, 0.1, 0, 0])), []);
  assert.deepEqual(C.diff(pad([], [0.9, 0, 0, 0]), pad()), [{ type: 'stick', side: 'left', active: false, category: 'stick' }]);
  assert.equal(C.diff(pad(), pad([], [0, 0, 0, -1]))[0].side, 'right');
  assert.deepEqual(C.diff(pad(), pad([], [0.05, 0.05, 0, 0])), []);   // drift never triggers a sound
});

test('options are validated and clamped', () => {
  const d = C.options('');
  assert.equal(d.controller, 'xbox'); assert.equal(d.sound, false); assert.equal(d.volume, 0.6); assert.equal(d.device, null);
  assert.equal(d.hint, false);
  const o = C.options('?device=1&sound=1&vol=500&dead=-4&scale=9999&body=%23ffffff&accent=zzz&bg=00ff00&hint=0');
  assert.equal(o.controller, 'xbox'); assert.equal(o.device, 1); assert.equal(o.sound, true);
  assert.equal(o.volume, 1); assert.equal(o.deadzone, 0); assert.equal(o.scale, 3);
  assert.equal(o.body, '#ffffff'); assert.equal(o.accent, '#35e0a1'); assert.equal(o.bg, '#00ff00');
  assert.equal(o.hint, false);
  assert.equal(C.options('?hint=1').hint, true);
  assert.equal(C.options('?controller=evil"><script>').controller, 'xbox');
  assert.equal(C.options('?device=-1').device, null);
  assert.equal(C.options('?body=red;background:url(x)').body, '');
});

test('toQuery round-trips and leaves defaults out', () => {
  assert.equal(C.toQuery(C.options('')), '');
  assert.equal(C.toQuery({ ...C.options(''), hint: true }), '?hint=1');
  const q = C.toQuery({ ...C.options(''), sound: true, volume: 0.4, body: '#101010', scale: 1.5 });
  assert.equal(q, '?sound=1&vol=40&scale=150&body=101010');
  const back = C.options(q);
  assert.equal(back.controller, 'xbox'); assert.equal(back.volume, 0.4); assert.equal(back.scale, 1.5); assert.equal(back.body, '#101010');
});

test('pickPad chooses the requested device or the first connected one', () => {
  const a = { index: 0, connected: true, id: 'a' }, b = { index: 1, connected: true, id: 'b' };
  assert.equal(C.pickPad([null, a, b], null).id, 'a');
  assert.equal(C.pickPad([a, b], 1).id, 'b');
  assert.equal(C.pickPad([a], 3), null);
  assert.equal(C.pickPad([null, null], null), null);
  assert.equal(C.pickPad(undefined, null), null);
});

test('demo pad presses every control, moves sticks and ramps triggers', () => {
  const seen = new Set(); let stickMoved = false, triggerPartial = false;
  for (let ms = 0; ms < 450 * 18 * 3; ms += 50) {
    const pad = C.demoPad(ms);
    pad.buttons.forEach((b, i) => { if (b.pressed) seen.add(i); if ((i === 6 || i === 7) && b.pressed && b.value < 1) triggerPartial = true; });
    if (C.stick(pad.axes[0], pad.axes[1], 0.1).magnitude > 0.5) stickMoved = true;
    assert.ok(pad.axes.every((v) => Math.abs(v) <= 1.0001));
    assert.equal(pad.buttons.length, 18);
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.ok(stickMoved && triggerPartial);
  assert.match(C.demoPad(0).id, /Xbox/);
  assert.equal(C.detectType(C.demoPad(0).id), 'xbox');
  assert.equal(C.options('?demo=1').demo, true);
  assert.equal(C.options('').demo, false);
});

test('skins expose every control the overlay updates', () => {
  const Skins = require('../static/controller/skins.js');
  for (const type of ['xbox']) {
    const html = Skins[type]();
    for (let i = 0; i <= 15; i++) assert.ok(html.includes('data-btn="' + i + '"'), type + ' is missing button ' + i);
    assert.ok(html.includes('data-stick="L"') && html.includes('data-stick="R"'), type + ' sticks');
    assert.ok(html.includes('data-trig="L"') && html.includes('data-trig="R"'), type + ' triggers');
    assert.ok(Skins.size[type][0] > 0 && Skins.travel[type] > 0 && Skins.triggerMode[type]);
  }
  assert.equal(C.options('?variant=white').variant, 'white');
  assert.equal(C.options('?variant=evil').variant, '');
  assert.equal(C.toQuery({ ...C.options(''), variant: 'white' }), '?variant=white');
});
