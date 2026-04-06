/* ================================================================
   MODULE: MAP ELEMENTS
   ================================================================ */
function placeEntry(x, y) {
  const e = {
    id: newId(),
    x,
    y,
    spawnRate: 60,
    convertToExit: true,
    label: "Entry " + (MAP.entries.length + 1),
  };
  if (checkOverlap('entry', e)) {
    showEditorAlert("Cannot place Entry: area is blocked");
    return;
  }
  MAP.entries.push(e);
  selectElement(e.id);
  updateElemList();
  drawMapLayer();
}

function placeExit(x, y) {
  const e = {
    id: newId(),
    x,
    y,
    capacity: 120,
    width: 2,
    label: "Exit " + (MAP.exits.length + 1),
  };
  if (checkOverlap('exit', e)) {
    showEditorAlert("Cannot place Exit: area is blocked");
    return;
  }
  MAP.exits.push(e);
  selectElement(e.id);
  updateElemList();
  drawMapLayer();
}

function placeZone(x, y, w, h) {
  const z = {
    id: newId(),
    x,
    y,
    w,
    h,
    type: "stage",
    attraction: 0.7,
    label: "Zone " + (MAP.zones.length + 1),
  };
  if (checkOverlap('zone', z)) {
    showEditorAlert("Cannot place Zone: area is blocked");
    return;
  }
  MAP.zones.push(z);
  selectElement(z.id);
  updateElemList();
}

function placeObstacle(x, y, w, h) {
  // x,y = top-left corner from draw gesture; store as center + angle:0
  const cx = x + w / 2;
  const cy = y + h / 2;
  const o = {
    id: newId(),
    x: cx,
    y: cy,
    w,
    h,
    angle: 0,
    label: "Wall " + (MAP.obstacles.length + 1),
  };
  if (checkOverlap('obstacle', o)) {
    showEditorAlert("Cannot place Obstacle: area is blocked");
    return;
  }
  MAP.obstacles.push(o);
  selectElement(o.id);
  updateElemList();
}

function placeChaos(x, y, w, h) {
  const c = {
    id: newId(),
    x,
    y,
    w,
    h,
    intensity: 1.0,
    label: "Chaos " + (MAP.chaos.length + 1),
  };
  if (checkOverlap('chaos', c)) {
    showEditorAlert("Cannot place Chaos zone: area is blocked");
    return;
  }
  MAP.chaos.push(c);
  selectElement(c.id);
  updateElemList();
  drawMapLayer();
}

function placeBarricade(x, y, w, h) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const b = {
    id: newId(),
    x: cx,
    y: cy,
    w,
    h,
    angle: 0,
    durability: 20,
    maxDurability: 20,
    broken: false,
    label: "Barricade " + (MAP.barricades.length + 1),
  };
  if (checkOverlap('barricade', b)) {
    showEditorAlert("Cannot place Barricade: area is blocked");
    return;
  }
  MAP.barricades.push(b);
  selectElement(b.id);
  updateElemList();
  drawMapLayer();
}

function findElem(id) {
  return [
    ...MAP.entries,
    ...MAP.exits,
    ...MAP.zones,
    ...MAP.obstacles,
    ...MAP.chaos,
    ...MAP.barricades,
  ].find((e) => e.id === id);
}

function deleteElement(id) {
  MAP.entries = MAP.entries.filter((e) => e.id !== id);
  MAP.exits = MAP.exits.filter((e) => e.id !== id);
  MAP.zones = MAP.zones.filter((e) => e.id !== id);
  MAP.obstacles = MAP.obstacles.filter((e) => e.id !== id);
  MAP.chaos = MAP.chaos.filter((e) => e.id !== id);
  MAP.barricades = MAP.barricades.filter((e) => e.id !== id);
  if (STATE.selectedId === id) selectElement(null);
  updateElemList();
  drawAll();
}

function clearAll() {
  if (!confirm("Clear all map elements?")) return;
  MAP.entries = [];
  MAP.exits = [];
  MAP.zones = [];
  MAP.obstacles = [];
  MAP.chaos = [];
  MAP.barricades = [];
  MAP.boundary = [];
  selectElement(null);
  updateElemList();
  drawAll();
}

/* ================================================================
   MODULE: HIT TESTING
   ================================================================ */

/* Hit test: returns element or null */
function hitTest(wx, wy) {
  const r = 4 / STATE.zoom;
  for (const e of MAP.entries) {
    if (Math.hypot(wx - e.x, wy - e.y) < r + 2) return { ...e, type: "entry" };
  }
  for (const e of MAP.exits) {
    if (Math.hypot(wx - e.x, wy - e.y) < r + 2) return { ...e, type: "exit" };
  }
  // Obstacles: rotated point test — x,y is now center, angle is rotation
  for (const o of MAP.obstacles) {
    if (pointInObstacle(wx, wy, o)) return { ...o, type: "obstacle" };
  }
  // Barricades: same rotated-rect test as obstacles
  for (const b of MAP.barricades) {
    if (pointInObstacle(wx, wy, b)) return { ...b, type: "barricade" };
  }
  for (const z of MAP.zones) {
    if (wx >= z.x && wx <= z.x + z.w && wy >= z.y && wy <= z.y + z.h)
      return { ...z, type: "zone" };
  }
  for (const c of MAP.chaos) {
    if (wx >= c.x && wx <= c.x + c.w && wy >= c.y && wy <= c.y + c.h)
      return { ...c, type: "chaos" };
  }
  return null;
}

/*
  pointInObstacle — rotated rectangle containment test.
  Obstacle stores center (o.x, o.y), size (o.w, o.h), angle in radians.
  Transform world point into obstacle local frame then AABB test.
*/
function pointInObstacle(wx, wy, o) {
  const angle = o.angle || 0;
  const dx = wx - o.x;
  const dy = wy - o.y;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return Math.abs(lx) <= o.w / 2 && Math.abs(ly) <= o.h / 2;
}

/* ================================================================
   MODULE: OVERLAP DETECTION (SAT)
   ================================================================ */

function getVertices(elem, type, inflate = 0) {
  if (type === 'obstacle' || type === 'barricade') {
    const cos = Math.cos(elem.angle || 0);
    const sin = Math.sin(elem.angle || 0);
    const hw = (elem.w / 2) + inflate, hh = (elem.h / 2) + inflate;
    return [
      {x: elem.x + hw*cos - hh*sin, y: elem.y + hw*sin + hh*cos},
      {x: elem.x - hw*cos - hh*sin, y: elem.y - hw*sin + hh*cos},
      {x: elem.x - hw*cos + hh*sin, y: elem.y - hw*sin - hh*cos},
      {x: elem.x + hw*cos + hh*sin, y: elem.y + hw*sin - hh*cos}
    ];
  } else if (type === 'zone' || type === 'chaos') {
    return [
      {x: elem.x - inflate, y: elem.y - inflate},
      {x: elem.x + elem.w + inflate, y: elem.y - inflate},
      {x: elem.x + elem.w + inflate, y: elem.y + elem.h + inflate},
      {x: elem.x - inflate, y: elem.y + elem.h + inflate}
    ];
  } else if (type === 'exit') {
     const hw = ((elem.width || 2) / 2) + inflate;
     return [
       {x: elem.x - hw, y: elem.y - hw},
       {x: elem.x + hw, y: elem.y - hw},
       {x: elem.x + hw, y: elem.y + hw},
       {x: elem.x - hw, y: elem.y + hw}
     ];
  } else if (type === 'entry') {
     const hw = 0.75 + inflate;
     return [
       {x: elem.x - hw, y: elem.y - hw},
       {x: elem.x + hw, y: elem.y - hw},
       {x: elem.x + hw, y: elem.y + hw},
       {x: elem.x - hw, y: elem.y + hw}
     ];
  }
  return [];
}

function polysOverlap(aVerts, bVerts) {
  const edges = [];
  for (let i=0; i<aVerts.length; i++) {
    edges.push({
      x: aVerts[(i+1)%aVerts.length].x - aVerts[i].x,
      y: aVerts[(i+1)%aVerts.length].y - aVerts[i].y
    });
  }
  for (let i=0; i<bVerts.length; i++) {
    edges.push({
      x: bVerts[(i+1)%bVerts.length].x - bVerts[i].x,
      y: bVerts[(i+1)%bVerts.length].y - bVerts[i].y
    });
  }
  for (const edge of edges) {
    const axis = { x: -edge.y, y: edge.x };
    let aMin = Infinity, aMax = -Infinity;
    for (const v of aVerts) {
      const proj = v.x * axis.x + v.y * axis.y;
      aMin = Math.min(aMin, proj);
      aMax = Math.max(aMax, proj);
    }
    let bMin = Infinity, bMax = -Infinity;
    for (const v of bVerts) {
      const proj = v.x * axis.x + v.y * axis.y;
      bMin = Math.min(bMin, proj);
      bMax = Math.max(bMax, proj);
    }
    if (aMax <= bMin || bMax <= aMin) return false;
  }
  return true;
}

function isPointInPolygon(point, vs) {
  let x = point.x, y = point.y;
  let isInside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    let xi = vs[i].x, yi = vs[i].y;
    let xj = vs[j].x, yj = vs[j].y;
    let intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) isInside = !isInside;
  }
  return isInside;
}

function checkOverlap(type, candidate, ignoreId = null) {
  // If the candidate is an entry, inflate it by 2m for the tests.
  // We do not inflate the candidate if it is NOT an entry.
  const isCandEntry = (type === 'entry');
  const candVerts = getVertices(candidate, type, isCandEntry ? 2 : 0);
  if (!candVerts.length) return false;

  const lists = [
    { items: MAP.entries, type: 'entry' },
    { items: MAP.exits, type: 'exit' },
    { items: MAP.zones, type: 'zone' },
    { items: MAP.chaos, type: 'chaos' },
    { items: MAP.obstacles, type: 'obstacle' },
    { items: MAP.barricades, type: 'barricade' }
  ];

  for (const list of lists) {
    for (const item of list.items) {
      if (item.id === ignoreId) continue;
      
      // Allow Chaos to overlap with EVERYTHING
      if (type === 'chaos') continue;
      if (list.type === 'chaos') continue;
      
      // If we are testing against an entry, and the candidate was NOT an entry,
      // we must inflate the target entry's vertices by 2m so we don't encroach on it.
      const isTargetEntry = (list.type === 'entry');
      const targetInflate = (isTargetEntry && !isCandEntry) ? 2 : 0;
      
      const itemVerts = getVertices(item, list.type, targetInflate);
      if (polysOverlap(candVerts, itemVerts)) return true;
    }
  }

  // Boundary Confinement Check (objects must stay inside the arena)
  // Only restrict if a valid boundary polygon exists
  if (MAP.boundary && MAP.boundary.length >= 3) {
    for (const v of candVerts) {
      if (!isPointInPolygon(v, MAP.boundary)) {
        return true; // Polygon vertex is outside the venue -> invalid placement
      }
    }
  }

  return false;
}

function checkBoundaryIntersect(p1, p2) {
  // A boundary is a line segment, which we can treat as a very thin polygon
  // Or we can just build a polygon from the line with a tiny thickness (e.g. 0.1m)
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return false;
  
  const nx = (-dy / len) * 0.1;
  const ny = (dx / len) * 0.1;
  
  const linePoly = [
    {x: p1.x + nx, y: p1.y + ny},
    {x: p1.x - nx, y: p1.y - ny},
    {x: p2.x - nx, y: p2.y - ny},
    {x: p2.x + nx, y: p2.y + ny}
  ];

  const lists = [
    { items: MAP.entries, type: 'entry' },
    { items: MAP.exits, type: 'exit' },
    { items: MAP.zones, type: 'zone' },
    { items: MAP.chaos, type: 'chaos' },
    { items: MAP.obstacles, type: 'obstacle' },
    { items: MAP.barricades, type: 'barricade' }
  ];

  for (const list of lists) {
    for (const item of list.items) {
      // If we are checking intersection against an Entry, the line must respect the 2m clearance!
      const targetInflate = (list.type === 'entry') ? 2 : 0;
      const itemVerts = getVertices(item, list.type, targetInflate);
      if (polysOverlap(linePoly, itemVerts)) return true;
    }
  }
  return false;
}

function showEditorAlert(msg) {
  const existing = document.getElementById('editor-alert');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.id = 'editor-alert';
  div.style.cssText = 'position:absolute;top:70px;left:50%;transform:translateX(-50%);background:var(--red);color:#fff;padding:8px 16px;border-radius:6px;font-family:"DM Mono",monospace;font-size:0.75rem;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.3);pointer-events:none;transition:opacity 0.3s;';
  div.textContent = "⚠ " + msg;
  document.body.appendChild(div);
  setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 300); }, 2000);
}

/* ================================================================
   MODULE: OBSTACLE HANDLE HIT TESTING
   ================================================================
   When an obstacle is selected in select-tool mode we expose:
     - 4 corner resize handles  : nw, ne, se, sw
     - 4 edge-midpoint handles  : n, e, s, w
     - 1 rotation handle        : rotate  (above top-center)

   All positions are computed in world space by rotating the
   local offset by the obstacle's current angle.
   ================================================================ */

const HANDLE_WORLD_R = 3.5; // world-unit base grab radius
const ROTATE_HANDLE_DIST = 8; // world-units above top-center

/*
  getObstacleHandles(o) — returns array of handle descriptors:
  { key, lx, ly, wx, wy }
    lx, ly — local position relative to center (before rotation)
    wx, wy — world position after applying rotation
*/
function getObstacleHandles(o) {
  const angle = o.angle || 0;
  const hw = o.w / 2;
  const hh = o.h / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  function toWorld(lx, ly) {
    return {
      wx: o.x + lx * cos - ly * sin,
      wy: o.y + lx * sin + ly * cos,
    };
  }

  const defs = [
    { key: "nw", lx: -hw, ly: -hh },
    { key: "ne", lx: hw, ly: -hh },
    { key: "se", lx: hw, ly: hh },
    { key: "sw", lx: -hw, ly: hh },
    { key: "n", lx: 0, ly: -hh },
    { key: "e", lx: hw, ly: 0 },
    { key: "s", lx: 0, ly: hh },
    { key: "w", lx: -hw, ly: 0 },
    { key: "rotate", lx: 0, ly: -(hh + ROTATE_HANDLE_DIST) },
  ];

  return defs.map((h) => ({ ...h, ...toWorld(h.lx, h.ly) }));
}

/*
  hitTestObstacleHandles(wx, wy) — if the selected element is an
  obstacle, returns whichever handle the world-point falls on, or null.
*/
function hitTestObstacleHandles(wx, wy) {
  if (!STATE.selectedId) return null;
  const o = MAP.obstacles.find((ob) => ob.id === STATE.selectedId)
         || MAP.barricades.find((ob) => ob.id === STATE.selectedId);
  if (!o) return null;

  const grabR = (HANDLE_WORLD_R / STATE.zoom) * 2.5;
  for (const h of getObstacleHandles(o)) {
    if (Math.hypot(wx - h.wx, wy - h.wy) < grabR) return h;
  }
  return null;
}

/* ================================================================
   MODULE: OBSTACLE HANDLE DRAWING
   ================================================================ */

/*
  drawObstacleHandles(o) — draws resize/rotate handles for a
  selected obstacle onto canvasUi (the top interaction layer).
  Called from selectElement() and updateObstacleHandleDrag().
*/
function drawObstacleHandles(o) {
  const handles = getObstacleHandles(o);
  const angle = o.angle || 0;
  const hw = o.w / 2;
  const hh = o.h / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // Dashed selection outline
  const corners4 = [
    { lx: -hw, ly: -hh },
    { lx: hw, ly: -hh },
    { lx: hw, ly: hh },
    { lx: -hw, ly: hh },
  ].map(({ lx, ly }) =>
    w2s(o.x + lx * cos - ly * sin, o.y + lx * sin + ly * cos),
  );

  ctxUi.save();
  ctxUi.strokeStyle = "rgba(239,68,68,0.9)";
  ctxUi.lineWidth = 1.5;
  ctxUi.setLineDash([4, 3]);
  ctxUi.beginPath();
  ctxUi.moveTo(corners4[0].x, corners4[0].y);
  corners4.forEach((p) => ctxUi.lineTo(p.x, p.y));
  ctxUi.closePath();
  ctxUi.stroke();
  ctxUi.setLineDash([]);

  // Line from top-center to rotation handle
  const topCenter = w2s(o.x + 0 * cos - -hh * sin, o.y + 0 * sin + -hh * cos);
  const rotH = handles.find((h) => h.key === "rotate");
  const rotS = w2s(rotH.wx, rotH.wy);
  ctxUi.strokeStyle = "rgba(251,191,36,0.85)";
  ctxUi.lineWidth = 1.2;
  ctxUi.beginPath();
  ctxUi.moveTo(topCenter.x, topCenter.y);
  ctxUi.lineTo(rotS.x, rotS.y);
  ctxUi.stroke();

  // Draw each handle dot / square
  const sz = Math.max(5, wScale(1.5));
  for (const h of handles) {
    const sp = w2s(h.wx, h.wy);
    if (h.key === "rotate") {
      ctxUi.fillStyle = "#fbbf24";
      ctxUi.strokeStyle = "#fff";
      ctxUi.lineWidth = 1.5;
      ctxUi.beginPath();
      ctxUi.arc(sp.x, sp.y, sz, 0, Math.PI * 2);
      ctxUi.fill();
      ctxUi.stroke();
    } else {
      ctxUi.fillStyle = "#fff";
      ctxUi.strokeStyle = "#ef4444";
      ctxUi.lineWidth = 1.5;
      ctxUi.fillRect(sp.x - sz / 2, sp.y - sz / 2, sz, sz);
      ctxUi.strokeRect(sp.x - sz / 2, sp.y - sz / 2, sz, sz);
    }
  }

  ctxUi.restore();
}

/* ================================================================
   MODULE: OBSTACLE DRAG INTERACTION
   ================================================================ */

/*
  beginObstacleHandleDrag — called from input.js onMouseDown when
  a handle hit is detected on the selected obstacle.
*/
function beginObstacleHandleDrag(handle, o, wx, wy) {
  STATE.obHandle = {
    handle,
    id: o.id,
    startAngle: o.angle || 0,
    startW: o.w,
    startH: o.h,
    startCx: o.x,
    startCy: o.y,
    startMouseAngle: Math.atan2(wy - o.y, wx - o.x),
    startMouseWorld: { x: wx, y: wy },
  };
}

/*
  updateObstacleHandleDrag — called from input.js onMouseMove while
  STATE.obHandle is set. Mutates the obstacle directly in MAP.obstacles.
*/
function updateObstacleHandleDrag(wx, wy, shiftKey) {
  const d = STATE.obHandle;
  if (!d) return;

  const o = MAP.obstacles.find((ob) => ob.id === d.id)
         || MAP.barricades.find((ob) => ob.id === d.id);
  if (!o) return;
  const obType = MAP.barricades.find((ob) => ob.id === d.id) ? 'barricade' : 'obstacle';

  if (d.handle.key === "rotate") {
    // ── ROTATE ────────────────────────────────────────────────
    let newAngle =
      d.startAngle +
      (Math.atan2(wy - d.startCy, wx - d.startCx) - d.startMouseAngle);
    if (shiftKey) {
      // Snap to 15° increments when Shift is held
      const snap = Math.PI / 12;
      newAngle = Math.round(newAngle / snap) * snap;
    }
    const candidate = { ...o, angle: newAngle };
    if (!checkOverlap(obType, candidate, o.id)) {
      o.angle = newAngle;
    }
  } else {
    // ── RESIZE ────────────────────────────────────────────────
    //
    // Transform current mouse into obstacle's local frame at drag-start.
    // The dragged handle tells us which axes change; the opposite edge is pinned.
    //
    const angle = d.startAngle;
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);

    const dmx = wx - d.startCx;
    const dmy = wy - d.startCy;
    const lmx = dmx * cos - dmy * sin; // local mouse x
    const lmy = dmx * sin + dmy * cos; // local mouse y

    const hkey = d.handle.key;
    const MIN = 1; // minimum 1m in any dimension

    let newW = d.startW;
    let newH = d.startH;
    let newCx = d.startCx;
    let newCy = d.startCy;

    const movesRight = hkey === "ne" || hkey === "e" || hkey === "se";
    const movesLeft = hkey === "nw" || hkey === "w" || hkey === "sw";
    const movesBottom = hkey === "se" || hkey === "s" || hkey === "sw";
    const movesTop = hkey === "ne" || hkey === "n" || hkey === "nw";

    if (movesRight) {
      const newHW = Math.max(MIN / 2, lmx);
      newW = newHW * 2;
      const pinLx = -d.startW / 2;
      newCx = d.startCx + (pinLx + newHW) * Math.cos(angle);
      newCy = d.startCy + (pinLx + newHW) * Math.sin(angle);
    } else if (movesLeft) {
      const newHW = Math.max(MIN / 2, -lmx);
      newW = newHW * 2;
      const pinLx = d.startW / 2;
      newCx = d.startCx + (pinLx - newHW) * Math.cos(angle);
      newCy = d.startCy + (pinLx - newHW) * Math.sin(angle);
    }

    if (movesBottom) {
      const newHH = Math.max(MIN / 2, lmy);
      newH = newHH * 2;
      const pinLy = -d.startH / 2;
      newCx = newCx + (pinLy + newHH) * -Math.sin(angle);
      newCy = newCy + (pinLy + newHH) * Math.cos(angle);
    } else if (movesTop) {
      const newHH = Math.max(MIN / 2, -lmy);
      newH = newHH * 2;
      const pinLy = d.startH / 2;
      newCx = newCx + (pinLy - newHH) * -Math.sin(angle);
      newCy = newCy + (pinLy - newHH) * Math.cos(angle);
    }

    const candidate = { ...o, w: newW, h: newH, x: newCx, y: newCy, angle: d.startAngle };
    if (!checkOverlap(obType, candidate, o.id)) {
      o.w = newW;
      o.h = newH;
      o.x = newCx;
      o.y = newCy;
      o.angle = d.startAngle; // angle unchanged during resize
    }
  }

  ctxUi.clearRect(0, 0, canvasUi.width, canvasUi.height);
  drawMapLayer();
  drawObstacleHandles(o);
  updateElemList();
  renderProps();
}

/*
  endObstacleHandleDrag — called from input.js onMouseUp.
*/
function endObstacleHandleDrag() {
  STATE.obHandle = null;
  ctxUi.clearRect(0, 0, canvasUi.width, canvasUi.height);
  drawAll();
  // Redraw handles after final drawAll so they sit on top
  const o = MAP.obstacles.find((ob) => ob.id === STATE.selectedId)
         || MAP.barricades.find((ob) => ob.id === STATE.selectedId);
  if (o) drawObstacleHandles(o);
}

/*
  getCursorForHandle — returns CSS cursor string for a handle key.
*/
function getCursorForHandle(key) {
  switch (key) {
    case "rotate":
      return "crosshair";
    case "nw":
    case "se":
      return "nwse-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    default:
      return "default";
  }
}

/* ================================================================
   MODULE: SELECTION & PROPERTIES
   ================================================================ */
function selectElement(id) {
  STATE.selectedId = id;
  STATE.obHandle = null;
  renderProps();
  drawMapLayer();
  // Draw handles on top if an obstacle or barricade is selected
  ctxUi.clearRect(0, 0, canvasUi.width, canvasUi.height);
  if (id) {
    const o = MAP.obstacles.find((ob) => ob.id === id)
           || MAP.barricades.find((ob) => ob.id === id);
    if (o) drawObstacleHandles(o);
  }
  // Highlight in element list
  document.querySelectorAll(".elem-item").forEach((el) => {
    el.classList.toggle("selected", el.dataset.id === id);
  });
}

function renderProps() {
  const panel = document.getElementById("props-content");
  const id = STATE.selectedId;
  if (!id) {
    panel.innerHTML = '<p class="no-selection">Nothing selected</p>';
    return;
  }
  const elem = findElem(id);
  if (!elem) {
    panel.innerHTML = '<p class="no-selection">Nothing selected</p>';
    return;
  }

  let html = "";
  const field = (
    label,
    key,
    type = "text",
    options = null,
    defaultVal = undefined,
  ) => {
    let val = elem[key];
    if (val === undefined) {
      val =
        defaultVal !== undefined
          ? defaultVal
          : type === "checkbox"
            ? false
            : "";
    }
    if (type === "checkbox") {
      return `<div class="prop-row">
        <label style="display:flex;align-items:center;gap:8px;font-family:'DM Mono',monospace;font-size:0.65rem;color:var(--text);cursor:pointer;flex-direction:row-reverse;justify-content:space-between;width:100%">
          <input class="prop-input" type="checkbox" ${val ? "checked" : ""} onchange="updateProp('${id}','${key}',this.checked, false, true)">
          ${label}
        </label>
      </div>`;
    }
    if (type === "select" && options) {
      return `<div class="prop-row">
        <div class="prop-label">${label}</div>
        <select class="prop-input" onchange="updateProp('${id}','${key}',this.value)">
          ${options.map((o) => `<option value="${o.v}" ${o.v == val ? "selected" : ""}>${o.l}</option>`).join("")}
        </select></div>`;
    }
    return `<div class="prop-row">
      <div class="prop-label">${label}</div>
      <input class="prop-input" type="${type === "number" ? "number" : "text"}" value="${val}"
        onchange="updateProp('${id}','${key}',this.value${type === "number" ? ",true" : ""})">
    </div>`;
  };

  html += field("Label", "label");
  html += field("X (m)", "x", "number");
  html += field("Y (m)", "y", "number");

  const type = [...MAP.entries].find((e) => e.id === id)
    ? "entry"
    : [...MAP.exits].find((e) => e.id === id)
      ? "exit"
      : [...MAP.zones].find((e) => e.id === id)
        ? "zone"
        : [...MAP.chaos].find((e) => e.id === id)
          ? "chaos"
          : [...MAP.barricades].find((e) => e.id === id)
            ? "barricade"
            : "obstacle";

  if (type === "entry") {
    html += field("Spawn Rate (ppl/min)", "spawnRate", "number");
    html += field(
      "Turn to Exit on Evac",
      "convertToExit",
      "checkbox",
      null,
      true,
    );
  }
  if (type === "exit") {
    html += field("Capacity (ppl/min)", "capacity", "number");
    html += field("Width (m)", "width", "number");
  }
  if (type === "zone") {
    html += field("Width (m)", "w", "number");
    html += field("Height (m)", "h", "number");
    html += field("Attraction (0–1)", "attraction", "number");
    html += field("Type", "type", "select", [
      { v: "stage", l: "🎭 Stage" },
      { v: "food", l: "🍕 Food Court" },
      { v: "rest", l: "🛋 Rest Area" },
      { v: "general", l: "🏟 General" },
    ]);
  }
  if (type === "obstacle") {
    html += field("Width (m)", "w", "number");
    html += field("Height (m)", "h", "number");
    // Rotation shown in degrees; stored internally as radians
    const angleDeg = ((((elem.angle || 0) * 180) / Math.PI) % 360).toFixed(1);
    html += `<div class="prop-row">
      <div class="prop-label">Rotation (°)</div>
      <input class="prop-input" type="number" step="1" value="${angleDeg}"
        onchange="updateObstacleAngleDeg('${id}', this.value)">
    </div>`;
    html += `<div style="font-family:'DM Mono',monospace;font-size:0.55rem;color:var(--dim);margin-top:4px;padding:0 2px;line-height:1.5">
      💡 Drag corner/edge handles to resize.<br>Drag the yellow ● above to rotate.<br>Hold <b>Shift</b> to snap to 15°.
    </div>`;
  }
  if (type === "barricade") {
    html += field("Width (m)", "w", "number");
    html += field("Height (m)", "h", "number");
    const angleDegB = ((((elem.angle || 0) * 180) / Math.PI) % 360).toFixed(1);
    html += `<div class="prop-row">
      <div class="prop-label">Rotation (°)</div>
      <input class="prop-input" type="number" step="1" value="${angleDegB}"
        onchange="updateBarricadeAngleDeg('${id}', this.value)">
    </div>`;
    html += field("Max Durability", "maxDurability", "number");
    const durPct = elem.maxDurability > 0 ? (elem.durability / elem.maxDurability * 100).toFixed(0) : 0;
    const durCol = durPct > 60 ? 'var(--green)' : durPct > 25 ? '#f59e0b' : 'var(--red)';
    html += `<div class="prop-row">
      <div class="prop-label">Durability: ${Math.ceil(elem.durability)} / ${elem.maxDurability}</div>
      <div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden">
        <div style="height:100%;width:${durPct}%;background:${durCol};border-radius:2px;transition:width 0.3s"></div>
      </div>
    </div>`;
    html += `<div style="font-family:'DM Mono',monospace;font-size:0.55rem;color:var(--dim);margin-top:4px;padding:0 2px;line-height:1.5">
      🧱 Breakable barrier. Blocks agents until durability reaches 0 from crowd pressure during evacuation.
    </div>`;
  }
  if (type === "chaos") {
    html += field("Width (m)", "w", "number");
    html += field("Height (m)", "h", "number");
    html += field("Intensity (0–5)", "intensity", "number");
  }

  html += `<button class="sm-btn danger" onclick="deleteElement('${id}')" style="margin-top:6px">🗑 Delete</button>`;
  panel.innerHTML = html;
}

/*
  updateObstacleAngleDeg — called from the Rotation (°) props input.
  Converts degrees → radians, stores on obstacle, redraws.
*/
function updateObstacleAngleDeg(id, degrees) {
  const o = MAP.obstacles.find((ob) => ob.id === id);
  if (!o) return;
  o.angle = (parseFloat(degrees) * Math.PI) / 180;
  ctxUi.clearRect(0, 0, canvasUi.width, canvasUi.height);
  drawMapLayer();
  drawObstacleHandles(o);
}

function updateBarricadeAngleDeg(id, degrees) {
  const b = MAP.barricades.find((ob) => ob.id === id);
  if (!b) return;
  b.angle = (parseFloat(degrees) * Math.PI) / 180;
  ctxUi.clearRect(0, 0, canvasUi.width, canvasUi.height);
  drawMapLayer();
  drawObstacleHandles(b);
}

function updateProp(id, key, value, numeric = false, isBoolean = false) {
  const elem = findElem(id);
  if (!elem) return;
  elem[key] = isBoolean ? value : numeric ? parseFloat(value) : value;
  // Sync barricade durability when maxDurability changes
  if (key === 'maxDurability' && elem.durability !== undefined) {
    elem.durability = Math.min(elem.durability, elem.maxDurability);
  }
  // Redraw handles if the changed element is the selected obstacle/barricade
  const o = MAP.obstacles.find((ob) => ob.id === id)
         || MAP.barricades.find((ob) => ob.id === id);
  if (o && STATE.selectedId === id) {
    ctxUi.clearRect(0, 0, canvasUi.width, canvasUi.height);
    drawMapLayer();
    drawObstacleHandles(o);
  } else {
    drawMapLayer();
  }
  updateElemList();
  renderProps();
}

function updateElemList() {
  const list = document.getElementById("elem-list");
  const all = [
    ...MAP.entries.map((e) => ({ ...e, _type: "entry", col: "#22c55e" })),
    ...MAP.exits.map((e) => ({ ...e, _type: "exit", col: "#3b82f6" })),
    ...MAP.zones.map((e) => ({ ...e, _type: "zone", col: "#a855f7" })),
    ...MAP.obstacles.map((e) => ({ ...e, _type: "obs", col: "#ef4444" })),
    ...MAP.barricades.map((e) => ({ ...e, _type: "barr", col: e.broken ? "#6b7280" : "#f59e0b" })),
    ...MAP.chaos.map((e) => ({ ...e, _type: "chaos", col: getComputedStyle(document.documentElement).getPropertyValue('--chaos-col').trim() || "#ffffff" })),
  ];
  document.getElementById("elem-count").textContent = `(${all.length})`;
  list.innerHTML = all
    .map(
      (e) => `
    <div class="elem-item ${STATE.selectedId === e.id ? "selected" : ""}" data-id="${e.id}" onclick="selectElement('${e.id}')">
      <div class="elem-dot" style="background:${e.col}"></div>
      <span class="elem-name">${e.label || e._type}</span>
      <span class="elem-del" onclick="event.stopPropagation();deleteElement('${e.id}')">✕</span>
    </div>`,
    )
    .join("");
}
