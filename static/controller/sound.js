/*
 * Click sounds for the controller overlay. Plays the bundled recorded set (static/sounds/dualsense) through Web Audio so
 * presses are low latency. Missing files are skipped silently, so users can swap in their own set by replacing the mp3s.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ControllerSound = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // file name -> played for (category, pressed)
  const FILES = ['btn-press', 'btn-release', 'dpad-press', 'dpad-release', 'touch-press', 'touch-release',
                 'stick-press', 'stick-release', 'create_options-press'];

  /** Which file belongs to an event, or null when that event is silent (the create/options button has no release sound). */
  function fileFor(category, pressed) {
    const name = category + (pressed ? '-press' : '-release');
    return FILES.indexOf(name) === -1 ? null : name;
  }

  class Player {
    constructor(options) {
      this.base = (options && options.base) || '/static/sounds/dualsense/';
      this.volume = options && options.volume !== undefined ? options.volume : 0.6;
      this.enabled = !!(options && options.enabled);
      this.context = null;
      this.buffers = {};
      this.loading = null;
    }

    /** Create the audio context. Browsers need a user gesture first; OBS browser sources do not. Safe to call repeatedly. */
    start() {
      if (!this.enabled) return;
      if (!this.context) {
        const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
        if (!AC) return;
        this.context = new AC();
        this.loading = this.load();
      }
      if (this.context.state !== 'running') this.context.resume().catch(() => {});
    }

    async load() {
      await Promise.all(FILES.map(async (name) => {
        try {
          const response = await fetch(this.base + name + '.mp3');
          if (!response.ok) return;
          this.buffers[name] = await this.context.decodeAudioData(await response.arrayBuffer());
        } catch (error) { /* a missing or unreadable file just means that click stays silent */ }
      }));
    }

    play(category, pressed) {
      if (!this.enabled || !this.context || this.context.state !== 'running') return false;
      const file = fileFor(category, pressed);
      const buffer = file && this.buffers[file];
      if (!buffer) return false;
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      source.buffer = buffer;
      gain.gain.value = this.volume;
      source.connect(gain).connect(this.context.destination);
      source.start(0);
      return true;
    }
  }

  return { Player, fileFor, FILES };
});
