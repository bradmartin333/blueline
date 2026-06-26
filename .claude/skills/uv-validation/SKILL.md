---
name: uv-validation
description: >-
  Validate this repo's changes — syntax-check the JS, load the game in a
  headless browser, and exercise features — using uv-managed Python with
  esprima and Playwright. Use this whenever you've edited data.js / game.js /
  index.html / style.css (or any browser-run code here) and want to confirm it
  parses, loads without console errors, and behaves; or whenever you need to run
  ANY Python in this repo. It also encodes the hard rules for Python here: every
  Python invocation goes through uv, always into a throwaway temporary venv, and
  pip is never used to install packages. Reach for this on requests like
  "validate my change", "check the game still works", "run the verification",
  "smoke-test the page", or any "run this python" task.
---

# uv Validation

Blueline is vanilla HTML/CSS/JS with **no build step and no package manager** —
so there's no `npm test` to lean on. Validation is done from Python, run through
`uv`, using two tools:

- **esprima** — a pure-Python JS parser, for a fast syntax check of `data.js` /
  `game.js` without a browser or a JS runtime (there is no `node` here).
- **Playwright** (Chromium) — to actually load `index.html`, catch console
  errors / page errors, and drive the new feature through the real DOM.

## Hard rules (Python in this repo)

These are non-negotiable and apply to *every* Python command you run here, not
just validation:

1. **All Python goes through `uv`.** Never call `python` / `python3`, `pip`,
   `pipx`, `virtualenv`, or `venv` directly. (This mirrors the repo's root
   `CLAUDE.md`.)
2. **Never use `pip` to install packages.** Pull dependencies in with
   `uv run --with <pkg>` (or PEP 723 inline metadata), never `pip install` /
   `uv pip install` into a persistent environment.
3. **Always use a temporary, throwaway venv.** Don't create or reuse a
   project-level `.venv`, and don't `uv sync` / `uv add` into the repo for
   validation work. `uv run --with …` already builds an ephemeral environment
   per invocation — that is the intended mechanism. If you need an explicit env,
   make it under the session scratchpad (a temp dir), not in the repo.

The reason for the temp-venv rule: validation deps (esprima, playwright) are
test-only and must never leak into the repo — there is no `requirements.txt` or
committed venv here and there must not be one.

## Quick start

`scripts/validate.py` runs both layers. It has PEP 723 inline metadata, so
`uv run` installs Playwright into a throwaway env automatically — no manual
setup, no `pip`.

```bash
# syntax-check only (fast; no browser, no Chromium download)
uv run scripts/validate.py --syntax-only

# full run: syntax check + headless load + console-error check
uv run scripts/validate.py

# one-time: install the Chromium browser Playwright drives (cached by Playwright,
# not pip-installed into the repo). Only needed before the first full run.
uv run --with playwright python -m playwright install chromium
```

The script:

1. Parses `data.js` and `game.js` with esprima and reports any syntax error
   with its location.
2. Starts a throwaway `http.server` (Playwright can't drive `file://` cleanly),
   loads `index.html`, waits for init, and fails if any **console error** or
   **page error** fired (the goatcounter "localhost" notice is ignored).
3. Sanity-checks `window.DATA`: every rig slot is fillable by some fly, every
   fly is placeable, and every achievement `test()` runs without throwing.

Exit code is non-zero if anything fails, so it's safe to chain in a script.

## Writing one-off checks

For feature-specific checks (e.g. "does pressing CAST show the timing meter?"),
drive the page with a short inline Playwright script — still through `uv`, still
into a temp env. Prefer **DOM-observable** assertions: module-scoped `let`/`const`
in `game.js` are **not** on `window`, so assert against rendered elements /
classes, not internal variables. Patterns that have worked here:

- `#cast-timing` loses `.hidden` after CAST; `#cast-meter` gains
  `.result-perfect` / `.result-good` / `.result-blown` on release.
- `#mute-btn.muted`, `#randomize-btn` inside `#match .m-top`, `.slot-fly` text
  changing after a dice roll, `#mend-btn` un-hidden once the drift starts.
- To reach a later state, drive the real controls: click `#cast-btn`, press
  `Space` to release the meter, click `#reel-in-btn` (or press `r`) to reset.

```bash
uv run --with playwright python - <<'PY'
import asyncio
from playwright.async_api import async_playwright
# ... load http://localhost:<port>/index.html, assert on the DOM ...
PY
```

## Lessons learned (read before writing checks)

- **Don't measure sub-second animation timing through async Playwright polling.**
  Sweep speed, frame cadence, transition durations — async `eval` sampling jitters
  badly and gives numbers that are confidently wrong in both directions. To verify
  a timing value (e.g. the cast meter's `sweepMs` and rod multipliers), **read it
  from the source** and confirm the constant + the formula, not a measured period.
  Reserve Playwright for *behavioral* facts (did the state change, did the class
  toggle, is the element there), which it nails.
- **Cast-slider difficulty/feel is the user's call, not Playwright's** (their
  explicit instruction). How hard/easy the timing meter is to nail — `sweepMs`,
  the rod-action multipliers, the good/perfect band widths — can only be judged by
  a human actually playing it. Don't claim a difficulty tuning is "verified" from
  a headless run: make the source change, confirm it parses + loads, then hand it
  back for the user to feel. Same goes for the cast follow-through animation
  looking right.
- The **`goatcounter` "not counting because of: localhost"** console message is
  benign analytics noise — already ignored by `validate.py`; ignore it in your own
  checks too.
- A check that returns `null` from `page.evaluate` is usually reading a
  module-scoped var that isn't on `window` — switch to a DOM assertion.

## Cleanup is part of running

Temp scripts, screenshots, `.log` files, and background `http.server`s belong in
the session scratchpad and must be **deleted when the verification is done** —
they accumulate across sessions and leak into the repo if you're not careful.
After running checks, clean up and confirm the repo is untouched by your scratch
work. This is the job of [[cruft-cleanup]] — invoke it (or at least its final
`git status --short` gate) before calling the work done. Validation deps stay
ephemeral: never `pip install`, never `uv sync`/`uv add` into the repo, no
committed `.venv` or `requirements.txt`.
