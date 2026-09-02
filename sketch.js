/* VMI-001 — sixteen-step drum machine.
   The sequencer and every control are DOM elements so the instrument lays out
   responsively and can be played by touch; the canvas is only an oscilloscope. */

const STEPS = 16;

/* Each track carries its own pattern, so the grid and the sequencer are reading
   from exactly the same array. */
const TRACKS = [
  { id: 'kick', label: 'Kick', file: 'libraries/kick.wav', tone: 'var(--ember)', pattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] },
  { id: 'snare', label: 'Snare', file: 'libraries/snare.wav', tone: 'var(--clay)', pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0] },
  { id: 'hihat', label: 'Hat', file: 'libraries/Hihat.wav', tone: 'var(--amber)', pattern: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0] },
  { id: 'clap', label: 'Clap', file: 'libraries/Clap.wav', tone: 'var(--cool)', pattern: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0] },
];

const FILTERS = [
  { id: 'lowpass', label: 'LP' },
  { id: 'highpass', label: 'HP' },
  { id: 'bandpass', label: 'BP' },
];

let fft, distortion, delay, reverb, filter, compressor;
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

let bpm = 90;
let swing = 0;
let patternLength = STEPS;
/** Audio-clock time of the next step, and which step that is. */
let nextStepTime = 0;
let nextStep = 0;
let tickTimer = null;
/** Steps already scheduled, drained by the playhead as the audio clock passes them. */
const pending = [];

// ---- p5 --------------------------------------------------------------------

function preload() {
  TRACKS.forEach((t) => {
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
    t.sound.disconnect();
    distortion.process(t.sound);
  });
  distortion.disconnect();
  delay.process(distortion, 0, 0.5, 2300);
  delay.disconnect();
  reverb.process(delay, 3, 10);
  reverb.disconnect();
  filter.process(reverb);

  /* A limiter on the master, so four voices through drive and reverb cannot run
     past 0dBFS. It stays inside p5's graph rather than a raw node wired to the
     destination, so the FFT still analyses what you actually hear. */
  compressor = new p5.Compressor();
  compressor.process(filter, 0.003, 0, 20, -3, 0.15);

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
      /* play() takes seconds from now, so the absolute time is converted back to
         an offset at the moment of scheduling. Never negative: a late wake still
         fires, just immediately. */
      const when = Math.max(0, at - ctx.currentTime);
      t.sound.play(when, t.rate, t.level * (velocity === ACCENT ? 1 : 0.62));
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
  slider($('bpm'), $('bpm-out'), (v) => `${v} bpm`, (v) => { bpm = v; });
  slider($('swing'), $('swing-out'), (v) => (v === 0 ? 'straight' : `${Math.round(v * 100)}%`), (v) => { swing = v; });
  slider($('steps'), $('steps-out'), (v) => `${v}`, (v) => {
    patternLength = v;
    if (nextStep >= patternLength) nextStep = 0;
    TRACKS.forEach((t) => {
      stepEls[t.id].forEach((b, i) => b.classList.toggle('beyond', i >= patternLength));
    });
  });
  slider($('cutoff'), $('cutoff-out'), hz, (v) => filter.freq(v, 0.02));
  slider($('res'), $('res-out'), (v) => v.toFixed(1), (v) => filter.res(v));
  slider($('drive'), $('drive-out'), (v) => v.toFixed(2), (v) => distortion.drywet(v));
  slider($('drive-amt'), $('drive-amt-out'), (v) => v.toFixed(2), (v) => distortion.set(v, '2x'));
  slider($('delay-time'), $('delay-time-out'), (v) => `${v.toFixed(3)}s`, (v) => delay.delayTime(v));
  slider($('delay-fb'), $('delay-fb-out'), (v) => v.toFixed(2), (v) => delay.feedback(v));
  slider($('reverb'), $('reverb-out'), (v) => v.toFixed(2), (v) => reverb.drywet(v));
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
