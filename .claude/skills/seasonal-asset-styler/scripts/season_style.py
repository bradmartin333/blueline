#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = ["numpy", "pillow"]
# ///
"""Apply a seasonal feel (spring / summer / autumn / winter) to game-art assets.

Works on photographic / posterized scene art with foliage, water and rock, and on
transparent foreground overlays (e.g. an arm + rod). Backgrounds get a full
recolor plus drifting scene elements; transparent overlays get only a subtle
matching colour grade so their lighting stays consistent with the scene.

Inputs may be PNG / JPEG / WebP; output is always written as lossless WebP
(matching the game's `.webp` assets), preserving dimensions and alpha exactly.

The inline script metadata above lets `uv run` install numpy + Pillow
automatically — no manual venv or pip:
    uv run season_style.py --season autumn --input ./assets --outdir ./out --backup
    uv run season_style.py --season winter --input a.webp b.webp --outdir ./out
    uv run season_style.py --season spring --input fg.webp --outdir ./out --as-foreground

Run `uv run season_style.py --help` for all options.
"""
import argparse, math, os, random, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SEASONS = ("spring", "summer", "autumn", "winter")

def to_hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(-1); mn = rgb.min(-1)
    df = mx - mn
    dfs = np.where(df > 1e-6, df, 1.0)
    h = np.zeros_like(mx)
    rm = mx == r; gm = (mx == g) & ~rm; bm = (mx == b) & ~rm & ~gm
    h = np.where(rm, ((g - b) / dfs) % 6, h)
    h = np.where(gm, ((b - r) / dfs) + 2, h)
    h = np.where(bm, ((r - g) / dfs) + 4, h)
    h = np.where(df > 1e-6, h / 6.0, 0.0)
    s = np.where(mx > 1e-6, df / np.where(mx > 1e-6, mx, 1.0), 0.0)
    return h, s, mx

def to_rgb(h, s, v):
    i = np.floor(h * 6).astype(int)
    f = h * 6 - i
    p = v * (1 - s); q = v * (1 - f * s); t = v * (1 - (1 - f) * s)
    i = i % 6
    r = np.choose(i, [v, q, p, p, t, v])
    g = np.choose(i, [t, v, v, q, p, p])
    b = np.choose(i, [p, p, t, v, v, q])
    return np.clip(np.stack([r, g, b], -1), 0, 1)

def masks(h, s, v):
    """Segment a scene into foliage / rock / water by colour."""
    foliage = (h > 0.16) & (h < 0.50) & (s > 0.07)
    rock = (((h < 0.13) | (h > 0.95)) & (s > 0.10) & (s < 0.70)
            & (v > 0.20) & (v < 0.92)) & ~foliage
    water = (s < 0.12) & (v > 0.08) & (v < 0.78) & ~foliage & ~rock
    return foliage, rock, water

def recolor_background(rgb, season):
    h, s, v = to_hsv(rgb)
    fol, rock, water = masks(h, s, v)
    H, S, V = h.copy(), s.copy(), v.copy()
    if season == "autumn":
        vt = np.clip((v - 0.20) / 0.62, 0, 1)
        H[fol] = (0.005 + 0.115 * vt ** 1.25)[fol]
        S[fol] = np.clip(s[fol] * 0.6 + 0.62, 0, 0.97)
        V[fol] = np.clip(v[fol] * 1.05, 0, 1)
        S[rock] = s[rock] * 0.40; H[rock] = 0.60; V[rock] = v[rock] * 0.97
        H[water] = 0.58; S[water] = np.clip(s[water] + 0.16, 0, 0.42); V[water] = v[water] * 0.96
    elif season == "winter":
        H[fol] = np.where(v[fol] > 0.55, 0.60, 0.08)
        S[fol] = np.where(v[fol] > 0.55, 0.04, s[fol] * 0.25)
        V[fol] = np.clip(np.where(v[fol] > 0.55, v[fol] * 1.15 + 0.05, v[fol] * 0.85), 0, 1)
        S[rock] = s[rock] * 0.30; H[rock] = 0.60; V[rock] = np.clip(v[rock] * 1.08, 0, 1)
        H[water] = 0.60; S[water] = np.clip(s[water] + 0.20, 0, 0.45); V[water] = v[water] * 0.82
    elif season == "spring":
        H[fol] = 0.27; S[fol] = np.clip(s[fol] * 0.7 + 0.45, 0, 0.9); V[fol] = np.clip(v[fol] * 1.12, 0, 1)
        S[rock] = s[rock] * 0.7; V[rock] = np.clip(v[rock] * 1.03, 0, 1)
        H[water] = 0.52; S[water] = np.clip(s[water] + 0.20, 0, 0.5); V[water] = np.clip(v[water] * 1.06, 0, 1)
    elif season == "summer":
        H[fol] = 0.30; S[fol] = np.clip(s[fol] * 0.7 + 0.55, 0, 0.95); V[fol] = np.clip(v[fol] * 0.95, 0, 1)
        S[rock] = np.clip(s[rock] * 0.9 + 0.03, 0, 1); H[rock] = np.clip(h[rock] * 0 + 0.09, 0, 1)
        H[water] = 0.50; S[water] = np.clip(s[water] + 0.18, 0, 0.5); V[water] = np.clip(v[water] * 1.05, 0, 1)
    return to_rgb(H, S, V)

def grade_foreground(rgb, season):
    lum = rgb.mean(-1, keepdims=True)
    shadow = np.clip(1 - lum, 0, 1)
    out = rgb.copy()
    if season in ("autumn", "winter"):
        out[..., 0:1] = np.clip(out[..., 0:1] - 0.035 * shadow, 0, 1)
        out[..., 2:3] = np.clip(out[..., 2:3] + 0.055 * shadow, 0, 1)
        mn = out.min(-1, keepdims=True); out = out * 0.94 + mn * 0.06
        if season == "winter":
            out = np.clip(out * 1.04, 0, 1)
    else:
        out[..., 0:1] = np.clip(out[..., 0:1] + 0.04 * shadow, 0, 1)
        out[..., 2:3] = np.clip(out[..., 2:3] - 0.025 * shadow, 0, 1)
    return np.clip(out, 0, 1)

def _maple(size, color):
    S = size * 4
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    cx, cy = S / 2, S * 0.55; pts = []
    for i in range(0, 361, 6):
        a = math.radians(i)
        r = (0.40 + 0.30 * math.cos(5 * a) + 0.05 * math.cos(2 * a)) * S * 0.9
        pts.append((cx + r * math.sin(a), cy - r * math.cos(a)))
    d.polygon(pts, fill=color + (255,))
    d.line([(cx, cy + 0.30 * S), (cx, cy + 0.5 * S)], fill=(90, 55, 30, 255), width=max(2, S // 40))
    dark = tuple(max(0, int(c * 0.6)) for c in color) + (170,)
    for ang in (-40, -20, 0, 20, 40):
        a = math.radians(ang)
        d.line([(cx, cy), (cx + 0.55 * S * math.sin(a), cy - 0.6 * S * math.cos(a))], fill=dark, width=max(1, S // 70))
    return im.resize((size, size), Image.LANCZOS)

def _petal(size, color):
    S = size * 4
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.polygon([(S*0.5, S*0.05), (S*0.78, S*0.45), (S*0.5, S*0.95), (S*0.22, S*0.45)], fill=color + (255,))
    return im.resize((size, size), Image.LANCZOS)

def _dot(size, color, alpha=255):
    S = size * 4
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.ellipse([S*0.1, S*0.1, S*0.9, S*0.9], fill=color + (alpha,))
    return im.resize((size, size), Image.LANCZOS)

SEASON_PALETTE = {
    "autumn": [(176,42,28),(201,78,24),(214,128,26),(168,52,30),(224,156,40),(150,38,40),(196,96,22),(120,30,28)],
    "spring": [(244,196,212),(250,228,236),(236,170,196),(255,240,245),(238,202,150)],
    "summer": [(255,236,170),(250,224,150),(255,246,210)],
    "winter": [(248,250,252),(232,240,248),(255,255,255)],
}

def add_elements(img, season, rng):
    W, H = img.size
    arr = np.asarray(img.convert("RGBA")).astype(np.float32) / 255.0
    h, s, v = to_hsv(arr[..., :3])
    yy = np.arange(H)[:, None] / H
    water = (s < 0.30) & (v > 0.10) & (v < 0.75) & (yy > 0.30)
    pal = SEASON_PALETTE[season]
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    atmos = Image.new("RGBA", (W, H), (0, 0, 0, 0)); ad = ImageDraw.Draw(atmos)
    wash = {"autumn": (214,224,230,40), "winter": (220,232,244,55),
            "spring": (255,250,235,32), "summer": (255,240,200,34)}[season]
    band = int(H * (0.45 if season == "summer" else 0.32))
    for _ in range(7):
        cx = rng.randint(0, W); cy = rng.randint(int(H * 0.08), band)
        rw = rng.randint(W // 5, W // 2); rh = rng.randint(20, 60)
        ad.ellipse([cx - rw, cy - rh, cx + rw, cy + rh], fill=wash)
    overlay.alpha_composite(atmos.filter(ImageFilter.GaussianBlur(28)))
    if season in ("autumn", "spring"):
        make = _maple if season == "autumn" else _petal
        placed = tries = 0; target = rng.randint(46, 64)
        while placed < target and tries < target * 40:
            tries += 1
            x = rng.randint(0, W - 1); y = rng.randint(int(H * 0.34), H - 1)
            if not water[min(y, H - 1), min(x, W - 1)]:
                continue
            depth = (y - H * 0.34) / (H - H * 0.34)
            sz = int(rng.uniform(13, 20) + depth * 16)
            sp = make(sz, rng.choice(pal)).rotate(rng.uniform(0, 360), expand=True, resample=Image.BICUBIC)
            sh = Image.new("RGBA", sp.size, (0, 0, 0, 0)); ImageDraw.Draw(sh).ellipse(
                [sp.size[0]*0.2, sp.size[1]*0.45, sp.size[0]*0.8, sp.size[1]*0.95], fill=(10,18,24,45))
            overlay.alpha_composite(sh.filter(ImageFilter.GaussianBlur(2)),
                                    (x - sp.size[0]//2, y - sp.size[1]//2 + max(2, sz//5)))
            a = np.asarray(sp).astype(np.float32); a[..., 3] *= 0.92
            overlay.alpha_composite(Image.fromarray(a.astype(np.uint8), "RGBA"),
                                    (x - sp.size[0]//2, y - sp.size[1]//2))
            placed += 1
        for _ in range(rng.randint(7, 11)):
            x = rng.randint(int(W*0.05), int(W*0.95)); y = rng.randint(int(H*0.05), int(H*0.45))
            sz = rng.randint(10, 20)
            sp = make(sz, rng.choice(pal)).rotate(rng.uniform(0, 360), expand=True, resample=Image.BICUBIC)
            overlay.alpha_composite(sp.filter(ImageFilter.GaussianBlur(0.6)), (x - sp.size[0]//2, y - sp.size[1]//2))
    elif season == "winter":
        for _ in range(rng.randint(150, 220)):
            x = rng.randint(0, W - 1); y = rng.randint(0, H - 1)
            sz = rng.randint(2, 7); blur = rng.random() < 0.3
            fl = _dot(sz, rng.choice(pal), alpha=rng.randint(170, 235))
            if blur: fl = fl.filter(ImageFilter.GaussianBlur(1.1))
            overlay.alpha_composite(fl, (x - sz//2, y - sz//2))
    elif season == "summer":
        for _ in range(rng.randint(60, 100)):
            x = rng.randint(0, W - 1); y = rng.randint(0, H - 1)
            sz = rng.randint(3, 9)
            mote = _dot(sz, rng.choice(pal), alpha=rng.randint(70, 150)).filter(ImageFilter.GaussianBlur(1.4))
            overlay.alpha_composite(mote, (x - sz//2, y - sz//2))
    return Image.alpha_composite(img.convert("RGBA"), overlay)

def is_foreground(img, threshold=0.05):
    if img.mode != "RGBA":
        return False
    a = np.asarray(img)[..., 3]
    return (a < 128).mean() > threshold

def process(path, season, outdir, force=None, do_elements=True, seed=0):
    img = Image.open(path)
    name = os.path.basename(path)
    fg = (force == "foreground") or (force is None and is_foreground(img.convert("RGBA")))
    if fg:
        rgba = np.asarray(img.convert("RGBA")).astype(np.float32) / 255.0
        rgb = grade_foreground(rgba[..., :3], season)
        out = np.concatenate([rgb, rgba[..., 3:]], -1)
        result = Image.fromarray((out * 255).astype(np.uint8), "RGBA")
        kind = "foreground"
    else:
        rgb = np.asarray(img.convert("RGB")).astype(np.float32) / 255.0
        result = Image.fromarray((recolor_background(rgb, season) * 255).astype(np.uint8), "RGB")
        if do_elements:
            result = add_elements(result, season, random.Random(seed)).convert("RGB")
        kind = "background"
    os.makedirs(outdir, exist_ok=True)
    # always export WebP (lossless keeps alpha edges + recolor crisp, like the game assets)
    outname = os.path.splitext(name)[0] + ".webp"
    result.save(os.path.join(outdir, outname), "WEBP", lossless=True, quality=100, method=6)
    print(f"  {name:18} -> {outname} ({season}, {kind})")

def collect(inputs):
    files = []
    for p in inputs:
        if os.path.isdir(p):
            files += [os.path.join(p, f) for f in sorted(os.listdir(p))
                      if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))]
        else:
            files.append(p)
    return files

def main():
    ap = argparse.ArgumentParser(description="Apply a seasonal feel to game-art assets.")
    ap.add_argument("--season", required=True, choices=SEASONS)
    ap.add_argument("--input", required=True, nargs="+", help="image file(s) or a directory")
    ap.add_argument("--outdir", required=True, help="where to write restyled images")
    ap.add_argument("--backup", action="store_true", help="copy originals into <outdir>/originals/")
    ap.add_argument("--no-elements", action="store_true", help="recolor only; skip drifting elements")
    ap.add_argument("--as-foreground", action="store_true", help="force overlay grade on every file")
    ap.add_argument("--as-background", action="store_true", help="force full scene treatment on every file")
    ap.add_argument("--seed", type=int, default=7, help="RNG seed for element placement")
    args = ap.parse_args()
    force = "foreground" if args.as_foreground else "background" if args.as_background else None
    files = collect(args.input)
    if not files:
        sys.exit("No images found.")
    if args.backup:
        import shutil
        bdir = os.path.join(args.outdir, "originals"); os.makedirs(bdir, exist_ok=True)
        for f in files:
            shutil.copy2(f, os.path.join(bdir, os.path.basename(f)))
    print(f"Styling {len(files)} asset(s) -> {args.season}")
    for i, f in enumerate(files):
        process(f, args.season, args.outdir, force, not args.no_elements, args.seed + i * 7)
    print("Done.")

if __name__ == "__main__":
    main()
