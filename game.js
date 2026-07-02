// ============================================================
//  BROOK & LINE — game engine
//  States: IDLE → CASTING → DRIFT ⇄ BITE → FIGHT → REVEAL
//  RNG is driven by conditions × tackle × drift quality.
// ============================================================

const A = DATA;
const $ = (id) => document.getElementById(id);

// ---------------- seasons & asset paths ----------------
// map the player's real-world month → the matching season (northern hemisphere)
function currentSeasonId() {
  const m = new Date().getMonth();           // 0 = Jan
  if (m <= 1 || m === 11) return 'winter';   // Dec, Jan, Feb
  if (m <= 4) return 'spring';               // Mar, Apr, May
  if (m <= 7) return 'summer';               // Jun, Jul, Aug
  return 'autumn';                           // Sep, Oct, Nov
}
// map the player's real-world hour → the closest time-of-day phase
function currentPhaseIdx() {
  const h = new Date().getHours();
  const id = h < 5 ? 'dusk' : h < 7 ? 'dawn' : h < 11 ? 'morning'
    : h < 14 ? 'midday' : h < 17 ? 'afternoon' : h < 20 ? 'evening' : 'dusk';
  const i = A.PHASES.findIndex(p => p.id === id);
  return i < 0 ? 0 : i;
}

// always open in the player's real-world season; the slider is a within-session
// explorer (its choice is intentionally not restored across reloads).
let SEASON_ID = currentSeasonId();
if (!A.SEASONS[SEASON_ID]) SEASON_ID = A.SEASON_ORDER[0];
let SEASON = A.SEASONS[SEASON_ID];

// The cast animation (angler + rod + line mask) and the angler poses (drift / mend /
// set) are the same first-person action in every season, so they live in shared
// folders rather than being duplicated per season. Only the backgrounds are seasonal.
const CAST_DIR = 'assets/cast';   // shared cast frames + line masks
const FG_DIR = 'assets/fg';       // shared angler poses
const CAST_FRAMES = 4;

// resolve every scene asset for a season from its manifest (counts → file names)
function buildPaths(season) {
  const d = season.dir;
  return {
    // numbered scene backdrops: bg[0] is the still scene (idle / casting / first drift
    // frame); bg[1..] are the downstream drift backdrops. They're all drift frames, so
    // the cast scene gets the same fly line + bob + pan as the rest.
    bg:      Array.from({ length: season.bgFrames }, (_, i) => `${d}/${i}.webp`),
    cast:    Array.from({ length: CAST_FRAMES }, (_, i) => `${CAST_DIR}/cast_${i}.webp`),
    castLine: Array.from({ length: CAST_FRAMES }, (_, i) => `${CAST_DIR}/line_${i}.webp`),
    drift:   `${FG_DIR}/drift.webp`,
    mend:    `${FG_DIR}/mend.webp`,
    set:     `${FG_DIR}/set.webp`,
  };
}
let IMG = buildPaths(SEASON);

const FISH_IMGS = A.SPECIES_ORDER.map(id => A.SPECIES[id].img);
// flat list of one season's scene images, for preloading
const locImageList = (img) => [...img.bg, ...img.cast, ...img.castLine, img.drift, img.mend, img.set];

// ---------------- DOM ----------------
const bg = $('background'), bg2 = $('background2'), fg = $('foreground');
const castLineEl = $('cast-line');
const flyLine = $('fly-line'), flyPath = $('fly-line-path'), flyDot = $('fly-dot'),
      flyLeader = $('fly-leader-path'), flyTippet = $('fly-tippet-path'), flyDot2 = $('fly-dot2');
const castBtn = $('cast-btn'), mendBtn = $('mend-btn'), setBtn = $('set-btn'), reelBtn = $('reel-in-btn');
const driftMini = $('drift-mini'), driftMiniFill = $('drift-mini-fill'), driftMiniVal = $('drift-mini-val');
const takePrompt = $('take-prompt');
const fightEl = $('fight'), greenZone = $('green-zone'),
      indicator = $('indicator'), stripBtn = $('strip-btn'),
      fightFish = $('fight-fish'), fightLine = $('fight-line'), fightAction = $('fight-species-action');
const reveal = $('reveal'), revRibbon = $('reveal-ribbon'), revSpecies = $('reveal-species'),
      revInches = $('reveal-inches'), revImg = $('reveal-img'), revFlavor = $('reveal-flavor'),
      releaseBtn = $('release-btn');
const tackleEl = $('tackle'), tackleToggleBtn = $('tackle-toggle'), panelCloseBtn = $('panel-close');
const sceneGrade = $('scene-grade'), ambientEl = $('ambient'), toastsEl = $('toasts');
const cardBtn = $('card-btn'), cardModal = $('card-modal'), trophyCanvas = $('trophy-canvas');

// ---------------- game state ----------------
const ST = { IDLE: 0, CASTING: 1, DRIFT: 2, BITE: 3, FIGHT: 4, REVEAL: 5 };
let state = ST.IDLE;

let tackle = { rodId: 'graphite5', rigId: 'dry', slots: ['para_adams'] };
let cond = { phaseIdx: 0, waterId: 'clear', hatch: 'none', light: 'soft' };

let driftQuality = 100;
let pity = 1;
let dragFreeUntil = 0;
let mendCoolUntil = 0;
const MEND_COOLDOWN_MS = 2200;   // one mend per this window — also one automend per hold
const AUTOMEND_STREAK = 5;       // this many automends in a row (no release) → secret
const MEND_MASH_STREAK = 5;      // this many taps blocked by one cooldown → secret
let mendAutoStreak = 0;          // consecutive hold-driven mends; releasing M resets it
let mendMash = 0;                // deliberate taps blocked by the active cooldown
let lastBiteTick = 0;
let driftRAF = null;
let bite = null;          // current bite payload {species, sizeIn, setWindow, deadline, trophy, legend}
let biteFlash = null;

// --- session tracking (for achievements / streaks) ---
let catchStreak = 0;          // consecutive lands without losing a hooked fish
let daySpecies = {};          // species landed since the last dawn (for the day-slam)
let lastCatch = null;         // snapshot of the most recent landed fish (for the trophy card)
let tackleWasRolled = false;  // did the dice set the current loadout? (for the Lucky Roll badge)
let perfectCastStreak = 0;    // consecutive perfect casts (for the Perfectionist badge)
let castLuck = 1;             // bite-chance multiplier earned from the cast-timing meter (1 = none)

// ---------------- persistence ----------------
const LSK = 'bl_journal_v1';
let journal = loadJournal();
function loadJournal() {
  let j = null;
  try { j = JSON.parse(localStorage.getItem(LSK)); } catch (e) {}
  if (!j || !j.species) {
    j = { species: {}, casts: 0, landed: 0, best: 0 };
    A.SPECIES_ORDER.forEach(id => j.species[id] = { caught: false, count: 0, best: 0 });
  }
  // migrate / ensure newer fields exist on older saves
  if (!j.legends) j.legends = {};
  if (!j.achievements) j.achievements = {};
  if (!j.secrets) j.secrets = {};
  if (!j.seasonsFished) j.seasonsFished = {};
  if (!j.daily) j.daily = { key: null, done: false, streak: 0, lastCompleted: null };
  A.SPECIES_ORDER.forEach(id => { if (!j.species[id]) j.species[id] = { caught: false, count: 0, best: 0 }; });
  return j;
}
function saveJournal() { localStorage.setItem(LSK, JSON.stringify(journal)); }

// =========================================================
//  ASSETS — preload (decode before use) + background crossfade
//  Decoding images before they're shown is what kills the
//  "pop-in" flashes; once decoded, swapping an <img> src is instant.
// =========================================================
const imgCache = new Map();   // src -> Promise that resolves once decoded/loaded
function preload(paths) {
  return Promise.all(paths.map(src => {
    if (imgCache.has(src)) return imgCache.get(src);
    const img = new Image();
    img.src = src;
    const p = (img.decode ? img.decode() : Promise.reject())
      .catch(() => new Promise(res => { img.onload = img.onerror = res; }));
    imgCache.set(src, p);
    return p;
  }));
}

// two stacked <img> layers; fade the back one in, then swap roles
let bgFront = bg, bgBack = bg2;
function applyLight(el) {
  el.classList.remove('light-low', 'light-soft', 'light-bright');
  el.classList.add('light-' + cond.light);
}
function setBackground(src, fade) {
  if (fade === false) {
    bgFront.src = src; applyLight(bgFront);
    bgBack.style.opacity = '0';
    return;
  }
  bgBack.src = src;
  applyLight(bgBack);
  bgBack.style.opacity = '1';
  bgFront.style.opacity = '0';
  const t = bgFront; bgFront = bgBack; bgBack = t;
}

// =========================================================
//  DYNAMIC FLY LINE — drawn from rod tip to the fly on the water
//  · The rod-tip anchor is mapped through the foreground's LIVE transform
//    (pan / bob / bite shake) so the line stays glued to the tip.
//  · During the drift the fly travels upstream→downstream and the line
//    bellies more as drag builds, snapping taut on a take.
//  · The fly-end marker depends on the rig (indicator / dry fly / foam).
// =========================================================
const lerp = (a, b, t) => a + (b - a) * t;
const SW_STAGE = 1472, SH_STAGE = 704;

let lineAnchors = null;   // current SEASON.line[state] entry
let lineRAF = null;
let lineJerk = 0;         // 0..1 transient that pulls the line taut on a strike
let mendBow = 0;          // 0..1 transient that flips the line's arc upstream after a mend
let takeTrack = null;     // live take animation whose mouth the fly + line end rides

// Single source of truth for the foreground's transform. Both the <img> and the
// fly-line rod-tip are derived from these, so the line can never lag/detach from
// the tip (no getComputedStyle round-trip, no cross-RAF timing gap).
let fgX = 0, fgY = 0, fgRot = 0, fgScale = 1;
function applyFgTransform() {
  fg.style.transform = `translate(${fgX.toFixed(1)}px, ${fgY.toFixed(1)}px) rotate(${fgRot.toFixed(2)}deg) scale(${fgScale})`;
}
function resetFgTransform() { fgX = 0; fgY = 0; fgRot = 0; fgScale = 1; fg.style.transform = ''; }

// rod-tip in stage px after the foreground's transform (origin = center)
function fgTipPoint(rod) {
  const ox = SW_STAGE / 2, oy = SH_STAGE / 2;
  const r = fgRot * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r);
  const dx = (rod[0] * SW_STAGE - ox) * fgScale, dy = (rod[1] * SH_STAGE - oy) * fgScale;
  return [ox + dx * c - dy * sn + fgX, oy + dx * sn + dy * c + fgY];
}

// which fly-end marker the current rig shows
function flyMarkerKind() {
  if (tackle.rigId === 'hopper_dropper') return 'foam';        // neon spec of foam
  const rig = A.RIGS[tackle.rigId];
  if (rig.slots.every(s => s === 'drop')) return 'ind';        // nymph → strike indicator
  return 'fly';                                                // dry → fuzzy distant fly
}

// double-dry rig: the second dry rides a length of tippet beyond the first,
// following the cast direction in x but mirrored in y, so it lands upstream
// of (further out than) the first fly instead of back toward the viewer
const TIPPET_LEN = 88;   // stage px between the two dries
function isDoubleDry() {
  const rig = A.RIGS[tackle.rigId];
  return rig.slots.length === 2 && rig.slots.every(s => s === 'top');
}
function tippetOffset(rx, ry, fxp, fyp) {
  const dx = fxp - rx, dy = fyp - ry;
  const d = Math.hypot(dx, dy) || 1;
  return [dx / d * TIPPET_LEN, -dy / d * TIPPET_LEN];
}

function updateFlyMarker() {
  const k = flyMarkerKind();
  flyDot.setAttribute('class', k);
  flyDot.setAttribute('r', k === 'foam' ? 5.5 : k === 'fly' ? 5.5 : 4.5);
  const dd = isDoubleDry();
  flyTippet.style.display = dd ? '' : 'none';
  flyDot2.style.display = dd ? '' : 'none';
  if (dd) { flyDot2.setAttribute('class', 'fly'); flyDot2.setAttribute('r', 4.5); }
}

function updateLineColor() {
  flyPath.style.stroke = (A.RODS[tackle.rodId] && A.RODS[tackle.rodId].lineColor) || '#e7ff8c';
}

function showFlyLine(which) {
  lineAnchors = (SEASON.line && (SEASON.line[which] || SEASON.line.drift)) || null;
  if (!lineAnchors) { hideFlyLine(); return; }
  updateFlyMarker();
  updateLineColor();
  flyLine.classList.add('show');
  if (lineRAF == null) lineRAF = requestAnimationFrame(drawFlyLine);
}
function hideFlyLine() {
  flyLine.classList.remove('show');
  if (lineRAF != null) { cancelAnimationFrame(lineRAF); lineRAF = null; }
}
// Current stage-px position of the striking fish's mouth, or null while it's
// not measurable yet. Mirrors the .take-clip / .take-fish-img layout in
// style.css (clip bottom 3px under the waterline, img bottom-aligned with its
// left edge on the strike x before its transform runs) and reads the img's
// LIVE mid-animation matrix, so the line can never drift apart from the fish.
// All species art faces left, mouth at the left tip, mid-height.
function takeMouthPoint() {
  const img = takeTrack.img;
  const w = img.offsetWidth, h = img.offsetHeight;
  if (!w || !h) return null;
  const cs = getComputedStyle(img).transform;
  if (!cs || cs === 'none') return null;
  const M = new DOMMatrix(cs);
  const px = 0.03 * w - w / 2, py = 0.5 * h - h / 2;   // mouth relative to the transform origin (center)
  return [takeTrack.ax + w / 2 + M.a * px + M.c * py + M.e,
          takeTrack.ay + 3 - h / 2 + M.b * px + M.d * py + M.f];
}

function drawFlyLine(now) {
  if (!lineAnchors || !flyLine.classList.contains('show')) { lineRAF = null; return; }
  const t = now / 1000;
  const drifting = (state === ST.DRIFT || state === ST.BITE);

  // fly position: during the drift it slides upstream→downstream with the segment.
  // Driven from the drift anchors even while the mend pose is showing, so a mend
  // visibly throws the fly back upstream.
  const dl = SEASON.line && SEASON.line.drift;
  let flyN;
  if (drifting && dl && dl.flyUp && dl.flyDown) {
    const s = Math.max(0, Math.min(1, driftProgress));   // lure floats downstream (carries thru bg cuts)
    flyN = [lerp(dl.flyUp[0], dl.flyDown[0], s), lerp(dl.flyUp[1], dl.flyDown[1], s)];
  } else {
    flyN = lineAnchors.fly || (dl && dl.flyUp) || [0.3, 0.92];
  }

  const [rx, ry] = fgTipPoint(lineAnchors.rod);
  const fxp = flyN[0] * SW_STAGE, fyp = flyN[1] * SH_STAGE;
  const dq = drifting ? driftQuality : 100;

  // double-dry: the second fly floats a tippet-length past the first, along
  // the cast direction
  const dd = isDoubleDry();
  let e2x = 0, e2y = 0, bob2 = Math.sin(t * 1.6 + 1.1) * 2;
  if (dd) { const [ox, oy] = tippetOffset(rx, ry, fxp, fyp); e2x = fxp + ox; e2y = fyp + oy; }

  // While a take animation plays, the taken fly + its line end ride the
  // fish's mouth from the moment it breaks the surface; as the fish sounds
  // again, the end point is handed back to the surface where the fly went
  // under. On a double-dry the fish may have eaten either fly.
  let ex = fxp, ey = fyp, bob = Math.sin(t * 1.6) * 2;
  if (takeTrack && state === ST.BITE) {
    const m = takeMouthPoint();
    if (m) {
      if (!takeTrack.contacted && m[1] <= takeTrack.ay + 8) takeTrack.contacted = true;
      if (takeTrack.contacted) {
        const sink = Math.max(0, Math.min(1, (m[1] - takeTrack.ay) / 30));
        const tx = lerp(m[0], takeTrack.ax, sink);
        const ty = lerp(Math.min(m[1], takeTrack.ay + 22), takeTrack.ay, sink);
        if (dd && takeTrack.flyIdx === 1) { e2x = tx; e2y = ty; bob2 = 0; }
        else { ex = tx; ey = ty; bob = 0; }
      }
    }
  }

  // The arc of the line reflects drag: it bellies DOWNSTREAM (−x here) and grows as the
  // drift degrades. A mend flips that belly UPSTREAM, then it relaxes back as drag rebuilds.
  const baseMag = (lineAnchors.sag || 0.06) * SH_STAGE;
  const dragBow = (100 - dq) / 100;                       // 0 = clean drift, 1 = blown out
  let lateral = -(0.35 + dragBow * 1.9) * baseMag;        // downstream belly
  if (mendBow > 0) {
    lateral = lerp(lateral, 1.6 * baseMag, mendBow);      // mend throws the arc upstream
    mendBow = Math.max(0, mendBow - 0.012);
  }
  if (lineJerk > 0) { lateral *= (1 - 0.85 * lineJerk); lineJerk = Math.max(0, lineJerk - 0.045); }
  const sway = Math.sin(t * 1.6) * 4 + Math.sin(t * 0.7) * 2;
  const mx = (rx + ex) / 2 + lateral + sway;              // control point: lateral arc
  // gravity sag: a slack, dragging line hangs deeper; a strike pulls it straight
  const my = (ry + ey) / 2 + baseMag * (0.45 + 0.4 * dragBow) * (1 - 0.75 * lineJerk);

  // The rig tapers like the real thing: colored fly line from the rod for most
  // of the way, then a near-clear leader for the last stretch to the fly.
  // Split the quadratic exactly (de Casteljau) so the curve stays seamless.
  const LT = 0.78;
  const c1x = lerp(rx, mx, LT),   c1y = lerp(ry, my, LT);
  const c2x = lerp(mx, ex, LT),   c2y = lerp(my, ey, LT);
  const jx  = lerp(c1x, c2x, LT), jy  = lerp(c1y, c2y, LT);
  flyPath.setAttribute('d', `M ${rx.toFixed(1)} ${ry.toFixed(1)} Q ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${jx.toFixed(1)} ${jy.toFixed(1)}`);
  flyLeader.setAttribute('d', `M ${jx.toFixed(1)} ${jy.toFixed(1)} Q ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`);
  flyDot.setAttribute('cx', ex.toFixed(1));
  flyDot.setAttribute('cy', (ey + bob).toFixed(1));
  if (dd) {
    // fine tippet from the first fly on to the second, with a touch of sag
    const sx = (ex + e2x) / 2, sy = (ey + e2y) / 2 + 6;
    flyTippet.setAttribute('d', `M ${ex.toFixed(1)} ${(ey + bob).toFixed(1)} Q ${sx.toFixed(1)} ${sy.toFixed(1)} ${e2x.toFixed(1)} ${e2y.toFixed(1)}`);
    flyDot2.setAttribute('cx', e2x.toFixed(1));
    flyDot2.setAttribute('cy', (e2y + bob2).toFixed(1));
  }
  lineRAF = requestAnimationFrame(drawFlyLine);
}

// =========================================================
//  CONDITIONS ENGINE
// =========================================================
function rollWater() {
  const r = Math.random();
  cond.waterId = r < 0.5 ? 'clear' : r < 0.8 ? 'riffled' : 'stained';
}
// the dark, low-light phases (dawn / dusk) read as "night" for the ambience —
// birdsong gives way to owl hoots in the audio loop.
function isNightPhase() {
  return A.PHASES[cond.phaseIdx].light === 'low';
}
function applyPhase() {
  const p = A.PHASES[cond.phaseIdx];
  cond.light = p.light;
  AUDIO.setNight(isNightPhase());
  // the season decides which bug is on for this phase; fall back to the phase default
  const seasonHatch = (SEASON.hatches && SEASON.hatches[p.id]) || p.hatch;
  // hatch mostly follows the season/phase, with a chance of "searching"
  cond.hatch = Math.random() < 0.78 ? seasonHatch : 'none';
  paintLight();
  renderReport();
  renderMatch();
}
// keep the time-of-day phase pinned to the player's real-world clock — it never
// cycles on its own, it just follows the wall clock as the actual hours pass.
function syncPhaseToClock() {
  const next = currentPhaseIdx();
  if (next === cond.phaseIdx) return;
  if (next === 0) daySpecies = {};   // rolled into a new dawn → fresh shot at a day-slam
  cond.phaseIdx = next;
  if (Math.random() < 0.35) rollWater();
  applyPhase();
}
function paintLight() {
  applyLight(bgFront);
  applyLight(bgBack);
  applyGrade();
}
// a soft, mood color-grade laid over the whole scene that shifts with time of day:
// cool blue at dawn, warm gold at evening/dusk, near-neutral midday.
function applyGrade() {
  if (!sceneGrade) return;
  const id = A.PHASES[cond.phaseIdx].id;
  sceneGrade.className = 'grade-' + id;
}

// =========================================================
//  EVALUATE — the heart of the "thoughtful RNG"
//  Returns how well current tackle fits current conditions.
// =========================================================
function equippedFlies() {
  return tackle.slots.filter(Boolean).map(id => A.FLIES[id]);
}
function presentedDepths() {
  return equippedFlies().map(f => f.depth);
}
function evaluate() {
  const flies = equippedFlies();
  const rig = A.RIGS[tackle.rigId];
  const rod = A.RODS[tackle.rodId];
  const water = A.WATER[cond.waterId];
  const phase = A.PHASES[cond.phaseIdx];

  if (!flies.length) {
    return { ready: false, biteMul: 0, score: 0, hatchFit: 0, depthFit: 0, rodFit: 0,
             verdict: 'NO FLY', note: 'Tie on at least one fly to fish.' };
  }

  // --- hatch fit: best imitation of the active hatch ---
  let hatchFit = 0;
  flies.forEach(f => {
    let v;
    if (cond.hatch === 'none') v = f.imitates.includes('attractor') ? 0.9 : 0.62;
    else if (f.imitates.includes(cond.hatch)) v = 1.0;
    else if (f.imitates.includes('attractor')) v = 0.6;
    else v = 0.32;
    hatchFit = Math.max(hatchFit, v);
  });

  // --- depth fit: overlap with where fish are feeding ---
  const depths = presentedDepths();
  let feedSum = 0;
  const seen = {};
  depths.forEach(d => { if (!seen[d]) { seen[d] = 1; feedSum += phase.feed[d] || 0; } });
  const depthFit = Math.min(1, feedSum / 0.48);

  // --- rod fit: casting weight match + finesse ---
  const diff = A.weightRank[rig.weight] - A.weightRank[rod.comfort];
  let rodFit = 1;
  if (diff > 0) rodFit = 1 - 0.16 * diff / Math.max(0.6, rod.punch);      // too light → sloppy
  else if (diff < 0) rodFit = 1 - 0.10 * (-diff) * (cond.waterId === 'clear' ? 1.3 : 0.8) / Math.max(0.7, rod.delicate);
  // delicate rod bonus on small dries in clear water
  const smallDry = flies.some(f => f.cat !== 'nymph' && f.hook >= 16);
  if (smallDry && cond.waterId === 'clear') rodFit *= (0.9 + 0.18 * rod.delicate);
  rodFit = Math.max(0.55, Math.min(1.12, rodFit));

  // --- combine into a bite multiplier ---
  const hatchFactor = Math.pow(hatchFit, water.selectivity);  // clear water punishes mismatch
  const biteMul = rig.biteBase * water.biteBase * hatchFactor * (0.35 + 0.65 * depthFit) * rodFit;

  // --- displayed score (0..1) ---
  const score = Math.max(0, Math.min(1, 0.5 * hatchFit + 0.32 * depthFit + 0.18 * (rodFit - 0.55) / 0.57));

  // --- verdict + note ---
  let verdict, vClass, note;
  if (score >= 0.8) { verdict = 'DIALED'; vClass = 'good'; }
  else if (score >= 0.58) { verdict = 'GOOD'; vClass = 'good'; }
  else if (score >= 0.38) { verdict = 'FAIR'; vClass = 'mid'; }
  else { verdict = 'POOR'; vClass = 'low'; }

  // most actionable hint
  if (hatchFit < 0.55) note = cond.hatch === 'none'
      ? 'No hatch — try an attractor or searching pattern.'
      : `Fish are on ${A.HATCHES[cond.hatch].label.toLowerCase()}. Match it.`;
  else if (depthFit < 0.5) note = 'You\'re fishing the wrong depth — see FEEDING.';
  else if (rodFit < 0.85) note = diff > 0 ? 'Rod\'s too soft for this rig — sloppy casts.'
      : 'Rod\'s heavy for these flies — landing hard.';
  else note = 'Tackle suits the water. Now drift it clean.';

  return { ready: true, biteMul, score, hatchFit, depthFit, rodFit, verdict, vClass, note };
}

// =========================================================
//  RENDER — report + match panels
// =========================================================
function renderReport() {
  const p = A.PHASES[cond.phaseIdx];
  const water = A.WATER[cond.waterId];
  $('rep-phase').textContent = p.label;
  $('rep-hatch').textContent = A.HATCHES[cond.hatch].label;
  $('rep-light').textContent = p.light === 'low' ? 'Low' : p.light === 'soft' ? 'Soft' : 'Bright';
  $('rep-water').textContent = water.label;
  // dominant feeding depth
  const top = Object.entries(p.feed).sort((a, b) => b[1] - a[1])[0][0];
  const feedName = { surface: 'Surface', film: 'In the film', shallow: 'Mid-column', deep: 'Down deep' }[top];
  $('rep-feed').textContent = feedName;
  $('rep-blurb').textContent = water.blurb + ' ' + A.HATCHES[cond.hatch].blurb;
}

function renderMatch() {
  const e = evaluate();
  const v = $('match-verdict');
  v.textContent = e.verdict;
  v.style.color = e.ready ? (e.vClass === 'good' ? 'var(--line-d)' : e.vClass === 'mid' ? 'var(--warn)' : 'var(--bad)') : 'var(--ink-faint)';
  // 5 bars
  const bars = $('match-bars');
  bars.innerHTML = '';
  const lit = Math.round(e.score * 5);
  for (let i = 0; i < 5; i++) {
    const s = document.createElement('span');
    if (i < lit) { s.className = 'on ' + (e.vClass || ''); }
    bars.appendChild(s);
  }
  $('match-note').textContent = e.note;
  // reflect match on each fly slot dot
  renderSlots();
}

// =========================================================
//  TACKLE UI
// =========================================================
// the loadout is committed the moment a cast starts — rod, rig and flies can only
// be changed while idle (between casts), never mid-cast/drift/fight/reveal.
function tackleLocked() { return state !== ST.IDLE; }

// reflect the locked state on the panel so the controls look (and feel) inert
// while a cast is in flight — pointer events off + dimmed, re-enabled at idle.
function syncTackleLock() { tackleEl.classList.toggle('locked', tackleLocked()); }

function renderRods() {
  const wrap = $('rod-list'); wrap.innerHTML = '';
  Object.entries(A.RODS).forEach(([id, r]) => {
    const b = document.createElement('button');
    b.className = 'opt' + (tackle.rodId === id ? ' sel' : '');
    b.innerHTML = `<div class="o-row"><span class="o-name">${r.name}</span>
      <span class="o-meta">${r.line} · ${r.action}</span></div>
      <div class="o-note">${r.blurb}</div>`;
    b.onclick = () => { if (tackleLocked()) return; tackle.rodId = id; tackleWasRolled = false; AUDIO.play('strip'); updateLineColor(); renderRods(); renderMatch(); };
    wrap.appendChild(b);
  });
}

function renderRigs() {
  const wrap = $('rig-list'); wrap.innerHTML = '';
  Object.entries(A.RIGS).forEach(([id, r]) => {
    const b = document.createElement('button');
    b.className = 'opt' + (tackle.rigId === id ? ' sel' : '');
    const slotsTxt = r.slots.map(s => s === 'top' ? 'dry' : 'nymph').join(' + ');
    b.innerHTML = `<div class="o-row"><span class="o-name">${r.name}</span>
      <span class="o-meta">${slotsTxt}</span></div>
      <div class="o-note">${r.blurb}</div>`;
    b.onclick = () => { if (tackleLocked()) return; setRig(id); };
    wrap.appendChild(b);
  });
}

function setRig(id) {
  const newRig = A.RIGS[id];
  const old = tackle.slots.slice();
  const newSlots = newRig.slots.map((slot, i) => {
    // keep an old fly if it still fits this slot
    const prev = old[i] ? A.FLIES[old[i]] : null;
    if (prev && A.slotAccepts(slot, prev.cat)) return old[i];
    // otherwise a sensible default for the slot
    if (slot === 'top') return 'para_adams';
    return 'perdigon';
  });
  tackle.rigId = id;
  tackle.slots = newSlots;
  tackleWasRolled = false;
  AUDIO.play('strip');
  updateFlyMarker();              // indicator / dry fly / foam depends on the rig
  renderRigs(); renderSlots(); renderMatch();
}

function renderSlots() {
  const wrap = $('slot-list'); wrap.innerHTML = '';
  const rig = A.RIGS[tackle.rigId];
  const e = state === ST.IDLE ? null : null;
  rig.slots.forEach((slot, i) => {
    const flyId = tackle.slots[i];
    const fly = flyId ? A.FLIES[flyId] : null;
    const kind = slot === 'top' ? 'TOP' : 'DROP';
    const b = document.createElement('button');
    b.className = 'fly-slot';
    // per-fly match dot
    let dotClass = '';
    if (fly) {
      const m = fly.imitates.includes(cond.hatch) ? 'good'
        : (cond.hatch === 'none' && fly.imitates.includes('attractor')) ? 'good'
        : fly.imitates.includes('attractor') ? 'mid' : '';
      dotClass = m;
    }
    b.innerHTML = `<span class="slot-kind ${slot === 'drop' ? 'drop' : ''}">${kind}</span>
      <span class="slot-main">
        <span class="slot-fly ${fly ? '' : 'empty'}">${fly ? fly.name : 'empty — tap to tie on'}</span>
        ${fly ? `<span class="slot-tag">${fly.tag} · #${fly.hook}</span>` : ''}
      </span>
      <span class="match-dot ${dotClass}"></span>
      <span class="slot-caret">▾</span>`;
    b.onclick = () => { if (tackleLocked()) return; openPicker(i, slot); };
    wrap.appendChild(b);
  });
}

// ---- fly picker popover ----
let pickerSlot = -1;
function openPicker(i, slot) {
  pickerSlot = i;
  $('picker-title').textContent = slot === 'top' ? 'Top fly' : 'Dropper fly';
  $('picker-sub').textContent = (slot === 'top' ? 'DRIES & TERRESTRIALS' : 'NYMPHS');
  const body = $('picker-body'); body.innerHTML = '';
  Object.entries(A.FLIES).forEach(([id, f]) => {
    if (!A.slotAccepts(slot, f.cat)) return;
    const matches = f.imitates.includes(cond.hatch) || (cond.hatch === 'none' && f.imitates.includes('attractor'));
    const b = document.createElement('button');
    b.className = 'bin-fly' + (tackle.slots[i] === id ? ' sel' : '');
    b.innerHTML = `<div class="bf-top"><span class="bf-name">${f.name}</span>
      <span class="bf-hatch ${matches ? 'match' : 'nomatch'}">${matches ? '✓ MATCH' : f.tag.split(' · ')[0]}</span></div>
      <div class="bf-tag">${f.tag} · hook #${f.hook}</div>
      <div class="bf-note">${f.note}</div>`;
    b.onclick = () => { tackle.slots[i] = id; tackleWasRolled = false; AUDIO.play('mend'); closePicker(); renderSlots(); renderMatch(); };
    body.appendChild(b);
  });
  $('fly-picker').classList.add('open');
}
function closePicker() { $('fly-picker').classList.remove('open'); }

// =========================================================
//  RANDOMIZE — "smart-ish" dice roll of the whole loadout
//  Random season / rod / rig, then flies leaning toward whatever
//  matches the current hatch so the roll is actually fishable.
// =========================================================
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// best fly for a slot: prefer one that imitates the active hatch (or an attractor
// when nothing's hatching); otherwise any valid fly for the slot.
function rollFlyForSlot(slot) {
  const valid = Object.entries(A.FLIES).filter(([, f]) => A.slotAccepts(slot, f.cat));
  const wantHatch = cond.hatch !== 'none' ? cond.hatch : 'attractor';
  const matches = valid.filter(([, f]) => f.imitates.includes(wantHatch));
  // 80% of the time take a matching fly when one exists; else a random valid one
  const pool = (matches.length && Math.random() < 0.8) ? matches : valid;
  return pick(pool)[0];
}

async function randomizeTackle() {
  const btn = $('randomize-btn');
  if (btn) { btn.classList.remove('rolling'); void btn.offsetWidth; btn.classList.add('rolling'); }
  AUDIO.play('strip');

  // season (await the art swap; setSeason no-ops if we happen to roll the same one)
  // const newSeason = pick(A.SEASON_ORDER);
  // if (newSeason !== SEASON_ID) await setSeason(newSeason);

  // rod + rig
  tackle.rodId = pick(Object.keys(A.RODS));
  const rigId = pick(Object.keys(A.RIGS));
  tackle.rigId = rigId;
  // flies to fit the freshly-rolled rig's slots, biased to the hatch
  tackle.slots = A.RIGS[rigId].slots.map(slot => rollFlyForSlot(slot));

  tackleWasRolled = true;
  updateLineColor(); updateFlyMarker();
  renderRods(); renderRigs(); renderSlots(); renderMatch();
}

// =========================================================
//  SCALING
// =========================================================
const SW = 1472, SH = 704;
function resize() {
  const wrap = $('stage-wrap');
  const ww = wrap.clientWidth, wh = wrap.clientHeight;
  let scale, tx = 0, ty = 0;
  if (window.innerWidth < 768 && wh > ww) {
    // portrait mobile: COVER the screen (no letterbox) and frame on the angler
    // so the fisherman/fly stay large instead of shrinking into a wide strip.
    scale = Math.max(ww / SW, wh / SH);
    const sw = SW * scale, sh = SH * scale;
    const fx = SEASON.focalX != null ? SEASON.focalX : 0.5;
    const fy = SEASON.focalY != null ? SEASON.focalY : 0.5;
    tx = (0.5 - fx) * sw;
    ty = (0.5 - fy) * sh;
    const maxX = Math.max(0, (sw - ww) / 2), maxY = Math.max(0, (sh - wh) / 2);
    tx = Math.max(-maxX, Math.min(maxX, tx));
    ty = Math.max(-maxY, Math.min(maxY, ty));
  } else {
    // landscape / desktop: CONTAIN (fit the whole scene)
    scale = Math.min(ww / SW, wh / SH);
  }
  $('game-container').style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${scale})`;
}
window.addEventListener('resize', resize);
// orientationchange fires before the viewport settles on mobile — re-frame a few times
window.addEventListener('orientationchange', () => { resize(); setTimeout(resize, 180); setTimeout(resize, 450); });
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

// =========================================================
//  PANEL TOGGLE
// =========================================================
const isMobile = () => window.innerWidth < 768;

function setPanelOpen(open) {
  if (isMobile()) {
    tackleEl.classList.toggle('open', open);
    tackleEl.classList.toggle('collapsed', !open);
  } else {
    tackleEl.classList.toggle('collapsed', !open);
  }
  tackleToggleBtn.textContent = open ? '✕' : '☰';
  // re-scale after layout shift (desktop only)
  if (!isMobile()) setTimeout(resize, 300);
}

// mobile: start closed; desktop: start open
setPanelOpen(!isMobile());

tackleToggleBtn.addEventListener('click', () => {
  const isOpen = isMobile() ? tackleEl.classList.contains('open') : !tackleEl.classList.contains('collapsed');
  setPanelOpen(!isOpen);
});
panelCloseBtn.addEventListener('click', () => setPanelOpen(false));

window.addEventListener('resize', () => {
  // crossing breakpoint: restore sensible default
  if (!isMobile() && tackleEl.classList.contains('open')) {
    tackleEl.classList.remove('open');
    tackleEl.classList.remove('collapsed');
    tackleToggleBtn.textContent = '✕';
  }
});

// =========================================================
//  GAME FLOW
// =========================================================
function setControls({ cast = false, mend = false, set = false, reel = false }) {
  castBtn.classList.toggle('hidden', !cast);
  mendBtn.classList.toggle('hidden', !mend);
  setBtn.classList.toggle('hidden', !set);
  reelBtn.classList.toggle('hidden', !reel);
}

function toIdle() {
  state = ST.IDLE;
  stopDrift();
  stopDriftFrames();
  clearCastTiming();
  castLuck = 1;
  hideFlyLine();
  castLineEl.classList.remove('show');
  bg.style.display = ''; bg2.style.display = '';
  setBackground(IMG.bg[0], true); paintLight();
  fg.style.display = 'none';
  fg.className = '';
  resetFgTransform();
  driftMini.classList.add('hidden');
  takePrompt.classList.add('hidden');
  reveal.classList.add('hidden');
  fightEl.classList.add('hidden');
  fightEl.classList.remove('legend-fight', 'fight-brook', 'fight-rainbow', 'fight-brown', 'fight-cutthroat');
  if (fightFish) fightFish.className = '';
  if (fightAction) fightAction.textContent = 'FISH ON';
  setControls({ cast: true });
  renderMatch();
  syncTackleLock();
}

function startCast() {
  const e = evaluate();
  if (!e.ready) { flashNote('Tie on a fly first.'); return; }
  state = ST.CASTING;
  setControls({});
  syncTackleLock();
  hideFlyLine();
  AUDIO.play('cast');
  fg.style.display = 'block';
  fg.className = '';
  resetFgTransform();             // cast frames are full-frame; no drift pan
  // cast line: re-colored to the rod, masked by the per-frame baked line shape
  castLineEl.style.background = (A.RODS[tackle.rodId] && A.RODS[tackle.rodId].lineColor) || '#e7ff8c';
  castLineEl.classList.add('show');
  // The cast frames LOOP (back and forth) while the timing meter sweeps, so the
  // rod keeps loading/unloading across all the frames instead of freezing on one.
  // The player's release ends the loop and lands the fly.
  startCastTiming();
}

// once the timing meter resolves, the fly lands and the drift begins
function finishCast() {
  if (state !== ST.CASTING) return;
  AUDIO.play('splash');
  // the still scene (bg[0]) is the first drift frame, so just start the drift —
  // the fly line + angler bob + pan all play over it, same as every drift frame
  startDrift();
}

// =========================================================
//  CAST TIMING METER — a rod-loading reflex synced to the casting motion.
//  A marker sweeps a bar with a "good" band and a tight "perfect" core; the
//  cast frames cycle back-and-forth the whole time. Tap / click / Space to
//  release: the closer the marker is to perfect, the cleaner the cast and the
//  bigger the bite-luck bonus on the coming drift. A timeout = a blown cast.
// =========================================================
const TIMING_CFG = {
  sweepMs: 620,         // base ms for one full bar traverse — then scaled by rod action below
  durationMs: 1500,     // auto-release as a BLOWN cast if the player never releases
  goodHalf: 0.16,       // half-width of the GOOD band (fraction of bar)
  perfectHalf: 0.05,    // half-width of the PERFECT core
  maxLuck: 1.9,         // bite-luck at a dead-center release (1 = no bonus)
};

let castTiming = null;   // { raf, t0, marker, frameTimer, resolved }
const castTimingEl = $('cast-timing');
const castMeterEl = $('cast-meter');
const castMarkerEl = $('cast-marker');
const castZoneGood = $('cast-zone-good');
const castZonePerfect = $('cast-zone-perfect');
const castReleaseBtn = $('cast-release');

// place the good/perfect zones; centered with a little random offset each cast so
// it's a real read, not muscle memory.
function placeCastZones() {
  const center = 0.32 + Math.random() * 0.36;   // 32%..68% across
  castTiming.center = center;
  const g = TIMING_CFG.goodHalf, p = TIMING_CFG.perfectHalf;
  castZoneGood.style.left = ((center - g) * 100) + '%';
  castZoneGood.style.width = (g * 2 * 100) + '%';
  castZonePerfect.style.left = ((center - p) * 100) + '%';
  castZonePerfect.style.width = (p * 2 * 100) + '%';
}

function startCastTiming() {
  castLuck = 1;
  castTiming = { resolved: false, frameTimer: null };
  castTimingEl.classList.remove('hidden');
  castMarkerEl.style.visibility = '';     // restore the marker (a prior timeout may have hidden it)
  // rod sweeps quicker on faster-action rods (fast=stiff, snappier loop). Glass
  // (slow) is the reference feel; each step up in action only nudges the speed a
  // little quicker so the faster rods aren't unmanageable.
  const action = A.RODS[tackle.rodId].action;
  castTiming.sweepMs = TIMING_CFG.sweepMs * (action === 'fast' ? 0.86 : action === 'slow' ? 1 : 0.93);
  placeCastZones();

  // loop the cast frames back-and-forth (ping-pong) so the rod keeps loading
  const cadence = A.RODS[tackle.rodId].cadence;
  let fi = 0, dir = 1;
  (function frame() {
    if (state !== ST.CASTING || !castTiming) return;
    castTiming.fi = fi;             // remember where the loop is for the follow-through
    fg.src = IMG.cast[fi];
    const mask = `url("${IMG.castLine[fi]}")`;
    castLineEl.style.webkitMaskImage = mask;
    castLineEl.style.maskImage = mask;
    const d = cadence[fi] || 110;
    fi += dir;
    if (fi >= IMG.cast.length) { fi = IMG.cast.length - 2; dir = -1; }   // bounce at the end
    else if (fi < 0) { fi = 1; dir = 1; }                                // bounce at the start
    castTiming.frameTimer = setTimeout(frame, d);
  })();

  // marker sweep (triangle wave 0..1..0) + safety auto-release
  castTiming.t0 = performance.now();
  AUDIO.play('cast');
  (function sweep(now) {
    if (state !== ST.CASTING || !castTiming || castTiming.resolved) return;
    const e = now - castTiming.t0;
    const phase = (e % (castTiming.sweepMs * 2)) / castTiming.sweepMs;   // 0..2
    const pos = phase <= 1 ? phase : 2 - phase;                           // 0..1..0 triangle
    castTiming.pos = pos;
    castMarkerEl.style.left = (pos * 100) + '%';
    if (e >= TIMING_CFG.durationMs) { releaseCast(true); return; }        // timed out → forced blown
    castTiming.raf = requestAnimationFrame(sweep);
  })(castTiming.t0);
}

// grade the release: distance from the zone center → tier + bite-luck bonus.
// `forced` (a timeout) is always a blown cast regardless of where the marker sat.
function releaseCast(forced) {
  if (!castTiming || castTiming.resolved) return;
  castTiming.resolved = true;
  cancelAnimationFrame(castTiming.raf);
  clearTimeout(castTiming.frameTimer);
  const startFi = castTiming.fi || 0;          // where the ping-pong loop left off

  const pos = castTiming.pos != null ? castTiming.pos : 1;
  const dist = Math.abs(pos - castTiming.center);
  let tier, luck;
  // a timeout never "landed" anywhere — hide the marker so the blown result reads
  // as a missed window rather than a release at the marker's frozen position.
  if (forced) castMarkerEl.style.visibility = 'hidden';
  if (forced) { tier = 'blown'; }
  else if (dist <= TIMING_CFG.perfectHalf) { tier = 'perfect'; }
  else if (dist <= TIMING_CFG.goodHalf) { tier = 'good'; }
  else { tier = 'blown'; }

  // luck scales smoothly from maxLuck (dead center) down to 1 at the GOOD edge,
  // and below 1 (a penalty) for a blown cast — earn the easier bite by nailing it.
  if (tier === 'blown') {
    const over = forced ? 1 : Math.min(1, (dist - TIMING_CFG.goodHalf) / (0.5 - TIMING_CFG.goodHalf));
    luck = 1 - 0.45 * over;          // down to ~0.55 on a wild / timed-out cast
  } else {
    const t = 1 - dist / TIMING_CFG.goodHalf;   // 0 at good-edge, 1 at center
    luck = 1 + (TIMING_CFG.maxLuck - 1) * t;
  }
  castLuck = luck;

  // consecutive-perfect-cast streak (read by the Perfectionist achievement)
  perfectCastStreak = tier === 'perfect' ? perfectCastStreak + 1 : 0;

  // result feedback lives entirely on the bar (no words, no particles)
  castMeterEl.classList.add('result-' + tier);
  AUDIO.play(tier === 'blown' ? 'fail' : tier === 'perfect' ? 'record' : 'strip');

  // play the cast animation through to its final delivery frame before the fly
  // lands — the ping-pong loop is frozen wherever the release caught it, so we run
  // it forward from there to the end so the cast motion always completes.
  const cadence = A.RODS[tackle.rodId].cadence;
  let fi = startFi;
  (function followThrough() {
    if (state !== ST.CASTING || !castTiming) return;   // aborted (RESET / season change)
    fg.src = IMG.cast[fi];
    const mask = `url("${IMG.castLine[fi]}")`;
    castLineEl.style.webkitMaskImage = mask;
    castLineEl.style.maskImage = mask;
    if (fi >= IMG.cast.length - 1) {           // reached the delivery frame → land
      setTimeout(() => { hideCastTiming(); finishCast(); }, 200);
      return;
    }
    fi++;
    castTiming.followTimer = setTimeout(followThrough, (cadence[fi] || 110) * 0.7);
  })();
}

function hideCastTiming() {
  if (castTiming) { cancelAnimationFrame(castTiming.raf); clearTimeout(castTiming.frameTimer); clearTimeout(castTiming.followTimer); }
  castTiming = null;
  castTimingEl.classList.add('hidden');
  castMeterEl.classList.remove('result-perfect', 'result-good', 'result-blown');
}

// abort an in-progress cast (RESET / season change mid-cast)
function clearCastTiming() { hideCastTiming(); }

// ---- drift motion (fakes a continuous downstream drift from N still frames) ----
// Each "segment" the foreground angler pans across the held background while the
// fly drifts downstream and drag builds; at the end of a segment the background
// HARD-CUTS to the next frame (no crossfade) and the angler snaps back to the
// start — the cut hides the reset, so it reads as drifting to a fresh stretch.
// NOTE: panSeg only drives the cosmetic angler pan + bg cuts. The actual drag and
// the fly's drifted position are tied to driftQuality (continuous), so they carry
// straight through a bg-frame cut instead of resetting with the scenery.
let driftFrameIdx = 0, panSeg = 0, driftProgress = 0;
const PAN_X = 30;             // per-frame cosmetic pan, half-amplitude in stage px
const ROD_FOLLOW = 70;        // how far (stage px) the rod tip chases the lure downstream
const FG_DRIFT_SCALE = 1.15;  // zoom so the panned/followed/bobbed arm edges stay off-frame
// foreground X = per-frame cosmetic pan + a follow that tracks the drifting lure
const driftFgX = () => (1 - panSeg * 2) * PAN_X - driftProgress * ROD_FOLLOW;

function startDriftFrames() {
  driftFrameIdx = 0; panSeg = 0;
  setBackground(IMG.bg[0], false);        // start on the still scene (already shown after the cast)
  paintLight();
}
function tickDrift(dt, now) {
  // the lure floats steadily downstream — continuous, and carries straight through bg cuts
  driftProgress = Math.min(1, driftProgress + dt * 1000 / (SEASON.driftTravelMs || 12000));
  // angler pan + bg frame cuts — cosmetic only; they never touch the drag/lure state
  const segSec = (SEASON.driftFrameMs || 6500) / 1000;
  if (driftFrameIdx < IMG.bg.length - 1) {
    panSeg += dt / segSec;
    if (panSeg >= 1) {
      driftFrameIdx++;
      setBackground(IMG.bg[driftFrameIdx], false);               // hard cut to next still
      paintLight();
      panSeg = 0;                          // angler snaps back for the fresh stretch
    }
  } else {
    panSeg = Math.min(1, panSeg + dt / segSec);                  // last frame: pan to the end, hold
  }
  fgX = driftFgX();
  fgY = Math.sin(now / 900) * 4;
  fgRot = 0; fgScale = FG_DRIFT_SCALE;
  applyFgTransform();
}
function stopDriftFrames() { driftFrameIdx = 0; panSeg = 0; }

// bite shake — driven in JS so it composes onto the frozen drift pan (no position pop),
// and the fly line stays glued to the rod tip (fgTipPoint reads this same transform).
let biteShakeRAF = null;
function startBiteShake() {
  stopBiteShake();
  const panX = driftFgX();                    // freeze the pan+follow where the take happened
  const t0 = performance.now();
  (function sh(now) {
    if (state !== ST.BITE) { biteShakeRAF = null; return; }
    const e = now - t0;
    const k = Math.max(0.15, 1 - e / 1200);  // ease the jitter down but keep a tremor
    fgX = panX + Math.sin(e / 21) * 8 * k;
    fgY = Math.cos(e / 17) * 6 * k;
    fgRot = Math.sin(e / 27) * 2 * k;
    fgScale = FG_DRIFT_SCALE;
    applyFgTransform();
    biteShakeRAF = requestAnimationFrame(sh);
  })(t0);
}
function stopBiteShake() { if (biteShakeRAF != null) { cancelAnimationFrame(biteShakeRAF); biteShakeRAF = null; } }

function startDrift() {
  state = ST.DRIFT;
  driftProgress = 0;                     // lure starts at the upstream landing spot
  startDriftFrames();
  castLineEl.classList.remove('show');   // baked cast line done; dynamic line takes over
  fg.src = IMG.drift;
  fg.classList.remove('shake');
  fgX = driftFgX(); fgY = 0; fgRot = 0; fgScale = FG_DRIFT_SCALE; applyFgTransform();
  showFlyLine('drift');

  driftQuality = 100;
  dragFreeUntil = 0;
  mendCoolUntil = 0;
  driftMini.classList.remove('hidden');
  updateDriftHud();
  setControls({ mend: true, reel: true });
  mendBtn.classList.remove('cooling');

  lastBiteTick = performance.now();
  startDriftLoop();
}

function startDriftLoop() {
  cancelAnimationFrame(driftRAF);
  let last = performance.now();
  function loop(now) {
    if (state !== ST.DRIFT) return;
    const dt = (now - last) / 1000; last = now;

    // --- drift quality decay ---
    const rig = A.RIGS[tackle.rigId];
    const water = A.WATER[cond.waterId];
    const decayRate = rig.driftDecay * 9 / water.dragHide;   // %/sec
    driftQuality = Math.max(0, driftQuality - decayRate * dt);
    updateDriftHud();

    // pan the angler downstream + cut bg frames as the fly drifts
    tickDrift(dt, now);

    // mend readiness cue
    const canMend = now > mendCoolUntil;
    mendBtn.classList.toggle('cooling', !canMend);
    mendBtn.classList.toggle('ready', canMend && driftQuality < 62 && driftQuality > 12);

    // --- bite roll on tick interval ---
    if (now - lastBiteTick > 1500) {
      lastBiteTick = now;
      rollBite(now);
    }
    driftRAF = requestAnimationFrame(loop);
  }
  driftRAF = requestAnimationFrame(loop);
}
function stopDrift() { cancelAnimationFrame(driftRAF); }

function updateDriftHud() {
  const label = driftQuality > 70 ? 'DRAG-FREE'
    : driftQuality > 40 ? 'SOME DRAG'
    : driftQuality > 15 ? 'DRAGGING' : 'BLOWN OUT';
  const isWarn = driftQuality <= 55 && driftQuality > 28;
  const isBad  = driftQuality <= 28;

  driftMiniFill.style.width = driftQuality + '%';
  driftMiniFill.classList.toggle('warn', isWarn);
  driftMiniFill.classList.toggle('bad', isBad);
  driftMiniVal.textContent = label;
}

function rollBite(now) {
  const e = evaluate();
  if (!e.ready || e.biteMul <= 0) return;
  const driftFactor = 0.22 + 0.78 * (driftQuality / 100);
  const dragFree = now < dragFreeUntil ? 1.5 : 1;
  // baseline is intentionally low — the cast-timing meter earns it back: castLuck
  // is 1 on a good-edge release, climbs toward ~1.9 for a dead-center "perfect"
  // cast, and drops below 1 on a blown cast.
  const BASE = 0.078;
  let p = BASE * e.biteMul * driftFactor * pity * dragFree * castLuck;
  if (driftProgress > 0.9) p *= 0.3;  // lure has drifted out of the zone — fish rarely chase it
  p = Math.min(0.45, p);
  if (Math.random() < p) {
    triggerBite(e);
  } else {
    pity = Math.min(2.1, pity + 0.09);   // pity timer — not flat coinflips
  }
}

// =========================================================
//  BITE → SET
// =========================================================

// Which fly slot does the fish take?  Weight each slot by how well its
// presentation depth matches the current feeding distribution, so fish
// feeding deep are more likely to grab the dropper, fish keyed on the
// surface are more likely to sip the top fly.
function chosenFlyIdx() {
  const flies = equippedFlies();
  if (flies.length <= 1) return 0;
  const phase = A.PHASES[cond.phaseIdx];
  const weights = flies.map(f => Math.max(0.05, phase.feed[f.depth] || 0.05));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
  return 0;
}

// scatter a few water-droplet flecks out of the strike point, mostly upward
// (angle range keeps them off the downward arc so they read as flung spray
// rather than falling rain); baseDelay holds the spray until the moment the
// fish actually breaks the surface partway into the animation
function spawnTakeDroplets(svg, NS, count, minD, maxD, baseDelay) {
  for (let i = 0; i < count; i++) {
    const angleDeg = -150 + Math.random() * 120;      // up-left .. up-right
    const angleRad = angleDeg * Math.PI / 180;
    const dist = minD + Math.random() * (maxD - minD);
    const drop = document.createElementNS(NS, 'circle');
    drop.setAttribute('class', 'take-drop');
    drop.setAttribute('cx', '20'); drop.setAttribute('cy', '20');
    drop.setAttribute('r', (0.8 + Math.random() * 0.8).toFixed(1));
    drop.style.setProperty('--dx', (Math.cos(angleRad) * dist).toFixed(1) + 'px');
    drop.style.setProperty('--dy', (Math.sin(angleRad) * dist).toFixed(1) + 'px');
    drop.style.animationDelay = Math.round((baseDelay || 0) + Math.random() * 60) + 'ms';
    svg.appendChild(drop);
  }
}

// Animate a fish striking the dry fly at the current fly position, using the
// real species art (preloaded at boot) instead of a drawn silhouette. The
// image lives in a box clipped at the waterline so only what breaks the
// surface is ever visible, is scaled by the rolled fish size, and is darkened
// a touch so it beds into the water. The take kind:
//   sip  — the back barely crests the film
//   rise — head-and-shoulders porpoise, nose-up
//   leap — full body clears, arcs over, splashy re-entry
// comes from the fly's vis rating (big visible hooks provoke harder takes)
// shaded by species temperament (aerial: rainbows go airborne, browns stay
// low) plus a dice roll, so repeats stay fresh. Speed, crest height, leap
// apex and body rotation all jitter per take; leap clearance is relative to
// the fish — small fish clear more of their own body length than heavy ones.
// flyIdx says which fly got eaten: on a double-dry rig index 1 strikes at the
// second fly, a tippet-length beyond the first in the cast direction.
function spawnTakeAnim(fly, speciesId, sizeIn, flyIdx) {
  if (!ambientEl) return;
  const dl = SEASON.line && SEASON.line.drift;
  if (!dl || !dl.flyUp || !dl.flyDown) return;

  const s = Math.max(0, Math.min(1, driftProgress));
  let flyX = lerp(dl.flyUp[0], dl.flyDown[0], s) * 100;
  let flyY = lerp(dl.flyUp[1], dl.flyDown[1], s) * 100;
  // double-dry second fly: strike happens a tippet-length out, in the cast direction
  if (flyIdx === 1 && lineAnchors) {
    const [rx, ry] = fgTipPoint(lineAnchors.rod);
    const [ox, oy] = tippetOffset(rx, ry, flyX / 100 * SW_STAGE, flyY / 100 * SH_STAGE);
    flyX += ox / SW_STAGE * 100;
    flyY += oy / SH_STAGE * 100;
  }

  const aerial = A.SPECIES[speciesId].aerial != null ? A.SPECIES[speciesId].aerial : 0.5;
  const energy = fly.vis + (aerial - 0.5) * 1.6 + (Math.random() - 0.5) * 1.2;
  const kind = energy < 1.7 ? 'sip' : energy < 2.7 ? 'rise' : 'leap';
  const dur  = Math.round((kind === 'sip' ? 640 : kind === 'leap' ? 1050 : 820)
                          * (0.85 + Math.random() * 0.3));

  const wrap = document.createElement('div');
  wrap.className = 'take-anim take-' + kind;
  wrap.style.left = flyX + '%';
  wrap.style.top  = flyY + '%';
  wrap.style.setProperty('--dur', dur + 'ms');

  // per-take motion variety, fed into the keyframes as CSS vars
  // fish come at the fly from either side: the art faces left, --dir -1
  // mirrors the body, its rotation and its travel (and the mouth tracking
  // reads the computed matrix, so it follows the flip for free)
  wrap.style.setProperty('--dir', Math.random() < 0.5 ? 1 : -1);
  wrap.style.setProperty('--rotK', (0.8 + aerial * 0.25 + Math.random() * 0.2).toFixed(2));
  if (kind === 'sip') {
    wrap.style.setProperty('--crest', Math.round(50 + Math.random() * 16) + '%');
  } else if (kind === 'rise') {
    wrap.style.setProperty('--crest', Math.round(6 + Math.random() * 22) + '%');
  } else {
    // %s are of body height, so clearance scales with the fish; the size term
    // keeps a heavy fish from clearing as many body lengths as a small one
    const clearK = Math.max(0.7, Math.min(1.25, 1.45 - sizeIn / 28)) * (0.85 + Math.random() * 0.35);
    wrap.style.setProperty('--apex',  Math.round(-62 * clearK) + '%');
    wrap.style.setProperty('--apex2', Math.round(-48 * clearK) + '%');
  }

  // dark shape swelling up under the surface just before the strike
  const shadow = document.createElement('div');
  shadow.className = 'take-shadow';
  wrap.appendChild(shadow);

  // the fish: real species art in a waterline-clipped box, sized by the fish
  const clip = document.createElement('div');
  clip.className = 'take-clip';
  const img = document.createElement('img');
  img.className = 'take-fish-img';
  img.src = A.SPECIES[speciesId].img;
  // the stage scales to fit the viewport (ambient renders ~0.6x on a typical
  // window), so these widths are deliberately larger than they'll appear
  img.style.width = Math.round(Math.max(76, Math.min(170, 60 + sizeIn * 3.5))) + 'px';
  clip.appendChild(img);
  wrap.appendChild(clip);
  // the taken fly's line end rides this fish's mouth; ax/ay anchor the wrap
  // in stage px so mouth tracking stays exact under the bite shake
  takeTrack = { img, contacted: false, flyIdx,
                ax: flyX / 100 * SW_STAGE, ay: flyY / 100 * SH_STAGE };

  // surface ring + flung spray in an SVG overlay (overflow lets them fly wide)
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'take-fx');
  svg.setAttribute('viewBox', '0 0 40 40');
  const ring = document.createElementNS(NS, 'ellipse');
  ring.setAttribute('class', 'take-ring');
  ring.setAttribute('cx', '20'); ring.setAttribute('cy', '20');
  ring.setAttribute('rx', '8');  ring.setAttribute('ry', '4');
  svg.appendChild(ring);
  if (kind === 'leap') {
    // second ring where the fish crashes back down
    const ring2 = ring.cloneNode();
    ring2.classList.add('re-entry');
    svg.appendChild(ring2);
  }
  const sprayDelay = dur * (kind === 'sip' ? 0.2 : 0.14);
  if (kind === 'leap')      spawnTakeDroplets(svg, NS, 7, 7, 15, sprayDelay);
  else if (kind === 'rise') spawnTakeDroplets(svg, NS, 4, 5, 9,  sprayDelay);
  else                      spawnTakeDroplets(svg, NS, 2, 3, 6,  sprayDelay);
  wrap.appendChild(svg);

  ambientEl.appendChild(wrap);
  setTimeout(() => {
    wrap.remove();
    if (takeTrack && takeTrack.img === img) takeTrack = null;
  }, dur + 250);

  // a hard, fast take deserves a smack of a splash to go with the visual
  if (kind === 'leap') AUDIO.play('takeSplash');
}

function chooseSpecies(e) {
  const flies = equippedFlies();
  const depths = presentedDepths();
  const phase = A.PHASES[cond.phaseIdx];
  const water = A.WATER[cond.waterId];
  const weights = A.SPECIES_ORDER.map(id => {
    const s = A.SPECIES[id];
    let w = s.weight;
    // food match
    const foodHit = flies.some(f => f.imitates.some(im => s.foods.includes(im)));
    const attractor = flies.some(f => f.imitates.includes('attractor'));
    w *= foodHit ? 1.9 : attractor ? 1.05 : 0.55;
    // depth overlap
    w *= depths.some(d => s.depths.includes(d)) ? 1.5 : 0.6;
    // light preference
    w *= s.lightLove.includes(phase.light) ? 1.4 : 0.8;
    // spookiness in clear water (delicate rod + good hatch match mitigates)
    if (cond.waterId === 'clear') {
      const stealth = (A.RODS[tackle.rodId].delicate) * (0.6 + 0.4 * e.hatchFit);
      w *= 1 / (1 + s.spook * 0.7 / stealth);
    }
    // big browns favored in low light
    w *= 1 + (s.fight - 0.4) * (phase.trophyLight - 1) * 0.8;
    return Math.max(0.02, w);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return A.SPECIES_ORDER[i]; }
  return A.SPECIES_ORDER[0];
}

function rollSize(speciesId, e) {
  const s = A.SPECIES[speciesId];
  const [min, mode, max] = s.size;
  // triangular distribution around the mode
  const u = Math.random(), c = (mode - min) / (max - min);
  let x = u < c ? min + Math.sqrt(u * (max - min) * (mode - min))
                : max - Math.sqrt((1 - u) * (max - min) * (max - mode));
  // condition nudges: light (trophy), water size bias, match quality
  const phase = A.PHASES[cond.phaseIdx];
  const lightBoost = 1 + (phase.trophyLight - 1) * 0.12;
  x *= A.WATER[cond.waterId].sizeBias * lightBoost * (0.94 + 0.12 * e.score);
  return Math.max(min, Math.min(max * 1.18, x));
}

function triggerBite(e) {
  state = ST.BITE;
  stopDrift();
  const speciesId = chooseSpecies(e);
  const sp = A.SPECIES[speciesId];

  // --- legendary lunker roll — a rare named monster, best odds in low light / dialed tackle ---
  const phase = A.PHASES[cond.phaseIdx];
  let legendChance = 0.014 * phase.trophyLight * (0.45 + e.score) * A.WATER[cond.waterId].sizeBias;
  legendChance = Math.min(0.05, legendChance);
  const isLegend = !!sp.legend && Math.random() < legendChance;

  let sizeIn = isLegend ? sp.legend.size * (0.97 + Math.random() * 0.1) : rollSize(speciesId, e);

  // determine which fly was taken, weighted by how well its depth matches current feeding
  const flyIdx = chosenFlyIdx();
  const lead = equippedFlies()[flyIdx];
  // set window from fly visibility + hook size + rod action
  const rod = A.RODS[tackle.rodId];
  const actionAdj = rod.action === 'fast' ? 1.1 : rod.action === 'slow' ? 0.95 : 1;
  let win = (950 + lead.vis * 470 - (lead.hook - 8) * 42) * actionAdj;
  win = Math.max(750, Math.min(2600, win));
  bite = { speciesId, sizeIn, win, deadline: performance.now() + win,
           trophy: sizeIn >= sp.trophy, legend: isLegend, flyIdx };

  fg.src = IMG.drift;
  showFlyLine('drift');                    // match the line to the drift pose (fixes mid-mend takes)
  startBiteShake();                        // JS shake, composed onto the frozen pan
  lineJerk = 1;                            // line snaps taut on the take
  takePrompt.classList.add('hidden');     // SET button is the cue
  driftMini.classList.add('hidden');
  setControls({ set: true });
  // fish-eating animation: whenever the taken fly is a surface ('top' slot)
  // dry/terrestrial — on a double-dry rig either fly can get eaten on screen
  const rig = A.RIGS[tackle.rigId];
  if (rig.slots[flyIdx] === 'top' && lead.cat !== 'nymph') spawnTakeAnim(lead, speciesId, sizeIn, flyIdx);
  AUDIO.play('hookup');
  // a legendary take announces itself (flashNote runs AFTER the hide above)
  if (isLegend) flashNote('A MONSTER!');

  // miss window
  clearTimeout(biteFlash);
  biteFlash = setTimeout(() => { if (state === ST.BITE) missBite(); }, win);
}

function doSet() {
  if (state !== ST.BITE) return;
  clearTimeout(biteFlash);
  stopBiteShake();
  resetFgTransform();             // clear the drift pan for the set close-up
  hideFlyLine();
  fg.src = IMG.set;
  AUDIO.play('set');
  setControls({});
  setTimeout(() => startFight(), 280);
}

function missBite() {
  state = ST.DRIFT;
  stopBiteShake();
  fg.src = IMG.drift;             // drift loop resumes the pan/bob via tickDrift
  showFlyLine('drift');
  AUDIO.play('fail');
  bite = null;
  flashNote('Missed the take.');
  driftMini.classList.remove('hidden');
  setControls({ mend: true, reel: true });
  pity = Math.min(2.3, pity + 0.2);
  lastBiteTick = performance.now();
  startDriftLoop();              // resumes; drift-frame progression continues from where it paused
}

// =========================================================
//  FIGHT (tension minigame)
// =========================================================
let fight = null;
let fightTimeout = null;

function speciesFightAction(s) {
  const aerial = s.aerial || 0;
  const r = Math.random();
  if (aerial > 0.75) return r < 0.55 ? 'jump' : r < 0.82 ? 'shake' : 'surge';
  if (aerial < 0.35) return r < 0.62 ? 'surge' : r < 0.9 ? 'shake' : 'jump';
  return r < 0.35 ? 'jump' : r < 0.72 ? 'surge' : 'shake';
}
function actionLabel(action, s) {
  if (action === 'jump') return `${s.name.toUpperCase()} JUMPS`;
  if (action === 'surge') return `${s.name.toUpperCase()} SURGES`;
  return `${s.name.toUpperCase()} HEADSHAKES`;
}
function setFightPose(action, s) {
  if (!fightFish || !fightAction || !fightLine) return;
  fightFish.classList.remove('jump', 'surge', 'shake');
  if (action) fightFish.classList.add(action);
  fightAction.textContent = action ? actionLabel(action, s) : `${s.name.toUpperCase()} ON`;
}
function triggerFightAction(action, ms) {
  if (!fight || state !== ST.FIGHT) return;
  fight.action = action;
  setFightPose(action, fight.s);
  setTimeout(() => {
    if (!fight || state !== ST.FIGHT || fight.action !== action) return;
    fight.action = null;
    setFightPose(null, fight.s);
  }, ms);
}
function updateFightVisual(now) {
  if (!fight || !fightFish || !fightLine) return;
  const x = 42 + fight.pos * 0.45;
  const y = 66 + Math.sin(now / 220) * (6 + fight.s.fight * 4);
  const rot = Math.sin(now / 180) * (5 + fight.s.aerial * 6) + (fight.action === 'surge' ? 6 : 0);
  const pull = 16 + (fight.pos / 100) * 44 + (fight.action === 'surge' ? 18 : 0) + (fight.action === 'jump' ? -12 : 0);
  const angle = (fight.pos - 50) * 0.28 + (fight.action === 'jump' ? -9 : 0) + (fight.action === 'shake' ? Math.sin(now / 65) * 2.8 : 0);
  fightEl.style.setProperty('--fight-fish-x', `${x.toFixed(1)}px`);
  fightEl.style.setProperty('--fight-fish-y', `${y.toFixed(1)}px`);
  fightEl.style.setProperty('--fight-fish-rot', `${rot.toFixed(1)}deg`);
  fightEl.style.setProperty('--fight-line-pull', `${pull.toFixed(1)}px`);
  fightEl.style.setProperty('--fight-line-angle', `${angle.toFixed(1)}deg`);
}
function startFight() {
  state = ST.FIGHT;
  const s = A.SPECIES[bite.speciesId];
  const lead = equippedFlies()[bite.flyIdx || 0];
  const sizeFactor = (bite.sizeIn - s.size[0]) / (s.size[2] - s.size[0]); // 0..1
  const leg = bite.legend;
  let need = Math.round(3 + s.fight * 3.5 + sizeFactor * 2);       // strips to land
  let speed = 0.85 + s.fight * 0.9 + sizeFactor * 0.5;            // marker speed
  let tippetRisk = Math.max(0, (lead.hook - 12) / 10) * (0.4 + sizeFactor);
  let base = 0.46;
  if (leg) { need += 3; speed += 0.35; tippetRisk = Math.min(0.85, tippetRisk + 0.18); base = 0.4; }
  fight = { need, got: 0, speed, pos: 0, dir: 1, zoneL: 0, zoneW: 0,
            tippetRisk, raf: null, base, s, action: null, nextActionAt: 0 };

  fightEl.classList.toggle('legend-fight', !!leg);
  fightEl.classList.remove('fight-brook', 'fight-rainbow', 'fight-brown', 'fight-cutthroat');
  fightEl.classList.add(`fight-${bite.speciesId}`);
  fightEl.classList.remove('hidden');
  if (fightFish) { fightFish.src = s.img; fightFish.alt = s.name; }
  setFightPose(null, s);
  updateFightVisual(performance.now());
  fight.nextActionAt = performance.now() + 520;
  fg.style.display = 'none';
  placeZone();
  AUDIO.play('reel', 4);
  runIndicator();

  // timeout — fish escapes if you idle (a legend gives you a little longer)
  clearTimeout(fightTimeout);
  fightTimeout = setTimeout(() => { if (state === ST.FIGHT) loseFish(false); }, leg ? 26000 : 20000);
}
function placeZone() {
  const W = 100;
  fight.zoneW = Math.max(10, (fight.base - fight.got * 0.045) * W) * (1 - fight.tippetRisk * 0.35);
  fight.zoneL = Math.random() * (W - fight.zoneW);
  greenZone.style.left = fight.zoneL + '%';
  greenZone.style.width = fight.zoneW + '%';
}
function runIndicator() {
  let last = performance.now();
  function loop(now) {
    if (state !== ST.FIGHT) return;
    const dt = (now - last) / 1000; last = now;
    fight.pos += fight.dir * fight.speed * 60 * dt;
    if (fight.pos >= 100) { fight.pos = 100; fight.dir = -1; }
    if (fight.pos <= 0) { fight.pos = 0; fight.dir = 1; }
    indicator.style.left = fight.pos + '%';
    if (!fight.action && now >= fight.nextActionAt) {
      const action = speciesFightAction(fight.s);
      fight.nextActionAt = now + 950 + Math.random() * 1300 * (1 - fight.s.fight * 0.3);
      triggerFightAction(action, action === 'jump' ? 560 : action === 'surge' ? 380 : 320);
    }
    updateFightVisual(now);
    fight.raf = requestAnimationFrame(loop);
  }
  fight.raf = requestAnimationFrame(loop);
}
function doStrip() {
  if (state !== ST.FIGHT) return;
  AUDIO.play('strip');
  // strip frame flash
  const inZone = fight.pos >= fight.zoneL && fight.pos <= fight.zoneL + fight.zoneW;
  if (inZone) {
    fight.got++;
    triggerFightAction('surge', 280);
    AUDIO.play('reel', 3);
    if (fight.got >= fight.need) { landFish(); return; }
    placeZone();
  } else {
    // slack — chance the fish throws the hook
    const throwChance = 0.18 + fight.tippetRisk * 0.5;
    if (Math.random() < throwChance) {
      loseFish(bite.legend || (bite.trophy && bite.speciesId === 'brown' && Math.random() < 0.5));
      return;
    }
    fight.got = Math.max(0, fight.got - 1);
    triggerFightAction((fight.s.aerial > 0.55 && Math.random() < 0.35) ? 'jump' : 'shake', 300);
    placeZone();
  }
}

// =========================================================
//  RESOLUTION
// =========================================================
function landFish() {
  clearTimeout(fightTimeout);
  cancelAnimationFrame(fight.raf);
  state = ST.REVEAL;
  fightEl.classList.add('hidden');
  fightEl.classList.remove('legend-fight', 'fight-brook', 'fight-rainbow', 'fight-brown', 'fight-cutthroat');
  if (fightFish) fightFish.className = '';
  const s = A.SPECIES[bite.speciesId];
  const inches = bite.sizeIn;
  const isLegend = bite.legend;
  journal.casts++; journal.landed++;
  const rec = journal.species[bite.speciesId];
  rec.caught = true; rec.count++;
  const isPB = inches > rec.best; if (isPB) rec.best = inches;
  const isRecord = inches > journal.best;
  if (isRecord) journal.best = inches;
  // log the legend the first (and best) time it's landed
  if (isLegend && (!journal.legends[bite.speciesId] || inches > journal.legends[bite.speciesId].length)) {
    journal.legends[bite.speciesId] = { name: s.legend.name, length: inches, date: Date.now() };
  }
  // session tracking
  catchStreak++;
  daySpecies[bite.speciesId] = true;
  const slamDay = A.SPECIES_ORDER.every(id => daySpecies[id]);

  // flavor by size class (legends get their own awe-struck pool)
  const cls = isLegend ? 'legend'
    : inches >= s.trophy ? 'trophy'
    : inches >= (s.size[1] + s.size[2]) / 2 ? 'big'
    : inches >= s.size[1] ? 'mid' : 'small';
  const lines = A.CATCH_LINES[cls];
  const flavor = lines[Math.floor(Math.random() * lines.length)];

  // snapshot for the trophy card — use the fly that was actually taken
  const lead = equippedFlies()[bite.flyIdx || 0];
  const rig = A.RIGS[tackle.rigId];
  lastCatch = {
    speciesId: bite.speciesId, species: s.name,
    displayName: isLegend ? s.legend.name : s.name,
    inches, legend: isLegend, trophy: bite.trophy, isRecord, flavor,
    fly: lead ? lead.name : '—', rig: rig.name, rod: A.RODS[tackle.rodId].name,
    seasonName: SEASON.name, phase: A.PHASES[cond.phaseIdx].label,
    water: A.WATER[cond.waterId].label, hatch: A.HATCHES[cond.hatch].label,
    img: s.img, date: new Date(),
  };

  saveJournal();

  // shared context for achievements + the daily challenge
  const ctx = {
    journal, speciesId: bite.speciesId, inches, trophy: bite.trophy, legend: isLegend,
    rigId: tackle.rigId, fly: lead, seasonId: SEASON_ID, hatch: cond.hatch,
    phaseId: A.PHASES[cond.phaseIdx].id, light: cond.light,
    streak: catchStreak, slamDay, daySpeciesCount: Object.keys(daySpecies).length,
    dryEat: !!lead && lead.cat !== 'nymph',
    diceRolled: tackleWasRolled, perfectCastStreak,
  };
  checkAchievements(ctx);
  checkDaily(ctx);
  renderJournal();

  revImg.src = s.img;
  revImg.style.display = '';
  revImg.style.width = Math.max(34, Math.min(62, 30 + inches * 1.5)) + '%';
  revSpecies.textContent = isLegend ? s.legend.name : s.name;
  revInches.textContent = inches.toFixed(1);
  $('reveal-size').classList.remove('hidden');
  reveal.classList.remove('lost');
  reveal.classList.toggle('legend', isLegend);
  revRibbon.classList.toggle('hidden', !(isLegend || isRecord || bite.trophy));
  revRibbon.textContent = isLegend ? 'LEGENDARY' : isRecord ? 'NEW RECORD' : 'TROPHY';
  revFlavor.textContent = flavor;
  releaseBtn.textContent = 'RELEASE';
  cardBtn.classList.remove('hidden');
  reveal.classList.remove('hidden');
  reveal.classList.add('fade-in');
  AUDIO.play(isLegend ? 'legend' : isRecord ? 'record' : 'catch');
  if (isLegend) showToast('👑', s.legend.name, `${s.name} landed · ${inches.toFixed(1)}"`, 'legend');
  pity = 0.7;   // just caught → reset the pity timer
}

function loseFish(dramatic) {
  clearTimeout(fightTimeout);
  if (fight) cancelAnimationFrame(fight.raf);
  state = ST.REVEAL;
  fightEl.classList.add('hidden');
  fightEl.classList.remove('legend-fight', 'fight-brook', 'fight-rainbow', 'fight-brown', 'fight-cutthroat');
  if (fightFish) fightFish.className = '';
  catchStreak = 0;                   // broke off → streak resets
  journal.casts++;
  saveJournal();
  AUDIO.play('fail');
  if (dramatic) {
    // the big one bulldogs and breaks you off — a beat of drama before the verdict
    fg.classList.add('shake');
    setTimeout(() => {
      fg.classList.remove('shake');
      showLost('It bulldogged for the logjam and broke you off.', 'SNAP!');
    }, 1300);
  } else {
    showLost('The hook pulled free. That\'s fishing.', 'LOST IT');
  }
}
function showLost(msg, head) {
  reveal.classList.add('lost');
  reveal.classList.remove('legend');
  cardBtn.classList.add('hidden');
  revRibbon.classList.add('hidden');
  revSpecies.textContent = head;
  $('reveal-size').classList.add('hidden');
  revImg.style.display = 'none';
  revFlavor.textContent = msg;
  releaseBtn.textContent = 'CAST AGAIN';
  reveal.classList.remove('hidden');
  reveal.classList.add('fade-in');
}

function reelIn() {
  // pick up the line and reset to cast without a fish
  AUDIO.play('reel', 6);
  toIdle();
}

// =========================================================
//  MEND — real logic + payoff
// =========================================================
// Returns true only when a mend actually lands (state right + off cooldown), so
// callers can tell a real mend from a no-op — the held-key automend counter relies
// on this to count one mend per cooldown.
function doMend() {
  if (state !== ST.DRIFT) return false;
  const now = performance.now();
  if (now < mendCoolUntil) return false;
  const rig = A.RIGS[tackle.rigId];

  // timing: best payoff when there's drag to fix but the drift isn't blown
  // sweet spot centered ~45% quality
  const dq = driftQuality;
  let timing;
  if (dq >= 25 && dq <= 65) timing = 1 - Math.abs(dq - 45) / 20 * 0.35;   // 0.65..1.0
  else if (dq > 65) timing = 0.4;     // mended too early — little to gain
  else timing = 0.5;                  // very late — partial recovery, fish wary

  const gain = (32 + 46 * timing) * rig.mendPayoff;
  driftQuality = Math.min(100, driftQuality + gain);
  updateDriftHud();

  // a clean mend buys a brief drag-free window (bite bonus)
  if (timing >= 0.85) dragFreeUntil = now + 3000;
  mendCoolUntil = now + MEND_COOLDOWN_MS;

  // visual: flick the line with the mend frame. The main effect is the ARC flipping
  // upstream (mendBow); the lure itself only repositions a touch.
  AUDIO.play('mend');
  fg.src = IMG.mend;
  showFlyLine('mend');
  mendBow = 0.5 + 0.5 * timing;                      // flip the line's arc upstream
  driftProgress = Math.max(0, driftProgress - 0.08); // lure slides back upstream just a little
  setTimeout(() => { if (state === ST.DRIFT) { fg.src = IMG.drift; showFlyLine('drift'); } }, 420);
  return true;
}

// A deliberate, user-initiated mend (M tap or MEND click). Same effect as doMend,
// but it watches for mashing: tap during an active cooldown and the mend is blocked
// — do that MEND_MASH_STREAK times within one cooldown and you trip a secret that
// ribs the panic-tapping. A mend that actually lands resets the counter.
function tapMend() {
  if (state === ST.DRIFT && performance.now() < mendCoolUntil) {
    if (++mendMash >= MEND_MASH_STREAK) unlockSecret('mendmash');
  }
  if (doMend()) mendMash = 0;
}

// =========================================================
//  small note flasher (reuses take-prompt slot subtly)
// =========================================================
let noteTimer = null;
function flashNote(msg) {
  takePrompt.textContent = msg;
  takePrompt.style.fontSize = '34px';
  takePrompt.classList.remove('hidden');
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { takePrompt.classList.add('hidden'); takePrompt.style.fontSize = ''; takePrompt.textContent = 'SET!'; }, 1100);
}

// =========================================================
//  JOURNAL
// =========================================================
function renderJournal() {
  const list = $('journal-list'); list.innerHTML = '';
  A.SPECIES_ORDER.forEach(id => {
    const s = A.SPECIES[id], rec = journal.species[id];
    const row = document.createElement('div');
    row.className = 'jr-species';
    row.innerHTML = `
      <div class="jr-thumb ${rec.caught ? '' : 'locked'}">${rec.caught ? `<img src="${s.img}">` : '?'}</div>
      <div class="jr-info">
        <div class="jr-name ${rec.caught ? '' : 'locked'}">${rec.caught ? s.name : '???'}</div>
        <div class="jr-stats">${rec.caught ? `caught ${rec.count} · best ${rec.best.toFixed(1)}"` : 'not yet landed'}</div>
        ${rec.caught ? `<div class="jr-stats" style="opacity:.8">${s.blurb}</div>` : ''}
      </div>`;
    list.appendChild(row);
  });
  renderDaily();
  renderLegends();
  renderAchievements();
  renderSecrets();
}

// =========================================================
//  TROPHY CARD — render the last catch to a downloadable canvas
// =========================================================
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawTrophyCard(c) {
  const cv = trophyCanvas, ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const PAPER = '#ece2cb', PAPER2 = '#e2d6ba', INK = '#211d14', INKSOFT = '#4a4334';
  const gold = '#c1922f', line = '#4ea016', rust = '#b5512a';
  const accent = c.legend ? gold : c.trophy ? gold : line;

  // paper background + subtle vignette
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
  const vg = ctx.createRadialGradient(W / 2, H * 0.42, W * 0.2, W / 2, H * 0.5, W * 0.85);
  vg.addColorStop(0, 'rgba(255,255,255,0.18)'); vg.addColorStop(1, 'rgba(33,29,20,0.10)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

  // border frame
  ctx.strokeStyle = INK; ctx.lineWidth = 10;
  roundRect(ctx, 26, 26, W - 52, H - 52, 22); ctx.stroke();
  ctx.strokeStyle = accent; ctx.lineWidth = 3;
  roundRect(ctx, 44, 44, W - 88, H - 88, 14); ctx.stroke();

  ctx.textAlign = 'center';

  // wordmark
  ctx.fillStyle = INK;
  ctx.font = '800 64px "Bricolage Grotesque", sans-serif';
  ctx.fillText('BLUELINE', W / 2, 132);
  ctx.fillStyle = INKSOFT;
  ctx.font = '400 22px "Courier Prime", monospace';
  ctx.fillText('FLY FISHING', W / 2, 168);
  ctx.strokeStyle = 'rgba(33,29,20,0.25)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(120, 196); ctx.lineTo(W - 120, 196); ctx.stroke();

  // ribbon (trophy / legend / record)
  if (c.legend || c.trophy || c.isRecord) {
    const label = c.legend ? 'LEGENDARY' : c.isRecord ? 'NEW RECORD' : 'TROPHY';
    ctx.save();
    ctx.translate(W / 2, 240); ctx.rotate(-0.03);
    ctx.font = '800 30px "Bricolage Grotesque", sans-serif';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = gold;
    roundRect(ctx, -tw / 2 - 28, -32, tw + 56, 52, 4); ctx.fill();
    ctx.fillStyle = INK; ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, -4);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  // fish image
  const img = cardFishImg;
  const boxY = 300, boxH = 430;
  if (img && img.complete && img.naturalWidth) {
    const maxW = W - 220, maxH = boxH;
    const r = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
    const iw = img.naturalWidth * r, ih = img.naturalHeight * r;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 16;
    ctx.drawImage(img, (W - iw) / 2, boxY + (boxH - ih) / 2, iw, ih);
    ctx.restore();
  }

  // species / legend name
  let y = 800;
  ctx.fillStyle = INK;
  ctx.font = '800 70px "Bricolage Grotesque", sans-serif';
  ctx.fillText(c.displayName, W / 2, y);
  if (c.legend) {
    ctx.fillStyle = rust;
    ctx.font = '700 26px "Courier Prime", monospace';
    ctx.fillText(c.species.toUpperCase(), W / 2, y + 40);
    y += 40;
  }

  // length — the hero number
  y += 96;
  ctx.fillStyle = line;
  ctx.font = '700 92px "Courier Prime", monospace';
  ctx.fillText(c.inches.toFixed(1) + '"', W / 2, y);

  // flavor line
  y += 60;
  ctx.fillStyle = INKSOFT;
  ctx.font = 'italic 400 26px "Courier Prime", monospace';
  wrapText(ctx, '"' + c.flavor + '"', W / 2, y, W - 200, 34);

  // stat grid at the bottom
  const stats = [['FLY', c.fly], ['RIG', c.rig], ['ROD', c.rod],
                 ['SEASON', c.seasonName], ['TIME', c.phase], ['WATER', c.water]];
  const gx = 130, gw = (W - 260) / 3, gy = H - 250, gh = 84;
  ctx.strokeStyle = 'rgba(33,29,20,0.25)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(120, gy - 30); ctx.lineTo(W - 120, gy - 30); ctx.stroke();
  stats.forEach((s, i) => {
    const col = i % 3, rowi = Math.floor(i / 3);
    const x = gx + col * gw, ry = gy + rowi * gh;
    ctx.textAlign = 'left';
    ctx.fillStyle = INKSOFT; ctx.font = '700 20px "Courier Prime", monospace';
    ctx.fillText(s[0], x, ry);
    ctx.fillStyle = INK; ctx.font = '700 28px "Bricolage Grotesque", sans-serif';
    ctx.fillText(String(s[1]), x, ry + 34);
  });

  // footer date
  ctx.textAlign = 'center';
  ctx.fillStyle = INKSOFT; ctx.font = '400 22px "Courier Prime", monospace';
  const d = c.date;
  const ds = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  ctx.fillText(ds, W / 2, H - 70);
}

function wrapText(ctx, text, x, y, maxW, lh) {
  const words = text.split(' ');
  let lineStr = '', lines = [];
  words.forEach(w => {
    const test = lineStr ? lineStr + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && lineStr) { lines.push(lineStr); lineStr = w; }
    else lineStr = test;
  });
  if (lineStr) lines.push(lineStr);
  lines.slice(0, 3).forEach((l, i) => ctx.fillText(l, x, y + i * lh));
}

let cardFishImg = null;
async function openCard() {
  if (!lastCatch) return;
  AUDIO.play('strip');
  // load the fish image fresh so it's decoded before we draw
  cardFishImg = new Image();
  cardFishImg.src = lastCatch.img;
  try { await (cardFishImg.decode ? cardFishImg.decode() : Promise.resolve()); } catch (e) {}
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}
  drawTrophyCard(lastCatch);
  cardModal.classList.remove('hidden');
}
function closeCard() { cardModal.classList.add('hidden'); }
function downloadCard() {
  if (!lastCatch) return;
  let url;
  try {
    url = trophyCanvas.toDataURL('image/png');
  } catch (e) {
    // file:// origins taint the canvas (the fish image), blocking export.
    // The preview still works — just nudge toward serving over http.
    alert('Couldn\'t export the image — browsers block saving when the game is opened directly as a file. Run it from a local web server (e.g. "uv run python -m http.server") and try again.');
    return;
  }
  const a = document.createElement('a');
  const safe = lastCatch.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  a.download = `blueline-${safe}-${lastCatch.inches.toFixed(0)}in.png`;
  a.href = url;
  a.click();
}

// =========================================================
//  LIVING RIVER — ambient life on the water (cosmetic only)
//  Rise rings dimple the surface and the odd fish splashes.
//  Runs only when the scene is visible (idle/drift).
// =========================================================
const ambientVisible = () => (state === ST.IDLE || state === ST.DRIFT) && !document.hidden;
const seasonLife = () => ({                 // per-season rise cadence (ms between rings)
  spring: { rise: [2600, 5200] },
  summer: { rise: [2000, 4200] },
  autumn: { rise: [3200, 6500] },
  winter: { rise: [5000, 11000] },
}[SEASON_ID] || { rise: [3000, 6000] });

function spawnRise() {
  if (!ambientEl) return;
  // place the dimple out on the open water — right of the angler, mid-frame
  const x = 38 + Math.random() * 56;        // 38%..94% across
  const y = 50 + Math.random() * 26;        // 50%..76% down (the water band)
  const big = Math.random() < 0.22;         // some rises are a full splashy take
  const ring = document.createElement('div');
  ring.className = 'rise' + (big ? ' rise-splash' : '');
  ring.style.left = x + '%';
  ring.style.top = y + '%';
  // scale rings down with distance (higher up the frame = further away = smaller)
  const dist = 0.55 + (y - 50) / 26 * 0.7;
  ring.style.setProperty('--rs', (big ? 1.5 : 1) * dist);
  ambientEl.appendChild(ring);
  if (big) AUDIO.play('rise');
  setTimeout(() => ring.remove(), 2200);
}

let riseTimer = null;
function scheduleRise() {
  const [a, b] = seasonLife().rise;
  riseTimer = setTimeout(() => { if (ambientVisible()) spawnRise(); scheduleRise(); }, a + Math.random() * (b - a));
}
function startAmbientLife() { clearTimeout(riseTimer); scheduleRise(); }

// =========================================================
//  ACHIEVEMENTS — persistent badges + toasts
// =========================================================
function showToast(icon, title, sub, kind) {
  if (!toastsEl) return;
  const t = document.createElement('div');
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.innerHTML = `<span class="t-icon">${icon}</span>
    <span class="t-body"><span class="t-title">${title}</span><span class="t-sub">${sub}</span></span>`;
  toastsEl.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 400); }, 4200);
}

// ctx is the snapshot built in landFish(); check every locked achievement against it
function checkAchievements(ctx) {
  A.ACHIEVEMENTS.forEach(a => {
    if (journal.achievements[a.id]) return;
    let ok = false;
    try { ok = a.test(ctx); } catch (e) {}
    if (ok) {
      journal.achievements[a.id] = Date.now();
      showToast(a.icon, 'Achievement: ' + a.name, a.desc, 'ach');
    }
  });
  saveJournal();
}

// Secrets are a separate, cheekier track from achievements — found by misusing
// the game rather than mastering it. Unlock is permanent and one-shot.
function unlockSecret(id) {
  if (journal.secrets[id]) return;
  const s = A.SECRETS.find(x => x.id === id);
  if (!s) return;
  journal.secrets[id] = Date.now();
  saveJournal();
  showToast(s.icon, 'Secret found: ' + s.name, s.blurb, 'secret');
  renderSecrets();
}

function renderSecrets() {
  const wrap = $('secret-list'); if (!wrap) return;
  wrap.innerHTML = '';
  const got = A.SECRETS.filter(s => journal.secrets[s.id]).length;
  const cnt = $('secret-count'); if (cnt) cnt.textContent = `${got} / ${A.SECRETS.length}`;
  A.SECRETS.forEach(s => {
    const found = !!journal.secrets[s.id];
    const row = document.createElement('div');
    row.className = 'ach-badge' + (found ? '' : ' locked');
    row.innerHTML = `<span class="ach-icon">${found ? s.icon : '🕵️'}</span>
      <span class="ach-info"><span class="ach-name">${found ? s.name : '???'}</span>
      <span class="ach-desc">${found ? s.blurb : 'Nice try!'}</span></span>`;
    wrap.appendChild(row);
  });
}

function renderAchievements() {
  const wrap = $('ach-list'); if (!wrap) return;
  wrap.innerHTML = '';
  const got = A.ACHIEVEMENTS.filter(a => journal.achievements[a.id]).length;
  const cnt = $('ach-count'); if (cnt) cnt.textContent = `${got} / ${A.ACHIEVEMENTS.length}`;
  A.ACHIEVEMENTS.forEach(a => {
    const unlocked = !!journal.achievements[a.id];
    const row = document.createElement('div');
    row.className = 'ach-badge' + (unlocked ? '' : ' locked');
    row.innerHTML = `<span class="ach-icon">${unlocked ? a.icon : '🔒'}</span>
      <span class="ach-info"><span class="ach-name">${a.name}</span>
      <span class="ach-desc">${a.desc}</span></span>`;
    wrap.appendChild(row);
  });
}

function renderLegends() {
  const wrap = $('legend-list'); if (!wrap) return;
  wrap.innerHTML = '';
  A.SPECIES_ORDER.forEach(id => {
    const s = A.SPECIES[id]; if (!s.legend) return;
    const got = journal.legends[id];
    const row = document.createElement('div');
    row.className = 'legend-row' + (got ? ' landed' : '');
    row.innerHTML = `<span class="legend-mark">${got ? '👑' : '❔'}</span>
      <span class="legend-info">
        <span class="legend-name">${got ? s.legend.name : '???'}</span>
        <span class="legend-sub">${got ? `${s.name} · ${got.length.toFixed(1)}"` : s.legend.blurb}</span>
      </span>`;
    wrap.appendChild(row);
  });
}

// =========================================================
//  DAILY CHALLENGE — one seeded objective per calendar day
// =========================================================
function dateKey(d) { d = d || new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
function todayChallenge() { return A.DAILY[hashStr(dateKey()) % A.DAILY.length]; }
function ensureDailyToday() {
  const k = dateKey();
  if (journal.daily.key !== k) { journal.daily.key = k; journal.daily.done = false; saveJournal(); }
}
function dailyAlive() {
  const y = dateKey(new Date(Date.now() - 86400000));
  return journal.daily.lastCompleted === dateKey() || journal.daily.lastCompleted === y;
}
function checkDaily(ctx) {
  ensureDailyToday();
  if (journal.daily.done) return;
  const ch = todayChallenge();
  let ok = false; try { ok = ch.test(ctx); } catch (e) {}
  if (!ok) return;
  journal.daily.done = true;
  const y = dateKey(new Date(Date.now() - 86400000));
  journal.daily.streak = (journal.daily.lastCompleted === y) ? (journal.daily.streak || 0) + 1 : 1;
  journal.daily.lastCompleted = dateKey();
  saveJournal();
  const sk = journal.daily.streak;
  showToast('📅', 'Daily Challenge done!', ch.desc + (sk > 1 ? ` · 🔥 ${sk}-day streak` : ''), 'ach');
  renderDaily();
}
function renderDaily() {
  const wrap = $('daily-card'); if (!wrap) return;
  ensureDailyToday();
  const ch = todayChallenge();
  const d = journal.daily;
  const streak = dailyAlive() ? (d.streak || 0) : 0;
  wrap.innerHTML = `
    <div class="daily-box ${d.done ? 'done' : ''}">
      <div class="daily-head"><span>DAILY CHALLENGE</span>
        <span class="daily-streak">${streak > 0 ? '🔥 ' + streak + '-day streak' : ''}</span></div>
      <div class="daily-desc">${ch.desc}</div>
      <div class="daily-status">${d.done ? '✓ Complete — back tomorrow for a new one' : 'Not yet — go land it'}</div>
    </div>`;
}

// =========================================================
//  SEASONS — slider selector (hidden unless there's more than one)
// =========================================================
function renderSeasons() {
  const sec = $('season-section'), range = $('season-range');
  if (!sec || !range) return;
  if (A.SEASON_ORDER.length <= 1) { sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');
  range.max = A.SEASON_ORDER.length - 1;
  range.value = A.SEASON_ORDER.indexOf(SEASON_ID);
  $('season-name').textContent = SEASON.name;
  $('season-blurb').textContent = SEASON.blurb || '';
}

async function setSeason(id) {
  if (!A.SEASONS[id] || id === SEASON_ID) return;
  SEASON_ID = id; SEASON = A.SEASONS[id]; IMG = buildPaths(SEASON);
  localStorage.setItem('bl_season', id);
  journal.seasonsFished[id] = true;
  checkAchievements({ journal });   // four-seasons may unlock here
  AUDIO.play('strip');
  AUDIO.setSeason(id);
  await preload(locImageList(IMG));      // have the new scene decoded before showing it
  renderSeasons();
  applyPhase();                          // refresh the hatch/report for the new season
  toIdle();                              // reset the scene to the new season
  resize();
}
// dragging the slider snaps to the nearest season
$('season-range').addEventListener('input', (e) => {
  if (tackleLocked()) { e.target.value = A.SEASON_ORDER.indexOf(SEASON_ID); return; }
  const id = A.SEASON_ORDER[+e.target.value];
  if (id) setSeason(id);
});

// =========================================================
//  WIRING
// =========================================================
castBtn.onclick = () => { AUDIO.unlock(); startCast(); };
const randomizeBtn = $('randomize-btn');
if (randomizeBtn) randomizeBtn.onclick = () => { if (state === ST.IDLE) randomizeTackle(); };
mendBtn.onclick = tapMend;
// Holding the MEND button down (mouse or touch) auto-mends too: while held we poll
// and let each cooldown-clearing tick land a mend, counting them just like the held
// M key. AUTOMEND_STREAK automends in a row trips the same secret. Releasing resets.
// Once the secret is found, automend is disabled for good — the poll no-ops.
let mendHoldPoll = null;
mendBtn.addEventListener('pointerdown', () => {
  clearInterval(mendHoldPoll);
  if (journal.secrets.automend) return;
  mendHoldPoll = setInterval(() => {
    if (journal.secrets.automend) { clearInterval(mendHoldPoll); return; }
    if (doMend() && ++mendAutoStreak >= AUTOMEND_STREAK) unlockSecret('automend');
  }, 200);
});
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
  mendBtn.addEventListener(ev, () => { clearInterval(mendHoldPoll); mendAutoStreak = 0; }));
setBtn.onclick = doSet;
// release the cast-timing meter — by button, or by tapping anywhere on the meter
castReleaseBtn.onclick = () => { if (castTiming && !castTiming.resolved) releaseCast(); };
castMeterEl.onclick = () => { if (castTiming && !castTiming.resolved) releaseCast(); };
stripBtn.onclick = doStrip;
reelBtn.onclick = reelIn;
releaseBtn.onclick = () => { toIdle(); $('reveal-size').classList.remove('hidden'); revImg.style.display = ''; };
$('picker-scrim').onclick = closePicker;
$('picker-close').onclick = closePicker;

// trophy card
cardBtn.onclick = openCard;
$('card-close').onclick = closeCard;
$('card-scrim').onclick = closeCard;
$('card-download').onclick = downloadCard;

// reset the log (species, records, legends, achievements)
const resetJournalBtn = $('reset-journal');
if (resetJournalBtn) resetJournalBtn.onclick = () => {
  if (!confirm('Reset your catch log? Records, legends and achievements will be wiped.')) return;
  localStorage.removeItem(LSK);
  journal = loadJournal();
  journal.seasonsFished[SEASON_ID] = true;
  catchStreak = 0; daySpecies = {}; perfectCastStreak = 0;
  saveJournal();
  renderJournal();
  AUDIO.play('strip');
};

// collapsible tackle sections — remember open/closed across reloads
['sec-rod', 'sec-rig', 'sec-flies'].forEach(id => {
  const d = $(id); if (!d) return;
  const key = 'bl_' + id;
  const saved = localStorage.getItem(key);
  if (saved != null) d.open = saved === '1';
  d.addEventListener('toggle', () => localStorage.setItem(key, d.open ? '1' : '0'));
});

// keyboard: space = primary action (incl. releasing the cast-timing meter)
window.addEventListener('keydown', (ev) => {
  if (ev.code === 'Space') {
    ev.preventDefault();
    if (state === ST.IDLE) { AUDIO.unlock(); startCast(); }
    else if (state === ST.CASTING && castTiming && !castTiming.resolved) releaseCast();
    else if (state === ST.BITE) doSet();
    else if (state === ST.FIGHT) doStrip();
    else if (state === ST.REVEAL) releaseBtn.click();
  } else if (ev.code === 'KeyM' && state === ST.DRIFT) {
    // Holding M auto-mends: the browser fires repeat keydowns while it's held, and
    // each one that clears the cooldown lands a real mend. We count those — pull
    // off AUTOMEND_STREAK automends in a row (no release) and you trip a secret
    // that ribs the hands-off approach. Once that secret is found the gag is over:
    // automend is disabled for good and a held key does nothing (mend by tapping).
    if (ev.repeat) {
      if (journal.secrets.automend) return;
      if (doMend() && ++mendAutoStreak >= AUTOMEND_STREAK) unlockSecret('automend');
      return;
    }
    mendAutoStreak = 0;   // a deliberate single press breaks the automend streak
    tapMend();
  }
  // R = reset the cast (mirrors the RESET button — available whenever it's shown)
  else if (ev.code === 'KeyR' && !reelBtn.classList.contains('hidden')) reelIn();
});
window.addEventListener('keyup', (ev) => { if (ev.code === 'KeyM') mendAutoStreak = 0; });

// tabs
document.querySelectorAll('.tab').forEach(t => {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    $('pane-' + t.dataset.tab).classList.add('active');
    if (t.dataset.tab === 'journal') renderJournal();
  };
});

// audio toggle
const muteBtn = $('mute-btn');
// speaker glyphs as inline SVG so the muted vs. on state reads clearly at a glance
const ICON_MUTED = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
const ICON_ON    = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/></svg>';
function reflectMute() {
  const m = AUDIO.isMuted();
  muteBtn.classList.toggle('muted', m);
  muteBtn.innerHTML = m ? ICON_MUTED : ICON_ON;
  muteBtn.title = m ? 'Sound off — click for stream & birds' : 'Sound on';
}
muteBtn.onclick = () => { AUDIO.unlock(); const m = AUDIO.toggle(); localStorage.setItem('bl_muted', m ? '1' : '0'); reflectMute(); };

// =========================================================
//  INIT
// =========================================================
async function init() {
  // start at the player's real-world time of day
  cond.phaseIdx = currentPhaseIdx();
  rollWater();
  applyPhase();

  journal.seasonsFished[SEASON_ID] = true; saveJournal();
  renderRods(); renderRigs(); renderSlots(); renderMatch(); renderJournal();
  renderSeasons();
  updateFlyMarker(); updateLineColor();

  // prime audio with the starting season (before unlock, so startAmbient picks it up)
  AUDIO.setSeason(SEASON_ID);

  // audio default: OFF — only on if the user explicitly turned it on before
  const pref = localStorage.getItem('bl_muted');
  AUDIO.setMuted(pref !== '0');
  reflectMute();

  // decode the active scene + fish before first paint → no pop-in flashes
  await preload(locImageList(IMG).concat(FISH_IMGS));
  resize();
  toIdle();
  startAmbientLife();   // rise rings + drifting birds while the scene is visible

  // keep the scene in step with the player's real-world time of day
  setInterval(() => { if (state === ST.IDLE || state === ST.DRIFT) syncPhaseToClock(); }, 60000);
}
init();
