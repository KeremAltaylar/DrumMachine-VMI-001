/* VMI-001 — sixteen-step drum machine.
   The sequencer and every control are DOM elements so the instrument lays out
   responsively and can be played by touch; the canvas is only an oscilloscope. */

const STEPS = 16;

/* Each track carries its own pattern, so the grid and the sequencer are reading
   from exactly the same array. */
/* `weight` biases the random generator: how likely this voice is to be placed,
   and `grid` which subdivision it favours — a kick that lands anywhere sounds
   like a mistake, a kick that favours downbeats sounds like a decision. */
const TRACKS = [
  { id: 'kick', label: 'Kick', file: 'libraries/kick.wav', tone: 'var(--ember)', weight: 0.9, grid: 4, pattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] },
  { id: 'snare', label: 'Snare', file: 'libraries/snare.wav', tone: 'var(--clay)', weight: 0.9, grid: 8, offset: 4, pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0] },
  { id: 'hihat', label: 'Hat', file: 'libraries/Hihat.wav', tone: 'var(--amber)', weight: 0.8, grid: 2, pattern: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0] },
  { id: 'clap', label: 'Clap', file: 'libraries/Clap.wav', tone: 'var(--cool)', weight: 0.4, grid: 8, offset: 4, pattern: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0] },

  /* Synthesised voices — see voices.js. No sample files, and the scheduler
     cannot tell them apart from the sampled tracks. */
  { id: 'openhat', label: 'Open', synth: 'openhat', tone: 'var(--sage)', weight: 0.35, grid: 4, offset: 2, pattern: new Array(16).fill(0) },
  { id: 'tom', label: 'Tom', synth: 'tom', tone: 'var(--clay)', weight: 0.3, grid: 2, pattern: new Array(16).fill(0) },
  { id: 'rim', label: 'Rim', synth: 'rim', tone: 'var(--dim)', weight: 0.45, grid: 1, pattern: new Array(16).fill(0) },
  { id: 'bell', label: 'Bell', synth: 'bell', tone: 'var(--lamp)', weight: 0.25, grid: 4, offset: 2, pattern: new Array(16).fill(0) },
];

const FILTERS = [
  { id: 'lowpass', label: 'LP' },
  { id: 'highpass', label: 'HP' },
  { id: 'bandpass', label: 'BP' },
];

let fft, distortion, delay, reverb, filter, compressor, lfo, lfoDepth;
let audioLive = false;
let playing = false;
/** Phase of the idle drift line, so the scope is never completely still. */
let drift = 0;

const ui = {};
/** track id -> array of 16 step buttons */
const stepEls = {};
let litColumn = -1;
/** Last column actually painted, so draw() is not rewriting classes every frame. */
let litShown = -2;
/** Audio-clock time until which the clip indicator stays lit. */
let clipUntil = 0;

/* ---- Transport ----
   p5.Part is deliberately not used. p5.Metro.setBPM sets the clock frequency to
   the BPM number instead of the tick rate, and its ontick guard then drops
   ticks that arrive early — which quantises every step to a multiple of 1/bpm
   seconds. Measured against the audio clock, that ran 7% fast at 90bpm and 15%
   fast at 120 (433.3ms per quarter where 500ms was asked for).

   This is the standard lookahead scheduler instead: a coarse timer wakes often
   and queues every step falling inside the next SCHEDULE_AHEAD seconds at an
   exact audio-clock time. Accuracy comes from the audio clock, so the timer
   only has to be roughly on time. */

/** How often the scheduler wakes, in ms. Must stay well under SCHEDULE_AHEAD. */
const TICK_MS = 25;
/** How far ahead hits are queued, in seconds. Covers a stalled main thread. */
const SCHEDULE_AHEAD = 0.12;
/** Step value meaning a louder hit. 0 is off, 1 a normal hit. */
const ACCENT = 2;

/* Every rate in the machine is a division of the bar rather than a free
   number, so nothing drifts against the pattern when the tempo moves. Values
   are in beats: a quarter note is 1. */
const DELAY_DIVISIONS = [
  { label: '1/16T', beats: 1 / 6 },
  { label: '1/16', beats: 0.25 },
  { label: '1/8T', beats: 1 / 3 },
  { label: '1/8', beats: 0.5 },
  { label: '1/8.', beats: 0.75 },
  { label: '1/4', beats: 1 },
  { label: '1/2', beats: 2 },
];
const LFO_DIVISIONS = [
  { label: '4 bars', beats: 16 },
  { label: '2 bars', beats: 8 },
  { label: '1 bar', beats: 4 },
  { label: '1/2', beats: 2 },
  { label: '1/4', beats: 1 },
  { label: '1/8', beats: 0.5 },
  { label: '1/16', beats: 0.25 },
];
let delayDivision = 3;
let lfoDivision = 2;
let saturator = null;

let bpm = 90;
let swing = 0;
/** Timing looseness as a fraction of a step. 0 is machine-exact. */
let humanize = 0;
/** How busy the random generator is. */
let density = 0.5;
let patternLength = STEPS;
/** Audio-clock time of the next step, and which step that is. */
let nextStepTime = 0;
let nextStep = 0;
let tickTimer = null;
/** Steps already scheduled, drained by the playhead as the audio clock passes them. */
const pending = [];

// ---- p5 --------------------------------------------------------------------

function preload() {
  TRACKS.filter((t) => t.file).forEach((t) => {
    t.sound = loadSound(t.file);
  });
}

function setup() {
  const scope = document.getElementById('scope');
  const c = createCanvas(scope.clientWidth, scope.clientHeight);
  c.parent(scope);

  fft = new p5.FFT();

  /* Effects are patched the way they would be on a desk: colour the hits, then
     move them, then put them in a room, and filter the whole result last so a
     sweep darkens the tails as well as the notes. Each stage is disconnected
     from the master before it is processed, so no dry copy runs past the chain. */
  distortion = new p5.Distortion(0.3, '2x');
  delay = new p5.Delay();
  reverb = new p5.Reverb();
  filter = new p5.Filter('lowpass');

  TRACKS.forEach((t) => {
    /* Level and tuning live on the track, not on the SoundFile: they are handed
       to play() per hit. Changing a shared gain while a tail is still ringing
       is a click; setting the gain of the hit about to fire cannot be. */
    t.level = 0.8;
    t.rate = 1;
    if (t.sound) {
      t.sound.disconnect();
      distortion.process(t.sound);
    }
  });

  /* Synthesised voices feed the same chain, so they are coloured, delayed,
     reverbed and filtered exactly like the sampled ones. */
  const ctx = getAudioContext();
  TRACKS.filter((t) => t.synth).forEach((t) => {
    t.sound = createDrumVoice(t.synth, ctx, distortion.input);
  });

  /* A slow sweep on the cutoff. The oscillator drives the filter's own
     frequency param, so the sweep is sample-accurate and costs no main-thread
     work — and at depth 0 the gain is zero, so it is genuinely off. */
  lfo = ctx.createOscillator();
  lfoDepth = ctx.createGain();
  lfo.frequency.value = 0.5;
  lfoDepth.gain.value = 0;
  /* Not chained: p5.sound replaces AudioNode.prototype.connect with a version
     that returns undefined, so a.connect(b).connect(c) throws here even though
     it is valid Web Audio. */
  lfo.connect(lfoDepth);
  lfoDepth.connect(filter.biquad.frequency);
  lfo.start();
  distortion.disconnect();
  delay.process(distortion, 0.25, 0.4, 8000);
  delay.disconnect();
  reverb.process(delay, 3, 10);
  reverb.disconnect();
  filter.process(reverb);

  /* The saturator sits last but one: after the filter, so a sweep does not
     change how hard it is driven, and before the limiter, so anything it adds
     is still caught. Creating the Compressor already connects it to the master,
     so the chain is filter -> saturator -> limiter -> out, with the filter's own
     direct path to the master removed. */
  compressor = new p5.Compressor();
  compressor.set(0.003, 0, 20, -3, 0.15);

  saturator = createSaturator(ctx, { lowCross: 180, highCross: 3200 });
  filter.disconnect();
  filter.connect(saturator.input);
  saturator.output.connect(compressor.input);

  buildInterface();
}

function draw() {
  const w = width;
  const h = height;
  background('#0f1412');

  /* Spectrum: columns rising off the floor, warm at the bottom of the range and
     cool at the top, so register is legible at a glance. */
  const spectrum = fft.analyze();
  noStroke();
  const bw = w / spectrum.length;
  for (let i = 0; i < spectrum.length; i++) {
    const level = spectrum[i] / 255;
    const mix = i / spectrum.length;
    fill(217 - mix * 90, 132 + mix * 46, 90 + mix * 106, (0.18 + level * 0.5) * 255);
    rect(i * bw, h - level * h * 0.62, bw + 1, level * h * 0.62);
  }

  // Horizon, so a silent scope still reads as an instrument.
  stroke(188, 207, 182, 36);
  strokeWeight(1);
  line(0, h / 2, w, h / 2);

  /* The waveform is traced twice — a wide soft pass under a thin bright one —
     so the trace glows without needing a blur filter. */
  const form = fft.waveform();
  noFill();
  const trace = (weight, alpha) => {
    stroke(232, 182, 76, alpha);
    strokeWeight(weight);
    beginShape();
    for (let i = 0; i < form.length; i++) {
      vertex(map(i, 0, form.length - 1, 0, w), map(form[i], -1, 1, h, 0));
    }
    endShape();
  };
  trace(5, 40);
  trace(1.5, 255);

  /* Clipping is measured on the mastered waveform rather than guessed at from
     the fader positions, and held briefly so a single overshoot is still
     visible. The limiter should make this rare; if it lights often, the gain
     staging upstream is wrong and the limiter is papering over it. */
  let peak = 0;
  for (let i = 0; i < form.length; i++) {
    const v = Math.abs(form[i]);
    if (v > peak) peak = v;
  }
  if (peak >= 0.99) clipUntil = millis() + 700;
  if (ui.clip) ui.clip.hidden = millis() > clipUntil;

  // A slow sine crossing the floor: the panel is alive before the first hit.
  drift += 0.006;
  stroke(188, 207, 182, 40);
  strokeWeight(1);
  beginShape();
  for (let x = 0; x <= w; x += 6) {
    vertex(x, h - 10 - Math.sin(x * 0.012 + drift) * 5);
  }
  endShape();

  updatePlayhead();
}

function windowResized() {
  const scope = document.getElementById('scope');
  resizeCanvas(scope.clientWidth, scope.clientHeight);
}

// ---- Sequencer -------------------------------------------------------------

/** Seconds per beat at the current tempo. */
function beatSeconds() {
  return 60 / bpm;
}

/* Re-derive every tempo-locked rate. Called when the tempo moves as well as
   when a division is picked, which is the whole point: a delay set to 1/8 stays
   an eighth note at any tempo instead of becoming an arbitrary interval. */
function applyTempoSync() {
  const d = DELAY_DIVISIONS[delayDivision];
  const l = LFO_DIVISIONS[lfoDivision];
  if (delay && d) {
    /* p5.Delay caps its line at 2s; a half note below 60bpm would exceed it. */
    delay.delayTime(Math.min(1.99, d.beats * beatSeconds()));
  }
  if (lfo && l) {
    lfo.frequency.setTargetAtTime(1 / (l.beats * beatSeconds()), getAudioContext().currentTime, 0.02);
  }
  const dOut = document.getElementById('delay-div-out');
  const lOut = document.getElementById('lfo-div-out');
  if (dOut && d) dOut.textContent = `${d.label} · ${(d.beats * beatSeconds()).toFixed(3)}s`;
  if (lOut && l) lOut.textContent = `${l.label} · ${(1 / (l.beats * beatSeconds())).toFixed(2)}Hz`;
}

/** Duration of one sixteenth, in seconds, at the current tempo. */
function stepDuration() {
  return 60 / bpm / 4;
}

/* Swing delays every second sixteenth. At 0 the grid is straight; two thirds of
   a step would be a triplet feel, which is why the control stops short of it. */
function swingDelay(step) {
  return step % 2 === 1 ? swing * stepDuration() : 0;
}

/** Queue every step falling inside the lookahead window. */
function scheduleAhead() {
  const ctx = getAudioContext();
  while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
    const at = nextStepTime + swingDelay(nextStep);

    TRACKS.forEach((t) => {
      const velocity = t.pattern[nextStep];
      if (!velocity) return;
      /* Humanise nudges each hit independently, which is why it is applied per
         voice rather than per step: moving the whole column keeps it machine
         tight, moving each voice is what a room full of players sounds like. */
      const drift = humanize
        ? (Math.random() - 0.5) * humanize * stepDuration()
        : 0;
      /* play() takes seconds from now, so the absolute time is converted back to
         an offset at the moment of scheduling. Never negative: a late wake still
         fires, just immediately. */
      const when = Math.max(0, at + drift - ctx.currentTime);
      /* Humanise also moves the pitch a little. A player who is loose in time is
         loose in tone too, and it stops a repeated sample sounding like a
         photocopy of itself. Kept to a third of the timing spread so it colours
         rather than detunes. */
      const rate = humanize
        ? t.rate * (1 + (Math.random() - 0.5) * humanize * 0.33)
        : t.rate;
      t.sound.play(when, rate, t.level * (velocity === ACCENT ? 1 : 0.62));
    });

    pending.push({ step: nextStep, time: at });
    nextStepTime += stepDuration();
    nextStep = (nextStep + 1) % patternLength;
  }
}

function startTransport() {
  const ctx = getAudioContext();
  nextStep = 0;
  /* Start a fraction ahead so the first step is scheduled, not raced. */
  nextStepTime = ctx.currentTime + 0.06;
  pending.length = 0;
  scheduleAhead();
  tickTimer = setInterval(scheduleAhead, TICK_MS);
}

function stopTransport() {
  clearInterval(tickTimer);
  tickTimer = null;
  pending.length = 0;
  litColumn = -1;
}

/* The playhead follows the audio clock rather than a counter, so it lights the
   step you are actually hearing even when a frame has been dropped. */
function updatePlayhead() {
  if (playing) {
    const now = getAudioContext().currentTime;
    while (pending.length && pending[0].time <= now) litColumn = pending.shift().step;
  }
  const column = playing ? litColumn : -1;
  if (column === litShown) return;
  litShown = column;

  TRACKS.forEach((t) => {
    stepEls[t.id].forEach((b, i) => b.classList.toggle('playing', i === column));
  });
}

/* Generate a pattern that sounds like a decision rather than noise.
   Uniform randomness across sixteen steps produces mush every time, so each
   step's chance is weighted three ways: the voice's own busyness, whether the
   step falls on that voice's preferred subdivision, and how strong a beat it is.
   Accents land on the strongest beats, which is where a player would put them. */
function randomPattern() {
  TRACKS.forEach((t) => {
    const grid = t.grid || 1;
    const offset = t.offset || 0;
    for (let i = 0; i < STEPS; i++) {
      const onGrid = (i - offset + STEPS) % STEPS % grid === 0;
      /* Downbeats are likeliest, then half-bar, then quarters, then the rest. */
      const strength = i % 4 === 0 ? 1 : i % 2 === 0 ? 0.55 : 0.25;
      /* Density scales between "sparse" and "busy" rather than between "silent"
         and "busy" — multiplying it straight in produced patterns with no snare
         at all at 50%, which is not a rhythm. */
      let chance = t.weight * strength * (onGrid ? 1 : 0.18) * (0.35 + density * 0.9);
      if (i >= patternLength) chance = 0;
      let value = Math.random() < chance ? 1 : 0;
      if (value && i % 4 === 0 && Math.random() < 0.45) value = ACCENT;
      t.pattern[i] = value;
    }
  });

  /* The kick, the backbeat and the hats are what make the rest legible as a
     pattern. If chance left any of them empty, place the anchor by hand. */
  const anchor = (id, step, value) => {
    const t = TRACKS.find((x) => x.id === id);
    if (t && !t.pattern.some(Boolean) && step < patternLength) t.pattern[step] = value;
  };
  anchor('kick', 0, ACCENT);
  anchor('snare', patternLength > 4 ? 4 : 2, ACCENT);
  anchor('hihat', 0, 1);

  TRACKS.forEach((t) => {
    stepEls[t.id].forEach((b, i) => paintStep(b, t.pattern[i]));
  });
}

/** Paint a step button for its value: 0 off, 1 on, 2 accent. */
function paintStep(button, value) {
  button.setAttribute('aria-pressed', String(value > 0));
  button.dataset.accent = String(value === ACCENT);
}

function buildSequencer() {
  const host = document.getElementById('sequencer');
  TRACKS.forEach((track) => {
    const row = document.createElement('div');
    row.className = 'track';

    const name = document.createElement('span');
    name.className = 'track-name';
    name.textContent = track.label;
    row.appendChild(name);

    const steps = document.createElement('div');
    steps.className = 'steps';
    stepEls[track.id] = track.pattern.map((on, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'step';
      b.style.setProperty('--track-tone', track.tone);
      b.dataset.beat = String(i % 4 === 0);
      b.setAttribute('aria-label', `${track.label} step ${i + 1}`);
      paintStep(b, on);
      b.addEventListener('click', () => {
        /* Off -> on -> accent -> off. The accent is what gives a machine pattern
           its shape; without it every hit carries the same weight. */
        track.pattern[i] = (track.pattern[i] + 1) % 3;
        paintStep(b, track.pattern[i]);
      });
      steps.appendChild(b);
      return b;
    });

    row.appendChild(steps);
    host.appendChild(row);
  });
}

// ---- Interface -------------------------------------------------------------

function buildInterface() {
  const $ = (id) => document.getElementById(id);
  Object.assign(ui, { power: $('power'), transport: $('transport'), clip: $('clip') });

  buildSequencer();
  buildMixer();

  ui.power.addEventListener('click', ensureAudio);

  ui.transport.addEventListener('click', () => {
    ensureAudio();
    playing = !playing;
    if (playing) startTransport();
    else stopTransport();
    ui.transport.setAttribute('aria-pressed', String(playing));
    ui.transport.textContent = playing ? 'Stop' : 'Play';
  });

  /* The id avoids `clear`, which would shadow p5's global drawing function. */
  $('clear-pattern').addEventListener('click', () => {
    TRACKS.forEach((track) => {
      track.pattern.fill(0);
      stepEls[track.id].forEach((b) => paintStep(b, 0));
    });
  });

  segmented($('filter-seg'), FILTERS.map((f) => f.label), 0, (i) => filter.setType(FILTERS[i].id));

  /* Tempo, swing and length feed the grid the scheduler computes from, so they
     take effect on the next scheduled step rather than restarting the pattern. */
  slider($('bpm'), $('bpm-out'), (v) => `${v} bpm`, (v) => { bpm = v; applyTempoSync(); });
  slider($('swing'), $('swing-out'), (v) => (v === 0 ? 'straight' : `${Math.round(v * 100)}%`), (v) => { swing = v; });
  slider($('humanize'), $('humanize-out'), (v) => (v === 0 ? 'tight' : `${Math.round(v * 100)}%`), (v) => { humanize = v; });
  slider($('density'), $('density-out'), (v) => `${Math.round(v * 100)}%`, (v) => { density = v; });
  slider($('lfo-depth'), $('lfo-depth-out'), (v) => (v === 0 ? 'off' : v.toFixed(2)),
    (v) => lfoDepth.gain.setTargetAtTime(v * 4000, getAudioContext().currentTime, 0.02));
  /* Rate is a division of the bar, not a free frequency — applyTempoSync turns
     it into Hz, and re-runs whenever the tempo moves. */
  slider($('lfo-div'), $('lfo-div-out'), () => '', (v) => { lfoDivision = v; applyTempoSync(); });

  slider($('sat-low'), $('sat-low-out'), (v) => (v === 0 ? 'off' : v.toFixed(2)), (v) => saturator.setLow(v));
  slider($('sat-high'), $('sat-high-out'), (v) => (v === 0 ? 'off' : v.toFixed(2)), (v) => saturator.setHigh(v));
  slider($('sat-low-x'), $('sat-low-x-out'), (v) => `${Math.round(v)}Hz`, (v) => saturator.setLowCross(v));
  slider($('sat-high-x'), $('sat-high-x-out'), hz, (v) => saturator.setHighCross(v));

  $('random-pattern').addEventListener('click', randomPattern);
  applyTempoSync();
  slider($('steps'), $('steps-out'), (v) => `${v}`, (v) => {
    patternLength = v;
    if (nextStep >= patternLength) nextStep = 0;
    TRACKS.forEach((t) => {
      stepEls[t.id].forEach((b, i) => b.classList.toggle('beyond', i >= patternLength));
    });
  });
  slider($('filter-mix'), $('filter-mix-out'), (v) => (v === 0 ? 'dry' : v.toFixed(2)), (v) => filter.drywet(v));
  slider($('cutoff'), $('cutoff-out'), hz, (v) => filter.freq(v, 0.02));
  slider($('res'), $('res-out'), (v) => v.toFixed(1), (v) => filter.res(v));
  slider($('drive'), $('drive-out'), (v) => (v === 0 ? 'dry' : v.toFixed(2)), (v) => distortion.drywet(v));
  slider($('drive-amt'), $('drive-amt-out'), (v) => v.toFixed(2), (v) => distortion.set(v, '2x'));
  /* Every p5.Effect is constructed as CrossFade(1) — fully wet. The delay had
     no mix control at all, so it sat at 100% wet with a 0s delay and its
     internal lowpass at 2300Hz, dulling the whole kit. Each effect now has a
     mix, and every one of them starts at 0 so the kit is heard dry. */
  slider($('delay-mix'), $('delay-mix-out'), (v) => (v === 0 ? 'dry' : v.toFixed(2)), (v) => delay.drywet(v));
  slider($('delay-div'), $('delay-div-out'), () => '', (v) => { delayDivision = v; applyTempoSync(); });
  slider($('delay-fb'), $('delay-fb-out'), (v) => v.toFixed(2), (v) => delay.feedback(v));
  slider($('reverb'), $('reverb-out'), (v) => (v === 0 ? 'dry' : v.toFixed(2)), (v) => reverb.drywet(v));
  slider($('reverb-time'), $('reverb-time-out'), (v) => `${v.toFixed(1)}s`, (v) => reverb.set(v, 10));
  slider($('volume'), $('volume-out'), (v) => v.toFixed(2), (v) => masterVolume(v, 0.02));
}

/* Level and tuning per voice: pitching a sample is the cheapest way to turn one
   kit into several. */
function buildMixer() {
  const host = document.getElementById('mix-grid');
  TRACKS.forEach((track) => {
    host.appendChild(mixField(`${track.label} level`, 0, 1, 0.01, 0.8, (v) => v.toFixed(2), (v) => { track.level = v; }));
    host.appendChild(mixField(`${track.label} tune`, 0.5, 2, 0.01, 1, (v) => `${v.toFixed(2)}×`, (v) => { track.rate = v; }));
  });
}

function mixField(label, min, max, step, value, format, onInput) {
  const field = document.createElement('div');
  field.className = 'field';
  field.innerHTML =
    `<label>${label}</label><span class="value"></span>` +
    `<input type="range" min="${min}" max="${max}" step="${step}" value="${value}" />`;
  slider(field.querySelector('input'), field.querySelector('.value'), format, onInput);
  return field;
}

function ensureAudio() {
  if (audioLive) return;
  userStartAudio();
  audioLive = true;
  ui.power.textContent = 'Audio on';
  ui.power.classList.add('live');
}

/** Hz reads better as kHz once past a thousand. */
function hz(v) {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}kHz` : `${Math.round(v)}Hz`;
}

function segmented(container, labels, initial, onPick) {
  const buttons = labels.map((label, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(i === initial));
    b.addEventListener('click', () => {
      onPick(i);
      buttons.forEach((other, j) => other.setAttribute('aria-pressed', String(i === j)));
    });
    container.appendChild(b);
    return b;
  });
}

function slider(input, output, format, onInput) {
  const apply = () => {
    const v = parseFloat(input.value);
    output.textContent = format(v);
    onInput(v);
  };
  input.addEventListener('input', apply);
  apply();
}
