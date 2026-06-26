# /// script
# requires-python = ">=3.10"
# dependencies = ["esprima", "playwright"]
# ///
"""
Validate Blueline's browser code with uv-managed, throwaway deps.

Two layers:
  1. esprima  — pure-Python JS syntax check of data.js / game.js (no JS runtime).
  2. Playwright — load index.html headless, fail on console/page errors, and
                  sanity-check window.DATA through the real DOM.

Run via uv (never pip), e.g.:
    uv run scripts/validate.py                # full run
    uv run scripts/validate.py --syntax-only  # skip the browser

PEP 723 metadata above means `uv run` builds an ephemeral env per invocation —
nothing is installed into the repo. The Chromium browser itself is provisioned
once with:  uv run --with playwright python -m playwright install chromium
"""
import argparse
import asyncio
import contextlib
import functools
import http.server
import socketserver
import sys
import threading
from pathlib import Path

# repo root = three levels up from .claude/skills/uv-validation/scripts/
REPO = Path(__file__).resolve().parents[4]
JS_FILES = ["data.js", "game.js"]


def syntax_check() -> bool:
    import esprima

    ok = True
    for name in JS_FILES:
        path = REPO / name
        if not path.exists():
            print(f"  ✗ {name}: not found")
            ok = False
            continue
        try:
            esprima.parseScript(path.read_text())
            print(f"  ✓ {name}: parses")
        except Exception as e:  # esprima.Error and friends
            print(f"  ✗ {name}: {e}")
            ok = False
    return ok


@contextlib.contextmanager
def serve(directory: Path):
    """A quiet throwaway http.server on a free port, for the duration of the block."""
    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a, **k):  # silence per-request logging
            pass

    handler = functools.partial(QuietHandler, directory=str(directory))
    with socketserver.TCPServer(("127.0.0.1", 0), handler) as httpd:
        port = httpd.server_address[1]
        t = threading.Thread(target=httpd.serve_forever, daemon=True)
        t.start()
        try:
            yield port
        finally:
            httpd.shutdown()


# console messages we don't care about (analytics refusing to count on localhost)
IGNORE_SUBSTRINGS = ("goatcounter",)


async def browser_check(port: int) -> bool:
    from playwright.async_api import async_playwright

    problems: list[str] = []

    def on_console(msg):
        if msg.type in ("error",) and not any(s in msg.text for s in IGNORE_SUBSTRINGS):
            problems.append(f"console {msg.type}: {msg.text}")

    async with async_playwright() as p:
        try:
            browser = await p.chromium.launch()
        except Exception as e:
            print(f"  ✗ could not launch Chromium ({e}).")
            print("    Run once: uv run --with playwright python -m playwright install chromium")
            return False
        page = await browser.new_page(viewport={"width": 1400, "height": 900})
        page.on("console", on_console)
        page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))

        await page.goto(f"http://127.0.0.1:{port}/index.html")
        await page.wait_for_timeout(1500)  # let init() finish (asset preload + toIdle)

        data_ok = await page.evaluate(
            """() => {
              const D = window.DATA;
              if (!D) return { ok:false, why:'window.DATA missing' };
              const rigSlotsOk = Object.values(D.RIGS).every(r =>
                r.slots.every(slot => Object.values(D.FLIES).some(f => D.slotAccepts(slot, f.cat))));
              const fliesPlaceable = Object.values(D.FLIES).every(f =>
                D.slotAccepts('top', f.cat) || D.slotAccepts('drop', f.cat));
              const ctx = { journal:{landed:0,species:{},legends:{},seasonsFished:{}}, inches:10,
                trophy:false, legend:false, rigId:'dry', fly:{cat:'dry',hook:14}, streak:0,
                phaseId:'dawn', light:'low', slamDay:false, daySpeciesCount:1, dryEat:false,
                hatch:'none', diceRolled:false, bubbleHits:0 };
              let achTestsRun = true;
              for (const a of D.ACHIEVEMENTS) { try { a.test(ctx); } catch(e){ achTestsRun = false; } }
              return { ok: rigSlotsOk && fliesPlaceable && achTestsRun,
                       rigSlotsOk, fliesPlaceable, achTestsRun,
                       flies:Object.keys(D.FLIES).length, rigs:Object.keys(D.RIGS).length,
                       achievements:D.ACHIEVEMENTS.length };
            }"""
        )
        await browser.close()

    if data_ok.get("ok"):
        print(f"  ✓ index.html loaded; DATA sane "
              f"({data_ok['flies']} flies, {data_ok['rigs']} rigs, {data_ok['achievements']} achievements)")
    else:
        print(f"  ✗ DATA check failed: {data_ok}")
    for pr in problems:
        print(f"  ✗ {pr}")
    if not problems:
        print("  ✓ no console / page errors")
    return bool(data_ok.get("ok")) and not problems


def main() -> int:
    ap = argparse.ArgumentParser(description="Validate Blueline browser code (uv + esprima + Playwright).")
    ap.add_argument("--syntax-only", action="store_true", help="skip the headless browser pass")
    args = ap.parse_args()

    print("Syntax check (esprima):")
    ok = syntax_check()

    if not args.syntax_only:
        print("\nBrowser check (Playwright):")
        with serve(REPO) as port:
            ok = asyncio.run(browser_check(port)) and ok

    print("\n" + ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
