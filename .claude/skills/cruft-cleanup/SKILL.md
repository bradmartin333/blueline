---
name: cruft-cleanup
description: >-
  Sweep away cruft before finishing a change: dead code left over from iterative
  feature churn (orphaned variables, functions, CSS rules, DOM nodes, dangling
  references) AND stray verification artifacts (screenshots, one-off temp
  scripts, log files, background servers) so the repo's git status only ever
  shows intended changes. Use this at the end of a task — especially after the
  feature was reworked or replaced mid-stream (e.g. "scrap X and do Y instead",
  "remove the old thing") — or whenever asked to "clean up", "remove dead code",
  "tidy up before committing", or "clean up verification assets". Also reach for
  it whenever `git status` shows files that shouldn't be there.
---

# Cruft Cleanup

Iterative feature work leaves two kinds of cruft. This skill finds and removes
both. Run it as the last step before you call a task done.

## 1. Dead code from reworked features

When a feature is replaced or renamed mid-task, references to the old version
scatter across files (this repo has bitten us repeatedly: the bubble→meter→
sparkle reworks left behind `lastBubbleHits`, an orphaned `bubbleHits` ctx
field, and dead CSS). JS here has no bundler/linter to flag unused symbols, so
**grep is the linter.**

After removing or renaming anything, sweep for survivors across **all** files
(`game.js`, `data.js`, `index.html`, `style.css`):

```bash
# replace the terms with the identifiers / classes / ids you just removed or renamed
grep -rn "oldName\|old-css-class\|#old-dom-id\|removedFunction" \
  /Users/brad/Documents/blueline/{game.js,data.js,index.html,style.css} \
  || echo "clean - no dangling refs"
```

Checklist for a removed/renamed thing — make sure none of these survive:

- **JS:** the `let`/`const` declaration, every read/write, the function
  definition, its call sites, any `$('id')` element ref, and resets in
  `toIdle()` / the journal-reset handler.
- **HTML:** the element itself and anything that only existed to feed it.
- **CSS:** the rule blocks, `@keyframes`, and any `--custom-prop` only it used.
- **data.js:** if you drop a fly/rig/species/hatch/food id, grep for that id in
  achievements' and daily challenges' `test()` bodies, species `foods`, season
  `hatches`, and the rig/slot helpers — a dropped id referenced in a `test()`
  silently breaks that badge.

Also delete code that became dead *because* of a removal: a ctx field nothing
reads anymore, a helper with no callers, a CSS class no element carries.

## 2. Verification / scratch artifacts

Screenshots, one-off Playwright/test scripts, `.log` files, and background HTTP
servers pile up across sessions in the scratchpad. Clean them when the
verification is done:

```bash
SCRATCH="<session scratchpad dir>"   # the harness-provided scratchpad, NOT the repo
rm -f "$SCRATCH"/*.png "$SCRATCH"/verify*.py "$SCRATCH"/shot*.py /tmp/blserver.log
pkill -f 'http.server' 2>/dev/null    # kill any temp server you started
ls -A "$SCRATCH" || echo "(empty)"
```

Rules:

- **Temp files live in the scratchpad, never the repo.** If you ever wrote a
  screenshot or scratch script into the repo tree, move or delete it.
- Kill background servers/processes you started (`http.server`, watchers).
- This repo has **no committed venv and no `requirements.txt`** — if a `.venv/`
  or `requirements.txt` appeared, it's cruft from a stray `pip`/`uv sync`; remove
  it (see [[uv-validation]] for why deps must stay ephemeral).

## 3. The final gate

The repo's working tree should show **only** the files your task intended to
touch. Always finish with:

```bash
git -C /Users/brad/Documents/blueline status --short
```

Every line should be explainable by the task. An unexpected `??` (untracked) or
`M` (modified) file is cruft, a leaked artifact, or an accidental edit — resolve
it before considering the work done.
