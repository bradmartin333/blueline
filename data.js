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
// hatch: the hatch most likely active this phase
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
DATA.RODS = {
  glass3:    { name: 'Creek Glass', line: '3-weight', action: 'slow',
               cadence: [180, 220, 150, 200], comfort: 'light', delicate: 1.35, punch: 0.7,
               blurb: 'Soft fiberglass. Lays small dries down like a feather; bogs under heavy rigs.' },
  graphite5: { name: 'All-Water',   line: '5-weight', action: 'medium',
               cadence: [110, 130, 90, 120], comfort: 'medium', delicate: 1.0, punch: 1.0,
               blurb: 'Medium graphite. No weaknesses, no party tricks. The workhorse.' },
  streamer6: { name: 'Quick-Tip',   line: '6-weight', action: 'fast',
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
    name: 'Brook Trout', img: 'assets/brook.png', weight: 1.0,
    foods: ['caddis','terrestrial','attractor'], depths: ['surface','film','shallow'],
    lightLove: ['low','soft'], spook: 0.6,
    size: [5, 8, 13], trophy: 11, fight: 0.3,
    blurb: 'Eager and gorgeous. Will smash a caddis at dusk all day long.' },
  rainbow: {
    name: 'Rainbow Trout', img: 'assets/rainbow.png', weight: 0.85,
    foods: ['bwo','pmd','scud','attractor'], depths: ['film','shallow','deep'],
    lightLove: ['soft','bright'], spook: 1.0,
    size: [8, 12, 18], trophy: 16, fight: 0.6,
    blurb: 'Mid-column generalist. Acrobatic — expect jumps and screaming runs.' },
  brown: {
    name: 'Brown Trout', img: 'assets/brown.png', weight: 0.45,
    foods: ['stonefly','terrestrial','caddis'], depths: ['shallow','deep'],
    lightLove: ['low'], spook: 1.5,
    size: [10, 15, 23], trophy: 18, fight: 0.85,
    blurb: 'Wary and big. Holds to structure, hunts the low light. The prize of the run.' },
};

DATA.SPECIES_ORDER = ['brook', 'rainbow', 'brown'];

// ---- Catch flavor lines ----
DATA.CATCH_LINES = {
  small:  ['A feisty little one.', 'Small but willing.', 'Dinks count too.'],
  mid:    ['A solid, healthy fish.', 'Good one — proper fight.', 'Beautifully marked.'],
  big:    ['A real slab.', 'That one pulled back.', 'Net-stretcher.'],
  trophy: ['A trophy. Hands shaking.', 'Fish of the day.', 'You earned that one.'],
};

window.DATA = DATA;
