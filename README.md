# R04DW4Y

A dodging/survival game where you steer a car down an endless road, weaving
around oncoming traffic that comes at you faster and faster the longer you
survive. Full sprite art, a main menu, settings, pause screen, and
highscores round out the experience.

## History

This project traces back to **Circles vs Squares**, a Python + Pygame game
I built as a school project back in middle school. It had nothing beyond
the bare essentials — no music, no sprites, no menus, not even a title
screen. You just opened it and you were already playing: a blue circle
(you) dodging red squares coming right at you.

In high school I came back to it and built **R04DW4Y** on top of the
Circles vs Squares code, this time with everything the original didn't
have: music, real sprites, a main menu, settings, a pause screen,
highscores — still Python/Pygame underneath. Then I ported that Pygame
version into the browser using PyScript/Pyodide (a full CPython interpreter
compiled to WebAssembly), so people could play it without installing
Python. That worked, but it was heavy — megabytes of interpreter to
download and boot before the game even started, and every bit of Python
running through an interpretation layer instead of native code.

Eventually I rewrote it again, this time as plain JavaScript + HTML5
Canvas2D — no Python, no Pyodide, no WASM runtime, just the browser's
native canvas. That's the version in this repo today. Same game at its
core — circle, road, squares, survive — just faster and lighter with every
pass.

## Why the JS rewrite is faster

The original ran Pygame **inside a full CPython interpreter compiled to
WebAssembly (Pyodide)**, loaded fresh in every visitor's browser. That's the
single biggest cost: megabytes of interpreter to download and boot, and
every Python bytecode op (including simple things like `x[0] -= 5`) running
through an interpretation layer instead of native code — before it even gets
to drawing anything.

On top of that, the original redid expensive work every frame:
- `pygame.transform.scale()` and the color-tint blit for the player/enemy
  sprites ran up to twice a frame, every frame, at 30–60fps.
- `pygame.font.Font(FONT_PATH, size)` was re-constructed from the font file
  on almost every frame (menus, HUD, pause screen) instead of once.
- Semi-transparent overlays allocated a brand new `pygame.Surface` every
  single frame.
- Menus polled mouse position/button state every frame and redrew widgets
  multiple times per frame to work out hover/pressed state.

This rewrite fixes all of that:
- **No interpreter** — this is the language the browser already runs natively.
- **Sprites are tinted and scaled once**, at load time, into cached offscreen
  canvases (`game.js` → the `tintScaled`/`scaleToCanvas` calls in `boot()`).
  Drawing them each frame is just `ctx.drawImage()`.
- **Fonts are loaded once** via the `FontFace` API; every `ctx.font = ...`
  afterwards is just a string, not an allocation.
- Overlays are `ctx.fillRect()` calls with alpha — no surface allocation.
- Input is **event-driven** (`mousemove`/`click`/`keydown` listeners) instead
  of polled and re-derived every frame.
- Gameplay runs on a **fixed 30Hz timestep decoupled from rendering**, so it
  behaves the same on a 60Hz or 144Hz screen instead of speeding up/slowing
  down with the display's refresh rate.

Net effect: instead of "Python game logic + Pygame draw calls, both running
inside a WASM Python VM," it's now "JS game logic + native canvas draw
calls" — there's no interpreter layer left to pay for.

## Feature parity

Everything from the grown-up Pygame/PyScript version is here: main menu,
settings (music mute, road type toggle, reset scores with confirm),
highscores (top 3), pause menu (resume/restart/quit), day/night brightness
cycle, scrolling background, speed ramp-up, 5-letter name entry on death.

One deliberate behavior change: **Quit** can't force-close a browser tab the
way `sys.exit()` could, so it now shows a "you can close this tab" message
instead of silently doing nothing.

## Files

- `index.html` — page shell + canvas element
- `game.js` — the entire game (asset loading, menus, gameplay, rendering)
- `Data/` — the original sprites, backgrounds, font, and music track
  (unused assets from the original repo — the small-button variants, the
  snowy-weather background, and the old save/settings files — were dropped
  since nothing in the game logic ever referenced them)

Saves (settings + highscores) now live in the browser's `localStorage`
instead of an IndexedDB-backed PyScript store / `.ini` / pickle file.