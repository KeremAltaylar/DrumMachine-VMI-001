/* Synthesised drum voices.
 *
 * Four extra channels without four extra sample files. Each voice exposes the
 * same play(whenSeconds, rate, amp) signature as a p5.SoundFile, so the
 * scheduler treats it identically to a sampled track and needs no changes.
 *
 * Everything is scheduled on the audio clock at an absolute time and every gain
 * starts from zero and returns to zero on an exponential ramp — a drum voice
 * whose gain jumps is a click, which is exactly what we are trying to avoid.
 * exponentialRampToValueAtTime cannot reach 0, so the tails land on a tiny
 * floor and are stopped after it.
 *
 * Connections are never chained: p5.sound replaces AudioNode.prototype.connect
 * with a version returning undefined, so a.connect(b).connect(c) throws.
 */
(function (global) {
  'use strict';

  /** Shared noise, built once: two seconds is longer than any tail here. */
  let noiseBuffer = null;
  function noise(ctx) {
    if (!noiseBuffer) {
      const len = ctx.sampleRate * 2;
      noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    return src;
  }

  /** Gain that rises almost instantly and decays exponentially to silence. */
  function envelope(ctx, at, peak, decay) {
    const g = ctx.createGain();
    const floor = 0.0001;
    g.gain.setValueAtTime(floor, at);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, floor), at + 0.002);
    g.gain.exponentialRampToValueAtTime(floor, at + decay);
    g.gain.setValueAtTime(0, at + decay + 0.01);
    return g;
  }

  function stopAt(nodes, at) {
    nodes.forEach((n) => {
      try { n.stop(at); } catch (e) { /* already stopped */ }
    });
  }

  /**
   * @param kind  one of 'openhat' | 'tom' | 'rim' | 'bell'
   * @param dest  AudioNode this voice feeds (the effects chain input)
   */
  function createVoice(kind, ctx, dest) {
    /* A little drift per hit. Two identical hits in a row are the giveaway
       that a kit is synthetic, so pitch and decay wander slightly each time —
       the same reason an analogue machine never repeats itself exactly. */
    const drift = (spread) => 1 + (Math.random() - 0.5) * spread;

    const shapes = {
      /* Six detuned squares through a band, the way an 808 hat is built, with a
         breath of noise over the top. Squares alone are too pure to read as
         metal; noise alone is too soft. */
      openhat(at, rate, amp) {
        const d = drift(0.05);
        const ratios = [1, 1.36, 1.79, 2.19, 2.68, 3.42];
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 9000 * rate * d;
        bp.Q.value = 1.4;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 6500 * rate;
        const env = envelope(ctx, at, 0.6 * amp, 0.42 * drift(0.2) / rate);
        const oscs = ratios.map((r) => {
          const o = ctx.createOscillator();
          o.type = 'square';
          o.frequency.value = 320 * r * rate * d;
          o.connect(bp);
          o.start(at);
          return o;
        });
        const n = noise(ctx);
        const ng = ctx.createGain();
        ng.gain.value = 0.35;
        n.connect(ng); ng.connect(bp);
        n.start(at);
        bp.connect(hp); hp.connect(env); env.connect(dest);
        stopAt(oscs.concat([n]), at + 0.7 / rate);
      },

      /* Sine with a falling pitch, plus a noise transient so the stick is
         audible before the skin. Without the transient a tom is just a bloop. */
      tom(at, rate, amp) {
        const d = drift(0.06);
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(210 * rate * d, at);
        osc.frequency.exponentialRampToValueAtTime(58 * rate * d, at + 0.28);
        const body = envelope(ctx, at, 0.8 * amp, 0.42 * drift(0.15));
        osc.connect(body); body.connect(dest);

        const n = noise(ctx);
        const nbp = ctx.createBiquadFilter();
        nbp.type = 'bandpass';
        nbp.frequency.value = 2400;
        const click = envelope(ctx, at, 0.28 * amp, 0.035);
        n.connect(nbp); nbp.connect(click); click.connect(dest);

        osc.start(at);
        n.start(at);
        stopAt([osc, n], at + 0.6);
      },

      /* Metallic crack: three detuned squares and a noise burst, both very
         short. The detuning is what stops it sounding like a beep. */
      rim(at, rate, amp) {
        const d = drift(0.08);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1750 * rate * d;
        bp.Q.value = 5;
        const env = envelope(ctx, at, 0.9 * amp, 0.07 * drift(0.25));
        const oscs = [1, 1.47, 2.13].map((r) => {
          const o = ctx.createOscillator();
          o.type = 'square';
          o.frequency.value = 400 * r * rate * d;
          o.connect(bp);
          o.start(at);
          return o;
        });
        const n = noise(ctx);
        const ng = ctx.createGain();
        ng.gain.value = 0.5;
        n.connect(ng); ng.connect(bp);
        n.start(at);
        bp.connect(env); env.connect(dest);
        stopAt(oscs.concat([n]), at + 0.2);
      },

      /* Cowbell: two squares a fifth-ish apart through a narrow band, with a
         short bright head over a longer body — that split is what gives it the
         clang rather than a hum. */
      bell(at, rate, amp) {
        const d = drift(0.04);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 2700 * rate;
        bp.Q.value = 2.2;
        const oscs = [540, 800].map((f) => {
          const o = ctx.createOscillator();
          o.type = 'square';
          o.frequency.value = f * rate * d;
          o.connect(bp);
          o.start(at);
          return o;
        });
        const head = envelope(ctx, at, 0.55 * amp, 0.05);
        const bodyEnv = envelope(ctx, at, 0.3 * amp, 0.34 * drift(0.2));
        bp.connect(head); head.connect(dest);
        bp.connect(bodyEnv); bodyEnv.connect(dest);
        stopAt(oscs, at + 0.5);
      },
    };

    const shape = shapes[kind];

    return {
      /* Same signature as p5.SoundFile.play, so the scheduler cannot tell the
         difference between a sampled voice and a synthesised one. */
      play(whenSeconds, rate, amp) {
        const at = ctx.currentTime + Math.max(0, whenSeconds || 0);
        shape(at, rate || 1, amp == null ? 0.8 : amp);
      },
      /* Present so anything that walks the track list can call it safely. */
      disconnect() {},
    };
  }

  global.createDrumVoice = createVoice;
})(window);
