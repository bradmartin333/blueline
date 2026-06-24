// ============================================================
//  GAME DATA — flies, rigs, rods, species, hatches, conditions
//  Pure static definitions + small helpers. No game state here.
// ============================================================

const DATA = {};

// ---- Depth zones (where the fly is presented / where fish feed) ----
// surface  : on top of the film
// film     : in the surface film / emerging
// shallow  : just under the surface
// deep     : down near the bottom
DATA.DEPTHS = ['surface', 'film', 'shallow', 'deep'];

// ---- Seasons ----
// The same creek, fished across the four seasons. Only the BACKDROP art changes
// season to season — the angler/rod foreground poses and the cast animation are
// identical everywhere — so every season shares one drift config (cadence, focal
// point, fly-line anchors) via SEASON_BASE and just points at its own art folder.
//
//   The cast animation (fg_cast_*.webp + line_cast_*.webp) is SHARED across seasons
//   in assets/cast/ — the first-person cast looks the same all year.
//
//   File layout per season (assets/seasons/<id>/):
//     bg_cast.webp            — idle / casting backdrop (the still stream)
//     bg_drift_0.webp … _N    — drift backdrops, played in sequence as the fly
//                              travels downstream (any number of frames)
//     fg_drift.webp           — foreground drift pose (rod held, NO baked fly line)
//     fg_mend.webp            — foreground mend pose (NO baked fly line)
//     fg_set.webp             — hookset close-up (also reused for the break-off flash)
//
//   driftFrames  : how many bg_drift_* frames exist.
//   driftFrameMs : ms each drift backdrop holds before the cosmetic hard-cut.
//   driftTravelMs: ms for the lure to float the whole flyUp→flyDown run (the drift's
//                  real length; a mend nudges it back upstream a little).
//   focalX/focalY: 0..1 focal point used to frame the scene on portrait screens.
//   line         : per-state fly-line anchors in normalized stage coords (0..1 of
//                  the 1472×704 stage). `rod` is the rod tip. During the drift the
//                  lure travels flyUp→flyDown — flyUp is where it lands (push it
//                  toward the top of the frame to land it further from the angler /
//                  further upstream); flyDown is where the drift ends, nearest you.
const SEASON_BASE = {
  driftFrames: 2,
  driftFrameMs: 6500,          // bg hard-cut cadence (cosmetic)
  driftTravelMs: 12000,        // how long the lure takes to float the full run
  focalX: 0.42, focalY: 0.5,
  line: {
    drift: { rod: [0.239, 0.253], flyUp: [0.64, 0.70], flyDown: [0.21, 0.90], sag: 0.06 },
    mend:  { rod: [0.265, 0.150], sag: 0.12 },
  },
};
const seasonArt = (id) => `assets/seasons/${id}`;
// hatches: what's coming off the water this season, keyed by time-of-day phase id.
// This overrides each phase's default hatch so the bugs match the season — spring
// BWOs, summer terrestrials, fall caddis, sparse winter midge days, etc. ('none' =
// a searching / midge day with no clear hatch.)
DATA.SEASONS = {
  spring: { ...SEASON_BASE, name: 'Spring', blurb: 'Snowmelt swells the creek and the first mayflies ride the film.',  dir: seasonArt('spring'),
    hatches: { dawn: 'none', morning: 'bwo', midday: 'bwo',         afternoon: 'stonefly',   evening: 'caddis', dusk: 'caddis' } },
  summer: { ...SEASON_BASE, name: 'Summer', blurb: 'Low, clear water and terrestrials — long bright days, spooky fish.', dir: seasonArt('summer'),
    hatches: { dawn: 'none', morning: 'pmd', midday: 'terrestrial', afternoon: 'terrestrial', evening: 'caddis', dusk: 'caddis' } },
  autumn: { ...SEASON_BASE, name: 'Autumn', blurb: 'Hardwood canopy turning, browns coloring up and feeding hard.',     dir: seasonArt('autumn'),
    hatches: { dawn: 'none', morning: 'bwo', midday: 'terrestrial', afternoon: 'bwo',        evening: 'caddis', dusk: 'caddis' } },
  winter: { ...SEASON_BASE, name: 'Winter', blurb: 'Cold, slow flows under bare trees — tiny flies, deep drifts.',      dir: seasonArt('winter'),
    hatches: { dawn: 'none', morning: 'none', midday: 'bwo',        afternoon: 'bwo',        evening: 'none',   dusk: 'none' } },
};
DATA.SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'];

// ---- Hatches / available food ----
// what the fish are keyed on. The active hatch shifts with time of day.
DATA.HATCHES = {
  none:       { label: 'Searching',     blurb: 'No clear hatch — fish are looking around.' },
  bwo:        { label: 'BWO Hatch',     blurb: 'Blue-Winged Olives riding the film.' },
  pmd:        { label: 'PMD Hatch',     blurb: 'Pale Morning Duns popping off.' },
  caddis:     { label: 'Caddis Hatch',  blurb: 'Caddis fluttering the surface — prime time.' },
  stonefly:   { label: 'Stoneflies',    blurb: 'Big stonefly nymphs on the move.' },
  terrestrial:{ label: 'Terrestrials',  blurb: 'Hoppers & ants blowing onto the water.' },
};

// ---- Time-of-day phases. Conditions cycle through these. ----
// feed: weighting of where fish are feeding (must overlap your rig depth)
// hatch: fallback hatch for this phase (the active SEASON's `hatches` table wins)
// light: 'low' | 'soft' | 'bright'
// trophyLight: bonus to big-fish odds (low light = big browns move)
DATA.PHASES = [
  { id: 'dawn',      label: 'Dawn',      light: 'low',    hatch: 'none',
    feed: { surface: 0.25, film: 0.2, shallow: 0.25, deep: 0.3 }, trophyLight: 1.5 },
  { id: 'morning',   label: 'Morning',   light: 'soft',   hatch: 'pmd',
    feed: { surface: 0.3, film: 0.3, shallow: 0.25, deep: 0.15 }, trophyLight: 1.0 },
  { id: 'midday',    label: 'Midday',    light: 'bright', hatch: 'terrestrial',
    feed: { surface: 0.25, film: 0.15, shallow: 0.2, deep: 0.4 }, trophyLight: 0.7 },
  { id: 'afternoon', label: 'Afternoon', light: 'bright', hatch: 'stonefly',
    feed: { surface: 0.2, film: 0.15, shallow: 0.3, deep: 0.35 }, trophyLight: 0.8 },
  { id: 'evening',   label: 'Evening',   light: 'soft',   hatch: 'caddis',
    feed: { surface: 0.45, film: 0.3, shallow: 0.15, deep: 0.1 }, trophyLight: 1.3 },
  { id: 'dusk',      label: 'Dusk',      light: 'low',    hatch: 'caddis',
    feed: { surface: 0.4, film: 0.25, shallow: 0.15, deep: 0.2 }, trophyLight: 1.6 },
];

// ---- Water clarity states ----
// biteBase : multiplier on overall willingness
// selectivity : how much the hatch-match matters (clear = picky)
// stealth : how much a spooky fish needs a delicate presentation
// dragHide : how forgiving of bad drift (riffled water hides drag → mend matters less)
// sizeBias : nudge to fish size
DATA.WATER = {
  clear:   { label: 'Gin Clear',   biteBase: 0.85, selectivity: 1.4, stealth: 1.4, dragHide: 0.9, sizeBias: 1.1,
             blurb: 'Low and clear. Fish are spooky and selective — match it well.' },
  stained: { label: 'Stained',     biteBase: 1.2,  selectivity: 0.7, stealth: 0.7, dragHide: 1.0, sizeBias: 0.95,
             blurb: 'Off-color water. Fish are less picky and less wary.' },
  riffled: { label: 'Riffled',     biteBase: 1.05, selectivity: 0.9, stealth: 0.8, dragHide: 1.4, sizeBias: 1.0,
             blurb: 'Broken water. Drag is hidden and fish hold tight — nymphs shine.' },
};

// ---- Flies ----
// cat: dry | terrestrial | nymph
// imitates: hatch ids this fly matches (attractor = matches anything weakly)
// depth: where it fishes
// hook: hook size (bigger # = smaller fly = harder, faster takes / smaller set window)
// vis: how easy the take is to see/feel (affects set window). 1 = subtle, 3 = obvious
DATA.FLIES = {
  elk_caddis:  { name: 'Elk Hair Caddis',   tag: 'caddis · dry',     cat: 'dry',         imitates: ['caddis','attractor'],     depth: 'surface', hook: 14, vis: 3, note: 'Buoyant, visible. Forgiving hookset.' },
  cornfed:     { name: 'Cornfed Caddis',     tag: 'caddis · emerger', cat: 'dry',         imitates: ['caddis'],                 depth: 'film',    hook: 16, vis: 2, note: 'Rides low in the film. Deadly mid-hatch.' },
  para_adams:  { name: 'Parachute Adams',    tag: 'mayfly · dry',     cat: 'dry',         imitates: ['bwo','pmd','attractor'],  depth: 'surface', hook: 16, vis: 2, note: 'The everything dry. Great searching pattern.' },
  bwo_dun:     { name: 'BWO Dun',            tag: 'bwo · dry',        cat: 'dry',         imitates: ['bwo'],                    depth: 'surface', hook: 18, vis: 1, note: 'Tiny and exact. Quick, subtle takes.' },
  pmd_dun:     { name: 'PMD Dun',            tag: 'pmd · dry',        cat: 'dry',         imitates: ['pmd'],                    depth: 'surface', hook: 16, vis: 2, note: 'Match the morning duns.' },
  stimulator:  { name: 'Stimulator',         tag: 'stone · dry',      cat: 'dry',         imitates: ['stonefly','caddis','attractor'], depth: 'surface', hook: 12, vis: 3, note: 'Big, buggy, floats high. Hopper season too.' },
  chubby:      { name: 'Chubby Chernobyl',   tag: 'hopper · foam',    cat: 'terrestrial', imitates: ['terrestrial','attractor'], depth: 'surface', hook: 10, vis: 3, note: 'Huge & foam. Obvious eats, holds a dropper.' },
  ant:         { name: 'Ant',                tag: 'terrestrial',      cat: 'terrestrial', imitates: ['terrestrial'],            depth: 'film',    hook: 18, vis: 1, note: 'Subtle sipper. Sneaky-good all summer.' },
  perdigon:    { name: 'Perdigon',           tag: 'mayfly · nymph',   cat: 'nymph',       imitates: ['bwo','pmd','attractor'],  depth: 'deep',    hook: 16, vis: 2, note: 'Slim & heavy. Sinks fast, fishes deep.' },
  pats:        { name: "Pat's Rubber Legs",  tag: 'stone · nymph',    cat: 'nymph',       imitates: ['stonefly'],               depth: 'deep',    hook: 8,  vis: 3, note: 'Big meal. Browns travel for it.' },
  blowtorch:   { name: 'Blowtorch',          tag: 'attractor · nymph',cat: 'nymph',       imitates: ['attractor','pmd'],        depth: 'shallow', hook: 14, vis: 2, note: 'Flashy hot-spot nymph. Searching machine.' },
  scud:        { name: 'Scud',               tag: 'crustacean',       cat: 'nymph',       imitates: ['scud','attractor'],       depth: 'shallow', hook: 16, vis: 2, note: 'Year-round protein. Loves stained water.' },
};

// ---- Rigs ----
// slots: which fly category each slot accepts (['dry'] etc; terrestrials count as dry-able on top)
// weight: casting weight class (light|medium|heavy) — used for rod fit
// driftDecay: how fast drift quality decays (dries drag visibly → high; nymphs → low)
// biteBase: rig's intrinsic productivity
// mendPayoff: how much a good mend restores (surface rigs reward mending most)
DATA.RIGS = {
  dry:           { name: 'Dry Fly',        slots: ['top'],          weight: 'light',  driftDecay: 1.35, biteBase: 1.0,  mendPayoff: 1.4,
                   blurb: 'One fly on top. Pure, visual, and demands a clean drift.' },
  double_dry:    { name: 'Double Dry',     slots: ['top','top'],    weight: 'light',  driftDecay: 1.3,  biteBase: 1.2,  mendPayoff: 1.3,
                   blurb: 'Two dries — twice the looks, twice the tangle risk.' },
  nymph_single:  { name: 'Nymph (single)', slots: ['drop'],         weight: 'medium', driftDecay: 0.7,  biteBase: 1.05, mendPayoff: 0.8,
                   blurb: 'One nymph down deep. Drag hides under the surface.' },
  nymph_double:  { name: 'Nymph (double)', slots: ['drop','drop'],  weight: 'heavy',  driftDecay: 0.65, biteBase: 1.3,  mendPayoff: 0.8,
                   blurb: 'Two nymphs at two depths. Covers the column.' },
  hopper_dropper:{ name: 'Hopper-Dropper', slots: ['top','drop'],   weight: 'heavy',  driftDecay: 0.95, biteBase: 1.25, mendPayoff: 1.1,
                   blurb: 'A buoyant bug up top, a nymph hung below. Does it all.' },
};
// slot 'top'  accepts: dry, terrestrial
// slot 'drop' accepts: nymph

DATA.slotAccepts = function (slot, cat) {
  if (slot === 'top') return cat === 'dry' || cat === 'terrestrial';
  if (slot === 'drop') return cat === 'nymph';
  return false;
};

// ---- Rods (casting feel) ----
// action: slow | medium | fast  → drives the cast animation cadence
// cadence: per-frame delays (ms) for the 4 casting frames
// comfort: rig weight this rod throws cleanly
// delicate: presentation finesse (helps spooky fish / small dries in clear water)
// punch: ability to throw heavy rigs / wind without sloppiness
// lineColor: color of the dynamically drawn fly line for this rod
DATA.RODS = {
  glass3:    { name: 'Creek Glass', line: '3-weight', action: 'slow', lineColor: '#8fe3c4',
               cadence: [180, 220, 150, 200], comfort: 'light', delicate: 1.35, punch: 0.7,
               blurb: 'Soft fiberglass. Lays small dries down like a feather; bogs under heavy rigs.' },
  graphite5: { name: 'All-Water',   line: '5-weight', action: 'medium', lineColor: '#e7ff8c',
               cadence: [110, 130, 90, 120], comfort: 'medium', delicate: 1.0, punch: 1.0,
               blurb: 'Medium graphite. No weaknesses, no party tricks. The workhorse.' },
  streamer6: { name: 'Quick-Tip',   line: '6-weight', action: 'fast', lineColor: '#ff9a40',
               cadence: [70, 85, 60, 80], comfort: 'heavy', delicate: 0.78, punch: 1.4,
               blurb: 'Fast & stiff. Punches heavy nymph rigs and wind; too much for tiny dries.' },
};

DATA.weightRank = { light: 0, medium: 1, heavy: 2 };

// ---- Species (catch table) ----
// weight: base rarity (higher = more common)
// foods: hatch/food ids this fish keys on (bonus when your fly imitates one)
// depths: where it tends to feed (overlap with your presentation helps)
// lightLove: phases.light values it prefers
// spook: how much clear water / bad stealth hurts your odds
// size: [min, mode, max] inches  ;  trophy: inches that counts as a trophy
// fight: 0..1 strength → longer fight, more break risk
// img
DATA.SPECIES = {
  brook: {
    name: 'Brook Trout', img: 'assets/fish/brook.webp', weight: 1.0,
    foods: ['caddis','terrestrial','attractor'], depths: ['surface','film','shallow'],
    lightLove: ['low','soft'], spook: 0.6,
    size: [5, 8, 13], trophy: 11, fight: 0.3,
    blurb: 'Eager and gorgeous. Will smash a caddis at dusk all day long.' },
  rainbow: {
    name: 'Rainbow Trout', img: 'assets/fish/rainbow.webp', weight: 0.85,
    foods: ['bwo','pmd','scud','attractor'], depths: ['film','shallow','deep'],
    lightLove: ['soft','bright'], spook: 1.0,
    size: [8, 12, 18], trophy: 16, fight: 0.6,
    blurb: 'Mid-column generalist. Acrobatic — expect jumps and screaming runs.' },
  brown: {
    name: 'Brown Trout', img: 'assets/fish/brown.webp', weight: 0.45,
    foods: ['stonefly','terrestrial','caddis'], depths: ['shallow','deep'],
    lightLove: ['low'], spook: 1.5,
    size: [10, 15, 23], trophy: 18, fight: 0.85,
    blurb: 'Wary and big. Holds to structure, hunts the low light. The prize of the run.' },
  cutthroat: {
    name: 'Cutthroat Trout', img: 'assets/fish/cutthroat.webp', weight: 0.6,
    foods: ['attractor','terrestrial','stonefly'], depths: ['surface','film','shallow'],
    lightLove: ['soft','bright'], spook: 0.8,
    size: [8, 12, 18], trophy: 16, fight: 0.5,
    blurb: 'Native cutt with the crimson slash. Opportunistic — rises happily to a big attractor dry.' },
};

DATA.SPECIES_ORDER = ['brook', 'rainbow', 'brown', 'cutthroat'];

// ---- Catch flavor lines — about THIS catch / how it went ----
DATA.CATCH_LINES = {
  small:  ['Ate on the drop and never quit.', 'Tiny, but it slashed the fly hard.',
           'A pint-sized scrapper — all heart.', 'Quick grab, quicker release.',
           'Pounced the second it landed.', 'Punched above its weight the whole way in.'],
  mid:    ['Solid take and a dogged little fight.', 'Used the current well before it tired.',
           'A clean eat and an honest tussle.', 'Held deep, then slid to hand.',
           'Took line twice — earned its keep.', 'Textbook drift, textbook fight.'],
  big:    ['Crushed it and bulldogged for the bottom.', 'Peeled drag and tested every knot.',
           'Heavy headshakes the whole fight.', 'Owned the run for a good minute.',
           'Stubborn brute — fought you for every inch.', 'Almost into the backing on that one.'],
  trophy: ['It ate, then everything went sideways.', 'A screaming run — hands still shaking.',
           'Bent the rod to the cork and held on.', 'The fish of the day, no contest.',
           'You\'ll be telling this one for years.', 'Pure adrenaline from the take to the net.'],
};

window.DATA = DATA;
