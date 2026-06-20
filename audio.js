// ============================================================
//  AUDIO — fully procedural (WebAudio). No asset files.
//  Ambient stream + birdsong loop, plus cast/splash/reel SFX.
//  Muted by default; unlocked on first gesture.
// ============================================================

const AUDIO = (function () {
  let ctx = null;
  let master = null;       // master gain (mute lives here)
  let ambGain = null;      // ambient bed gain
  let muted = true;
  let started = false;
  let birdTimer = null;
  let noiseBuffer = null;

  function ensureCtx() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
    noiseBuffer = makeNoiseBuffer();
  }

  function makeNoiseBuffer() {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // brown-ish noise (integrated white) for a softer water hiss
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.2;
    }
    return buf;
  }

  // ---------- Ambient bed: moving water + a low burble ----------
  function startAmbient() {
    if (started) return;
    started = true;
    ambGain = ctx.createGain();
    ambGain.gain.value = 0.0;
    ambGain.connect(master);

    // Layer 1 — broadband water hiss (lowpassed brown noise)
    const water = ctx.createBufferSource();
    water.buffer = noiseBuffer; water.loop = true;
    const waterLP = ctx.createBiquadFilter();
    waterLP.type = 'lowpass'; waterLP.frequency.value = 1100; waterLP.Q.value = 0.4;
    const waterG = ctx.createGain(); waterG.gain.value = 0.22;
    water.connect(waterLP).connect(waterG).connect(ambGain);
    water.start();

    // Layer 2 — burble: bandpassed noise with a slowly wandering center freq
    const burble = ctx.createBufferSource();
    burble.buffer = noiseBuffer; burble.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 1.6;
    const burbleG = ctx.createGain(); burbleG.gain.value = 0.10;
    burble.connect(bp).connect(burbleG).connect(ambGain);
    burble.start();
    // wander the burble filter
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.13;
    const lfoG = ctx.createGain(); lfoG.gain.value = 180;
    lfo.connect(lfoG).connect(bp.frequency); lfo.start();

    // fade the bed in
    ambGain.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 2.5);

    scheduleBird();
  }

  // ---------- Birdsong: occasional sweet chirps ----------
  function scheduleBird() {
    const next = 3500 + Math.random() * 9000;
    birdTimer = setTimeout(() => {
      if (started) chirp();
      scheduleBird();
    }, next);
  }

  function chirp() {
    const t0 = ctx.currentTime;
    const notes = 1 + Math.floor(Math.random() * 3);
    const base = 2200 + Math.random() * 1600;
    const g = ctx.createGain();
    g.gain.value = 0; g.connect(ambGain || master);
    for (let n = 0; n < notes; n++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const t = t0 + n * (0.09 + Math.random() * 0.05);
      const f = base * (1 + (Math.random() - 0.3) * 0.25);
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * (1.3 + Math.random() * 0.4), t + 0.05);
      o.frequency.exponentialRampToValueAtTime(f * 0.9, t + 0.11);
      o.connect(g);
      o.start(t); o.stop(t + 0.13);
    }
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.12, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + notes * 0.16 + 0.15);
  }

  // ---------- one-shot helpers ----------
  function noiseBurst(dur, type, freq, q, gain, sweepTo) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 1;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(master);
    const t = ctx.currentTime;
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    src.start(t); src.stop(t + dur + 0.05);
  }

  function tone(freq, dur, type, gain, sweepTo) {
    const o = ctx.createOscillator(); o.type = type || 'sine';
    const g = ctx.createGain(); g.gain.value = 0;
    o.frequency.value = freq;
    o.connect(g).connect(master);
    const t = ctx.currentTime;
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    o.start(t); o.stop(t + dur + 0.05);
  }

  const SFX = {
    cast() { // airy whoosh of the line
      noiseBurst(0.5, 'bandpass', 600, 0.8, 0.18, 1700);
    },
    splash() { // fly hits the water
      noiseBurst(0.32, 'lowpass', 1400, 0.7, 0.3, 350);
    },
    reel(times) { // ratchet clicks
      times = times || 6;
      for (let i = 0; i < times; i++) {
        setTimeout(() => { if (ctx) tone(1400 + Math.random() * 300, 0.04, 'square', 0.05); }, i * 55);
      }
    },
    set() { // sharp hookset
      noiseBurst(0.18, 'highpass', 900, 0.7, 0.22, 1600);
      tone(320, 0.16, 'triangle', 0.12, 180);
    },
    hookup() { // fish on — rising bright tone
      tone(440, 0.22, 'triangle', 0.16, 760);
    },
    strip() { // line strip pull
      noiseBurst(0.14, 'bandpass', 900, 1.2, 0.12, 500);
    },
    mend() { // line flick reset
      noiseBurst(0.22, 'bandpass', 1300, 0.9, 0.14, 700);
    },
    catch() { // landed — little 3-note flourish
      [523, 659, 784].forEach((f, i) => setTimeout(() => { if (ctx) tone(f, 0.3, 'triangle', 0.13); }, i * 110));
    },
    fail() { // lost it — falling tone
      tone(300, 0.4, 'sawtooth', 0.1, 120);
    },
    record() { // new record — bright arpeggio
      [659, 784, 988, 1319].forEach((f, i) => setTimeout(() => { if (ctx) tone(f, 0.32, 'triangle', 0.12); }, i * 110));
    },
  };

  return {
    // call from a user gesture
    unlock() {
      ensureCtx();
      if (ctx.state === 'suspended') ctx.resume();
      startAmbient();
    },
    isMuted() { return muted; },
    setMuted(m) {
      muted = m;
      if (master) master.gain.linearRampToValueAtTime(m ? 0 : 1, (ctx ? ctx.currentTime : 0) + 0.15);
    },
    toggle() { this.setMuted(!muted); return muted; },
    play(name, arg) {
      if (!ctx || muted) return;
      if (SFX[name]) SFX[name](arg);
    },
  };
})();

window.AUDIO = AUDIO;
