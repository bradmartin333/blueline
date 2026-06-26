# CLAUDE.md

Guidance for Claude Code (and other AI agents) working in this repository.

## Rules

These are hard rules. Follow them unless the user explicitly overrides one for a
given task.

- **Python: use `uv` for everything.** All Python operations go through `uv` —
  never call `python`/`python3`, `pip`, `pipx`, `virtualenv`, or `venv`
  directly, and don't add `requirements.txt`/manual venvs.
  - Run a script: `uv run path/to/script.py …`
  - One-off with deps: `uv run --with pillow --with numpy path/to/script.py …`
    (or rely on the script's PEP 723 `# /// script` inline metadata, which
    `uv run` installs automatically).
  - REPL / module: `uv run python`, `uv run -m <module>`.
  - Pull in deps **ephemerally** with `uv run --with <pkg>` (or PEP 723). Do
    **not** `uv add` / `uv sync` / `uv pip install` into the repo — there is no
    committed venv or `requirements.txt` and there must not be one (see the
    `uv-validation` skill). A `PreToolUse` hook in `.claude/settings.json`
    enforces this.
  - **`uv` must be installed.** If `uv: command not found`:
    - macOS / Linux: `curl -LsSf https://astral.sh/uv/install.sh | sh`
    - Homebrew: `brew install uv`
    - Windows: `powershell -c "irm https://astral.sh/uv/install.ps1 | iex"`

## Skills

Project-scoped Claude skills live in [`.claude/skills/`](.claude/skills/). Each
skill is a folder with a `SKILL.md` (and optional `scripts/`). They're picked up
automatically by Claude Code when working in this repo.

- **seasonal-asset-styler** — restyle scene art to feel like a different season
  (spring/summer/autumn/winter): recolors foliage/water/rock and adds drifting
  seasonal elements. Its `scripts/season_style.py` needs Pillow + numpy and is
  run with `uv run` (see the rule above).
- **uv-validation** — validate changes to the browser code (`data.js` / `game.js`
  / `index.html` / `style.css`): `scripts/validate.py` syntax-checks the JS with
  esprima and loads the page in headless Playwright, failing on console errors.
  Run it with `uv run` (deps come in via PEP 723 + `uv run --with`, never pip).
- **cruft-cleanup** — sweep away cruft before finishing: dead code from reworked
  features (orphaned vars/functions/CSS/DOM + dangling references) and stray
  verification artifacts (screenshots, temp scripts, logs, servers), so
  `git status` shows only intended changes. Reach for it at the end of a task.
- **skill-gardener** — keep `.claude/skills/` healthy as development continues:
  fold fresh learnings into existing skills, fix stale examples, prune obsolete
  skills, and propose new skills when a repeatable pattern emerges. Run it
  periodically, like a linter for the skill set.

## Project notes

Blueline is a fly-fishing browser game built with **vanilla HTML/CSS/JS** — no
build step, no bundler, no package manager. Open `index.html` to run it.

- `data.js` — static game data (seasons, hatches, flies, rigs, rods, species).
- `game.js` — engine: state machine, conditions, drift/fight loops, rendering.
- `audio.js` — sound.
- `index.html` / `style.css` — markup and styling.
- `assets/seasons/<id>/` — per-season backgrounds (`cast.webp`, `drift_*.webp`);
  `assets/cast/` — shared cast animation frames + line masks; `assets/fg/` — shared
  angler poses (`drift`/`mend`/`set`); `assets/fish/` — fish images.
