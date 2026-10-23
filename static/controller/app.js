/* Controller overlay page: finds the pad, draws the skin, updates it every frame, plays click sounds. */
(function () {
  'use strict';
  const Core = window.ControllerCore, Skins = window.ControllerSkins;
  const options = Core.options(window.location.search);
  const stage = document.getElementById('stage');
  const hint = document.getElementById('hint');
  const player = new window.ControllerSound.Player({ enabled: options.sound, volume: options.volume });

  document.documentElement.style.setProperty('--accent', options.accent);
  document.body.style.background = options.bg || 'transparent';

  let shownType = null, els = null, previous = null, lastId = null;

  function applyBody() {
    const body = options.body;
    const set = (name, value) => stage.style.setProperty(name, value);
    if (!body) {
      ['--shell', '--shell-hi', '--cap', '--cap-hi'].forEach((name) => stage.style.removeProperty(name));
      return;
    }
    set('--shell', body); set('--shell-hi', body);
    set('--cap', '#0b0b0d'); set('--cap-hi', '#2b2d31');
  }

  function render() {
    if (shownType === 'xbox') return;
    shownType = 'xbox';
    const [width, height] = Skins.size.xbox;
    stage.className = 'stage xbox' + (options.variant === 'white' ? ' white' : '');
    stage.style.setProperty('--w', Math.round(width * options.scale) + 'px');
    stage.style.setProperty('--h', Math.round(height * options.scale) + 'px');
    stage.style.setProperty('--cw', width + 'px');
    stage.style.setProperty('--ch', height + 'px');
    stage.style.setProperty('--scale', options.scale);
    stage.innerHTML = '<div class="canvas">' + Skins.xbox() + '</div>';
    applyBody();
    els = {
      buttons: Array.from(stage.querySelectorAll('[data-btn]')),
      sticks: { L: stage.querySelector('[data-stick="L"]'), R: stage.querySelector('[data-stick="R"]') },
      triggers: { L: stage.querySelector('[data-trig="L"]'), R: stage.querySelector('[data-trig="R"]') },
    };
  }

  function draw(pad) {
    const byIndex = {};
    pad.buttons.forEach((button, i) => { byIndex[i] = button; });
    els.buttons.forEach((el) => {
      const index = Number(el.getAttribute('data-btn'));
      el.classList.toggle('on', Core.isPressed(byIndex[index]));
    });
    ['L', 'R'].forEach((side, n) => {
      const value = Core.stick(pad.axes[n * 2], pad.axes[n * 2 + 1], options.deadzone);
      const cap = els.sticks[side];
      if (cap) {
        const reach = Skins.travel[shownType], dx = (value.x * reach).toFixed(2), dy = (value.y * reach).toFixed(2);
        cap.classList.toggle('active', value.magnitude > 0);          // lit while the stick is pushed, brighter the further it goes
        cap.style.setProperty('--tilt', value.magnitude.toFixed(3));
        if (cap instanceof SVGElement) cap.setAttribute('transform', 'translate(' + dx + ' ' + dy + ')');
        else cap.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      }
      const trigger = els.triggers[side], source = byIndex[side === 'L' ? 6 : 7];
      if (trigger) {
        const amount = source ? (typeof source === 'number' ? source : source.value || (source.pressed ? 1 : 0)) : 0;
        const level = Core.clamp(amount, 0, 1).toFixed(3);
        if (Skins.triggerMode[shownType] === 'opacity') trigger.style.opacity = level;
        else trigger.style.transform = 'scaleY(' + level + ')';
      }
    });
  }

  function sample(pad) {
    return { buttons: Array.from(pad.buttons, (b) => ({ pressed: !!b.pressed, value: b.value || 0 })), axes: Array.from(pad.axes) };
  }

  function frame() {
    const getter = navigator.getGamepads ? navigator.getGamepads.bind(navigator) : () => [];
    const pad = options.demo ? Core.demoPad(performance.now())
                             : Core.pickPad(getter(), options.device);
    if (pad) {
      if (pad.id !== lastId) { lastId = pad.id; previous = null; }
      render();
      const now = sample(pad);
      if (options.sound) Core.diff(previous, now, options.deadzone).forEach((e) => {
        if (e.type === 'button') player.play(e.category, e.pressed);
        else player.play('stick', e.active);
      });
      previous = now;
      draw(pad);
      hint.hidden = true;
    } else {
      previous = null; lastId = null;
      render();
      if (els) {
        els.buttons.forEach((el) => el.classList.remove('on'));
        Object.values(els.sticks).forEach((cap) => { if (cap) { cap.removeAttribute('transform'); cap.style.transform = ''; cap.classList.remove('active'); } });
        Object.values(els.triggers).forEach((t) => { if (t) { t.style.transform = ''; t.style.opacity = ''; } });
      }
      hint.hidden = !options.hint;
      hint.textContent = window.isSecureContext
        ? 'Press any button on your controller to connect it'
        : 'Browsers block controllers on this address. Open this page as http://127.0.0.1:8000/controller on the PC with the controller';
    }
    window.requestAnimationFrame(frame);
  }

  window.addEventListener('gamepadconnected', () => player.start());
  ['pointerdown', 'keydown'].forEach((name) => window.addEventListener(name, () => player.start(), { passive: true }));
  player.start();   // OBS browser sources may start audio without a gesture; ordinary browsers wait for the first press
  window.__controller = { options, get type() { return shownType; } };
  frame();
})();
