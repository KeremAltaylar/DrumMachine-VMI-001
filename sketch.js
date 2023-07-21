let mySound, myPhrase, myPart;
let pattern = [1, 0, 0, 1, 0, 0, 1, 0];
let pattern2 = [1, 0, 0, 0, 1, 0, 0, 0];
let pattern3 = [1, 0, 0, 0, 1, 0, 0, 0];
let pattern4 = [1, 0, 0, 0, 1, 0, 0, 0];
let pattern5 = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
let ind = 0;
// let x = 150;
// let y = 150;
// let sz = 100;
let x;
let y;
let sz;
let buttonsKick = [];
let buttonsSnare = [];
let buttonsHihat = [];
let buttonsClap = [];
let startStop;
let slider3, slider, slider2, slider4;
let reverb1, distortion, delay;
let col;
let indLamb = 0;
let colors = [];
function preload() {
  mySound = loadSound("libraries/kick.wav");
  mySound2 = loadSound("libraries/snare.wav");
  mySound3 = loadSound("libraries/Hihat.wav");
  mySound4 = loadSound("libraries/Clap.wav");
  font = loadFont("libraries/font.ttf");
}

function setup() {
  createCanvas(windowWidth, windowHeight);

  textFont(font);
  textSize(windowWidth / 30);
  textAlign(CENTER, CENTER);
  col1 = color("#670B04");
  //col2 = color("#670B04");
  col2 = 0;
  col3 = color("#D7300E");
  col4 = color("#F16323");
  col5 = color("#FBA253");
  //colors = [col1, col3, col4, col5];
  fft = new p5.FFT();
  lpfilter = new p5.BandPass();
  reverb1 = new p5.Reverb();
  //comp = new p5.Compressor();
  delay = new p5.Delay();
  distortion = new p5.Distortion(1, "2x");
  distortion.process(mySound);
  distortion.process(mySound2);
  distortion.process(mySound3);
  distortion.process(mySound4);
  delay.process(distortion, 0.82, 0.7, 2300);
  reverb1.process(delay, 10, 10);

  slider3 = createSlider(40, 220, 90, 1);
  slider3.position(windowWidth / 20, windowHeight / 1.15);

  slider = createSlider(0, 0.1, 0, 0.001);
  slider.position(windowWidth / 3.61, windowHeight / 1.15);

  slider2 = createSlider(0, 1, 0, 0.05);
  slider2.position(windowWidth / 1.95, windowHeight / 1.15);

  slider4 = createSlider(0, 1, 0, 0.05);
  slider4.position(windowWidth / 1.355, windowHeight / 1.15);

  for (i = 0; i < 16; i++) {
    x = (i + 1) * (windowWidth / 18) + 10;
    y = windowHeight / 25;
    sz = windowWidth / 35;
    buttonsKick[i] = new buttonS(x, y * 2, sz, "false", i, col1);
    buttonsSnare[i] = new buttonS(x, y * 4, sz, "false", i, col3);
    buttonsHihat[i] = new buttonS(x, y * 6.1, sz, "false", i, col4);
    buttonsClap[i] = new buttonS(x, y * 8.1, sz, "false", i, col5);
  }
  startStop = new buttonS(
    windowWidth / 2 - windowWidth / 32,
    windowHeight / 1.5,
    windowWidth / 16,
    "false",
    col1,
    col4
  );
  userStartAudio();
  myPhrase = new p5.Phrase("kick", onEachStep, pattern);
  myPhrase2 = new p5.Phrase("snare", onEachStep2, pattern2);
  myPhrase3 = new p5.Phrase("snare", onEachStep3, pattern3);
  myPhrase4 = new p5.Phrase("snare", onEachStep4, pattern4);
  cntPhrase = new p5.Phrase("snare", cntrl, pattern5);
  myPart = new p5.Part();
  myPart.addPhrase(myPhrase);
  myPart.addPhrase(myPhrase2);
  myPart.addPhrase(myPhrase3);
  myPart.addPhrase(myPhrase4);
  myPart.addPhrase(cntPhrase);
  frameRate(60);
}

function onEachStep(time, playbackRate) {
  mySound.rate(playbackRate);
  mySound.play(time);
}

function cntrl() {
  if (indLamb == 16) {
    indLamb = 0;
  }
  indLamb = indLamb + 1;
  // console.log(indLamb);
}

function onEachStep2(time, playbackRate) {
  mySound2.rate(playbackRate);
  mySound2.play(time);
}
function onEachStep3(time, playbackRate) {
  mySound3.rate(playbackRate);
  mySound3.play(time);
}
function onEachStep4(time, playbackRate) {
  mySound4.rate(playbackRate);
  mySound4.play(time);
}

function draw() {
  background("#E9E3CE");
  push();
  for (i = 0; i < 10; i++) {
    stroke(i * 70.3, i * 14.3, 0);
    //stroke(i * random(0, 25), i * random(0, 10), 0);
    noFill();
    ellipse(
      windowWidth / 1.08,
      windowHeight / 1.64 + windowHeight / 15,
      (i * 5) / 2
    );
    ellipse(
      windowWidth / 1.08,
      windowHeight / 1.65 + windowHeight / 7,
      i * 5 * 1
    );
  }
  pop();
  delay.delayTime(slider.value());
  distortion.drywet(slider4.value());
  reverb1.drywet(slider2.value());
  myPart.setBPM(slider3.value());
  for (i = 0; i < 16; i++) {
    buttonsKick[i].display();
    buttonsSnare[i].display();
    buttonsHihat[i].display();
    buttonsClap[i].display();
  }
  startStop.display();
  push();
  noFill();
  stroke(0);
  strokeWeight(10);
  rect(10, windowHeight / 18, windowWidth - 20, windowHeight / 3);
  rect(10, windowHeight / 1.25, windowWidth - 20, windowHeight / 6.9);
  rect(
    windowWidth / 1.15,
    windowHeight / 1.57,
    windowWidth / 8.71,
    windowHeight / 6.14
  );
  pop();
  push();
  let spectrum = fft.analyze();
  //noStroke();

  for (let i = 0; i < spectrum.length; i++) {
    //console.log(i);

    stroke(random(0, 29), random(0, 255));
    let x = map(i, 0, spectrum.length, windowWidth / 2 + 5, windowWidth - 5);
    let x2 = map(i, 0, spectrum.length, windowWidth / 2 - 5, 5);
    let h = -windowHeight + map(spectrum[i], 0, 200, windowHeight, 0);
    //on = h;

    rect(x2, windowHeight / 2.5, windowWidth / 100 / spectrum.length, -h / 8);
    // rect(x2 / 2, windowHeight / 2, windowWidth / 6 / spectrum.length, h / 8);
    // rect(x / 2, windowHeight / 2, windowWidth / 6 / spectrum.length, h / 8);
    rect(x, windowHeight / 2.5, windowWidth / 100 / spectrum.length, -h / 8);
  }
  pop();

  x = (indLamb + 0) * (windowWidth / 18) + 20;
  y = windowHeight / 20;
  sz = windowWidth / 35;
  ellipse(x, y, sz);

  text("BPM", windowWidth / 6.2, windowHeight / 1.19);
  text("Grains", windowWidth / 2.6, windowHeight / 1.19);
  text("Echo", windowWidth / 1.61, windowHeight / 1.19);
  text("Overdrive", windowWidth / 1.18, windowHeight / 1.19);
  text("K", windowWidth / 23, windowHeight / 11);
  text("S", windowWidth / 23, windowHeight / 5.8);
  text("H", windowWidth / 23, windowHeight / 3.95);
  text("C", windowWidth / 23, windowHeight / 3);
  text("START/STOP", windowWidth / 2, windowHeight / 1.6);
}

function mousePressed() {
  for (i = 0; i < 16; i++) {
    buttonsKick[i].clickedK();
    buttonsSnare[i].clickedS();
    buttonsHihat[i].clickedH();
    buttonsClap[i].clickedC();
  }
  startStop.clickedH();
  startStop.start();
}
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  //textSize(windowWidth / 39);
  for (i = 0; i < 16; i++) {
    x = (i + 1) * (windowWidth / 18) + 10;
    y = windowHeight / 25;
    sz = windowWidth / 35;
    buttonsKick[i] = new buttonS(x, y * 2, sz, "false", i, col1);
    buttonsSnare[i] = new buttonS(x, y * 4, sz, "false", i, col3);
    buttonsHihat[i] = new buttonS(x, y * 6.1, sz, "false", i, col4);
    buttonsClap[i] = new buttonS(x, y * 8.2, sz, "false", i, col5);
  }
  startStop = new buttonS(
    windowWidth / 2 - windowWidth / 32,
    windowHeight / 1.5,
    windowWidth / 16,
    "false",
    col1,
    col4
  );
  for (i = 0; i < 16; i++) {
    buttonsKick[i].clickedK();
    buttonsSnare[i].clickedS();
    buttonsHihat[i].clickedH();
    buttonsClap[i].clickedC();
  }
  slider3.position(windowWidth / 20, windowHeight / 1.15);

  slider.position(windowWidth / 3.61, windowHeight / 1.15);

  slider2.position(windowWidth / 1.95, windowHeight / 1.15);

  slider4.position(windowWidth / 1.355, windowHeight / 1.15);
  push();
  for (i = 0; i < 10; i++) {
    stroke(i * 70.3, i * 14.3, 0);
    //stroke(i * random(0, 25), i * random(0, 10), 0);
    noFill();
    ellipse(
      windowWidth / 1.08,
      windowHeight / 1.64 + windowHeight / 15,
      (i * 5) / 2
    );
    ellipse(
      windowWidth / 1.08,
      windowHeight / 1.65 + windowHeight / 7,
      i * 5 * 1
    );
  }
  pop();
}

class buttonS {
  constructor(x, y, sz, btnOn, step, col) {
    this.x = x;
    this.y = y;
    this.sz = sz;
    this.btnOn = btnOn;
    this.col = col;
    this.startC = false;
    this.step = step;
  }
  display() {
    strokeWeight(2);
    stroke(255);
    fill(this.col);
    rect(this.x, this.y, this.sz);
  }
  clickedK() {
    if (
      mouseX > this.x &&
      mouseY > this.y &&
      mouseX < this.x + this.sz &&
      mouseY < this.y + this.sz
    ) {
      this.btnOn = !this.btnOn;
    }

    // set the fill color
    if (this.btnOn) {
      this.col = col1;
      pattern[this.step] = 0;
      //myPart.loop();
    } else {
      this.col = col2;
      // myPart.stop();
      pattern[this.step] = 1;
    }
  }
  clickedS() {
    if (
      mouseX > this.x &&
      mouseY > this.y &&
      mouseX < this.x + this.sz &&
      mouseY < this.y + this.sz
    ) {
      this.btnOn = !this.btnOn;
    }

    // set the fill color
    if (this.btnOn) {
      this.col = col3;
      pattern2[this.step] = 0;
      //myPart.loop();
    } else {
      (this.col = col2),
        // myPart.stop();
        (pattern2[this.step] = 1);
    }
  }
  clickedC() {
    if (
      mouseX > this.x &&
      mouseY > this.y &&
      mouseX < this.x + this.sz &&
      mouseY < this.y + this.sz
    ) {
      this.btnOn = !this.btnOn;
    }

    // set the fill color
    if (this.btnOn) {
      this.col = col5;
      pattern4[this.step] = 0;
      //myPart.loop();
    } else {
      this.col = col2;
      // myPart.stop();
      pattern4[this.step] = 1;
    }
  }
  clickedH() {
    if (
      mouseX > this.x &&
      mouseY > this.y &&
      mouseX < this.x + this.sz &&
      mouseY < this.y + this.sz
    ) {
      this.btnOn = !this.btnOn;
    }

    // set the fill color
    if (this.btnOn) {
      this.col = col4;
      pattern3[this.step] = 0;
      //myPart.loop();
    } else {
      this.col = col2;
      // myPart.stop();
      pattern3[this.step] = 1;
    }
  }
  start() {
    if (
      mouseX > this.x &&
      mouseY > this.y &&
      mouseX < this.x + this.sz &&
      mouseY < this.y + this.sz
    ) {
      this.startC = !this.startC;
    }
    if (this.startC) {
      myPart.loop();
    } else {
      myPart.stop();
    }
  }
}
