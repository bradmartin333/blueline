---
name: seasonal-asset-styler
description: >-
  Restyle game / scene art to feel like a different season — spring, summer,
  autumn, or winter. Recolors foliage, water, and rock and adds matching
  drifting elements (falling leaves, blossom petals, snow, summer light motes)
  plus seasonal atmosphere. Use this whenever someone wants to give image assets
  a seasonal "feel", "vibe", or "mood", convert a scene from one season to
  another (e.g. "make these summer backgrounds look like fall/winter"), create
  seasonal variants of the same location, or add seasonal effects like autumn
  leaves or falling snow to artwork — even if they don't say the word "season".
  Handles both full background scenes and transparent foreground overlays.
---

# Seasonal Asset Styler

Give a set of scene assets a seasonal feel without redrawing them. The skill
segments each background into **foliage / water / rock** by colour, recolors
each region for the target season, and overlays drifting seasonal elements and
atmosphere. Transparent foreground overlays (a hand, a rod, a HUD prop) get a
subtle matching colour grade only — never element scatter — so their lighting
stays consistent with the new scene.

## When to use

Reach for this any time the goal is a *seasonal* transformation of imagery:
seasonal variants of a location, converting a scene between seasons, or layering
on snow / leaves / petals. It's tuned for nature-ish scenes (rivers, forests,
trails) but the colour logic is general.

## Quick start

The work is done by `scripts/season_style.py` (needs `Pillow` and `numpy`).
Run it directly — no need to reimplement the pipeline.

```bash
# whole folder, with originals backed up
uv run scripts/season_style.py --season autumn --input ./assets --outdir ./out_autumn --backup

# specific files
uv run scripts/season_style.py --season winter --input bg_a.webp bg_b.webp --outdir ./out_winter
```

`--season` is one of `spring`, `summer`, `autumn`, `winter`. `--input` accepts
files or a directory (PNG / JPEG / WebP); `--outdir` is where restyled copies are
written (originals are never modified in place). Output is always **lossless
WebP** — e.g. `bg_a.png` in becomes `bg_a.webp` out — to match the game's assets.

## How each season reads

- **spring** — fresh vivid yellow-greens, brighter clear water, drifting blossom petals, soft warm bloom.
- **summer** — lush deep saturated greens, bright water, warm haze with floating light motes/pollen.
- **autumn** — foliage recolored red→gold by brightness, cool steel-blue water, grey granite rock, maple leaves drifting on the water and through the air, cool mist on the treeline.
- **winter** — desaturated snow-dusted foliage, cold slate water, pale grey rock, falling snow across the frame, cool haze.

## Foreground vs background

By default the script auto-detects: an image with meaningful transparency
(>5% transparent pixels) is treated as a **foreground overlay** and only colour-
graded; everything else gets the **full background** treatment. Override with
`--as-foreground` or `--as-background` if a particular asset is misclassified.
Dimensions and the alpha channel are always preserved exactly.

## Useful flags

- `--backup` — copy the originals into `<outdir>/originals/` first.
- `--no-elements` — recolor only; skip the drifting leaves/snow/petals (faster, cleaner for tiny assets or UI art).
- `--seed N` — change the random placement of elements; same seed = reproducible output. Each file in a batch is offset from this seed so variants don't look identical.

## Tuning notes

The look is controlled by a few clearly-marked spots in the script, so it's easy
to adjust rather than starting over:

- **Region segmentation** lives in `masks()`. If tan boulders pick up foliage colour, tighten the foliage hue band or the rock saturation range there.
- **Per-season recolor** is in `recolor_background()` — each season is its own branch operating on `foliage`/`rock`/`water` masks in HSV. Nudge hue/saturation/value there to shift the mood.
- **Drifting elements** are in `add_elements()`, with colours in `SEASON_PALETTE` and sprite shapes in `_maple` / `_petal` / `_dot`.

Work on a copy or use `--backup`, eyeball the output, and iterate on those
values — small HSV changes go a long way.
