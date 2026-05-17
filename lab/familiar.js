/* lab/familiar.js — Familiar
   A small creature that lives in the Lab. It follows you, reacts to you,
   and remembers you between visits. Built on Three.js. */

import * as THREE from 'three';

const STORE = 'lab.familiar.v1';

const loadMem = () => { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; } };
const saveMem = (m) => { try { localStorage.setItem(STORE, JSON.stringify(m)); } catch { /* private mode */ } };

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch { return false; }
}

/* Mount Familiar inside `stage`. Returns { dispose }. */
export function launchFamiliar(stage, opts = {}) {
  if (!hasWebGL()) {
    const fb = document.createElement('div');
    fb.className = 'fam-fallback';
    fb.innerHTML = '<p>Familiar needs WebGL to come alive.<br>Open the Lab on a current desktop browser to meet it.</p>';
    stage.appendChild(fb);
    return { dispose() { fb.remove(); } };
  }

  /* ── memory ─────────────────────────────── */
  const mem = loadMem();
  const now = Date.now();
  const visits = (mem?.visits || 0) + 1;
  const firstSeen = mem?.firstSeen || now;
  const awayDays = mem ? (now - (mem.lastSeen || now)) / 86400000 : 0;
  let mood = mem ? Math.max(0.2, (mem.mood ?? 0.65) - Math.min(0.45, awayDays * 0.18)) : 0.6;
  let interactions = mem?.interactions || 0;

  /* ── scene ──────────────────────────────── */
  const W = () => stage.clientWidth || 1;
  const H = () => stage.clientHeight || 1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, W() / H(), 0.1, 100);
  camera.position.set(0, 0, 7);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W(), H());
  renderer.setClearColor(0x0b0b0b, 1);
  stage.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const keyLight = new THREE.PointLight(0xfff0c4, 90, 40); keyLight.position.set(5, 6, 7); scene.add(keyLight);
  const coolLight = new THREE.PointLight(0x8893ff, 26, 40); coolLight.position.set(-7, -4, -3); scene.add(coolLight);

  const familiar = new THREE.Group();
  scene.add(familiar);

  /* body — an icosahedron that breathes by displacing its own vertices */
  const R = 1.25;
  const geo = new THREE.IcosahedronGeometry(R, 4);
  const base = Float32Array.from(geo.attributes.position.array);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xe9e3d2, emissive: 0xffe500, emissiveIntensity: 0.2, roughness: 0.5, metalness: 0.0,
  });
  const body = new THREE.Mesh(geo, bodyMat);
  familiar.add(body);

  /* halo — a soft additive shell so the creature reads as glowing */
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xffe500, transparent: true, opacity: 0.06,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const halo = new THREE.Mesh(new THREE.IcosahedronGeometry(R * 1.4, 2), haloMat);
  familiar.add(halo);

  /* eyes */
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf3eedd, roughness: 0.35 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.2 });
  const eyeGeos = [];
  function makeEye(x) {
    const g = new THREE.Group();
    const wGeo = new THREE.SphereGeometry(0.3, 28, 28);
    const pGeo = new THREE.SphereGeometry(0.15, 22, 22);
    eyeGeos.push(wGeo, pGeo);
    const white = new THREE.Mesh(wGeo, whiteMat);
    white.scale.z = 0.55;
    const pupil = new THREE.Mesh(pGeo, pupilMat);
    pupil.position.z = 0.2;
    g.add(white, pupil);
    g.position.set(x, 0.22, R * 0.95);
    g.userData = { white, pupil };
    return g;
  }
  const eyeL = makeEye(-0.44);
  const eyeR = makeEye(0.44);
  familiar.add(eyeL, eyeR);

  /* ── on-stage readout: memory line + mood meter ─── */
  const readout = document.createElement('div');
  readout.className = 'fam-readout';
  const memLine = document.createElement('div');
  memLine.className = 'fam-memory';
  const moodEl = document.createElement('div');
  moodEl.className = 'fam-mood';
  moodEl.innerHTML = '<span class="fam-mood-label">mood</span>'
    + '<span class="fam-mood-track"><span class="fam-mood-fill"></span></span>';
  readout.append(memLine, moodEl);
  stage.appendChild(readout);
  const moodFill = moodEl.querySelector('.fam-mood-fill');

  let line;
  if (!mem) line = "we haven't met. i'm Familiar — move your cursor.";
  else if (awayDays < 1) line = 'you came back. i kept your spot.';
  else if (awayDays < 7) {
    const d = Math.max(1, Math.round(awayDays));
    line = `you came back — it has been ${d} day${d === 1 ? '' : 's'}.`;
  } else line = 'long time. i remember you anyway.';

  let ci = 0;
  const typer = setInterval(() => {
    memLine.textContent = line.slice(0, ++ci);
    if (ci >= line.length) clearInterval(typer);
  }, 40);

  /* ── interaction ────────────────────────── */
  const pointer = new THREE.Vector2(0, 0);
  let lastMove = performance.now();

  function toLocal(e) {
    const r = stage.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
  }
  function onMove(e) {
    toLocal(e);
    lastMove = performance.now();
    mood = Math.min(1, mood + 0.0026);
    if (dozing) {            /* a sleeping Familiar startles awake when you return */
      dozing = false;
      excite = Math.max(excite, 0.85);
      squash = Math.max(squash, 0.55);
      mood = Math.max(mood, 0.26);
    }
  }

  let excite = 0;   /* spikes on a click, decays */
  let squash = 0;   /* drives the squash-and-stretch hop */
  let dozing = false;  /* true once mood bottoms out — it has nodded off */
  const rings = [];
  let actx;

  function purr() {
    if (opts.isSoundOn && !opts.isSoundOn()) return;   /* sound is opt-in */
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t = actx.currentTime;
      const osc = actx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 132 + mood * 46;           /* warm, audible purr */
      const lfo = actx.createOscillator();              /* tremolo gives it the purr texture */
      lfo.frequency.value = 22;
      const lfoGain = actx.createGain();
      lfoGain.gain.value = 26;
      lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
      const lp = actx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 720;
      const g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(lp); lp.connect(g); g.connect(actx.destination);
      osc.start(t); lfo.start(t);
      osc.stop(t + 0.55); lfo.stop(t + 0.55);
    } catch { /* audio blocked — stay silent */ }
  }

  function onDown(e) {
    toLocal(e);
    lastMove = performance.now();
    mood = Math.min(1, mood + 0.22);
    excite = 1;
    squash = 1;
    dozing = false;
    interactions++;
    purr();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(R * 1.05, R * 1.12, 56),
      new THREE.MeshBasicMaterial({
        color: 0xffe500, transparent: true, opacity: 0.55,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    ring.userData.t = 0;
    familiar.add(ring);
    rings.push(ring);
  }

  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerdown', onDown);

  function onResize() {
    camera.aspect = W() / H();
    camera.updateProjectionMatrix();
    renderer.setSize(W(), H());
  }
  window.addEventListener('resize', onResize);

  /* ── loop ───────────────────────────────── */
  const clock = new THREE.Clock();
  const moodSad = new THREE.Color(0x575b64);
  const moodHappy = new THREE.Color(0xf2e9cf);
  let blink = 0;
  let nextBlink = performance.now() + 1800 + Math.random() * 2600;
  let raf = 0;
  let saveAcc = 0;
  let simTime = 0;

  const persist = () => saveMem({ firstSeen, lastSeen: Date.now(), visits, mood, interactions });

  /* one frame of life — dt is elapsed seconds */
  function step(dt) {
    simTime += dt;
    const tt = simTime;

    const idleMs = performance.now() - lastMove;
    if (idleMs > 3000) mood = Math.max(0, mood - dt / 22);   /* 3s grace, then it fades */
    if (mood < 0.08) dozing = true;
    excite = Math.max(0, excite - dt * 1.9);
    squash = Math.max(0, squash - dt * 2.7);

    /* follow the cursor — sluggish when low, lively when happy */
    const idle = performance.now() - lastMove > 2800;
    const tx = idle ? Math.sin(tt * 0.34) * 1.8 : pointer.x * 2.7;
    const ty = (idle ? Math.cos(tt * 0.27) : pointer.y * 1.8)
      + Math.sin(tt * 1.5) * (0.05 + mood * 0.12) - (1 - mood) * 0.95;
    const ease = Math.min(1, (0.32 + mood * 1.95) * dt * 3);
    familiar.position.x += (tx - familiar.position.x) * ease;
    familiar.position.y += (ty - familiar.position.y) * ease;

    /* breathing — displace every vertex along its normal */
    const amp = 0.028 + mood * 0.12 + excite * 0.16;
    const sp = 0.55 + mood * 1.15;
    const arr = geo.attributes.position.array;
    for (let i = 0; i < arr.length; i += 3) {
      const ox = base[i], oy = base[i + 1], oz = base[i + 2];
      const l = Math.hypot(ox, oy, oz) || 1;
      const d = amp * (
        Math.sin(ox * 1.7 + tt * sp) * 0.5
        + Math.sin(oy * 2.0 - tt * sp * 0.8) * 0.3
        + Math.sin(oz * 2.4 + tt * sp * 1.3) * 0.3
      );
      arr[i] = ox + (ox / l) * d;
      arr[i + 1] = oy + (oy / l) * d;
      arr[i + 2] = oz + (oz / l) * d;
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();

    /* squash-and-stretch hop on a click */
    const sq = Math.sin(squash * Math.PI) * 0.3;
    const slump = 1 - mood;                          /* low mood deflates it a little */
    const sx = (1 + slump * 0.12) * (1 + sq * 0.7);
    const sy = (1 - slump * 0.18) * (1 - sq);
    familiar.scale.set(sx, sy, sx);

    /* mood shows in colour and glow */
    bodyMat.color.copy(moodSad).lerp(moodHappy, mood);
    bodyMat.emissiveIntensity = 0.015 + mood * 0.52 + excite * 0.34;
    haloMat.opacity = 0.015 + mood * 0.15 + excite * 0.14;

    /* eyes — track the cursor, blink, droop when low */
    if (performance.now() > nextBlink) {
      blink = 1;
      nextBlink = performance.now() + 2000 + Math.random() * 3400;
    }
    blink = Math.max(0, blink - dt * 7.5);
    const blinkScale = 1 - Math.sin(Math.min(1, blink) * Math.PI);
    const openBase = mood < 0.16 ? (mood / 0.16) * 0.16 : 0.16 + (mood - 0.16) * 0.86;
    const openness = openBase * (1 - excite * 0.45);
    for (const eye of [eyeL, eyeR]) {
      eye.userData.white.scale.y = Math.max(0.05, 0.9 * openness * Math.max(0.05, blinkScale));
      const p = eye.userData.pupil;
      p.position.x += (pointer.x * 0.13 - p.position.x) * 0.16;
      p.position.y += (pointer.y * 0.1 + 0.02 - p.position.y) * 0.16;
    }

    /* click rings expand and fade */
    for (let i = rings.length - 1; i >= 0; i--) {
      const ring = rings[i];
      ring.userData.t += dt;
      const s = 1 + ring.userData.t * 3.6;
      ring.scale.set(s, s, s);
      ring.material.opacity = Math.max(0, 0.55 * (1 - ring.userData.t / 0.85));
      if (ring.userData.t > 0.85) {
        familiar.remove(ring);
        ring.geometry.dispose();
        ring.material.dispose();
        rings.splice(i, 1);
      }
    }

    /* a breath of camera parallax */
    camera.position.x += (pointer.x * 0.5 - camera.position.x) * 0.04;
    camera.position.y += (pointer.y * 0.35 - camera.position.y) * 0.04;
    camera.lookAt(0, 0, 0);

    moodFill.style.transform = `scaleX(${mood.toFixed(3)})`;
    renderer.render(scene, camera);

    saveAcc += dt;
    if (saveAcc > 4) { saveAcc = 0; persist(); }
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    step(Math.min(clock.getDelta(), 0.05));
  }

  step(0);   /* paint the first frame at once */
  loop();    /* then keep it alive */

  return {
    step,
    dispose() {
      cancelAnimationFrame(raf);
      clearInterval(typer);
      persist();
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', onResize);
      readout.remove();
      renderer.domElement.remove();
      renderer.dispose();
      geo.dispose();
      bodyMat.dispose();
      halo.geometry.dispose();
      haloMat.dispose();
      whiteMat.dispose();
      pupilMat.dispose();
      eyeGeos.forEach((g) => g.dispose());
      rings.forEach((r) => { r.geometry.dispose(); r.material.dispose(); });
      try { if (actx) actx.close(); } catch { /* already closed */ }
    },
  };
}
