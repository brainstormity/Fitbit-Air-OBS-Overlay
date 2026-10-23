/*
 * Controller skin: original SVG drawing of an Xbox Series wireless controller.
 * Every interactive part carries a data attribute the page updates each frame:
 *   data-btn="N"        standard-mapping button N (adds class "on" while pressed)
 *   data-stick="L|R"    the moving cap of a stick (translated by the axes)
 *   data-trig="L|R"     a fill that grows with the analog trigger value
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ControllerSkins = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STICK_TRAVEL = 18; // how far a cap moves from centre at full tilt, in SVG units

  const dpad = (cx, cy, arm) => {
    const w = arm * 0.62, l = arm;
    return `
      <g class="dpad">
        <circle cx="${cx}" cy="${cy}" r="${arm + 14}" class="well"/>
        <rect class="dir" data-btn="12" x="${cx - w / 2}" y="${cy - l - 4}" width="${w}" height="${l + 4 - w / 2}" rx="7"/>
        <rect class="dir" data-btn="13" x="${cx - w / 2}" y="${cy + w / 2}" width="${w}" height="${l + 4 - w / 2}" rx="7"/>
        <rect class="dir" data-btn="14" x="${cx - l - 4}" y="${cy - w / 2}" width="${l + 4 - w / 2}" height="${w}" rx="7"/>
        <rect class="dir" data-btn="15" x="${cx + w / 2}" y="${cy - w / 2}" width="${l + 4 - w / 2}" height="${w}" rx="7"/>
        <rect class="dir-core" x="${cx - w / 2}" y="${cy - w / 2}" width="${w}" height="${w}"/>
      </g>`;
  };

  const stickAt = (side, cx, cy, big) => `
      <g class="stick-unit">
        <circle cx="${cx}" cy="${cy}" r="${big + 12}" class="well"/>
        <circle cx="${cx}" cy="${cy}" r="${big + 4}" class="stick-ring"/>
        <g data-stick="${side}" data-cx="${cx}" data-cy="${cy}">
          <circle cx="${cx}" cy="${cy}" r="${big}" class="cap" data-btn="${side === 'L' ? 10 : 11}"/>
          <circle cx="${cx}" cy="${cy}" r="${big * 0.62}" class="cap-dish"/>
          <circle cx="${cx}" cy="${cy}" r="${big * 0.18}" class="cap-dot"/>
        </g>
      </g>`;

  const trigger = (side, x, y, w, h, tilt) => `
      <g transform="rotate(${tilt} ${x + w / 2} ${y + h})">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" class="trig-bg"/>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" class="trig-fill" data-trig="${side}" data-btn="${side === 'L' ? 6 : 7}"/>
      </g>`;

  /* ------------------------------------------------------------------ Xbox Series (original artwork) */
  const GRIP_DOTS = `<pattern id="dots" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" fill="rgba(255,255,255,.07)"/><circle cx="5.5" cy="5.5" r="1.1" fill="rgba(255,255,255,.07)"/></pattern>`;

  function xbox() {
    return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 560" class="skin xbox" role="img" aria-label="Xbox controller">
  <defs>
    <linearGradient id="xbShell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--shell-hi)"/><stop offset=".55" stop-color="var(--shell)"/><stop offset="1" stop-color="var(--shell-lo)"/></linearGradient>
    <linearGradient id="xbBump" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--bumper-hi)"/><stop offset="1" stop-color="var(--bumper)"/></linearGradient>
    <radialGradient id="xbCap" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="var(--cap-hi)"/><stop offset="1" stop-color="var(--cap)"/></radialGradient>
    <radialGradient id="xbGuide" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#4a4d54"/><stop offset="1" stop-color="#26282c"/></radialGradient>
    ${GRIP_DOTS}
    <clipPath id="xbClip"><path id="xbBody" d="M 198 152 C 236 128 300 126 350 142 C 380 151 420 151 450 142 C 500 126 564 128 602 152 C 654 184 692 274 706 384 C 716 454 700 508 650 516 C 610 522 580 492 560 452 C 545 422 520 402 490 402 L 310 402 C 280 402 255 422 240 452 C 220 492 190 522 150 516 C 100 508 84 454 94 384 C 108 274 146 184 198 152 Z"/></clipPath>
  </defs>
  ${trigger('L', 222, 100, 84, 70, -8)}
  ${trigger('R', 494, 100, 84, 70, 8)}
  <use href="#xbBody" class="shell" fill="url(#xbShell)"/>
  <g clip-path="url(#xbClip)">
    <rect x="80" y="300" width="640" height="240" fill="url(#dots)"/>
    <path d="M 100 150 C 300 112 500 112 700 150 L 700 214 C 500 176 300 176 100 214 Z" fill="rgba(255,255,255,.07)"/>
    <path d="M 240 452 C 255 422 280 402 310 402 L 490 402 C 520 402 545 422 560 452" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="3"/>
  </g>
  <use href="#xbBody" class="shell-line"/>
  <path data-btn="4" class="bumper" d="M 182 186 C 196 152 240 124 306 118 C 336 116 356 120 366 130 L 360 148 C 336 144 300 148 266 162 C 238 174 214 192 202 212 Z"/>
  <path data-btn="5" class="bumper" d="M 618 186 C 604 152 560 124 494 118 C 464 116 444 120 434 130 L 440 148 C 464 144 500 148 534 162 C 562 174 586 192 598 212 Z"/>
  <circle cx="400" cy="262" r="1" fill="none"/>
  ${stickAt('L', 258, 236, 31)}
  ${dpad(333, 350, 29)}
  ${stickAt('R', 467, 350, 31)}
  <g class="face-cluster">
    <g data-btn="3" class="face" style="--c:#f5c518"><circle cx="548" cy="198" r="23"/><text x="548" y="207" class="glyph">Y</text></g>
    <g data-btn="2" class="face" style="--c:#3b8cf0"><circle cx="512" cy="236" r="23"/><text x="512" y="245" class="glyph">X</text></g>
    <g data-btn="1" class="face" style="--c:#f0463c"><circle cx="584" cy="236" r="23"/><text x="584" y="245" class="glyph">B</text></g>
    <g data-btn="0" class="face" style="--c:#6fd14a"><circle cx="548" cy="274" r="23"/><text x="548" y="283" class="glyph">A</text></g>
  </g>
  <g data-btn="16" class="home"><circle cx="400" cy="190" r="25"/><circle cx="400" cy="190" r="15" class="home-ring"/><path class="home-mark" d="M 391 181 L 409 199 M 409 181 L 391 199"/></g>
  <g data-btn="8" class="small"><circle cx="346" cy="238" r="11"/><rect x="340" y="233" width="12" height="5" rx="1.5" class="mark"/><rect x="340" y="239" width="12" height="5" rx="1.5" class="mark"/></g>
  <g data-btn="9" class="small"><circle cx="454" cy="238" r="11"/><rect x="447" y="233" width="14" height="2.6" rx="1.2" class="mark"/><rect x="447" y="237.5" width="14" height="2.6" rx="1.2" class="mark"/><rect x="447" y="242" width="14" height="2.6" rx="1.2" class="mark"/></g>
  <g data-btn="17" class="small share"><rect x="389" y="276" width="22" height="14" rx="7"/><path class="mark-line" d="M 395 285 L 395 281 L 405 281 L 405 285 M 400 288 L 400 283"/></g>
</svg>`;
  }

  // natural size of the skin in pixels, how far a stick cap moves, and how the skin shows analog triggers
  const size = { xbox: [800, 560] };
  const travel = { xbox: 22 };
  const triggerMode = { xbox: 'fill' };

  return { xbox, STICK_TRAVEL, size, travel, triggerMode };
});
