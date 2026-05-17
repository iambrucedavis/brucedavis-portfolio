/* lab/tumble.js — Tumble (Drop 03)
   Draw a line, watch the world fall through it.
   A 2D physics sandbox on Matter.js: anything you draw with the cursor
   becomes a solid object, and balls drop from the top and tumble
   through whatever you have built. Reset to clear the slate. */

import Matter from 'https://cdn.jsdelivr.net/npm/matter-js@0.20.0/+esm';

const { Engine, Composite, Bodies } = Matter;

const BALL_CAP = 46;
const SPAWN_EVERY = 0.85;   /* seconds between balls */
const SEG_LEN = 14;         /* px between physics segments of a drawn line */

export function launchTumble(stage, opts = {}) {  // eslint-disable-line no-unused-vars
  /* ── DOM ─────────────────────────────────── */
  const canvas = document.createElement('canvas');
  canvas.className = 'tumble-canvas';
  stage.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const readout = document.createElement('div');
  readout.className = 'tumble-readout';
  readout.innerHTML =
    '<div class="tumble-hint">Draw anywhere — build something for the balls to fall through.</div>'
    + '<button class="tumble-reset" type="button">Reset</button>';
  stage.appendChild(readout);
  const resetBtn = readout.querySelector('.tumble-reset');

  /* ── sizing ──────────────────────────────── */
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = 1, H = 1;
  function resize() {
    W = stage.clientWidth || 1;
    H = stage.clientHeight || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildWalls();
  }

  /* ── physics ─────────────────────────────── */
  const engine = Engine.create();
  engine.gravity.y = 1;
  const world = engine.world;

  let walls = [];
  function buildWalls() {
    if (walls.length) Composite.remove(world, walls);
    const t = 120;
    walls = [
      Bodies.rectangle(-t / 2 + 2, H / 2, t, H * 3, { isStatic: true }),       /* left */
      Bodies.rectangle(W + t / 2 - 2, H / 2, t, H * 3, { isStatic: true }),    /* right */
    ];
    Composite.add(world, walls);
  }

  let balls = [];
  let lines = [];              /* each: { pts:[...], bodies:[...] } */
  let spawnTimer = 0;

  function spawnBall() {
    const r = 7 + Math.random() * 8;
    const b = Bodies.circle(W * (0.16 + Math.random() * 0.68), -24, r, {
      restitution: 0.46, friction: 0.04, frictionAir: 0.004, density: 0.0014,
    });
    b.tumbleR = r;
    balls.push(b);
    Composite.add(world, b);
  }

  /* ── drawing ─────────────────────────────── */
  let drawing = false;
  let strokePts = [];
  let strokeBodies = [];
  let anchor = null;

  function localPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function addSegment(a, b) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 2) return;
    const seg = Bodies.rectangle((a.x + b.x) / 2, (a.y + b.y) / 2, len + 9, 9, {
      isStatic: true, friction: 0.1, angle: Math.atan2(b.y - a.y, b.x - a.x),
    });
    strokeBodies.push(seg);
    Composite.add(world, seg);
  }
  function onDown(e) {
    drawing = true;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ok */ }
    const p = localPos(e);
    strokePts = [p];
    strokeBodies = [];
    anchor = p;
  }
  function onMove(e) {
    if (!drawing) return;
    const p = localPos(e);
    strokePts.push(p);
    if (Math.hypot(p.x - anchor.x, p.y - anchor.y) > SEG_LEN) {
      addSegment(anchor, p);
      anchor = p;
    }
  }
  function onUp() {
    if (!drawing) return;
    drawing = false;
    const last = strokePts[strokePts.length - 1];
    if (last && anchor && Math.hypot(last.x - anchor.x, last.y - anchor.y) > 3) {
      addSegment(anchor, last);
    }
    if (strokeBodies.length) lines.push({ pts: strokePts, bodies: strokeBodies });
    strokePts = [];
    strokeBodies = [];
    anchor = null;
  }
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  function reset() {
    for (const ln of lines) Composite.remove(world, ln.bodies);
    for (const b of balls) Composite.remove(world, b);
    lines = [];
    balls = [];
    strokePts = [];
    strokeBodies = [];
    drawing = false;
  }
  resetBtn.addEventListener('click', reset);

  window.addEventListener('resize', resize);
  resize();

  /* ── render ──────────────────────────────── */
  function glowLine(pts) {
    if (pts.length < 2) return;
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        if (i === 0) ctx.moveTo(pts[i].x, pts[i].y); else ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = pass === 0 ? '#ffe500' : '#fff7d6';
      ctx.lineWidth = pass === 0 ? 14 : 4;
      ctx.globalAlpha = pass === 0 ? 0.2 : 1;
      ctx.shadowBlur = pass === 0 ? 20 : 6;
      ctx.shadowColor = '#ffe500';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  function render() {
    ctx.clearRect(0, 0, W, H);

    for (const ln of lines) glowLine(ln.pts);
    if (drawing) glowLine(strokePts);

    for (const b of balls) {
      ctx.beginPath();
      ctx.arc(b.position.x, b.position.y, b.tumbleR, 0, 6.2832);
      ctx.fillStyle = '#ECE7DB';
      ctx.shadowBlur = 12;
      ctx.shadowColor = 'rgba(255,229,0,0.45)';
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  /* ── loop ────────────────────────────────── */
  let raf = 0;
  function step(dt) {
    Engine.update(engine, Math.min(dt, 0.05) * 1000);

    spawnTimer += dt;
    if (spawnTimer > SPAWN_EVERY) { spawnTimer = 0; spawnBall(); }

    for (let i = balls.length - 1; i >= 0; i--) {
      if (balls[i].position.y > H + 90) {
        Composite.remove(world, balls[i]);
        balls.splice(i, 1);
      }
    }
    if (balls.length > BALL_CAP) {
      const extra = balls.splice(0, balls.length - BALL_CAP);
      for (const b of extra) Composite.remove(world, b);
    }

    render();
  }
  function loop() {
    raf = requestAnimationFrame(loop);
    step(1 / 60);
  }

  step(1 / 60);
  loop();

  return {
    step,
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      Composite.clear(world, false);
      Engine.clear(engine);
      canvas.remove();
      readout.remove();
    },
  };
}
