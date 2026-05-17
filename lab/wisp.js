/* lab/wisp.js — Wisp (Drop 02)
   Draw with glowing light by pinching in the air.
     thumb + index pinch   → a wisp of light (glows, then fades)
     thumb + middle pinch  → ink (sticks on the screen)
     open palm, held       → erase
   Sweep your trail through the drifting motes of light to collect them.
   Webcam + MediaPipe hand tracking; camera-optional with a demo loop.
   The webcam frame is read on-device and never leaves it. */

const MP_VER = '0.10.14';
const MP_ESM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`;
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/wasm`;
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const STORE = 'lab.wisp.v1';
const MOTE_MAX = 7;
const MOTE_SPAWN = 2.6;     /* seconds between spawns */
const ERASE_HOLD = 0.55;    /* seconds of open palm to clear */

export function launchWisp(stage, opts = {}) {
  const isSoundOn = () => !!(opts.isSoundOn && opts.isSoundOn());

  /* ── DOM ─────────────────────────────────── */
  const video = el('video', 'wisp-video');
  video.playsInline = true; video.muted = true;
  const inkCanvas = el('canvas', 'wisp-ink');     /* permanent ink */
  const trailCanvas = el('canvas', 'wisp-trail'); /* fading wisp light */
  const fxCanvas = el('canvas', 'wisp-fx');       /* motes, cursor, bursts */
  stage.append(video, inkCanvas, trailCanvas, fxCanvas);
  const inkCtx = inkCanvas.getContext('2d');
  const trailCtx = trailCanvas.getContext('2d');
  const fxCtx = fxCanvas.getContext('2d');

  const score = el('div', 'wisp-score');
  stage.appendChild(score);

  const readout = el('div', 'wisp-readout');
  readout.innerHTML =
    '<div class="wisp-hint">starting…</div>'
    + '<div class="wisp-legend">'
    + '<span>pinch index — light</span><span>pinch middle — ink</span><span>open palm — erase</span>'
    + '</div>';
  stage.appendChild(readout);
  const hintEl = readout.querySelector('.wisp-hint');

  const cta = el('div', 'wisp-cta');
  cta.hidden = true;
  cta.innerHTML =
    '<p class="wisp-cta-line">This one draws with your hands.</p>'
    + '<p class="wisp-cta-sub">Wisp needs your camera to see you pinch and draw. '
    + 'The video is read on your device and never leaves it — nothing is recorded or uploaded. '
    + 'Meanwhile, here is a glimpse of what it does.</p>'
    + '<button class="wisp-cta-btn" type="button">Enable camera &amp; play →</button>';
  stage.appendChild(cta);

  function el(tag, cls) { const e = document.createElement(tag); e.className = cls; return e; }

  /* ── sizing ──────────────────────────────── */
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = 1, H = 1;
  function resize() {
    W = stage.clientWidth || 1;
    H = stage.clientHeight || 1;
    for (const c of [inkCanvas, trailCanvas, fxCanvas]) {
      c.width = W * dpr; c.height = H * dpr;
      c.style.width = W + 'px'; c.style.height = H + 'px';
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }
  resize();
  window.addEventListener('resize', resize);

  /* ── state ───────────────────────────────── */
  let mode = 'init';            /* 'init' | 'tracking' | 'demo' */
  let stream = null, landmarker = null, raf = 0, lastVideoTime = -1;
  const pen = { x: W / 2, y: H / 2, has: false, draw: false, tool: 'wisp', palm: false };
  let trail = [];               /* fading wisp: {x,y,age} */
  let inkLast = null;           /* permanent-ink continuity */
  let eraseHold = 0;
  let motes = [];
  let pops = [];                /* collect bursts: {x,y,age} */
  let spawnTimer = 0;
  let store = load();
  let combo = 0, lastCollect = -9;
  const coarse = window.matchMedia('(pointer:coarse)').matches;

  function load() { try { return JSON.parse(localStorage.getItem(STORE)) || { motes: 0 }; } catch { return { motes: 0 }; } }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(store)); } catch { /* private mode */ } }
  function renderScore() { score.innerHTML = '✦ <b>' + store.motes + '</b> motes'; }
  renderScore();

  /* ── audio ───────────────────────────────── */
  let actx = null, drawOsc = null, drawGain = null;
  function ensureAudio() {
    if (actx || !isSoundOn()) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      drawOsc = actx.createOscillator(); drawOsc.type = 'sine'; drawOsc.frequency.value = 240;
      const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100;
      drawGain = actx.createGain(); drawGain.gain.value = 0;
      drawOsc.connect(lp); lp.connect(drawGain); drawGain.connect(actx.destination);
      drawOsc.start();
    } catch { actx = null; }
  }
  function updateTone() {
    ensureAudio();
    if (!actx) return;
    if (actx.state === 'suspended') actx.resume();
    const t = actx.currentTime;
    const on = isSoundOn() && pen.has && pen.draw;
    if (on) {
      drawOsc.frequency.setTargetAtTime(190 + (1 - pen.y / H) * 320, t, 0.05);
      drawGain.gain.setTargetAtTime(pen.tool === 'ink' ? 0.05 : 0.035, t, 0.04);
    } else {
      drawGain.gain.setTargetAtTime(0, t, 0.07);
    }
  }
  function ding() {
    if (!isSoundOn()) { ensureAudio(); }
    if (!actx || !isSoundOn()) return;
    const t = actx.currentTime;
    const o = actx.createOscillator(); o.type = 'triangle';
    const base = 540 + Math.min(combo, 7) * 64;
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * 1.5, t + 0.11);
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.15, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g); g.connect(actx.destination);
    o.start(t); o.stop(t + 0.34);
  }

  /* ── camera + hand tracking ──────────────── */
  async function startCamera() {
    hintEl.textContent = 'asking for the camera…';
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      video.srcObject = stream;
      await video.play();
      hintEl.textContent = 'loading hand tracking…';
      const { HandLandmarker, FilesetResolver } = await import(MP_ESM);
      const fileset = await FilesetResolver.forVisionTasks(MP_WASM);
      landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MP_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO', numHands: 1,
      });
      cta.hidden = true;
      mode = 'tracking';
      hintEl.textContent = 'pinch to draw';
    } catch {
      mode = 'demo';
      cta.hidden = false;
      hintEl.textContent = coarse ? 'demo — Wisp is best on a desktop webcam' : 'demo — camera off';
    }
  }
  cta.querySelector('.wisp-cta-btn').addEventListener('click', () => { cta.hidden = true; startCamera(); });

  const D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function trackHand() {
    if (!landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    let res;
    try { res = landmarker.detectForVideo(video, performance.now()); } catch { return; }
    const hands = res && res.landmarks;
    if (!hands || !hands.length) { pen.has = false; pen.draw = false; pen.palm = false; return; }
    const lm = hands[0];
    const wrist = lm[0], thumb = lm[4], index = lm[8], middle = lm[12];
    pen.has = true;
    const pinchI = D(thumb, index) < 0.06;
    const pinchM = D(thumb, middle) < 0.07;
    const ext = (tip, pip) => D(lm[tip], wrist) > D(lm[pip], wrist) * 1.1;
    const openPalm = !pinchI && !pinchM
      && ext(8, 6) && ext(12, 10) && ext(16, 14) && ext(20, 18);
    pen.palm = openPalm;
    if (pinchI && (!pinchM || D(thumb, index) <= D(thumb, middle))) {
      pen.draw = true; pen.tool = 'wisp';
      pen.x = (1 - (thumb.x + index.x) / 2) * W; pen.y = (thumb.y + index.y) / 2 * H;
    } else if (pinchM) {
      pen.draw = true; pen.tool = 'ink';
      pen.x = (1 - (thumb.x + middle.x) / 2) * W; pen.y = (thumb.y + middle.y) / 2 * H;
    } else {
      pen.draw = false;
      const aim = openPalm ? lm[9] : index;
      pen.x = (1 - aim.x) * W; pen.y = aim.y * H;
    }
  }

  /* ── demo loop (camera declined) ─────────── */
  let demoT = 0;
  function demoDrive(dt) {
    demoT += dt;
    pen.has = true;
    pen.x = W * 0.5 + Math.sin(demoT * 0.74) * W * 0.27 + Math.sin(demoT * 2.1) * W * 0.05;
    pen.y = H * 0.5 + Math.cos(demoT * 0.93) * H * 0.25 + Math.cos(demoT * 2.5) * H * 0.05;
    const ph = Math.floor(demoT / 8) % 3;
    pen.palm = false;
    if (ph === 2 && (demoT % 8) < 0.7) { pen.palm = true; pen.draw = false; }
    else { pen.draw = Math.sin(demoT * 0.6) > -0.45; pen.tool = ph === 1 ? 'ink' : 'wisp'; }
  }

  /* ── motes ───────────────────────────────── */
  function spawnMote() {
    motes.push({
      x: W * (0.12 + Math.random() * 0.76),
      y: H * (0.16 + Math.random() * 0.68),
      vx: (Math.random() - 0.5) * 26,
      vy: (Math.random() - 0.5) * 26,
      phase: Math.random() * 6.28,
    });
  }
  function updateMotes(dt) {
    spawnTimer += dt;
    if (spawnTimer > MOTE_SPAWN && motes.length < MOTE_MAX) { spawnTimer = 0; spawnMote(); }
    for (const m of motes) {
      m.x += m.vx * dt; m.y += m.vy * dt; m.phase += dt * 2.4;
      if (m.x < 40 || m.x > W - 40) m.vx *= -1;
      if (m.y < 60 || m.y > H - 60) m.vy *= -1;
      m.x = Math.max(40, Math.min(W - 40, m.x));
      m.y = Math.max(60, Math.min(H - 60, m.y));
    }
    if (pen.has && pen.draw) {
      for (let i = motes.length - 1; i >= 0; i--) {
        if (D(pen, motes[i]) < 30) {
          const m = motes.splice(i, 1)[0];
          pops.push({ x: m.x, y: m.y, age: 0 });
          combo = (perfNow() - lastCollect < 1.3) ? combo + 1 : 1;
          lastCollect = perfNow();
          ding();
          if (mode === 'tracking') { store.motes += 1; save(); renderScore(); }
        }
      }
    }
    for (const p of pops) p.age += dt;
    pops = pops.filter((p) => p.age < 0.55);
  }
  const perfNow = () => performance.now() / 1000;

  /* ── erase ───────────────────────────────── */
  function handleErase(dt) {
    if (pen.has && pen.palm) {
      eraseHold += dt;
      if (eraseHold >= ERASE_HOLD) {
        inkCtx.clearRect(0, 0, W, H);
        trailCtx.clearRect(0, 0, W, H);
        trail = []; inkLast = null; eraseHold = 0;
      }
    } else {
      eraseHold = Math.max(0, eraseHold - dt * 2.5);
    }
  }

  /* ── render ──────────────────────────────── */
  function render(dt) {
    /* permanent ink — draw new segments straight onto the ink layer */
    if (pen.has && pen.draw && pen.tool === 'ink') {
      if (inkLast) {
        inkCtx.globalCompositeOperation = 'lighter';
        inkCtx.lineCap = 'round'; inkCtx.lineJoin = 'round';
        stroke(inkCtx, [inkLast, pen], '#ffd23d', '#fffdf0', 26, 3.4);
      }
      inkLast = { x: pen.x, y: pen.y };
    } else {
      inkLast = null;
    }

    /* fading wisp light */
    trailCtx.globalCompositeOperation = 'destination-out';
    trailCtx.fillStyle = 'rgba(0,0,0,0.085)';
    trailCtx.shadowBlur = 0;
    trailCtx.fillRect(0, 0, W, H);
    if (pen.has && pen.draw && pen.tool === 'wisp') trail.push({ x: pen.x, y: pen.y, age: 0 });
    for (const p of trail) p.age += dt;
    trail = trail.filter((p) => p.age < 1.3);
    if (trail.length > 240) trail.splice(0, trail.length - 240);
    if (trail.length > 1) {
      trailCtx.globalCompositeOperation = 'lighter';
      trailCtx.lineCap = 'round'; trailCtx.lineJoin = 'round';
      stroke(trailCtx, trail, '#ffe500', '#fff7d6', 22, 3.6);
    }

    /* fx layer — cleared and redrawn every frame */
    fxCtx.clearRect(0, 0, W, H);
    fxCtx.globalCompositeOperation = 'lighter';
    for (const m of motes) {
      const r = 6 + Math.sin(m.phase) * 1.6;
      fxCtx.beginPath();
      fxCtx.arc(m.x, m.y, r, 0, 6.2832);
      fxCtx.fillStyle = '#ffe500';
      fxCtx.shadowBlur = 16; fxCtx.shadowColor = '#ffe500';
      fxCtx.fill();
    }
    for (const p of pops) {
      const t = p.age / 0.55;
      fxCtx.beginPath();
      fxCtx.arc(p.x, p.y, 8 + t * 46, 0, 6.2832);
      fxCtx.strokeStyle = '#fff7d6';
      fxCtx.globalAlpha = 1 - t;
      fxCtx.lineWidth = 3 * (1 - t);
      fxCtx.shadowBlur = 14; fxCtx.shadowColor = '#ffe500';
      fxCtx.stroke();
      fxCtx.globalAlpha = 1;
    }
    if (pen.has) {
      fxCtx.beginPath();
      fxCtx.arc(pen.x, pen.y, pen.draw ? 9 : 6, 0, 6.2832);
      fxCtx.fillStyle = pen.draw ? '#fffdf0' : 'rgba(255,229,0,0.5)';
      fxCtx.shadowBlur = pen.draw ? 22 : 8; fxCtx.shadowColor = '#ffe500';
      fxCtx.fill();
    }
    if (eraseHold > 0.02 && pen.has) {
      const t = Math.min(1, eraseHold / ERASE_HOLD);
      fxCtx.beginPath();
      fxCtx.arc(pen.x, pen.y, 26, -1.5708, -1.5708 + t * 6.2832);
      fxCtx.strokeStyle = '#ffe500';
      fxCtx.lineWidth = 3; fxCtx.shadowBlur = 10; fxCtx.shadowColor = '#ffe500';
      fxCtx.stroke();
    }
    fxCtx.shadowBlur = 0;
    fxCtx.globalCompositeOperation = 'source-over';
  }

  /* draw a polyline twice — a soft wide glow pass, then a bright core */
  function stroke(c, pts, outer, inner, glow, core) {
    for (let pass = 0; pass < 2; pass++) {
      c.beginPath();
      for (let i = 0; i < pts.length; i++) {
        if (i === 0) c.moveTo(pts[i].x, pts[i].y); else c.lineTo(pts[i].x, pts[i].y);
      }
      c.strokeStyle = pass === 0 ? outer : inner;
      c.lineWidth = pass === 0 ? glow : core;
      c.globalAlpha = pass === 0 ? 0.16 : 0.95;
      c.shadowBlur = pass === 0 ? glow * 1.4 : glow * 0.5;
      c.shadowColor = outer;
      c.stroke();
    }
    c.globalAlpha = 1; c.shadowBlur = 0;
  }

  /* ── loop ────────────────────────────────── */
  function step(dt) {
    if (mode === 'tracking') trackHand();
    else if (mode === 'demo') demoDrive(dt);
    handleErase(dt);
    updateMotes(dt);
    render(dt);
    updateTone();
  }
  function loop() { raf = requestAnimationFrame(loop); step(1 / 60); }

  for (let i = 0; i < 4; i++) spawnMote();
  step(1 / 60);
  loop();
  startCamera();

  return {
    step,
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      try { if (landmarker) landmarker.close(); } catch { /* gone */ }
      try { if (drawOsc) drawOsc.stop(); } catch { /* gone */ }
      try { if (actx) actx.close(); } catch { /* gone */ }
      video.srcObject = null;
      for (const n of [video, inkCanvas, trailCanvas, fxCanvas, score, readout, cta]) n.remove();
    },
  };
}
