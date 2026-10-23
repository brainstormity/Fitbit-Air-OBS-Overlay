/*
 * Controller overlay core: pure logic with no DOM access, so it runs in the browser and in Node tests.
 * Button numbers follow the W3C "standard" Gamepad layout that Xbox and DualSense pads both report.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ControllerCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BUTTONS = {
    south: 0, east: 1, west: 2, north: 3,        // A/B/X/Y on Xbox, cross/circle/square/triangle on DualSense
    lb: 4, rb: 5, lt: 6, rt: 7,
    view: 8, menu: 9, l3: 10, r3: 11,
    up: 12, down: 13, left: 14, right: 15,
    home: 16, extra: 17,                          // Xbox/PS button, and the DualSense touchpad press (Xbox: Share, if reported)
  };

  const TRIGGER_THRESHOLD = 0.35;
  const STICK_MOVE_THRESHOLD = 0.35;

  /** Pick a look from the controller's reported name. Unknown pads use the Xbox layout, which is what "standard" maps to. */
  function detectType(id) {
    const text = String(id || '').toLowerCase();
    if (/dualsense|dualshock|054c|playstation|ps5|ps4|wireless controller.*054c/.test(text)) return 'dualsense';
    return 'xbox';
  }

  /** Radial deadzone with rescaling, so a stick resting slightly off centre reads exactly 0 and full tilt still reads 1. */
  function stick(x, y, deadzone) {
    const dead = clamp(deadzone === undefined ? 0.12 : deadzone, 0, 0.9);
    const magnitude = Math.hypot(x || 0, y || 0);
    if (!isFinite(magnitude) || magnitude <= dead) return { x: 0, y: 0, magnitude: 0 };
    const scaled = Math.min(1, (magnitude - dead) / (1 - dead));
    return { x: (x / magnitude) * scaled, y: (y / magnitude) * scaled, magnitude: scaled };
  }

  /** Which of the bundled click sounds a button uses (same grouping as the recorded DualSense set). */
  function soundCategory(index) {
    if (index === BUTTONS.up || index === BUTTONS.down || index === BUTTONS.left || index === BUTTONS.right) return 'dpad';
    if (index === BUTTONS.extra) return 'touch';
    if (index === BUTTONS.view || index === BUTTONS.menu) return 'create_options';
    return 'btn';
  }

  function isPressed(button) {
    if (!button) return false;
    if (typeof button === 'number') return button > TRIGGER_THRESHOLD;
    return !!button.pressed || (button.value || 0) > TRIGGER_THRESHOLD;
  }

  /** Compare two samples of a pad and return what changed: button edges and stick moves. */
  function diff(previous, current, deadzone) {
    const events = [];
    const count = Math.max((previous && previous.buttons.length) || 0, current.buttons.length);
    for (let i = 0; i < count; i++) {
      const was = previous ? isPressed(previous.buttons[i]) : false;
      const now = isPressed(current.buttons[i]);
      if (was !== now) events.push({ type: 'button', index: i, pressed: now, category: soundCategory(i) });
    }
    ['left', 'right'].forEach((side, n) => {
      const before = previous ? stick(previous.axes[n * 2], previous.axes[n * 2 + 1], deadzone).magnitude > STICK_MOVE_THRESHOLD : false;
      const after = stick(current.axes[n * 2], current.axes[n * 2 + 1], deadzone).magnitude > STICK_MOVE_THRESHOLD;
      if (before !== after) events.push({ type: 'stick', side, active: after, category: 'stick' });
    });
    return events;
  }

  function clamp(value, low, high) {
    const number = Number(value);
    return Math.min(high, Math.max(low, isFinite(number) ? number : low));
  }

  const COLOR = /^[0-9a-f]{3}([0-9a-f]{3})?$/i;
  function color(value, fallback) {
    const text = String(value || '').replace(/^#/, '');
    return COLOR.test(text) ? '#' + text : fallback;
  }

  /** Read the overlay settings from a URL query string. Every value is validated; nothing is trusted. */
  function options(search) {
    const params = new URLSearchParams(search || '');
    const type = params.get('controller');
    const device = params.get('device');
    return {
      controller: type === 'xbox' || type === 'dualsense' ? type : 'auto',
      device: device !== null && /^\d+$/.test(device) ? Number(device) : null,
      sound: params.get('sound') === '1',
      volume: clamp(params.has('vol') ? params.get('vol') : 60, 0, 100) / 100,
      deadzone: clamp(params.has('dead') ? params.get('dead') : 12, 0, 60) / 100,
      scale: clamp(params.has('scale') ? params.get('scale') : 100, 20, 300) / 100,
      body: color(params.get('body'), ''),
      accent: color(params.get('accent'), '#35e0a1'),
      bg: color(params.get('bg'), ''),
      hint: params.get('hint') === '1' || params.get('hint') === 'true',
      demo: params.get('demo') === '1',
      variant: params.get('variant') === 'white' ? 'white' : '',
    };
  }

  /** Build a query string from settings, leaving out anything at its default so URLs stay short. */
  function toQuery(settings) {
    const defaults = options('');
    const parts = [];
    const add = (key, value) => parts.push(key + '=' + encodeURIComponent(value));
    if (settings.controller && settings.controller !== 'auto') add('controller', settings.controller);
    if (settings.device !== null && settings.device !== undefined && settings.device !== '') add('device', settings.device);
    if (settings.sound) add('sound', 1);
    if (settings.sound && Math.round(settings.volume * 100) !== Math.round(defaults.volume * 100)) add('vol', Math.round(settings.volume * 100));
    if (Math.round(settings.deadzone * 100) !== Math.round(defaults.deadzone * 100)) add('dead', Math.round(settings.deadzone * 100));
    if (Math.round(settings.scale * 100) !== 100) add('scale', Math.round(settings.scale * 100));
    if (settings.body) add('body', settings.body.replace('#', ''));
    if (settings.accent && settings.accent !== defaults.accent) add('accent', settings.accent.replace('#', ''));
    if (settings.bg) add('bg', settings.bg.replace('#', ''));
    if (settings.hint) add('hint', 1);
    if (settings.demo) add('demo', 1);
    if (settings.variant === 'white') add('variant', 'white');
    return parts.length ? '?' + parts.join('&') : '';
  }

  /** Choose the pad to show: the requested index if given, otherwise the first connected one. */
  function pickPad(pads, device) {
    const list = Array.prototype.slice.call(pads || []).filter(Boolean);
    if (device !== null && device !== undefined) return list.find((pad) => pad.index === device) || null;
    return list.find((pad) => pad.connected !== false) || null;
  }

  /**
   * A scripted fake controller for previews and screenshots: no hardware needed. Every ~450 ms it presses the next
   * control, while the sticks circle and the triggers ramp, so every part of the skin and every sound gets shown.
   */
  function demoPad(ms, type) {
    const order = [0, 1, 2, 3, 4, 5, 12, 15, 13, 14, 8, 9, 10, 11, 16, 17, 6, 7];
    const step = Math.floor(ms / 450);
    const active = order[step % order.length];
    const pressed = Math.floor((ms % 450) / 450 * 100) < 70;           // held for the first 70% of each step
    const t = ms / 1000;
    const buttons = Array.from({ length: 18 }, (_, i) => ({ pressed: false, value: 0 }));
    if (pressed) {
      buttons[active] = { pressed: true, value: 1 };
      if (active === 6 || active === 7) buttons[active].value = 0.35 + 0.65 * (((ms % 450) / 450) / 0.7);
    }
    const id = type === 'dualsense' ? 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'
                                    : 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';
    const amount = Math.max(0, Math.sin(t * 0.7));                      // sticks swell and fade so the centre is visited too
    return { id, index: 0, connected: true, buttons,
      axes: [Math.cos(t * 1.6) * amount, Math.sin(t * 1.6) * amount, Math.cos(t * 1.1 + 2) * amount * 0.9, Math.sin(t * 1.1 + 2) * amount * 0.9] };
  }

  return { BUTTONS, demoPad, detectType, stick, soundCategory, isPressed, diff, options, toQuery, pickPad, clamp };
});
