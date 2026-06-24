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
  - Manage deps/tools: `uv add`, `uv sync`, `uv tool install`.

## Skills

Project-scoped Claude skills live in [`.claude/skills/`](.claude/skills/). Each
skill is a folder with a `SKILL.md` (and optional `scripts/`). They're picked up
automatically by Claude Code when working in this repo.

- **seasonal-asset-styler** — restyle scene art to feel like a different season
  (spring/summer/autumn/winter): recolors foliage/water/rock and adds drifting
  seasonal elements. Its `scripts/season_style.py` needs Pillow + numpy and is
  run with `uv run` (see the rule above).

## Project notes

Blueline is a fly-fishing browser game built with **vanilla HTML/CSS/JS** — no
build step, no bundler, no package manager. Open `index.html` to run it.

- `data.js` — static game data (seasons, hatches, flies, rigs, rods, species).
- `game.js` — engine: state machine, conditions, drift/fight loops, rendering.
- `audio.js` — sound.
- `index.html` / `style.css` — markup and styling.
- `assets/seasons/<id>/` — per-season scene art; `assets/cast/` — shared cast
  animation frames; `assets/fish/` — fish images.
