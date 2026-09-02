/* Turns every range input on the panel into a rotary control.
 *
 * The native <input type="range"> is NOT replaced — it stays inside the knob as
 * the source of truth and as the whole accessibility surface. That means arrow
 * keys, Home/End, screen readers and every existing listener in sketch.js keep
 * working exactly as before; this file only adds a way to turn the value with a
 * vertical drag, and something that looks like a knob on top of it.
 *
 * Consequence worth knowing: if this script fails to load, the instrument still
 * works. It degrades to the sliders it was built with.
 */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var SWEEP = 270; // degrees of travel, 7 o'clock round to 5 o'clock
  var ARC = 2 * Math.PI * 18; // circumference of the r=18 indicator ring
  var DRAG_SPAN = 180; // vertical pixels of drag covering the full range

  function el(name, attrs) {
    var node = document.createElementNS(SVG_NS, name);
    Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  function enhance(input) {
    if (input.classList.contains('knobbed')) return null;
    input.classList.add('knobbed');
    var field = input.closest('.field');
    var knob = document.createElement('div');
    knob.className = 'knob';

    var svg = el('svg', { viewBox: '0 0 48 48', 'aria-hidden': 'true', focusable: 'false' });
    var track = el('circle', { class: 'knob-track', cx: 24, cy: 24, r: 18 });
    var arc = el('circle', { class: 'knob-arc', cx: 24, cy: 24, r: 18 });
    var pointer = el('line', { class: 'knob-pointer', x1: 24, y1: 9, x2: 24, y2: 17 });
    svg.appendChild(track);
    svg.appendChild(arc);
    svg.appendChild(pointer);
    knob.appendChild(svg);

    input.parentNode.insertBefore(knob, input);
    knob.appendChild(input);
    if (field) field.classList.add('has-knob');

    function paint() {
      var min = parseFloat(input.min || 0);
      var max = parseFloat(input.max || 100);
      var value = parseFloat(input.value);
      var norm = max === min ? 0 : (value - min) / (max - min);
      norm = Math.min(1, Math.max(0, norm));
      arc.style.strokeDasharray = (norm * SWEEP * ARC) / 360 + ' ' + ARC;
      pointer.style.transform = 'rotate(' + (-135 + norm * SWEEP) + 'deg)';
    }

    /* Vertical drag. The input keeps ownership of the value, so we set it and
       let its own 'input' event drive both the audio and the repaint. */
    var drag = null;

    knob.addEventListener('pointerdown', function (e) {
      if (e.target === input) return;
      /* Record the drag before capturing: setPointerCapture throws on an
         unknown pointer id, and losing the whole handler to that would leave a
         knob that silently does nothing. Capture is an optimisation here, not a
         requirement. */
      drag = { y: e.clientY, from: parseFloat(input.value) };
      try {
        knob.setPointerCapture(e.pointerId);
      } catch (err) {
        /* no capture; the move handler still tracks while the pointer is down */
      }
      input.focus();
      e.preventDefault();
    });

    knob.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var min = parseFloat(input.min || 0);
      var max = parseFloat(input.max || 100);
      var step = parseFloat(input.step || 1) || 1;
      var dy = drag.y - e.clientY;
      var travel = (max - min) * (dy / DRAG_SPAN) * (e.shiftKey ? 0.1 : 1);
      var next = Math.min(max, Math.max(min, drag.from + travel));
      next = Math.round(next / step) * step;
      var fixed = parseFloat(next.toPrecision(12));
      if (fixed !== parseFloat(input.value)) {
        input.value = fixed;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    function endDrag(e) {
      drag = null;
      if (knob.hasPointerCapture && knob.hasPointerCapture(e.pointerId)) {
        knob.releasePointerCapture(e.pointerId);
      }
    }
    knob.addEventListener('pointerup', endDrag);
    knob.addEventListener('pointercancel', endDrag);

    input.addEventListener('input', paint);
    /* The visible focus ring belongs to the knob, since the input itself is
       transparent. :focus-visible on the input drives a class on the wrapper. */
    input.addEventListener('focus', function () { knob.classList.add('is-focused'); });
    input.addEventListener('blur', function () { knob.classList.remove('is-focused'); });

    paint();
    return paint;
  }

  function init() {
    Array.prototype.forEach.call(
      document.querySelectorAll('.panels input[type="range"], .library input[type="range"]'),
      enhance
    );

    /* The mixer is generated in sketch.js, which runs after this file, so its
       controls are enhanced when they appear rather than at load. */
    var host = document.getElementById('mix-grid');
    if (host) {
      new MutationObserver(function () {
        Array.prototype.forEach.call(
          host.querySelectorAll('input[type="range"]'),
          enhance
        );
      }).observe(host, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
