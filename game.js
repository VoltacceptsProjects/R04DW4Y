(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // SETUP
  // ---------------------------------------------------------------------
  const WIDTH = 800,
    HEIGHT = 600;
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;

  const loadingEl = document.getElementById('loading');
  const cursorDot = document.getElementById('crosshair-cursor');

  const WHITE = [230, 230, 230];
  const BLACK = [23, 23, 23];
  const BLUE = [96, 30, 249];
  const RED = [241, 12, 69];
  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

  const PLAYER_COLOR = BLUE,
    ENEMY_COLOR = RED;
  const BG_COLOR = WHITE,
    TEXT_COLOR = BLACK;

  let sprites = {};

  // ---------------------------------------------------------------------
  // PERSISTANT STORAGE
  // ---------------------------------------------------------------------
  const Store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem('r04dw4y:' + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('r04dw4y:' + key, JSON.stringify(value)); } catch { /* ignore */ }
    }
  };

  let musicMuted = Store.get('music_muted', false);
  let backgroundIsGravel = Store.get('gravel_road', true);

  function saveSettings() {
    Store.set('music_muted', musicMuted);
    Store.set('gravel_road', backgroundIsGravel);
  }

  function loadHighscores() {
    const scores = Store.get('highscores', []);
    return scores.slice().sort((a, b) => b[1] - a[1]).slice(0, 3);
  }
  function saveHighscore(name, score) {
    const scores = loadHighscores();
    scores.push([name, score]);
    scores.sort((a, b) => b[1] - a[1]);
    Store.set('highscores', scores.slice(0, 3));
  }

  // ---------------------------------------------------------------------
  // ASSET LOADING HELPERS
  // ---------------------------------------------------------------------
  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => { console.warn('Missing image:', src);
        resolve(null); };
      img.src = src;
    });
  }

  async function loadFont(family, url) {
    try {
      const face = new FontFace(family, `url("${url}")`);
      await face.load();
      document.fonts.add(face);
      return family;
    } catch (e) {
      console.warn('Font failed to load, using fallback', e);
      return 'sans-serif';
    }
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function scaleToCanvas(img, w, h) {
    const c = makeCanvas(w, h);
    if (img) c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c;
  }

  function tintScaled(img, w, h, color) {
    const c = makeCanvas(w, h);
    if (!img) return c;
    const tctx = c.getContext('2d');
    tctx.drawImage(img, 0, 0, w, h);
    tctx.globalCompositeOperation = 'multiply';
    tctx.fillStyle = rgb(color);
    tctx.fillRect(0, 0, w, h);
    tctx.globalCompositeOperation = 'destination-in';
    tctx.drawImage(img, 0, 0, w, h);
    tctx.globalCompositeOperation = 'source-over';
    return c;
  }

  function scaleBackground(img) {
    if (!img) return null;
    const h = Math.round((img.height * WIDTH) / img.width);
    return scaleToCanvas(img, WIDTH, h);
  }

  // ---------------------------------------------------------------------
  // INPUT STATE
  // ---------------------------------------------------------------------
  const mouse = { x: WIDTH / 2, y: HEIGHT / 2, down: false };
  const keys = new Set();
  let clickQueue = [];
  let keyDownQueue = [];

  window.addEventListener('keydown', (e) => {
    keys.add(e.key);
    keyDownQueue.push(e.key);
    if (['ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key));

  function canvasPoint(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * WIDTH,
      y: ((e.clientY - r.top) / r.height) * HEIGHT,
    };
  }

  canvas.addEventListener('mousemove', (e) => {
    const p = canvasPoint(e);
    mouse.x = p.x;
    mouse.y = p.y;
    showCursor(mouse.x, mouse.y);
  });
  canvas.addEventListener('mousedown', (e) => {
    const p = canvasPoint(e);
    mouse.x = p.x;
    mouse.y = p.y;
    mouse.down = true;
    clickQueue.push({ x: p.x, y: p.y });
    showCursor(mouse.x, mouse.y);
  });
  canvas.addEventListener('mouseup', () => { mouse.down = false; });
  canvas.addEventListener('mouseleave', () => { cursorDot.classList.remove('active'); });

  function pointInRect(px, py, rect) {
    return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
  }
  function pointInCircle(px, py, cx, cy, r) {
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
  }

  // ---------------------------------------------------------------------
  // TIMING HELPERS
  // ---------------------------------------------------------------------
  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ===========================================================================
  // MAIN
  // ===========================================================================
  let FONT_FAMILY = 'sans-serif';
  let backgrounds = {};
  let music = null;
  let isGameRunning = false;
  let isPaused = false;
  let menuBackRequested = false;
  
  async function boot() {
    const [
      playerImg, enemyImg, settingsImg,
      buttonImg, buttonHoverImg, buttonPressedImg,
      toggleBgImg, toggleHandleImg,
      dirtImg, gravelImg,
      fontFamily
    ] = await Promise.all([
      loadImage('Data/Sprites/player.png'),
      loadImage('Data/Sprites/enemy.png'),
      loadImage('Data/Icons/settings.png'),
      loadImage('Data/UI/Button/button.png'),
      loadImage('Data/UI/Button/button_hover.png'),
      loadImage('Data/UI/Button/button_pressed.png'),
      loadImage('Data/UI/Toggle/Background.png'),
      loadImage('Data/UI/Toggle/Handle.png'),
      loadImage('Data/Backgrounds/dirt_road.png'),
      loadImage('Data/Backgrounds/gravel_road.png'),
      loadFont('GameFont', 'Data/Fonts/default.ttf'),
    ]);
    FONT_FAMILY = fontFamily;

    const SPRITE_W = 50,
      SPRITE_H = 104;
    sprites.player = tintScaled(playerImg, SPRITE_W, SPRITE_H, PLAYER_COLOR);
    sprites.enemy = tintScaled(enemyImg, SPRITE_W, SPRITE_H, ENEMY_COLOR);
    sprites.settingsIcon = scaleToCanvas(settingsImg, 32, 32);

    const BTN_W = 242,
      BTN_H = 48;
    const SBTN_W = 100,
      SBTN_H = 36;
    const WARN_TINT = [200, 50, 50];
    sprites.button = {
      normal: scaleToCanvas(buttonImg, BTN_W, BTN_H),
      hover: scaleToCanvas(buttonHoverImg, BTN_W, BTN_H),
      pressed: scaleToCanvas(buttonPressedImg, BTN_W, BTN_H),
    };
    sprites.smallButton = {
      normal: scaleToCanvas(buttonImg, SBTN_W, SBTN_H),
      hover: scaleToCanvas(buttonHoverImg, SBTN_W, SBTN_H),
      pressed: scaleToCanvas(buttonPressedImg, SBTN_W, SBTN_H),
    };
    sprites.warnButton = {
      normal: tintScaled(buttonImg, BTN_W, BTN_H, WARN_TINT),
      hover: tintScaled(buttonHoverImg, BTN_W, BTN_H, WARN_TINT),
      pressed: tintScaled(buttonPressedImg, BTN_W, BTN_H, WARN_TINT),
    };

    const TOGGLE_W = 64,
      TOGGLE_H = 32,
      HANDLE_S = 32;
    sprites.toggleBgOn = tintScaled(toggleBgImg, TOGGLE_W, TOGGLE_H, [100, 200, 100]);
    sprites.toggleBgOff = tintScaled(toggleBgImg, TOGGLE_W, TOGGLE_H, [200, 100, 100]);
    sprites.toggleHandle = scaleToCanvas(toggleHandleImg, HANDLE_S, HANDLE_S);

    backgrounds.gravel = scaleBackground(gravelImg);
    backgrounds.dirt = scaleBackground(dirtImg);

    // set crosshair cursor sprite
    cursorDot.src = 'Data/UI/crosshair.png';

    music = new Audio('Data/Soundtracks/menu.ogg');
    music.loop = true;
    music.volume = 0.6;

    loadingEl.remove();

    await gameLoopForever();
  }

  function getBackgroundImage() {
    return backgroundIsGravel ? backgrounds.gravel : backgrounds.dirt;
  }

  function playMusic() {
    if (musicMuted) { music.pause(); return; }
    music.play().catch(() => { /* blocked until a user gesture */ });
  }
  function pauseMusic() { music.pause(); }

  let audioUnlockAttempted = false;
  function unlockAudioOnce() {
    if (audioUnlockAttempted) return;
    audioUnlockAttempted = true;
    if (music && !musicMuted && music.paused) music.play().catch(() => {});
  }
  window.addEventListener('pointerdown', unlockAudioOnce, { once: true });
  window.addEventListener('keydown', unlockAudioOnce, { once: true });

  // ---------------------------------------------------------------------
  // DRAWING HELPERS
  // ---------------------------------------------------------------------
  function clear(color) {
    ctx.fillStyle = rgb(color);
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
  function text(str, size, color, x, y, align = 'center') {
    ctx.fillStyle = typeof color === 'string' ? color : rgb(color);
    ctx.font = `${size}px "${FONT_FAMILY}"`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  }
  function overlay(alpha) {
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
  function panel(x, y, w, h) {
    ctx.fillStyle = rgb(BG_COLOR);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = rgb(TEXT_COLOR);
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
  }

  function drawButton(sprite, cx, cy, w, h, label, fontSize, textColor) {
    const rect = { x: cx - w / 2, y: cy - h / 2, w, h };
    const hovered = pointInRect(mouse.x, mouse.y, rect);
    const img = hovered ? sprite.hover : sprite.normal;
    ctx.drawImage(img, rect.x, rect.y, w, h);
    text(label, fontSize, textColor, cx, cy + 2);
    return { rect, hovered };
  }

  function wasClicked(rect, frameClicks) {
    for (const p of frameClicks) {
      if (pointInRect(p.x, p.y, rect)) return true;
    }
    return false;
  }

  function drawToggle(cx, cy, state, label) {
    text(label, 36, TEXT_COLOR, cx - 200, cy + 2, 'left');
    const rect = { x: cx, y: cy - 16, w: 64, h: 32 };
    ctx.drawImage(state ? sprites.toggleBgOn : sprites.toggleBgOff, rect.x, rect.y, 64, 32);
    const handleX = state ? cx + 50 : cx + 10;
    // Only the handle itself is clickable/tappable, not the whole track.
    const handleRect = { x: handleX - 16, y: cy - 16, w: 32, h: 32 };
    ctx.drawImage(sprites.toggleHandle, handleRect.x, handleRect.y, 32, 32);
    return handleRect;
  }

  // ===========================================================================
  // SCREENS
  // ===========================================================================

  async function mainMenu() {
    // Force a full clean canvas and reset any lingering overlay
    clear(BG_COLOR);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    let settingsOpen = false;
    let showHighscores = false;
    let resetConfirmOpen = false;
    isGameRunning = false;
    playMusic();

    while (true) {
      await nextFrame();
      const frameClicks = consumeClicks();

      if (menuBackRequested) {
        if (settingsOpen) {
          settingsOpen = false;
          saveSettings();
        } else if (showHighscores) {
          showHighscores = false;
        }
        menuBackRequested = false;
      }

      clear(BG_COLOR);
      text('R04DW4Y', 72, TEXT_COLOR, WIDTH / 2, 150);

      ctx.drawImage(sprites.player, 350 - 25, 250 - 52, 50, 104);
      ctx.drawImage(sprites.enemy, 430, 225, 50, 104);

      let startClicked = false,
        highscoresClicked = false,
        quitClicked = false;

      if (!settingsOpen && !showHighscores) {
        const start = drawButton(sprites.button, 400, 455, 242, 48, 'Start', 36, TEXT_COLOR);
        const hs = drawButton(sprites.button, 400, 510, 242, 48, 'Highscores', 36, TEXT_COLOR);
        const quit = drawButton(sprites.button, 400, 565, 242, 48, 'Quit', 36, TEXT_COLOR);
        startClicked = wasClicked(start.rect, frameClicks);
        highscoresClicked = wasClicked(hs.rect, frameClicks);
        quitClicked = wasClicked(quit.rect, frameClicks);
      }

      ctx.drawImage(sprites.settingsIcon, 750 - 16, 50 - 16, 32, 32);
      const gearClicked = frameClicks.some(p => pointInCircle(p.x, p.y, 750, 50, 20));
      if (gearClicked && !showHighscores) settingsOpen = true;

      if (settingsOpen) {
        const result = drawSettingsOverlay(frameClicks, resetConfirmOpen);
        if (result.closed) { settingsOpen = false;
          saveSettings(); }
        resetConfirmOpen = result.resetConfirmOpen;
      } else if (showHighscores) {
        const closed = drawHighscoreOverlay(frameClicks);
        if (closed) showHighscores = false;
      }

      if (startClicked) return true;
      if (highscoresClicked) showHighscores = true;
      if (quitClicked) { await showQuitMessage(); }
    }
  }

  function consumeClicks() {
    const c = clickQueue;
    clickQueue = [];
    return c;
  }

  function drawSettingsOverlay(frameClicks, resetConfirmOpen) {
    overlay(0.5);
    panel(200, 130, 400, 300);
    text('Settings', 48, TEXT_COLOR, 400, 180);

    const musicRect = drawToggle(450, 230, !musicMuted, 'Music');
    const roadLabel = backgroundIsGravel ? 'Gravel Road' : 'Dirt Road';
    const roadRect = drawToggle(450, 280, backgroundIsGravel, roadLabel);

    const resetBtn = drawButton(sprites.warnButton, 400, 335, 242, 48, 'Reset Score', 36, TEXT_COLOR);
    const closeBtn = drawButton(sprites.button, 400, 390, 242, 48, 'Close', 36, TEXT_COLOR);

    if (wasClicked(musicRect, frameClicks)) {
      musicMuted = !musicMuted;
      if (musicMuted) pauseMusic();
      else playMusic();
    }
    if (wasClicked(roadRect, frameClicks)) backgroundIsGravel = !backgroundIsGravel;
    if (wasClicked(resetBtn.rect, frameClicks)) resetConfirmOpen = true;

    let closed = false;
    if (resetConfirmOpen) {
      panel(250, 250, 300, 120);
      text('Reset Scores?', 28, rgb(RED), 400, 290);
      const yesBtn = drawButton(sprites.smallButton, 340, 350, 100, 36, 'Yes', 28, [0, 200, 0]);
      const noBtn = drawButton(sprites.smallButton, 460, 350, 100, 36, 'No', 28, [200, 0, 0]);
      if (wasClicked(yesBtn.rect, frameClicks)) {
        Store.set('highscores', []);
        resetConfirmOpen = false;
      }
      if (wasClicked(noBtn.rect, frameClicks)) resetConfirmOpen = false;
    } else if (wasClicked(closeBtn.rect, frameClicks)) {
      closed = true;
    }

    return { closed, resetConfirmOpen };
  }

  function drawHighscoreOverlay(frameClicks) {
    overlay(0.5);
    panel(200, 150, 400, 300);
    text('Highscores', 48, TEXT_COLOR, 400, 200);

    const highscores = loadHighscores();
    highscores.forEach(([name, score], idx) => {
      const display = name.replace(/-/g, '  ');
      text(`${display}   ${score}`, 36, TEXT_COLOR, 400, 250 + idx * 40);
    });

    const closeBtn = drawButton(sprites.button, 400, 400, 242, 48, 'Close', 36, TEXT_COLOR);
    return wasClicked(closeBtn.rect, frameClicks);
  }

  async function showQuitMessage() {
    const start = performance.now();
    while (performance.now() - start < 1600) {
      await nextFrame();
      consumeClicks();
      clear(BG_COLOR);
      text('Thanks for playing!', 48, TEXT_COLOR, WIDTH / 2, HEIGHT / 2 - 20);
      text('You can close this tab now.', 28, TEXT_COLOR, WIDTH / 2, HEIGHT / 2 + 30);
    }
  }

  // ===========================================================================
  // NAME ENTRY
  // ===========================================================================
  async function getPlayerName() {
    let name = '';
    keyDownQueue = [];
    while (true) {
      await nextFrame();
      for (const k of keyDownQueue) {
        if (k === 'Backspace' && name.length > 0) name = name.slice(0, -1);
        else if (k === 'Enter' && name.length > 0 && name.length <= 5) {
          keyDownQueue = [];
          return name.padEnd(5, '-');
        } else if (/^[a-zA-Z]$/.test(k) && name.length < 5) {
          name += k.toUpperCase();
        }
      }
      keyDownQueue = [];

      clear(BG_COLOR);
      text('Enter Your Name', 48, TEXT_COLOR, 400, 200);
      text(name + '_'.repeat(5 - name.length), 48, TEXT_COLOR, 400, 300);
      text('A-Z, Backspace, Enter', 32, TEXT_COLOR, 400, 400);
    }
  }

  async function deathScreen(score) {
    clear(BG_COLOR);
    text('GAME OVER', 72, rgb(RED), WIDTH / 2, HEIGHT / 2 - 50);
    text(`Final Score: ${score}`, 48, TEXT_COLOR, WIDTH / 2, HEIGHT / 2 + 20);
    await sleep(500);
    const name = await getPlayerName();
    saveHighscore(name, score);
  }

  // ===========================================================================
  // GAMEPLAY
  // ===========================================================================
  const STEP_MS = 1000 / 30;

  async function runGame() {
    isGameRunning = true;
    let playerPos = [375, 500];
    const playerRadius = 25,
      playerSpeed = 10;
    let objectPos = [randInt(0, 750), 0];
    let objectSpeed = 10;
    const speedIncrease = 0.05;
    let score = 0;
    let ended = false;
    isPaused = false;

    pauseMusic();

    let bgScroll = 0;
    let bgImage = getBackgroundImage();
    let bgHeight = bgImage ? bgImage.height : 600;

    let brightness = 255;
    let daynightState = 'darken';
    let daynightStep = 0;
    let daynightPause = 0;

    let cleanupDone = false; // flag to ensure clean exit

    function reset() {
      playerPos = [375, 500];
      objectPos = [randInt(0, 750), 0];
      objectSpeed = 10;
      score = 0;
      ended = false;
      bgScroll = 0;
      bgImage = getBackgroundImage();
      bgHeight = bgImage ? bgImage.height : 600;
      brightness = 255;
      daynightState = 'darken';
      daynightStep = 0;
      daynightPause = 0;
    }

    let acc = 0;
    let last = performance.now();
    keyDownQueue = [];

    while (true) {
      await nextFrame();
      const now = performance.now();
      // Only advance the simulation clock while unpaused, so time spent
      // in the pause menu doesn't pile up and get replayed all at once
      // (as a sudden jump/burst) the moment the game resumes.
      if (!isPaused) acc += now - last;
      last = now;

      for (const k of keyDownQueue) {
        if (k === 'Escape') {
          isPaused = !isPaused;
          if (isPaused) pauseMusic();
          else playMusic();
        }
      }
      keyDownQueue = [];
      const frameClicks = consumeClicks();

      bgImage = getBackgroundImage();
      bgHeight = bgImage ? bgImage.height : 600;

      if (isPaused) {
        drawGameFrame({ bgImage, bgScroll, bgHeight, playerPos, playerRadius, objectPos, score, brightness: 255 });
        overlay(0.63);
        panel(200, 150, 400, 300);
        text('Paused', 56, TEXT_COLOR, 400, 210);

        const resumeBtn = drawButton(sprites.button, 400, 280, 242, 48, 'Resume', 36, TEXT_COLOR);
        const restartBtn = drawButton(sprites.button, 400, 340, 242, 48, 'Restart', 36, TEXT_COLOR);
        const quitBtn = drawButton(sprites.button, 400, 400, 242, 48, 'Quit to Menu', 36, TEXT_COLOR);

        if (wasClicked(resumeBtn.rect, frameClicks)) { isPaused = false;
          playMusic(); }
        if (wasClicked(restartBtn.rect, frameClicks)) { reset();
          isPaused = false;
          playMusic(); }
        if (wasClicked(quitBtn.rect, frameClicks)) {
          // Force clean exit: clear canvas and reset state
          cleanupDone = true;
          isPaused = false;
          clear(BG_COLOR);
          ctx.clearRect(0, 0, WIDTH, HEIGHT);
          pauseMusic();
          playMusic();
          return;
        }
        continue;
      }

      while (acc >= STEP_MS) {
        acc -= STEP_MS;

        if (keys.has('ArrowLeft') && playerPos[0] > playerRadius) playerPos[0] -= playerSpeed;
        if (keys.has('ArrowRight') && playerPos[0] < 750 - playerRadius) playerPos[0] += playerSpeed;

        objectPos[1] += objectSpeed;

        if (backgroundIsGravel) {
          if (score % 5 === 0 && score !== 0) objectSpeed += speedIncrease;
        } else {
          if (score % 10 === 0 && score !== 0) objectSpeed += speedIncrease;
        }

        const bgSpeed = objectSpeed + 5;
        bgScroll = (bgScroll + bgSpeed) % bgHeight;

        if (objectPos[1] > 600) {
          objectPos = [randInt(0, 750), 0];
          score += 1;

          if (daynightState === 'darken') {
            brightness = Math.max(95, brightness - 8);
            daynightStep += 1;
            if (daynightStep >= 20) { daynightState = 'pause_dark';
              daynightPause = 0; }
          } else if (daynightState === 'pause_dark') {
            daynightPause += 1;
            if (daynightPause >= 5) { daynightState = 'lighten';
              daynightStep = 0; }
          } else if (daynightState === 'lighten') {
            brightness = Math.min(255, brightness + 8);
            daynightStep += 1;
            if (daynightStep >= 20) { daynightState = 'pause_light';
              daynightPause = 0; }
          } else if (daynightState === 'pause_light') {
            daynightPause += 1;
            if (daynightPause >= 5) { daynightState = 'darken';
              daynightStep = 0; }
          }
        }

        const rectL = objectPos[0],
          rectT = objectPos[1],
          rectR = objectPos[0] + 50,
          rectB = objectPos[1] + 104;
        const closestX = Math.max(rectL, Math.min(playerPos[0], rectR));
        const closestY = Math.max(rectT, Math.min(playerPos[1], rectB));
        const dist = Math.hypot(playerPos[0] - closestX, playerPos[1] - closestY);
        if (dist < playerRadius) ended = true;
      }

      drawGameFrame({ bgImage, bgScroll, bgHeight, playerPos, playerRadius, objectPos, score, brightness });

      if (ended) {
        pauseMusic();
        await deathScreen(score);
        return;
      }
    }
  }

  function drawGameFrame({ bgImage, bgScroll, bgHeight, playerPos, playerRadius, objectPos, score, brightness }) {
    if (bgImage) {
      ctx.drawImage(bgImage, 0, bgScroll - bgHeight);
      ctx.drawImage(bgImage, 0, bgScroll);
    } else {
      clear(BG_COLOR);
    }

    ctx.drawImage(sprites.player, playerPos[0] - 25, playerPos[1] - 52, 50, 104);
    ctx.drawImage(sprites.enemy, objectPos[0], objectPos[1], 50, 104);

    text(`Score: ${score}`, 36, TEXT_COLOR, 10, 28, 'left');
    text('ESC: Menu', 24, TEXT_COLOR, 10, 62, 'left');

    if (brightness < 255) overlay((255 - brightness) / 255);
  }

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }


  function showCursor(cx, cy) {
    cursorDot.style.left = (cx / WIDTH * 100) + '%';
    cursorDot.style.top = (cy / HEIGHT * 100) + '%';
    cursorDot.classList.add('active');
  }

  // ===========================================================================
  // LOOP FOREVER
  // ===========================================================================
  async function gameLoopForever() {
    while (true) {
      const started = await mainMenu();
      if (started) await runGame();
    }
  }

  boot();
})();