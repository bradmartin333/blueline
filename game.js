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
const flyLine = $('fly-line'), flyPath = $('fly-line-path'), flyDot = $('fly-dot');
const castBtn = $('cast-btn'), mendBtn = $('mend-btn'), setBtn = $('set-btn'), reelBtn = $('reel-in-btn');
const driftMini = $('drift-mini'), driftMiniFill = $('drift-mini-fill'), driftMiniVal = $('drift-mini-val');
const takePrompt = $('take-prompt');
const fightEl = $('fight'), greenZone = $('green-zone'),
      indicator = $('indicator'), stripBtn = $('strip-btn');
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
let lastBiteTick = 0;
let driftRAF = null;
let bite = null;          // current bite payload {species, sizeIn, setWindow, deadline, trophy, legend}
let biteFlash = null;

// --- session tracking (for achievements / streaks) ---
let catchStreak = 0;          // consecutive lands without losing a hooked fish
let daySpecies = {};          // species landed since the last dawn (for the day-slam)
let lastCatch = null;         // snapshot of the most recent landed fish (for the trophy card)

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
function updateFlyMarker() {
  const k = flyMarkerKind();
  flyDot.setAttribute('class', k);
  flyDot.setAttribute('r', k === 'foam' ? 5.5 : k === 'fly' ? 5.5 : 4.5);
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
  const mx = (rx + fxp) / 2 + lateral + sway;             // control point: lateral arc
  const my = (ry + fyp) / 2 + baseMag * 0.5;              // slight gravity sag
  flyPath.setAttribute('d', `M ${rx.toFixed(1)} ${ry.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${fxp.toFixed(1)} ${fyp.toFixed(1)}`);
  flyDot.setAttribute('cx', fxp.toFixed(1));
  flyDot.setAttribute('cy', (fyp + Math.sin(t * 1.6) * 2).toFixed(1));
  lineRAF = requestAnimationFrame(drawFlyLine);
}

// =========================================================
//  CONDITIONS ENGINE
// =========================================================
function rollWater() {
  const r = Math.random();
  cond.waterId = r < 0.5 ? 'clear' : r < 0.8 ? 'riffled' : 'stained';
}
function applyPhase() {
  const p = A.PHASES[cond.phaseIdx];
  cond.light = p.light;
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
function renderRods() {
  const wrap = $('rod-list'); wrap.innerHTML = '';
  Object.entries(A.RODS).forEach(([id, r]) => {
    const b = document.createElement('button');
    b.className = 'opt' + (tackle.rodId === id ? ' sel' : '');
    b.innerHTML = `<div class="o-row"><span class="o-name">${r.name}</span>
      <span class="o-meta">${r.line} · ${r.action}</span></div>
      <div class="o-note">${r.blurb}</div>`;
    b.onclick = () => { tackle.rodId = id; AUDIO.play('strip'); updateLineColor(); renderRods(); renderMatch(); };
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
    b.onclick = () => { setRig(id); };
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
    b.onclick = () => openPicker(i, slot);
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
    b.onclick = () => { tackle.slots[i] = id; AUDIO.play('mend'); closePicker(); renderSlots(); renderMatch(); };
    body.appendChild(b);
  });
  $('fly-picker').classList.add('open');
}
function closePicker() { $('fly-picker').classList.remove('open'); }

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
  setControls({ cast: true });
  renderMatch();
}

function startCast() {
  const e = evaluate();
  if (!e.ready) { flashNote('Tie on a fly first.'); return; }
  state = ST.CASTING;
  setControls({});
  hideFlyLine();
  AUDIO.play('cast');
  fg.style.display = 'block';
  fg.className = '';
  resetFgTransform();             // cast frames are full-frame; no drift pan
  // cast line: re-colored to the rod, masked by the per-frame baked line shape
  castLineEl.style.background = (A.RODS[tackle.rodId] && A.RODS[tackle.rodId].lineColor) || '#e7ff8c';
  castLineEl.classList.add('show');
  const cadence = A.RODS[tackle.rodId].cadence;
  let i = 0;
  (function frame() {
    if (state !== ST.CASTING) return;
    if (i >= IMG.cast.length) {
      AUDIO.play('splash');
      // the still scene (bg[0]) is the first drift frame, so just start the drift —
      // the fly line + angler bob + pan all play over it, same as every drift frame
      startDrift();
      return;
    }
    fg.src = IMG.cast[i];
    const mask = `url("${IMG.castLine[i]}")`;
    castLineEl.style.webkitMaskImage = mask;
    castLineEl.style.maskImage = mask;
    const d = cadence[i] || 110;
    i++;
    setTimeout(frame, d);
  })();
}

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
  const BASE = 0.115;
  let p = BASE * e.biteMul * driftFactor * pity * dragFree;
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

  const lead = equippedFlies()[0];
  // set window from fly visibility + hook size + rod action
  const rod = A.RODS[tackle.rodId];
  const actionAdj = rod.action === 'fast' ? 1.1 : rod.action === 'slow' ? 0.95 : 1;
  let win = (950 + lead.vis * 470 - (lead.hook - 8) * 42) * actionAdj;
  win = Math.max(750, Math.min(2600, win));
  bite = { speciesId, sizeIn, win, deadline: performance.now() + win,
           trophy: sizeIn >= sp.trophy, legend: isLegend };

  fg.src = IMG.drift;
  showFlyLine('drift');                    // match the line to the drift pose (fixes mid-mend takes)
  startBiteShake();                        // JS shake, composed onto the frozen pan
  lineJerk = 1;                            // line snaps taut on the take
  takePrompt.classList.add('hidden');     // SET button is the cue
  driftMini.classList.add('hidden');
  setControls({ set: true });
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
function startFight() {
  state = ST.FIGHT;
  const s = A.SPECIES[bite.speciesId];
  const lead = equippedFlies()[0];
  const sizeFactor = (bite.sizeIn - s.size[0]) / (s.size[2] - s.size[0]); // 0..1
  const leg = bite.legend;
  let need = Math.round(3 + s.fight * 3.5 + sizeFactor * 2);       // strips to land
  let speed = 0.85 + s.fight * 0.9 + sizeFactor * 0.5;            // marker speed
  let tippetRisk = Math.max(0, (lead.hook - 12) / 10) * (0.4 + sizeFactor);
  let base = 0.46;
  if (leg) { need += 3; speed += 0.35; tippetRisk = Math.min(0.85, tippetRisk + 0.18); base = 0.4; }
  fight = { need, got: 0, speed, pos: 0, dir: 1, zoneL: 0, zoneW: 0,
            tippetRisk, raf: null, base };

  fightEl.classList.toggle('legend-fight', !!leg);
  fightEl.classList.remove('hidden');
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
  fightEl.classList.remove('legend-fight');
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

  // snapshot for the trophy card
  const lead = equippedFlies()[0];
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
    rigId: tackle.rigId, fly: lead, seasonId: SEASON_ID,
    phaseId: A.PHASES[cond.phaseIdx].id, light: cond.light,
    streak: catchStreak, slamDay, daySpeciesCount: Object.keys(daySpecies).length,
    dryEat: !!lead && rig.slots.every(sl => sl === 'top') && lead.cat !== 'nymph',
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
  fightEl.classList.remove('legend-fight');
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
function doMend() {
  if (state !== ST.DRIFT) return;
  const now = performance.now();
  if (now < mendCoolUntil) return;
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
  mendCoolUntil = now + 2200;

  // visual: flick the line with the mend frame. The main effect is the ARC flipping
  // upstream (mendBow); the lure itself only repositions a touch.
  AUDIO.play('mend');
  fg.src = IMG.mend;
  showFlyLine('mend');
  mendBow = 0.5 + 0.5 * timing;                      // flip the line's arc upstream
  driftProgress = Math.max(0, driftProgress - 0.08); // lure slides back upstream just a little
  setTimeout(() => { if (state === ST.DRIFT) { fg.src = IMG.drift; showFlyLine('drift'); } }, 420);
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
  const id = A.SEASON_ORDER[+e.target.value];
  if (id) setSeason(id);
});

// =========================================================
//  WIRING
// =========================================================
castBtn.onclick = () => { AUDIO.unlock(); startCast(); };
mendBtn.onclick = doMend;
setBtn.onclick = doSet;
stripBtn.onclick = doStrip;
reelBtn.onclick = reelIn;
releaseBtn.onclick = () => { hideAudioNudge(); toIdle(); $('reveal-size').classList.remove('hidden'); revImg.style.display = ''; };
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
  catchStreak = 0; daySpecies = {};
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

// keyboard: space = primary action
window.addEventListener('keydown', (ev) => {
  if (ev.code === 'Space') {
    ev.preventDefault();
    if (state === ST.IDLE) { AUDIO.unlock(); startCast(); }
    else if (state === ST.BITE) doSet();
    else if (state === ST.FIGHT) doStrip();
    else if (state === ST.REVEAL) releaseBtn.click();
  } else if (ev.code === 'KeyM' && state === ST.DRIFT) doMend();
});

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
function reflectMute() {
  const m = AUDIO.isMuted();
  muteBtn.classList.toggle('muted', m);
  muteBtn.textContent = m ? '♪' : '♬';
  muteBtn.title = m ? 'Sound off — click for stream & birds' : 'Sound on';
}
muteBtn.onclick = () => { AUDIO.unlock(); const m = AUDIO.toggle(); localStorage.setItem('bl_muted', m ? '1' : '0'); reflectMute(); hideAudioNudge(); };
$('nudge-on').onclick = () => { AUDIO.unlock(); AUDIO.setMuted(false); localStorage.setItem('bl_muted', '0'); reflectMute(); hideAudioNudge(); };
function hideAudioNudge() { const n = $('audio-nudge'); if (n) n.style.display = 'none'; }

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

  // audio default: muted unless user previously turned it on
  const pref = localStorage.getItem('bl_muted');
  AUDIO.setMuted(pref !== '0');
  reflectMute();
  if (pref === '0') hideAudioNudge();

  // decode the active scene + fish before first paint → no pop-in flashes
  await preload(locImageList(IMG).concat(FISH_IMGS));
  resize();
  toIdle();
  startAmbientLife();   // rise rings + drifting birds while the scene is visible

  // keep the scene in step with the player's real-world time of day
  setInterval(() => { if (state === ST.IDLE || state === ST.DRIFT) syncPhaseToClock(); }, 60000);
}
init();
