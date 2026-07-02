// ============================================================
//  AUDIO — fully procedural (WebAudio). No asset files.
//  Ambient stream + birdsong loop (owl hoots after dark), plus cast/splash/reel SFX.
//  Muted by default; unlocked on first gesture.
//  Call AUDIO.setSeason(id) to shift the ambient to match.
// ============================================================

const AUDIO = (function () {
  let ctx = null;
  let master = null;       // master gain (mute lives here)
  let ambGain = null;      // ambient bed gain
  let muted = true;
  let started = false;
  let birdTimer = null;
  let noiseBuffer = null;

  // refs to rampable nodes — set in startAmbient()
  let waterLPNode = null;
  let waterGNode  = null;
  let burbleGNode = null;
  let windGain       = null;   // null when wind layer isn't running
  let cicadaGain     = null;   // null when cicada layer isn't running
  let cicadaBurstTimer = null; // setTimeout handle for burst scheduling

  let currentSeason = 'spring';
  let nightMode = false;   // when true, the birdsong loop hoots owls instead of chirping

  // ---- Per-season ambient config ----
  // birdInterval : [minMs, maxMs] between chirps
  // birdPitch    : [minHz, maxHz] base frequency range
  // birdGain     : peak chirp volume
  // birdNotes    : [min, max] notes per chirp
  // waterLP      : lowpass cutoff for the water hiss (higher = brighter/fuller)
  // waterGain    : volume of the water hiss layer
  // burbleGain   : volume of the burble layer
  // wind         : whether to run the wind/gust layer
  // cicadas      : whether to run the cicada layer

  // Master birdsong volume — one knob scaling every season's birdGain.
  // Lower = quieter chirps; 1 = the original per-season levels.
  const BIRD_VOLUME = 0.03;

  const SEASON_AMB = {
    spring: {
      birdInterval: [2500, 8000], birdPitch: [2600, 4400], birdGain: 0.14, birdNotes: [1, 3],
      waterLP: 1200, waterGain: 0.23, burbleGain: 0.11,
      wind: false, cicadas: false,
    },
    summer: {
      birdInterval: [1200, 4500], birdPitch: [2800, 4800], birdGain: 0.15, birdNotes: [2, 4],
      waterLP: 1000, waterGain: 0.18, burbleGain: 0.09,
      wind: false, cicadas: true,
    },
    autumn: {
      birdInterval: [6000, 18000], birdPitch: [1800, 3200], birdGain: 0.09, birdNotes: [1, 2],
      waterLP: 950, waterGain: 0.20, burbleGain: 0.09,
      wind: true, cicadas: false,
    },
    winter: {
      birdInterval: [18000, 45000], birdPitch: [1600, 2400], birdGain: 0.07, birdNotes: [1, 1],
      waterLP: 800, waterGain: 0.17, burbleGain: 0.07,
      wind: true, cicadas: false,
    },
  };

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
    const cfg = SEASON_AMB[currentSeason] || SEASON_AMB.spring;

    ambGain = ctx.createGain();
    ambGain.gain.value = 0.0;
    ambGain.connect(master);

    // Layer 1 — broadband water hiss (lowpassed brown noise)
    const water = ctx.createBufferSource();
    water.buffer = noiseBuffer; water.loop = true;
    waterLPNode = ctx.createBiquadFilter();
    waterLPNode.type = 'lowpass'; waterLPNode.frequency.value = cfg.waterLP; waterLPNode.Q.value = 0.4;
    waterGNode = ctx.createGain(); waterGNode.gain.value = cfg.waterGain;
    water.connect(waterLPNode).connect(waterGNode).connect(ambGain);
    water.start();

    // Layer 2 — burble: bandpassed noise with a slowly wandering center freq
    const burble = ctx.createBufferSource();
    burble.buffer = noiseBuffer; burble.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 1.6;
    burbleGNode = ctx.createGain(); burbleGNode.gain.value = cfg.burbleGain;
    burble.connect(bp).connect(burbleGNode).connect(ambGain);
    burble.start();
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.13;
    const lfoG = ctx.createGain(); lfoG.gain.value = 180;
    lfo.connect(lfoG).connect(bp.frequency); lfo.start();

    // fade the bed in
    ambGain.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 2.5);

    // start any layers the current season calls for
    if (cfg.cicadas) startCicadas();
    if (cfg.wind)    startWind();

    scheduleBird();
  }

  // ---------- Wind / gust layer (autumn + winter) ----------
  function startWind() {
    if (windGain || !ctx) return;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    windGain.connect(ambGain || master);

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer; src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    // winter = colder, higher-pitched; autumn = warmer, lower
    filt.frequency.value = currentSeason === 'winter' ? 900 : 600;
    filt.Q.value = 0.6;
    src.connect(filt).connect(windGain);
    src.start();

    // slow gust LFO on gain
    const gustLFO = ctx.createOscillator();
    gustLFO.type = 'sine'; gustLFO.frequency.value = 0.07;
    const gustDepth = ctx.createGain();
    gustDepth.gain.value = currentSeason === 'winter' ? 0.06 : 0.04;
    gustLFO.connect(gustDepth).connect(windGain.gain);
    gustLFO.start();

    // filter pitch wander
    const pitchLFO = ctx.createOscillator();
    pitchLFO.type = 'sine'; pitchLFO.frequency.value = 0.05;
    const pitchDepth = ctx.createGain();
    pitchDepth.gain.value = 200;
    pitchLFO.connect(pitchDepth).connect(filt.frequency);
    pitchLFO.start();

    // fade in
    windGain.gain.linearRampToValueAtTime(currentSeason === 'winter' ? 0.10 : 0.07, ctx.currentTime + 3);
  }

  function stopWind() {
    if (!windGain) return;
    const t = ctx.currentTime;
    windGain.gain.linearRampToValueAtTime(0, t + 2);
    const ref = windGain;
    setTimeout(() => { try { ref.disconnect(); } catch (_) {} }, 2500);
    windGain = null;
  }

  // ---------- Cicada layer (summer) — short bursts, long silences ----------
  function startCicadas() {
    if (cicadaGain || !ctx) return;
    cicadaGain = ctx.createGain();
    cicadaGain.gain.value = 0;
    cicadaGain.connect(ambGain || master);

    // Two slightly detuned sine oscillators — sine is far gentler than sawtooth
    [3420, 3680].forEach(freq => {
      const osc = ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = freq;
      const amLFO = ctx.createOscillator();
      amLFO.type = 'sine'; amLFO.frequency.value = 18 + Math.random() * 8;
      const amDepth = ctx.createGain(); amDepth.gain.value = 0.35;
      const amCarrier = ctx.createGain(); amCarrier.gain.value = 0.5;
      amLFO.connect(amDepth).connect(amCarrier.gain);
      amLFO.start();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 2.5;
      osc.connect(bp).connect(amCarrier).connect(cicadaGain);
      osc.start();
    });

    scheduleCicadaBurst();
  }

  function scheduleCicadaBurst() {
    if (!cicadaGain) return;
    // burst: 1–3 s of sound, then silence for 45–65 s
    const burstSec = 1 + Math.random() * 2;
    const t = ctx.currentTime;
    cicadaGain.gain.cancelScheduledValues(t);
    cicadaGain.gain.linearRampToValueAtTime(0.001, t + 0.3);
    cicadaGain.gain.setValueAtTime(0.001, t + 0.3 + burstSec);1
    cicadaGain.gain.linearRampToValueAtTime(0, t + 0.3 + burstSec + 0.4);
    const silenceMs = (45 + Math.random() * 20) * 1000;
    cicadaBurstTimer = setTimeout(scheduleCicadaBurst, (burstSec + 0.7) * 1000 + silenceMs);
  }

  function stopCicadas() {
    if (!cicadaGain) return;
    clearTimeout(cicadaBurstTimer); cicadaBurstTimer = null;
    const t = ctx.currentTime;
    cicadaGain.gain.cancelScheduledValues(t);
    cicadaGain.gain.linearRampToValueAtTime(0, t + 0.4);
    const ref = cicadaGain;
    setTimeout(() => { try { ref.disconnect(); } catch (_) {} }, 1000);
    cicadaGain = null;
  }

  // ---------- Birdsong: occasional chirps, tuned per season ----------
  // After dark the same loop hoots owls instead — sparser and slower than the
  // chirps, so the night scene feels quiet, but not so sparse you wait forever
  // to hear one.
  const OWL_INTERVAL = [6000, 16000];

  function scheduleBird(soon) {
    clearTimeout(birdTimer);
    const cfg = SEASON_AMB[currentSeason] || SEASON_AMB.spring;
    const [minMs, maxMs] = nightMode ? OWL_INTERVAL : cfg.birdInterval;
    // `soon` fires the first call quickly (e.g. right when night begins) so the
    // owl is immediately audible instead of waiting out a full interval.
    const next = soon ? 600 + Math.random() * 1200 : minMs + Math.random() * (maxMs - minMs);
    birdTimer = setTimeout(() => {
      if (started) (nightMode ? owl : chirp)();
      scheduleBird();
    }, next);
  }

  function chirp() {
    const cfg = SEASON_AMB[currentSeason] || SEASON_AMB.spring;
    const [minN, maxN] = cfg.birdNotes;
    const [minP, maxP] = cfg.birdPitch;
    const t0 = ctx.currentTime;
    const notes = minN + Math.floor(Math.random() * (maxN - minN + 1));
    const base = minP + Math.random() * (maxP - minP);
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
    g.gain.linearRampToValueAtTime(cfg.birdGain * BIRD_VOLUME, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + notes * 0.16 + 0.15);
  }

  // The nighttime counterpart to chirp(): a low, breathy owl hoot. A soft sine
  // fundamental down in the 280–360 Hz range, each hoot swelling and fading, with
  // most calls being the classic two-hoot "hoo … hoo".
  function owl() {
    const t0 = ctx.currentTime;
    const hoots = Math.random() < 0.7 ? 2 : 1;   // mostly the "hoo-hoo" call
    const base = 280 + Math.random() * 80;
    // A low hoot needs much more gain than a bright chirp to be perceptible over
    // the water bed, so the owl uses its own absolute peak (in line with the
    // audible SFX) rather than the very quiet BIRD_VOLUME the chirps share.
    const peak = 0.11;
    for (let h = 0; h < hoots; h++) {
      const t = t0 + h * (0.55 + Math.random() * 0.15);
      const f = base * (1 + (Math.random() - 0.5) * 0.06);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f * 1.06, t);
      o.frequency.linearRampToValueAtTime(f, t + 0.12);
      o.frequency.linearRampToValueAtTime(f * 0.94, t + 0.4);
      // a faint breathy second partial for body
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.setValueAtTime(f * 2.01, t);
      const g2 = ctx.createGain(); g2.gain.value = 0.18;
      o2.connect(g2);
      const g = ctx.createGain();
      g.gain.value = 0; g.connect(ambGain || master);
      g2.connect(g);
      o.connect(g);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.1);    // gentle swell in
      g.gain.linearRampToValueAtTime(peak, t + 0.28);   // hold
      g.gain.exponentialRampToValueAtTime(0.0004, t + 0.55);
      o.start(t); o.stop(t + 0.6);
      o2.start(t); o2.stop(t + 0.6);
    }
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
    takeSplash() { // a fast/aggressive take — fish smacks the surface hard
      noiseBurst(0.4, 'lowpass', 2000, 0.5, 0.4, 220);
      tone(150, 0.22, 'sine', 0.18, 60);
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
    rise() { // a fish rising somewhere out on the water — a soft, distant gloop
      noiseBurst(0.18, 'lowpass', 700, 1.4, 0.05, 240);
    },
    legend() { // legendary fish — a grand, slow fanfare
      [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => { if (ctx) tone(f, 0.55, 'triangle', 0.13); }, i * 150));
      [392, 523].forEach((f, i) => setTimeout(() => { if (ctx) tone(f, 1.2, 'sine', 0.08); }, i * 150));
    },
  };

  return {
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
    // toggle the nighttime owl loop on/off; reschedules so the change is heard now
    setNight(on) {
      on = !!on;
      if (on === nightMode) return;
      nightMode = on;
      // when night falls, fire an owl soon so the shift is immediately heard
      if (started) scheduleBird(on);
    },
    setSeason(id) {
      if (!SEASON_AMB[id] || id === currentSeason) return;
      const prev = SEASON_AMB[currentSeason];
      currentSeason = id;
      const cfg = SEASON_AMB[id];

      // reschedule birds immediately with new cadence/pitch
      if (started) scheduleBird();

      // ramp water character
      if (waterLPNode && waterGNode && burbleGNode && ctx) {
        const t = ctx.currentTime;
        waterLPNode.frequency.linearRampToValueAtTime(cfg.waterLP, t + 3);
        waterGNode.gain.linearRampToValueAtTime(cfg.waterGain, t + 3);
        burbleGNode.gain.linearRampToValueAtTime(cfg.burbleGain, t + 3);
      }

      if (!started) return;  // layers will be started in startAmbient() when audio unlocks

      // start/stop seasonal layers
      if (cfg.cicadas && !cicadaGain) startCicadas();
      if (!cfg.cicadas && cicadaGain)  stopCicadas();
      if (cfg.wind && !windGain)  startWind();
      if (!cfg.wind && windGain)  stopWind();
    },
  };
})();

window.AUDIO = AUDIO;
