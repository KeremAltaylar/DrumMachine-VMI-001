/* Two-band saturator.
 *
 * The dry signal passes through untouched. Alongside it, a low band and a high
 * band are split off, driven through a waveshaper, and blended back on top —
 * so raising a band ADDS harmonics at that end rather than replacing what was
 * there. At zero both band gains are zero and the output is bit-identical to
 * the input.
 *
 * The two curves are deliberately different: the low band uses a soft tanh,
 * which rounds peaks and thickens weight; the high band uses a harder curve,
 * which generates more odd harmonics and so puts an edge on the leading edge of
 * a hit. That is where the "transient" character comes from — this is harmonic
 * saturation, not an envelope-following transient designer. It makes attacks
 * read as sharper because the harmonics it adds are loudest where the signal is
 * loudest, which on a drum is the transient.
 *
 * Connections are never chained: p5.sound replaces AudioNode.prototype.connect
 * with a version returning undefined.
 */
(function (global) {
  'use strict';

  const SAMPLES = 2048;

  /** Soft, symmetric: rounds rather than clips. */
  function tanhCurve(drive) {
    const curve = new Float32Array(SAMPLES);
    const k = 1 + drive * 24;
    for (let i = 0; i < SAMPLES; i++) {
      const x = (i / (SAMPLES - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return curve;
  }

  /** Harder knee: more odd harmonics, which is what reads as bite. */
  function edgeCurve(drive) {
    const curve = new Float32Array(SAMPLES);
    const k = 1 + drive * 60;
    for (let i = 0; i < SAMPLES; i++) {
      const x = (i / (SAMPLES - 1)) * 2 - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
  }

  function createSaturator(ctx, options) {
    const opts = options || {};
    const lowCross = opts.lowCross || 180;
    const highCross = opts.highCross || 3200;

    const input = ctx.createGain();
    const output = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 1;

    /* Low band: everything under the crossover, softly saturated. */
    const lowFilter = ctx.createBiquadFilter();
    lowFilter.type = 'lowpass';
    lowFilter.frequency.value = lowCross;
    const lowShaper = ctx.createWaveShaper();
    lowShaper.oversample = '4x';
    const lowGain = ctx.createGain();
    lowGain.gain.value = 0;

    /* High band: everything above the crossover, harder saturated. */
    const highFilter = ctx.createBiquadFilter();
    highFilter.type = 'highpass';
    highFilter.frequency.value = highCross;
    const highShaper = ctx.createWaveShaper();
    highShaper.oversample = '4x';
    const highGain = ctx.createGain();
    highGain.gain.value = 0;

    input.connect(dry);
    dry.connect(output);

    /* Each band is filtered AGAIN after the shaper. Saturation generates
       harmonics above the fundamental, so a driven 60Hz kick sprays 120, 180,
       240Hz into the midrange — measured as +60% mid energy against +22% low,
       which is not what a low-end saturator is for. These keep what each band
       adds inside the end of the spectrum it belongs to. */
    const lowTame = ctx.createBiquadFilter();
    lowTame.type = 'lowpass';
    lowTame.frequency.value = lowCross * 4;
    const highTame = ctx.createBiquadFilter();
    highTame.type = 'highpass';
    highTame.frequency.value = highCross;

    input.connect(lowFilter);
    lowFilter.connect(lowShaper);
    lowShaper.connect(lowTame);
    lowTame.connect(lowGain);
    lowGain.connect(output);

    input.connect(highFilter);
    highFilter.connect(highShaper);
    highShaper.connect(highTame);
    highTame.connect(highGain);
    highGain.connect(output);

    lowShaper.curve = tanhCurve(0.5);
    highShaper.curve = edgeCurve(0.5);

    const ramp = (param, value) => param.setTargetAtTime(value, ctx.currentTime, 0.02);

    return {
      input,
      output,

      /* Amount 0..1. The curve gets harder as the amount rises AND the band is
         blended in louder, so the knob does one obvious thing. */
      setLow(amount) {
        lowShaper.curve = tanhCurve(amount);
        /* Lows are blended below unity: a saturated low band added at full
           level is how a mix turns to mud. */
        ramp(lowGain.gain, amount * 0.55);
      },

      setHigh(amount) {
        highShaper.curve = edgeCurve(amount);
        ramp(highGain.gain, amount * 0.4);
      },

      setLowCross(hz) { ramp(lowFilter.frequency, hz); ramp(lowTame.frequency, hz * 4); },
      setHighCross(hz) { ramp(highFilter.frequency, hz); ramp(highTame.frequency, hz); },
    };
  }

  global.createSaturator = createSaturator;
})(window);
