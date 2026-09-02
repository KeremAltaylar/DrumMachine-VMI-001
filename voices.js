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
    const shapes = {
      /* A long, bright noise tail through a highpass — the open hat. */
      openhat(at, rate, amp) {
        const src = noise(ctx);
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 7000 * rate;
        const env = envelope(ctx, at, 0.65 * amp, 0.38 / rate);
        src.connect(hp); hp.connect(env); env.connect(dest);
        src.start(at);
        stopAt([src], at + 0.5 / rate);
      },

      /* A sine whose pitch falls as it decays: the classic tom. */
      tom(at, rate, amp) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(180 * rate, at);
        osc.frequency.exponentialRampToValueAtTime(60 * rate, at + 0.25);
        const env = envelope(ctx, at, 0.9 * amp, 0.4);
        osc.connect(env); env.connect(dest);
        osc.start(at);
        stopAt([osc], at + 0.5);
      },

      /* A very short bandpassed noise crack. */
      rim(at, rate, amp) {
        const src = noise(ctx);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1800 * rate;
        bp.Q.value = 6;
        const env = envelope(ctx, at, 0.8 * amp, 0.06);
        src.connect(bp); bp.connect(env); env.connect(dest);
        src.start(at);
        stopAt([src], at + 0.15);
      },

      /* Two detuned squares through a narrow band: metallic, cowbell-ish. */
      bell(at, rate, amp) {
        const a = ctx.createOscillator();
        const b = ctx.createOscillator();
        a.type = b.type = 'square';
        a.frequency.value = 540 * rate;
        b.frequency.value = 800 * rate;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 2600 * rate;
        bp.Q.value = 2;
        const env = envelope(ctx, at, 0.55 * amp, 0.3);
        a.connect(bp);
        b.connect(bp);
        bp.connect(env); env.connect(dest);
        a.start(at);
        b.start(at);
        stopAt([a, b], at + 0.45);
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
