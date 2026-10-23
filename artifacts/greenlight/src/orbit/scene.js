/**
 * @file The CrossCheck orbit, drawn with three.js over God's Eye View's globe.
 *
 * World units are Earth radii, Earth-fixed (ECEF). The globe graticule is
 * built in ECEF so it lines up with the real Earth during the morph; the
 * rings live in an orbit-local group rotated to face the viewer's longitude.
 * Calm by design: no bloom; only must-fix items are lit on first load and
 * every other layer sits at 15% until switched on.
 * @module audit/scene
 */
import * as THREE from '../../vendor/three/three.module.min.js';
import { basisForLongitude, ease, phase } from './cameraMath.js';
import { RINGS, isBlocking, nodeKind, nodeOpacity } from './model.js';

const COLOR = {
  C: 0x4fd99a,
  L: 0x4fd99a,
  P: 0xf5c451,
  N: 0xff5c6e,
  NA: 0x4a5a70,
  UN: 0xcfe3ee,
  OUT: 0x2a3546,
  saf: 0x7cc9e8,
  sec: 0x00e5ff,
  ai: 0xf7fbff,
  link: 0x9fb6d4,
  linkHot: 0xffd0c8,
  linkShow: 0x00e5ff,
  FIXED: 0x4fd99a,
};

const FLASH_MS = 1600;
const BASE = Object.freeze({
  core: 1,
  saf: 1,
  sec: 1,
  ai: 1,
  tube: 1,
  floor: 1,
  links: 1,
  must: 1,
  other: 1,
});
/** Tour emphasis: multipliers on each part's opacity. */
const EMPHASIS = Object.freeze({
  none: BASE,
  core: {
    ...BASE,
    core: 1.6,
    saf: 0.22,
    sec: 0.22,
    ai: 0.22,
    floor: 0.4,
    links: 0.2,
  },
  saf: {
    ...BASE,
    saf: 1.7,
    sec: 0.1,
    ai: 0.1,
    core: 0.35,
    links: 0.2,
    floor: 0.6,
  },
  sec: {
    ...BASE,
    sec: 1.7,
    saf: 0.1,
    ai: 0.1,
    core: 0.35,
    links: 0.2,
    floor: 0.6,
  },
  ai: {
    ...BASE,
    ai: 1.7,
    saf: 0.1,
    sec: 0.1,
    core: 0.35,
    links: 0.2,
    floor: 0.6,
  },
  mustfix: {
    ...BASE,
    must: 1.3,
    other: 0.12,
    tube: 0.35,
    core: 0.4,
    links: 0.2,
  },
  links: { ...BASE, links: 2.3, tube: 0.5, other: 0.4, core: 0.4 },
});

function nodeColor(item) {
  if (item.out) return COLOR.OUT;
  if (!item.status) return COLOR.UN;
  return COLOR[item.status] ?? COLOR.UN;
}

function fresnelMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      c: { value: new THREE.Color(color) },
      alpha: { value: 0 },
    },
    vertexShader:
      'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
    fragmentShader:
      'uniform vec3 c; uniform float alpha; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.-max(dot(vN,vV),0.),2.6); gl_FragColor = vec4(c*(f*1.5+0.03), (f*0.95+0.03)*alpha); }',
  });
}

function lineMaterial(color, opacity) {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
}

function circle(radius, y, segments = 160) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

/**
 * Build the orbit scene.
 * @param {{nodes: object[], groups: object[], themes: object[]}} model
 */
export function createOrbitScene({ nodes, groups, themes }) {
  const scene = new THREE.Scene();
  const fadeables = []; // { material, base, key }: opacity = base × factor(key)

  // ── Stars, far away ───────────────────────────────────────────────────
  {
    const n = 900;
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const r = 300 + Math.random() * 120;
      p[i * 3] = r * Math.sqrt(1 - u * u) * Math.cos(t);
      p[i * 3 + 1] = r * Math.sqrt(1 - u * u) * Math.sin(t);
      p[i * 3 + 2] = r * u;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const m = new THREE.PointsMaterial({
      color: 0x8fa8c8,
      size: 1.2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
    });
    fadeables.push({ material: m, base: 0.45, key: 'veil' });
    scene.add(new THREE.Points(g, m));
  }

  // ── The software item: a glass Earth with the real graticule (ECEF) ──
  const core = new THREE.Group();
  scene.add(core);
  const shell = fresnelMaterial(0x9cc6ef);
  core.add(new THREE.Mesh(new THREE.SphereGeometry(1.0, 96, 64), shell));
  const grid = lineMaterial(0x8fbbe6, 0);
  fadeables.push({ material: grid, base: 0.24, key: 'core', part: 'core' });
  for (let lat = -60; lat <= 60; lat += 30) {
    const r = Math.cos((lat * Math.PI) / 180);
    const z = Math.sin((lat * Math.PI) / 180);
    const pts = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z));
    }
    core.add(
      new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), grid),
    );
  }
  for (let lon = 0; lon < 180; lon += 30) {
    const L = (lon * Math.PI) / 180;
    const pts = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      pts.push(
        new THREE.Vector3(
          Math.cos(a) * Math.cos(L),
          Math.cos(a) * Math.sin(L),
          Math.sin(a),
        ),
      );
    }
    core.add(
      new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), grid),
    );
  }

  // ── The orbit, in orbit-local axes (y = Earth's axis) ─────────────────
  const root = new THREE.Group();
  root.matrixAutoUpdate = false;
  scene.add(root);
  const rings = new THREE.Group(); // scaled during the morph
  root.add(rings);

  const floorMat = lineMaterial(0x2c4566, 0);
  fadeables.push({
    material: floorMat,
    base: 0.12,
    key: 'rings',
    part: 'floor',
  });
  for (const r of [2.6, 4.3, 5.9, 7.5, 8.6, 10.3])
    rings.add(new THREE.Line(circle(r, -1.47), floorMat));

  for (const g of groups) {
    const ring = RINGS[g.lens];
    const pts = [];
    for (let i = 0; i <= 48; i++) {
      const a = g.from + ((g.to - g.from) * i) / 48;
      pts.push(
        new THREE.Vector3(
          Math.cos(a) * ring.radius,
          ring.base,
          Math.sin(a) * ring.radius,
        ),
      );
    }
    const m = new THREE.MeshBasicMaterial({
      color: COLOR[g.lens],
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    fadeables.push({
      material: m,
      base: 0.45,
      key: 'rings',
      part: g.lens,
      tube: true,
    });
    rings.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(pts),
          48,
          g.lens === 'saf' ? 0.019 : g.lens === 'sec' ? 0.02 : 0.022,
          6,
          false,
        ),
        m,
      ),
    );
  }

  const dot = new THREE.SphereGeometry(1, 14, 10);
  const byId = new Map();

  /** Colour of a node from its current item. */
  function colorOf(n) {
    if (n.blocking) return n.item.status === 'N' ? COLOR.N : COLOR.P;
    if (n.item.fixed) return COLOR.FIXED;
    return nodeColor(n.item);
  }

  /** A raised pin's stem and footprint, made on first need. */
  function ensurePin(e) {
    if (e.stem) return;
    const n = e.node;
    e.stem = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...n.base),
        new THREE.Vector3(...n.base),
      ]),
      lineMaterial(e.material.color.getHex(), 0),
    );
    rings.add(e.stem);
    e.foot = new THREE.Mesh(
      new THREE.RingGeometry(n.size * 1.6, n.size * 2.2, 24),
      new THREE.MeshBasicMaterial({
        color: e.material.color.getHex(),
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    e.foot.rotation.x = -Math.PI / 2;
    e.foot.position.set(n.base[0], n.base[1] + 0.005, n.base[2]);
    rings.add(e.foot);
  }

  function styleNode(e) {
    const n = e.node;
    const c = colorOf(n);
    e.material.color.setHex(c);
    e.stem?.material.color.setHex(c);
    e.foot?.material.color.setHex(c);
    e.mesh.scale.setScalar(
      n.size * (n.blocking ? 1.5 : n.item.fixed ? 1.25 : 0.8),
    );
    e.liftGoal = n.blocking ? 1 : 0;
    if (n.blocking) ensurePin(e);
  }

  for (const n of nodes) {
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(dot, material);
    mesh.position.set(...n.base);
    rings.add(mesh);
    const entry = {
      node: { ...n },
      mesh,
      material,
      stem: null,
      foot: null,
      lift: n.blocking ? 1 : 0,
      liftGoal: 0,
      flashUntil: 0,
    };
    styleNode(entry);
    byId.set(n.id, entry);
  }

  // ── Links between the standards (shared evidence themes) ──────────────
  const links = [];
  const linksByNode = new Map();
  const focusedLinks = new Set();
  const PAIRS = [
    ['saf', 'sec'],
    ['saf', 'ai'],
    ['sec', 'ai'],
  ];
  themes.forEach((t, ti) => {
    for (const [la, lb] of PAIRS)
      for (const a of t[la] || [])
        for (const b of t[lb] || []) {
          const A = byId.get(a);
          const B = byId.get(b);
          if (!A || !B) continue;
          const material = new THREE.MeshBasicMaterial({
            color: COLOR.link,
            transparent: true,
            opacity: 0,
            depthWrite: false,
          });
          const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
          rings.add(mesh);
          const link = { theme: ti, a, b, mesh, material, built: -1 };
          links.push(link);
          for (const id of [a, b]) {
            if (!linksByNode.has(id)) linksByNode.set(id, []);
            linksByNode.get(id).push(link);
          }
        }
  });

  // ── Selection marks ───────────────────────────────────────────────────
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.165, 64),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  halo.visible = false;
  rings.add(halo);
  const linkMarks = [];

  // ── State ─────────────────────────────────────────────────────────────
  const state = {
    morph: 0,
    layers: {},
    selected: null,
    hovered: null,
    linked: new Set(),
    pulse: null, // { key: 'saf'|'sec'|'ai'|'core'|'mustfix', until }
    emphasis: null, // the tour's focus: 'core'|'saf'|'sec'|'ai'|'mustfix'|'links'
  };
  // Emphasis factors, eased towards their targets each frame.
  const ef = { ...EMPHASIS.none };
  let lastFrame = 0;
  const tmp = new THREE.Vector3();

  function factor(key, t) {
    if (key === 'veil') return ease(phase(t, 0.0, 0.5));
    if (key === 'core') return ease(phase(t, 0.05, 0.45));
    return ease(phase(t, 0.3, 0.65));
  }

  function liftFactor(t) {
    return ease(phase(t, 0.7, 1));
  }

  function linkCurve(l) {
    const pa = byId.get(l.a).mesh.position;
    const pb = byId.get(l.b).mesh.position;
    const mid = pa.clone().add(pb).multiplyScalar(0.5);
    mid.y += 0.7 + pa.distanceTo(pb) * 0.1;
    return new THREE.QuadraticBezierCurve3(pa.clone(), mid, pb.clone());
  }

  function rebuildLink(l, radius = 0.0045) {
    const pa = byId.get(l.a).mesh.position;
    const pb = byId.get(l.b).mesh.position;
    const key = `${pa.y.toFixed(3)},${pb.y.toFixed(3)},${radius}`;
    if (l.built === key) return;
    l.mesh.geometry.dispose();
    l.mesh.geometry = new THREE.TubeGeometry(linkCurve(l), 48, radius, 5, false);
    l.built = key;
  }

  /** Links of one shared-evidence theme, drawn bold for the tour. */
  const showcase = { theme: null, nodes: new Set(), marks: [] };
  const SHOW_RADIUS = 0.012;
  function isShown(l) {
    return showcase.theme !== null && l.theme === showcase.theme;
  }

  /** Re-apply every opacity, position and scale from the current state. */
  function apply(now = performance.now()) {
    const t = state.morph;
    shell.uniforms.alpha.value = factor('core', t);
    for (const f of fadeables) {
      const e = f.part ? ef[f.part] * (f.tube ? ef.tube : 1) : 1;
      f.material.opacity = Math.min(1, f.base * factor(f.key, t) * e);
    }
    shell.uniforms.alpha.value *= ef.core;
    const ringFactor = factor('rings', t);
    const s = 0.22 + 0.78 * ease(phase(t, 0.3, 0.8));
    rings.scale.set(s, 1, s);
    const lift = liftFactor(t);
    const pulseOn = state.pulse && now < state.pulse.until;
    const pulse = pulseOn ? 0.5 + 0.5 * Math.sin(now / 160) : 0;
    for (const e of byId.values()) {
      const n = e.node;
      let o = nodeOpacity(n, state.layers, {
        selected: state.selected,
        linked: showcase.nodes.size ? new Set([...state.linked, ...showcase.nodes]) : state.linked,
      });
      if (
        pulseOn &&
        (state.pulse.key === n.lens ||
          (state.pulse.key === 'mustfix' && n.blocking))
      )
        o = Math.max(o, 0.35 + 0.65 * pulse);
      o = Math.min(
        1,
        o * ef[n.lens] * (n.blocking || n.item.fixed ? ef.must : ef.other),
      );
      if (now < e.flashUntil) {
        const k = (e.flashUntil - now) / FLASH_MS;
        o = Math.max(o, 0.6 + 0.4 * k);
        e.mesh.scale.setScalar(n.size * (1.25 + 1.4 * k));
      }
      e.material.opacity = o * ringFactor;
      const y = n.base[1] + RINGS[n.lens].lift * e.lift * lift;
      e.mesh.position.y = y;
      if (e.stem) {
        const pos = e.stem.geometry.attributes.position;
        pos.setY(1, y);
        pos.needsUpdate = true;
        e.stem.material.opacity = 0.75 * o * ringFactor;
        e.foot.material.opacity = 0.6 * o * ringFactor;
      }
    }
    const linksOn = !!state.layers.links;
    focusedLinks.clear();
    for (const l of links) {
      if (isShown(l)) {
        rebuildLink(l, SHOW_RADIUS);
        l.material.color.setHex(COLOR.linkShow);
        continue; // opacity animated in frame()
      }
      const hot =
        linksOn &&
        ((state.selected && (l.a === state.selected || l.b === state.selected)) ||
          (state.hovered && (l.a === state.hovered || l.b === state.hovered)));
      if (linksOn) rebuildLink(l);
      l.material.color.setHex(hot ? COLOR.linkHot : COLOR.link);
      l.material.opacity = hot ? 0.95 : linksOn ? (showcase.theme !== null ? 0.015 : 0.03) : 0;
      if (hot) focusedLinks.add(l);
    }
    if (pulseOn && state.pulse.key === 'core')
      shell.uniforms.alpha.value *= 1 + 0.6 * pulse;
    halo.visible = !!state.selected && t > 0.95;
  }

  /** Place the orbit for a viewer at longitude `lon` (radians). */
  function setLongitude(lon) {
    const b = basisForLongitude(lon);
    root.matrix.set(
      b.x[0],
      b.y[0],
      b.z[0],
      0,
      b.x[1],
      b.y[1],
      b.z[1],
      0,
      b.x[2],
      b.y[2],
      b.z[2],
      0,
      0,
      0,
      0,
      1,
    );
    root.matrixWorldNeedsUpdate = true;
  }

  function setMorph(t) {
    state.morph = Math.min(1, Math.max(0, t));
    apply();
  }

  function setLayers(layers) {
    state.layers = { ...layers };
    apply();
  }

  function select(id, linked = new Set()) {
    for (const m of linkMarks) rings.remove(m);
    linkMarks.length = 0;
    state.selected = id;
    state.hovered = null;
    state.linked = linked;
    if (id && byId.has(id)) {
      const e = byId.get(id);
      halo.position.copy(e.mesh.position);
      for (const other of linked) {
        const o = byId.get(other);
        if (!o) continue;
        const r = new THREE.Mesh(
          new THREE.RingGeometry(0.075, 0.084, 48),
          new THREE.MeshBasicMaterial({
            color: COLOR.linkHot,
            transparent: true,
            opacity: 0.85,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        r.position.copy(o.mesh.position);
        r.userData.follow = o.mesh;
        rings.add(r);
        linkMarks.push(r);
      }
    }
    apply();
  }

  function setHovered(id) {
    if (state.hovered === id) return;
    state.hovered = id;
    const linksOn = !!state.layers.links;
    const baseOpacity = linksOn ? 0.03 : 0;
    for (const l of focusedLinks) {
      l.material.color.setHex(COLOR.link);
      l.material.opacity = baseOpacity;
    }
    focusedLinks.clear();
    if (!linksOn) return;
    for (const id of [state.selected, state.hovered]) {
      if (!id) continue;
      for (const l of linksByNode.get(id) || []) {
        rebuildLink(l);
        l.material.color.setHex(COLOR.linkHot);
        l.material.opacity = 0.95;
        focusedLinks.add(l);
      }
    }
  }

  function pulse(key, ms = 2600) {
    state.pulse = { key, until: performance.now() + ms };
  }

  /**
   * Show the items as they stand at a point of the remediation: colours,
   * raised pins and layers follow each item's status. Newly fixed items
   * flash once and their pins settle onto the ring.
   */
  function setItems(items, { flash = true } = {}) {
    const now = performance.now();
    for (const item of items) {
      const e = byId.get(item.id);
      if (!e) continue;
      const wasFixed = !!e.node.item.fixed;
      e.node.item = item;
      e.node.blocking = isBlocking(item);
      e.node.kind = nodeKind(item);
      styleNode(e);
      if (flash && item.fixed && !wasFixed) e.flashUntil = now + FLASH_MS;
    }
    apply(now);
  }

  /** Dim everything but one part of the orbit (null: back to normal). */
  function setEmphasis(key) {
    state.emphasis = EMPHASIS[key] ? key : null;
  }

  /** Per-frame: face marks at the camera and animate pulses. */
  function frame(camera, now) {
    const dt = Math.min(0.1, lastFrame ? (now - lastFrame) / 1000 : 0);
    lastFrame = now;
    const goal = EMPHASIS[state.emphasis || 'none'];
    let moving = false;
    for (const k of Object.keys(ef)) {
      const d = goal[k] - ef[k];
      if (Math.abs(d) < 0.002) ef[k] = goal[k];
      else {
        ef[k] += d * Math.min(1, dt * 4.5);
        moving = true;
      }
    }
    for (const e of byId.values()) {
      const d = e.liftGoal - e.lift;
      if (Math.abs(d) < 0.002) e.lift = e.liftGoal;
      else {
        e.lift += d * Math.min(1, dt * 2.6);
        moving = true;
      }
      if (e.flashUntil && now < e.flashUntil + 50) moving = true;
      else if (e.flashUntil) {
        e.flashUntil = 0;
        styleNode(e);
        moving = true;
      }
    }
    if (moving) apply(now);
    if (state.selected) {
      const e = byId.get(state.selected);
      if (e) halo.position.copy(e.mesh.position);
      halo.lookAt(camera.position);
      const s = 1 + 0.08 * Math.sin(now / 420);
      halo.scale.setScalar(s);
    }
    for (const m of linkMarks) {
      m.position.copy(m.userData.follow.position);
      m.lookAt(camera.position);
    }
    if (showcase.theme !== null) {
      let i = 0;
      for (const l of links) {
        if (!isShown(l)) continue;
        // A slow shimmer that travels along the set, so the eye reads them as connections.
        l.material.opacity = 0.62 + 0.38 * Math.sin(now / 260 - i * 0.55);
        i++;
      }
      const s = 1 + 0.18 * Math.sin(now / 300);
      for (const m of showcase.marks) {
        m.position.copy(m.userData.follow.position);
        m.lookAt(camera.position);
        m.scale.setScalar(s);
      }
    }
    if (state.pulse) {
      apply(now);
      if (now > state.pulse.until) state.pulse = null;
    }
  }

  /** Highlight every link of one theme (index into `themes`), or clear with null. */
  function showcaseLinks(theme) {
    for (const m of showcase.marks) {
      rings.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    showcase.marks = [];
    showcase.nodes = new Set();
    showcase.theme = theme ?? null;
    if (showcase.theme !== null) {
      for (const l of links) {
        if (!isShown(l)) continue;
        showcase.nodes.add(l.a);
        showcase.nodes.add(l.b);
      }
      for (const id of showcase.nodes) {
        const o = byId.get(id);
        if (!o) continue;
        const r = new THREE.Mesh(
          new THREE.RingGeometry(0.085, 0.1, 40),
          new THREE.MeshBasicMaterial({ color: COLOR.linkShow, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
        );
        r.position.copy(o.mesh.position);
        r.userData.follow = o.mesh;
        rings.add(r);
        showcase.marks.push(r);
      }
    }
    apply();
  }

  /** Themes that have links, most links first: [{ theme, count }]. */
  function linkThemes() {
    const counts = new Map();
    for (const l of links) counts.set(l.theme, (counts.get(l.theme) || 0) + 1);
    return [...counts.entries()].map(([theme, count]) => ({ theme, count })).sort((a, b) => b.count - a.count);
  }

  /** The two requirement ids at the ends of a theme's longest arc. */
  function linkEnds(theme) {
    let best = null;
    let bestLen = -1;
    for (const l of links) {
      if (l.theme !== theme) continue;
      const len = byId.get(l.a).mesh.position.distanceTo(byId.get(l.b).mesh.position);
      if (len > bestLen) {
        bestLen = len;
        best = l;
      }
    }
    return best ? { a: best.a, b: best.b } : null;
  }

  /** World position of the top of the longest arc of a theme: where the eye goes. */
  function linkApex(theme) {
    let best = null;
    let bestLen = -1;
    for (const l of links) {
      if (l.theme !== theme) continue;
      const len = byId.get(l.a).mesh.position.distanceTo(byId.get(l.b).mesh.position);
      if (len > bestLen) {
        bestLen = len;
        best = l;
      }
    }
    if (!best) return null;
    return rings.localToWorld(linkCurve(best).getPoint(0.5)).clone();
  }

  /** World position (Earth radii, ECEF) of a node or a local point. */
  function worldOf(idOrPoint) {
    if (typeof idOrPoint === 'string') {
      const e = byId.get(idOrPoint);
      if (!e) return null;
      return rings.localToWorld(tmp.copy(e.mesh.position)).clone();
    }
    return rings.localToWorld(tmp.set(...idOrPoint)).clone();
  }

  /** Nearest node to a screen point, preferring visible ones. */
  function pick(camera, x, y, width, height, radiusPx = 14) {
    let best = null;
    let bestScore = Infinity;
    for (const e of byId.values()) {
      if (e.material.opacity <= 0.01) continue;
      const w = rings.localToWorld(tmp.copy(e.mesh.position)).project(camera);
      if (w.z > 1) continue;
      const sx = ((w.x + 1) / 2) * width;
      const sy = ((1 - w.y) / 2) * height;
      const d = Math.hypot(sx - x, sy - y);
      if (d > radiusPx) continue;
      const score = d - (e.material.opacity > 0.5 ? 6 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = e.node.id;
      }
    }
    return best;
  }

  function dispose() {
    scene.traverse((o) => {
      o.geometry?.dispose?.();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose?.();
    });
  }

  apply();
  return {
    scene,
    setLongitude,
    setMorph,
    setLayers,
    select,
    setHovered,
    pulse,
    setEmphasis,
    setItems,
    showcaseLinks,
    linkThemes,
    linkApex,
    linkEnds,
    frame,
    worldOf,
    pick,
    dispose,
    get morph() {
      return state.morph;
    },
  };
}

export { THREE };
