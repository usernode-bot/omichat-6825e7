# Omichat brand assets

The mark is **two overlapping speech bubbles forming a friendly rounded "O"**:
a large ring-shaped bubble with its tail pointing down-left, and a smaller
bubble overlapping it at the top right. A gap separates them where they
overlap. Flat shapes only: circles and polygons, no gradients, shadows or text.

## Files

| File | Size | What |
| --- | --- | --- |
| `icon.svg` / `icon.png` | 1024 × 1024 | App icon (the home tile). Black ground, cream ring, yellow bubble. |
| `featured-light.svg` / `featured-light.png` | 1600 × 900 | Featured image, light. Cream ground, black ring, black-outlined accents. |
| `featured-dark.svg` / `featured-dark.png` | 1600 × 900 | Featured image, dark. Black ground, cream ring. |

The PNGs are the shipped files; the SVGs are their sources. `icon.png` is
declared in `dapp.json` as `icon.image` (with the 💬 emoji kept as fallback).
The featured images are for the Homeroom directory, which has no manifest
slot yet, so they are committed here only.

## Colours

Homeroom brand palette only:

- Cream `#FFFEEA` — the ring bubble (dark grounds) / the light ground
- Yellow `#FFEE6F` — the small bubble
- Blue `#3090E1`, Green `#A9CF97` — small accent bubbles on the featured images
- Black `#000000` — the dark ground / the ring bubble (light ground), and the
  separation gap

## Geometry (1024 grid)

- Ring bubble: circle `cx 460 cy 560 r 250`, stroke 96, no fill, plus a tail
  polygon `250,660 360,790 196,884`.
- Separation halo: circle `cx 700 cy 370 r 170` with an 80 stroke (plus the
  small bubble's tail stroked 40), drawn under the yellow bubble in the ground
  colour, so it cuts a clean gap through the ring where they overlap.
- Small bubble: circle `cx 700 cy 370 r 170` plus a tail polygon
  `790,470 880,620 700,540`, filled yellow.

The featured images reuse the same mark at 0.75 scale
(`translate(416 66) scale(0.75)`) and add a blue accent circle r 56 at
`(260, 240)` and a green one r 44 at `(1340, 660)`; on the light version the
accents get a 16px black outline.

## Rendering

`rsvg-convert` was not available in the build sandbox, so the PNGs were
rendered with headless Chromium (Playwright's, one screenshot per SVG at the
SVG's exact pixel size). To re-render after editing an SVG:

```sh
CHROME=~/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell
$CHROME --headless --disable-gpu --no-sandbox --force-device-scale-factor=1 \
  --window-size=1024,1024 --screenshot=brand/icon.png "file://$PWD/brand/icon.svg"
$CHROME --headless --disable-gpu --no-sandbox --force-device-scale-factor=1 \
  --window-size=1600,900 --screenshot=brand/featured-light.png "file://$PWD/brand/featured-light.svg"
$CHROME --headless --disable-gpu --no-sandbox --force-device-scale-factor=1 \
  --window-size=1600,900 --screenshot=brand/featured-dark.png "file://$PWD/brand/featured-dark.svg"
```

Keep every colour in the SVGs inside the palette above; the icon file itself
must stay a plain square (the home screen rounds the corners).
