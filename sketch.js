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

let fft, distortion, delay, reverb, filter;
let part;
let audioLive = false;
let playing = false;
/** Phase of the idle drift line, so the scope is never completely still. */
let drift = 0;

const ui = {};
/** track id -> array of 16 step buttons */
const stepEls = {};
let litColumn = -1;

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
    t.sound.disconnect();
    distortion.process(t.sound);
  });
  distortion.disconnect();
  delay.process(distortion, 0, 0.5, 2300);
  delay.disconnect();
  reverb.process(delay, 3, 10);
  reverb.disconnect();
  filter.process(reverb);

  part = new p5.Part(STEPS, 1 / STEPS);
  TRACKS.forEach((t) => {
    part.addPhrase(new p5.Phrase(t.id, () => t.sound.play(), t.pattern));
  });

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

/* The metronome fires phrase step `metroTicks % 16` and only then increments its
   counter, so the step that just sounded is one behind the current tick. */
function updatePlayhead() {
  const column = playing ? (part.metro.metroTicks - 1 + STEPS) % STEPS : -1;
  if (column === litColumn) return;

  TRACKS.forEach((t) => {
    if (litColumn >= 0) stepEls[t.id][litColumn].classList.remove('playing');
    if (column >= 0) stepEls[t.id][column].classList.add('playing');
  });
  litColumn = column;
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
      b.setAttribute('aria-pressed', String(Boolean(on)));
      b.setAttribute('aria-label', `${track.label} step ${i + 1}`);
      b.addEventListener('click', () => {
        track.pattern[i] = track.pattern[i] ? 0 : 1;
        b.setAttribute('aria-pressed', String(Boolean(track.pattern[i])));
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
  Object.assign(ui, { power: $('power'), transport: $('transport') });

  buildSequencer();
  buildMixer();

  ui.power.addEventListener('click', ensureAudio);

  ui.transport.addEventListener('click', () => {
    ensureAudio();
    playing = !playing;
    if (playing) part.loop();
    else part.stop();
    ui.transport.setAttribute('aria-pressed', String(playing));
    ui.transport.textContent = playing ? 'Stop' : 'Play';
  });

  /* The id avoids `clear`, which would shadow p5's global drawing function. */
  $('clear-pattern').addEventListener('click', () => {
    TRACKS.forEach((track) => {
      track.pattern.fill(0);
      stepEls[track.id].forEach((b) => b.setAttribute('aria-pressed', 'false'));
    });
  });

  segmented($('filter-seg'), FILTERS.map((f) => f.label), 0, (i) => filter.setType(FILTERS[i].id));

  slider($('bpm'), $('bpm-out'), (v) => `${v} bpm`, (v) => part.setBPM(v));
  slider($('cutoff'), $('cutoff-out'), hz, (v) => filter.freq(v));
  slider($('res'), $('res-out'), (v) => v.toFixed(1), (v) => filter.res(v));
  slider($('drive'), $('drive-out'), (v) => v.toFixed(2), (v) => distortion.drywet(v));
  slider($('drive-amt'), $('drive-amt-out'), (v) => v.toFixed(2), (v) => distortion.set(v, '2x'));
  slider($('delay-time'), $('delay-time-out'), (v) => `${v.toFixed(3)}s`, (v) => delay.delayTime(v));
  slider($('delay-fb'), $('delay-fb-out'), (v) => v.toFixed(2), (v) => delay.feedback(v));
  slider($('reverb'), $('reverb-out'), (v) => v.toFixed(2), (v) => reverb.drywet(v));
  slider($('reverb-time'), $('reverb-time-out'), (v) => `${v.toFixed(1)}s`, (v) => reverb.set(v, 10));
  slider($('volume'), $('volume-out'), (v) => v.toFixed(2), (v) => masterVolume(v));
}

/* Level and tuning per voice: pitching a sample is the cheapest way to turn one
   kit into several. */
function buildMixer() {
  const host = document.getElementById('mix-grid');
  TRACKS.forEach((track) => {
    host.appendChild(mixField(`${track.label} level`, 0, 1, 0.01, 0.8, (v) => v.toFixed(2), (v) => track.sound.setVolume(v)));
    host.appendChild(mixField(`${track.label} tune`, 0.5, 2, 0.01, 1, (v) => `${v.toFixed(2)}×`, (v) => track.sound.rate(v)));
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
