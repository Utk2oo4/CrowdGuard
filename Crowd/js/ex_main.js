

/* ================================================================
   MODULE: FLOORPLAN
   ================================================================ */
function loadFloorplan(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => { STATE.floorplanImg = img; drawBackground(); };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function clearFloorplan() { STATE.floorplanImg = null; drawBackground(); }

/* ================================================================
   MODULE: SAVE / LOAD MAP
   ================================================================ */
function saveMapToJSON() {
  const data = JSON.stringify({ MAP, WORLD, version: 2 }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'crowdguard-map.json';
  a.click();
}

function loadMapFromFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      Object.assign(MAP, data.MAP);
      updateElemList();
      drawAll();
    } catch (e) { alert('Invalid map file'); }
  };
  reader.readAsText(file);
  input.value = '';
}

function loadDefaultMap() {
  MAP.entries = [
    { id: newId(), x: 10,  y: 75,  spawnRate: 80,  label: 'North Gate' },
    { id: newId(), x: 100, y: 10,  spawnRate: 60,  label: 'West Gate'  },
    { id: newId(), x: 190, y: 75,  spawnRate: 100, label: 'East Gate'  },
  ];
  MAP.exits = [
    { id: newId(), x: 10,  y: 40,  capacity: 120, width: 3, label: 'Exit A' },
    { id: newId(), x: 10,  y: 110, capacity: 90,  width: 2, label: 'Exit B' },
    { id: newId(), x: 190, y: 40,  capacity: 150, width: 4, label: 'Exit C' },
    { id: newId(), x: 100, y: 140, capacity: 80,  width: 2, label: 'Exit D' },
  ];
  MAP.zones = [
    { id: newId(), x: 60, y: 40, w: 80, h: 50, type: 'stage',   attraction: 0.70, label: 'Main Stage' },
    { id: newId(), x: 10, y: 90, w: 35, h: 40, type: 'food',    attraction: 0.20, label: 'Food Court' },
    { id: newId(), x: 155,y: 90, w: 35, h: 40, type: 'rest',    attraction: 0.10, label: 'Rest Area'  },
  ];
  MAP.obstacles = [
    { id: newId(), x: 45,  y: 30, w: 5,  h: 90, label: 'Barrier L' },
    { id: newId(), x: 150, y: 30, w: 5,  h: 90, label: 'Barrier R' },
    { id: newId(), x: 85,  y: 10, w: 30, h: 5,  label: 'Stage Wall' },
  ];
  MAP.boundary = [
    {x:5,y:5},{x:195,y:5},{x:195,y:145},{x:5,y:145}
  ];
  elemIdCounter += 20;
  updateElemList();
  STATE.panX = WORLD.w / 2; STATE.panY = WORLD.h / 2;
  STATE.zoom = Math.min(wrap.clientWidth / WORLD.w, wrap.clientHeight / WORLD.h) * 0.9;
  drawAll();
}

/* ================================================================
   MODULE: AGENT SIMULATION (Stubs — Part 2 will fill these)
   ================================================================ */
// Simulation config
let SIM_SPEED = 1;
let AGENT_DRAW_R = 2;
let SHOW_HEAT = true;
let SHOW_VEL = false;
let SHOW_TRAIL = false;
let SHOW_DANGER = true;
let SPAWN_MULT = 1.0;
let totalSpawned = 0;

// Spawn burst animations [{x,y,r,alpha,col}]
const spawnBursts = [];

// Agent arrays (Float32 for perf)
let MAX_AGENTS = 3000;  // supports 2000+ agents smoothly
let ax, ay, avx, avy, apanic, aalive, atarget, atype;
// atype: 0=entering 1=gathering 2=evacuating
let agentCount = 0;
let simStartTime = 0;
let simElapsed = 0;
let spawnAccumulators = [];
let simTick = 0;
let evacuatedCount = 0;
let simPaused = false;
let simLoopId = null;

// Density grid (world units / 5 = cells)
const DCELL = 5; // 5m per density cell
const DGW = Math.ceil(WORLD.w / DCELL);
const DGH = Math.ceil(WORLD.h / DCELL);
const densityGrid = new Float32Array(DGW * DGH);

// Spatial hash
const SCELL = 4;
const SGW = Math.ceil(WORLD.w / SCELL);
const SGH = Math.ceil(WORLD.h / SCELL);
let spatialGrid = [];

// Stats history for export
const statsHistory = [];

function initSim() {
  ax      = new Float32Array(MAX_AGENTS);
  ay      = new Float32Array(MAX_AGENTS);
  avx     = new Float32Array(MAX_AGENTS);
  avy     = new Float32Array(MAX_AGENTS);
  apanic  = new Float32Array(MAX_AGENTS);
  aalive  = new Uint8Array(MAX_AGENTS);
  atarget = new Uint16Array(MAX_AGENTS); // zone index
  atype   = new Uint8Array(MAX_AGENTS);
  agentCount = 0;
  evacuatedCount = 0;
  totalSpawned = 0;
  simTick = 0;
  simElapsed = 0;
  simStartTime = performance.now();
  spawnAccumulators = MAP.entries.map(() => 0);
  statsHistory.length = 0;
  spawnBursts.length = 0;
  STATE.phase = 'idle';
  updatePhaseUI();
  renderEntrySpawnList();
}

function resetSim() { stopSimLoop(); initSim(); ctxAgents.clearRect(0,0,canvasAgents.width,canvasAgents.height); updateSimStats(); }

function togglePause() {
  simPaused = !simPaused;
  document.getElementById('btn-play-pause').textContent = simPaused ? '▶ Resume' : '⏸ Pause';
  if (!simPaused && simLoopId === null) startSimLoop();
}

function startSimLoop() {
  simPaused = false;
  if (simLoopId) return;
let _lastTs = 0, _fpsSmooth = 60;
  function loop(ts) {
    if (!simPaused && STATE.mode === 'sim') {
      // FPS tracking
      if (_lastTs) {
        const fps = 1000 / (ts - _lastTs);
        _fpsSmooth = _fpsSmooth * 0.9 + fps * 0.1;
        if (simTick % 20 === 0) {
          const el = document.getElementById('fps-counter');
          if (el) el.textContent = _fpsSmooth.toFixed(0);
        }
      }
      _lastTs = ts;
      const steps = Math.max(1, Math.round(SIM_SPEED));
      for (let s = 0; s < steps; s++) simStep();
      renderSim();
    }
    simLoopId = requestAnimationFrame(loop);
  }
  simLoopId = requestAnimationFrame(loop);
}

function stopSimLoop() {
  if (simLoopId) { cancelAnimationFrame(simLoopId); simLoopId = null; }
}

function triggerPhase(phase) {
  STATE.phase = phase;
  updatePhaseUI();
  // Ensure we redraw MapLayer in case entries converted to exits or vice-versa
  if (typeof drawMapLayer === 'function') drawMapLayer();
}

function updatePhaseUI() {
  const pi = document.getElementById('phase-indicator');
  const labels = { idle:'IDLE', entry:'ENTRY PHASE', buildup:'CROWD BUILDUP', evac:'EVACUATION', chaos:'CHAOS EVACUATION' };
  const cls    = { idle:'ph-idle', entry:'ph-entry', buildup:'ph-buildup', evac:'ph-evac', chaos:'ph-evac' };
  pi.textContent = labels[STATE.phase] || 'IDLE';
  pi.className = cls[STATE.phase] || 'ph-idle';

  const hint = document.getElementById('spawn-phase-hint');
  if (hint) {
    const hintText = {
      idle:    'Press <span style="color:var(--green)">START EVENT</span> to begin spawning agents from entry points.',
      entry:   '🟢 <span style="color:var(--green)">Agents are spawning</span> from entry points below. Watch them stream in!',
      buildup: '🟡 <span style="color:var(--yellow)">Entry closed.</span> Agents wander toward attraction zones.',
      evac:    '🔴 <span style="color:var(--red)">EVACUATION active.</span> All agents heading to exits.',
      chaos:   '💀 <span style="color:#fff">CHAOS active.</span> Agents fleeing from chaos sources towards exits.',
    };
    hint.innerHTML = `<span style="font-family:'DM Mono',monospace;font-size:0.6rem">${hintText[STATE.phase] || ''}</span>`;
  }
  renderEntrySpawnList();
}

// Renders per-entry spawn rate cards in the sidebar
function renderEntrySpawnList() {
  const el = document.getElementById('entry-spawn-list');
  if (!el) return;
  if (MAP.entries.length === 0) {
    el.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:0.6rem;color:var(--dim);font-style:italic">No entry points on map.<br>Go to Map Editor → add Entry.</div>';
    return;
  }
  el.innerHTML = MAP.entries.map((entry, ei) => {
    const isActive = STATE.phase === 'entry';
    return `
    <div style="background:var(--surface2);border:1px solid ${isActive ? 'rgba(34,197,94,0.4)' : 'var(--border)'};border-radius:4px;padding:8px 10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <span style="font-family:'DM Mono',monospace;font-size:0.65rem;color:var(--text)">${entry.label || 'Entry ' + (ei+1)}</span>
        ${isActive ? '<span style="font-size:0.55rem;color:var(--green);font-family:\'DM Mono\',monospace;animation:pulse 1s infinite">● ACTIVE</span>' : '<span style="font-size:0.55rem;color:var(--dim);font-family:\'DM Mono\',monospace">○ IDLE</span>'}
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <div style="flex:1">
          <div style="font-family:'DM Mono',monospace;font-size:0.55rem;color:var(--dim);margin-bottom:2px">Spawn rate (ppl/min)</div>
          <input type="number" min="1" max="500" value="${entry.spawnRate}"
            style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);font-family:'DM Mono',monospace;font-size:0.7rem;padding:3px 6px;border-radius:3px"
            onchange="MAP.entries[${ei}].spawnRate=parseInt(this.value);renderEntrySpawnList()">
        </div>
        <button onclick="dropFromEntry(${ei},20)" title="Instantly drop 20 agents here"
          style="flex-shrink:0;font-family:'DM Mono',monospace;font-size:0.6rem;padding:4px 8px;border:1px solid var(--green);background:transparent;color:var(--green);cursor:pointer;border-radius:3px">
          +20
        </button>
      </div>
      <div style="margin-top:5px">
        <div style="height:2px;background:var(--border);border-radius:1px">
          <div style="height:100%;background:var(--green);border-radius:1px;width:${isActive ? '100%' : '0%'};transition:width 0.5s"></div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// Instantly drop N agents distributed across all entry points
function dropCrowd(n) {
  if (MAP.entries.length === 0) {
    alert('Add at least one Entry point on the map first!');
    return;
  }
  const perEntry = Math.ceil(n / MAP.entries.length);
  MAP.entries.forEach((entry, ei) => dropFromEntry(ei, perEntry));
}

// Drop n agents from a specific entry point
function dropFromEntry(entryIdx, n) {
  const entry = MAP.entries[entryIdx];
  if (!entry) return;
  if (STATE.phase === 'idle') {
    // Auto-start if idle — make them visible
    STATE.phase = 'entry';
    updatePhaseUI();
  }
  let added = 0;
  for (let k = 0; k < n && agentCount < MAX_AGENTS; k++) {
    const idx = agentCount++;
    totalSpawned++;
    // Scatter within ~3m of entry
    ax[idx]  = entry.x + (Math.random() - 0.5) * 4;
    ay[idx]  = entry.y + (Math.random() - 0.5) * 4;
    avx[idx] = 0; avy[idx] = 0;
    apanic[idx] = 0;
    aalive[idx] = 1;
    atype[idx] = 0;
    // Weighted zone target
    const roll = Math.random();
    let cumul = 0;
    atarget[idx] = 0;
    for (let zi = 0; zi < MAP.zones.length; zi++) {
      cumul += (MAP.zones[zi].attraction || 0.5);
      if (roll <= cumul) { atarget[idx] = zi; break; }
    }
    added++;
  }
  // Trigger spawn burst visual
  const p = w2s(entry.x, entry.y);
  spawnBursts.push({ x: entry.x, y: entry.y, r: 0, maxR: 8, alpha: 1, col: '#22c55e', count: added });
}

// ── SIMULATION STEP (Part 2 — Physics)
const INERTIA      = 0.84;
const AGENT_RADIUS = 0.8;  // metres
const BASE_SPEED   = 0.04; // m/frame (~1.4 m/s walking pace)

// Pre-allocate spatial grid buckets to avoid GC pressure
const _sgBuckets = Array.from({length: SGW * SGH}, () => []);

function buildSpatialGrid() {
  // Clear without reallocating
  for (let k = 0; k < _sgBuckets.length; k++) _sgBuckets[k].length = 0;
  spatialGrid = _sgBuckets;
  for (let i = 0; i < agentCount; i++) {
    if (!aalive[i]) continue;
    const cx = Math.min(SGW-1, Math.floor(ax[i] / SCELL)) | 0;
    const cy = Math.min(SGH-1, Math.floor(ay[i] / SCELL)) | 0;
    _sgBuckets[cy * SGW + cx].push(i);
  }
}

function getNeighbors(x, y, radius) {
  const result = [];
  const r = Math.ceil(radius / SCELL);
  const cx0 = Math.max(0, Math.floor(x / SCELL) - r);
  const cx1 = Math.min(SGW-1, Math.floor(x / SCELL) + r);
  const cy0 = Math.max(0, Math.floor(y / SCELL) - r);
  const cy1 = Math.min(SGH-1, Math.floor(y / SCELL) + r);
  for (let cy = cy0; cy <= cy1; cy++)
    for (let cx = cx0; cx <= cx1; cx++)
      for (const j of spatialGrid[cy * SGW + cx]) result.push(j);
  return result;
}

function nearestExit(x, y) {
  let best = null, bestD = Infinity;
  for (const ex of MAP.exits) {
    const d = Math.hypot(x - ex.x, y - ex.y);
    if (d < bestD) { bestD = d; best = ex; }
  }
  return { exit: best, dist: bestD };
}

function isInObstacle(x, y) {
  for (const o of MAP.obstacles) {
    if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) return true;
  }
  return false;
}

function inBoundary(x, y) {
  if (MAP.boundary.length < 3) return x >= 0 && x <= WORLD.w && y >= 0 && y <= WORLD.h;
  // Ray cast
  let inside = false;
  const pts = MAP.boundary;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) {
    const rx = px - x1, ry = py - y1;
    return { dist: Math.hypot(rx, ry), rx, ry };
  }
  let t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
  const projX = x1 + t * dx, projY = y1 + t * dy;
  const rx = px - projX, ry = py - projY;
  return { dist: Math.hypot(rx, ry), rx, ry };
}

function spawnAgents() {
  if (STATE.phase !== 'entry') return;
  const dt = 1 / 60;
  MAP.entries.forEach((entry, ei) => {
    spawnAccumulators[ei] = (spawnAccumulators[ei] || 0) + entry.spawnRate * SPAWN_MULT * dt / 60;
    let justSpawned = 0;
    while (spawnAccumulators[ei] >= 1 && agentCount < MAX_AGENTS) {
      spawnAccumulators[ei] -= 1;
      const idx = agentCount++;
      totalSpawned++;
      ax[idx]  = entry.x + (Math.random() - 0.5) * 3;
      ay[idx]  = entry.y + (Math.random() - 0.5) * 3;
      avx[idx] = 0; avy[idx] = 0;
      apanic[idx] = 0;
      aalive[idx] = 1;
      atype[idx] = 0;
      const roll = Math.random();
      let cumul = 0;
      atarget[idx] = 0;
      for (let zi = 0; zi < MAP.zones.length; zi++) {
        cumul += (MAP.zones[zi].attraction || 0.5);
        if (roll <= cumul) { atarget[idx] = zi; break; }
      }
      justSpawned++;
    }
    // Spawn burst animation every ~10 new agents
    if (justSpawned > 0 && simTick % 10 === ei % 10) {
      spawnBursts.push({ x: entry.x, y: entry.y, r: 0, maxR: 6, alpha: 0.8, col: '#22c55e', count: justSpawned });
    }
  });
}

function simStep() {
  simTick++;
  simElapsed += 1 / 60; // virtual time: advances in sync with SIM_SPEED

  spawnAgents();
  buildSpatialGrid();

  // Pre-compute exit list handles potential converted entries
  let allExits = MAP.exits;
  if (STATE.phase === 'evac' || STATE.phase === 'chaos') {
    allExits = [
      ...MAP.exits,
      ...MAP.entries.filter(e => e.convertToExit).map(e => ({
        ...e,
        isEntryConverted: true,
        capacity: 120, // default exit capacity for converted entries
        width: 2
      }))
    ];
  }
  
  // Pre-compute exit queue counts for capacity throttling
  const exitQueues = allExits.map(() => 0);
  for (let i = 0; i < agentCount; i++) {
    if (!aalive[i]) continue;
    if (STATE.phase === 'evac' || STATE.phase === 'chaos') {
      let bestD = Infinity, bestEi = 0, isRealExit = true;
      
      for (let ei = 0; ei < allExits.length; ei++) {
        let inChaos = false;
        if (STATE.phase === 'chaos') {
          for (const c of MAP.chaos) {
            if (allExits[ei].x >= c.x && allExits[ei].x <= c.x + c.w &&
                allExits[ei].y >= c.y && allExits[ei].y <= c.y + c.h) {
              inChaos = true; break;
            }
          }
        }
        if (inChaos) continue;

        const d = Math.hypot(ax[i] - allExits[ei].x, ay[i] - allExits[ei].y);
        if (d < bestD) { bestD = d; bestEi = ei; isRealExit = !allExits[ei].isEntryConverted; }
      }
      if (bestD < 15 && bestD !== Infinity && isRealExit) exitQueues[bestEi]++; // Only queue count real exits for simplicity
    }
  }

  // Panic spread pass
  if (STATE.phase === 'evac' || STATE.phase === 'chaos') {
    for (let i = 0; i < agentCount; i++) {
      if (!aalive[i] || apanic[i] < 0.5) continue;
      const nb = getNeighbors(ax[i], ay[i], 4);
      for (const j of nb) {
        if (j !== i && aalive[j]) apanic[j] = Math.min(1, apanic[j] + 0.004);
      }
    }
  }

  const nx = new Float32Array(agentCount);
  const ny = new Float32Array(agentCount);
  for (let i = 0; i < agentCount; i++) { nx[i] = ax[i]; ny[i] = ay[i]; }

  for (let i = 0; i < agentCount; i++) {
    if (!aalive[i]) continue;
    const x = ax[i], y = ay[i];

    // Panic decay toward 0 in calm phases, rise in evac
    if (STATE.phase === 'evac' || STATE.phase === 'chaos') {
      apanic[i] = Math.min(1, apanic[i] + (STATE.phase === 'chaos' ? 0.005 : 0.001));
    } else {
      apanic[i] = Math.max(0, apanic[i] - 0.003);
    }
    const pf = apanic[i];
    const speed = BASE_SPEED * (1 + pf * 0.7);

    let tx = x, ty = y;
    let shouldMove = true;

    // ── PHASE: EVAC / CHAOS ──────────────────────────────────────────
    if (STATE.phase === 'evac' || STATE.phase === 'chaos') {
      // Find nearest exit with remaining capacity
      let bestD = Infinity, bestEx = null, bestEi = -1;
      for (let ei = 0; ei < allExits.length; ei++) {
        const ex = allExits[ei];
        let inChaos = false;
        if (STATE.phase === 'chaos') {
          for (const c of MAP.chaos) {
            if (ex.x >= c.x && ex.x <= c.x + c.w &&
                ex.y >= c.y && ex.y <= c.y + c.h) {
              inChaos = true; break;
            }
          }
        }
        if (inChaos) continue;

        const d = Math.hypot(x - ex.x, y - ex.y);
        // Capacity throttle: slow agents if queue is over capacity
        const queuePenalty = exitQueues[ei] > ex.capacity / 6 ? d * 0.3 : 0;
        if (d + queuePenalty < bestD) { bestD = d + queuePenalty; bestEx = ex; bestEi = ei; }
      }
      if (bestEx) {
        tx = bestEx.x; ty = bestEx.y;
        // Remove agent when close enough (within exit width)
        const realDist = Math.hypot(x - bestEx.x, y - bestEx.y);
        const exitR = Math.max(bestEx.width || 2, 1.5);
        if (realDist < exitR) {
          // Throttle by capacity: only let through capacity/60 per second per tick
          const maxPerTick = (bestEx.capacity / 60) / 60;
          if (Math.random() < maxPerTick + 0.02) {
            aalive[i] = 0; evacuatedCount++; continue;
          }
        }
      }

    // ── PHASE: ENTRY ─────────────────────────────────────────
    } else if (STATE.phase === 'entry') {
      const zone = MAP.zones[atarget[i]];
      if (zone) {
        const cx = zone.x + zone.w / 2, cy = zone.y + zone.h / 2;
        const inZone = x >= zone.x && x <= zone.x+zone.w && y >= zone.y && y <= zone.y+zone.h;
        if (inZone) {
          // Wander slowly within zone
          if (simTick % 80 === i % 80) {
            atarget[i] = atarget[i]; // keep zone
          }
          tx = x + (Math.random()-0.5)*6;
          ty = y + (Math.random()-0.5)*6;
          atype[i] = 1; // mark as gathered
        } else {
          tx = cx; ty = cy;
        }
      } else if (MAP.zones.length === 0) {
        // No zones: spread into boundary
        tx = x + (Math.random()-0.5)*3;
        ty = y + (Math.random()-0.5)*3;
      }

    // ── PHASE: BUILDUP ───────────────────────────────────────
    } else if (STATE.phase === 'buildup') {
      const zone = MAP.zones[atarget[i]];
      if (zone) {
        const inZone = x >= zone.x && x <= zone.x+zone.w && y >= zone.y && y <= zone.y+zone.h;
        if (inZone) {
          // Occasionally switch to a different zone (browsing behaviour)
          if (simTick % 300 === i % 300 && Math.random() < 0.15) {
            let newTarget = pickWeightedZone();
            atarget[i] = newTarget;
          }
          // Wander inside zone
          tx = x + (Math.random()-0.5)*4;
          ty = y + (Math.random()-0.5)*4;
        } else {
          tx = zone.x + zone.w/2;
          ty = zone.y + zone.h/2;
        }
      }

    // ── PHASE: IDLE ──────────────────────────────────────────
    } else {
      shouldMove = false;
    }

    if (!shouldMove) { nx[i]=x; ny[i]=y; continue; }

    // Desired velocity toward target
    let ddx = tx - x, ddy = ty - y;
    const dd = Math.hypot(ddx, ddy);
    if (dd > 0.001) { ddx /= dd; ddy /= dd; }
    else { ddx = 0; ddy = 0; }
    let desVx = ddx * speed, desVy = ddy * speed;

    // Social force: Helbing exponential repulsion from neighbours
    let sfx = 0, sfy = 0;
    const nb = getNeighbors(x, y, AGENT_RADIUS * 5);
    for (const j of nb) {
      if (j === i || !aalive[j]) continue;
      let rx = x - ax[j], ry = y - ay[j];
      const rd = Math.hypot(rx, ry);
      const minD = AGENT_RADIUS * 2;
      if (rd < minD * 2.5 && rd > 0.001) {
        const overlap = minD - rd;
        const str = 0.45 * Math.exp(overlap / 0.7) * 0.28;
        sfx += (rx / rd) * str;
        sfy += (ry / rd) * str;
      }
    }

    // Chaos repulsion
    for (const c of MAP.chaos) {
      const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
      const clx = Math.max(c.x, Math.min(c.x+c.w, x));
      const cly = Math.max(c.y, Math.min(c.y+c.h, y));
      let crx = x - clx, cry = y - cly;
      let cd = Math.hypot(crx, cry);
      
      if (cd < 0.001) {
        crx = x - cx; cry = y - cy; cd = Math.hypot(crx, cry);
        if (cd < 0.001) { crx = 1; cry = 0; cd = 1; }
      }

      if (STATE.phase === 'chaos') {
        const effectRadius = Math.max(c.w, c.h)/2 + 20;
        const dCenter = Math.hypot(x - cx, y - cy);
        if (dCenter < effectRadius) {
           let force = (1 - dCenter/effectRadius) * (c.intensity || 1.0) * 4.0;
           sfx += (crx/cd) * force;
           sfy += (cry/cd) * force;
           if (dCenter < effectRadius * 0.7) apanic[i] = 1.0;
        }
      }
    }

    // Obstacle repulsion
    for (const o of MAP.obstacles) {
      const clx = Math.max(o.x, Math.min(o.x+o.w, x));
      const cly = Math.max(o.y, Math.min(o.y+o.h, y));
      const orx = x - clx, ory = y - cly;
      const od = Math.hypot(orx, ory);
      if (od < 3.5 && od > 0.001) {
        sfx += (orx/od) * Math.exp((1.5-od)/0.8) * 0.7;
        sfy += (ory/od) * Math.exp((1.5-od)/0.8) * 0.7;
      }
    }

    // Boundary / wall repulsion
    let isInsidePolygon = true;
    if (MAP.boundary && MAP.boundary.length > 2) {
      isInsidePolygon = inBoundary(x, y);
      
      if (!isInsidePolygon) {
        // STRANDED OUTSIDE: Pull strongly towards centroid
        let bCx = 0, bCy = 0;
        for (const pt of MAP.boundary) { bCx += pt.x; bCy += pt.y; }
        bCx /= MAP.boundary.length; bCy /= MAP.boundary.length;
        const fX = bCx - x, fY = bCy - y, fD = Math.hypot(fX, fY);
        if (fD > 0.001) {
          sfx += (fX / fD) * 1.5; // strong pull to center
          sfy += (fY / fD) * 1.5;
        }
      } else {
        // Polygon boundary repulsion
        const pts = MAP.boundary;
        for (let j = 0; j < pts.length; j++) {
          const p1 = pts[j];
          const p2 = pts[(j + 1) % pts.length]; // wrapping around
          
          const res = distToSegment(x, y, p1.x, p1.y, p2.x, p2.y);
          if (res.dist < 1.5 && res.dist > 0.001) {
            sfx += (res.rx / res.dist) * Math.exp((1.5 - res.dist) / 0.8) * 0.7;
            sfy += (res.ry / res.dist) * Math.exp((1.5 - res.dist) / 0.8) * 0.7;
          }
        }
      }
    } else {
      // Rectangular fallback
      const wr = 1.5;
      if (x < wr) sfx += Math.exp((wr-x)/0.8)*0.7;
      if (x > WORLD.w-wr) sfx -= Math.exp((x-(WORLD.w-wr))/0.8)*0.7;
      if (y < wr) sfy += Math.exp((wr-y)/0.8)*0.7;
      if (y > WORLD.h-wr) sfy -= Math.exp((y-(WORLD.h-wr))/0.8)*0.7;
      isInsidePolygon = (x >= 0 && x <= WORLD.w && y >= 0 && y <= WORLD.h);
    }

    // Panic noise — erratic push
    if (pf > 0.25) {
      desVx += (Math.random()-.5)*pf*BASE_SPEED*1.5;
      desVy += (Math.random()-.5)*pf*BASE_SPEED*1.5;
    }

    // Compose & clamp velocity
    let tvx = desVx + sfx, tvy = desVy + sfy;
    const tmag = Math.hypot(tvx, tvy);
    const maxV = speed * 1.6;
    if (tmag > maxV) { tvx *= maxV/tmag; tvy *= maxV/tmag; }

    // Inertia smoothing
    avx[i] = avx[i]*INERTIA + tvx*(1-INERTIA);
    avy[i] = avy[i]*INERTIA + tvy*(1-INERTIA);

    let newx = x + avx[i];
    let newy = y + avy[i];
    newx = Math.max(0.5, Math.min(WORLD.w-0.5, newx));
    newy = Math.max(0.5, Math.min(WORLD.h-0.5, newy));

    // Obstacle collision: try to slide
    if (isInObstacle(newx, newy)) {
      if (!isInObstacle(newx, y))   { newy = y;   avy[i] *= -0.1; }
      else if (!isInObstacle(x, newy)) { newx = x; avx[i] *= -0.1; }
      else { newx = x; newy = y; avx[i] *= -0.1; avy[i] *= -0.1; }
    }
    
    // Boundary Hard Constraint: Do not step outside the polygon if you are currently inside
    if (MAP.boundary && MAP.boundary.length > 2 && isInsidePolygon) {
       if (!inBoundary(newx, newy)) {
         if (inBoundary(newx, y)) { newy = y; avy[i] *= -0.5; }
         else if (inBoundary(x, newy)) { newx = x; avx[i] *= -0.5; }
         else { newx = x; newy = y; avx[i] *= -0.5; avy[i] *= -0.5; }
       }
    }

    nx[i] = newx; ny[i] = newy;
  }

  for (let i = 0; i < agentCount; i++) { ax[i] = nx[i]; ay[i] = ny[i]; }

  computeDensity();
  detectBottlenecks();
  updateSimStats();

  if (simTick % 60 === 0) {
    let peakD = 0;
    for (const v of densityGrid) if (v > peakD) peakD = v;
    statsHistory.push({
      time: simElapsed.toFixed(1),
      agents_alive: (() => { let c=0; for(let i=0;i<agentCount;i++) if(aalive[i])c++; return c; })(),
      total_spawned: totalSpawned,
      evacuated: evacuatedCount,
      peak_density: peakD.toFixed(2),
      phase: STATE.phase,
    });
  }
}

function pickWeightedZone() {
  if (MAP.zones.length === 0) return 0;
  const total = MAP.zones.reduce((s,z) => s + (z.attraction||0.5), 0);
  let roll = Math.random() * total, cumul = 0;
  for (let zi = 0; zi < MAP.zones.length; zi++) {
    cumul += (MAP.zones[zi].attraction||0.5);
    if (roll <= cumul) return zi;
  }
  return MAP.zones.length - 1;
}

function computeDensity() {
  densityGrid.fill(0);
  for (let i = 0; i < agentCount; i++) {
    if (!aalive[i]) continue;
    const cx = Math.min(DGW-1, Math.floor(ax[i] / DCELL));
    const cy = Math.min(DGH-1, Math.floor(ay[i] / DCELL));
    densityGrid[cy * DGW + cx]++;
  }
  // Convert count → density (people/m²)
  const cellArea = DCELL * DCELL;
  for (let i = 0; i < densityGrid.length; i++) densityGrid[i] /= cellArea;
}

const warnings = [];
function detectBottlenecks() {
  warnings.length = 0;
  let maxD = 0;

  // Scan density grid for hotspots
  const dangerCells = [];
  for (let i = 0; i < DGW * DGH; i++) {
    const d = densityGrid[i];
    if (d > maxD) maxD = d;
    if (d > 5) {
      const cx = (i % DGW) * DCELL + DCELL/2;
      const cy = Math.floor(i / DGW) * DCELL + DCELL/2;
      // Try to name the hotspot by zone
      let zoneName = null;
      for (const z of MAP.zones) {
        if (cx >= z.x && cx <= z.x+z.w && cy >= z.y && cy <= z.y+z.h) { zoneName = z.label || z.type; break; }
      }
      dangerCells.push({ cx, cy, d, zoneName });
    }
  }

  // Deduplicate danger cells into clusters
  const clusters = [];
  for (const cell of dangerCells) {
    let merged = false;
    for (const cl of clusters) {
      if (Math.hypot(cell.cx - cl.cx, cell.cy - cl.cy) < DCELL * 2) {
        cl.d = Math.max(cl.d, cell.d);
        cl.zoneName = cl.zoneName || cell.zoneName;
        merged = true; break;
      }
    }
    if (!merged) clusters.push({ ...cell });
  }

  // Generate warnings from clusters
  for (const cl of clusters.slice(0, 4)) {
    const label = cl.zoneName ? `"${cl.zoneName}"` : `(${cl.cx.toFixed(0)}m, ${cl.cy.toFixed(0)}m)`;
    warnings.push({ level:'danger', msg:`DANGER ${label}: ${cl.d.toFixed(1)} ppl/m²` });
  }

  // Medium-density warnings (crowded but not dangerous)
  let warnCount = 0;
  for (let i = 0; i < DGW * DGH; i++) {
    if (densityGrid[i] >= 2 && densityGrid[i] < 5 && warnCount < 2) {
      const cx = (i % DGW) * DCELL + DCELL/2;
      const cy = Math.floor(i / DGW) * DCELL + DCELL/2;
      let zoneName = null;
      for (const z of MAP.zones) {
        if (cx >= z.x && cx <= z.x+z.w && cy >= z.y && cy <= z.y+z.h) { zoneName = z.label||z.type; break; }
      }
      const label = zoneName ? `"${zoneName}"` : `(${cx.toFixed(0)}m,${cy.toFixed(0)}m)`;
      warnings.push({ level:'warn', msg:`Crowded at ${label}: ${densityGrid[i].toFixed(1)} ppl/m²` });
      warnCount++;
    }
  }

  // Exit capacity warnings during evacuation
  if (STATE.phase === 'evac' || STATE.phase === 'chaos') {
    let checkExits = MAP.exits;
    if (STATE.phase === 'evac' || STATE.phase === 'chaos') {
      checkExits = [...MAP.exits, ...MAP.entries.filter(e => e.convertToExit).map(e => ({...e, isEntryConverted: true, capacity: 120, width: 2}))];
    }
    for (const ex of checkExits) {
      // Count agents heading to this exit
      let queueLen = 0;
      for (let i = 0; i < agentCount; i++) {
        if (aalive[i] && Math.hypot(ax[i]-ex.x, ay[i]-ex.y) < 12) queueLen++;
      }
      const maxQueue = ex.capacity / 5;
      if (queueLen > maxQueue) {
        warnings.push({ level:'danger', msg:`${ex.label||'Exit'}: overloaded (${queueLen} queued, cap ${ex.capacity}/min)` });
      } else if (queueLen > maxQueue * 0.6) {
        warnings.push({ level:'warn', msg:`${ex.label||'Exit'}: congestion forming (${queueLen} queued)` });
      }
    }
    if (checkExits.length === 0) {
      warnings.push({ level:'danger', msg:'No exits on map! Add exits in Map Editor.' });
    }
  }

  // Update warning panel
  const wl = document.getElementById('warnings-list');
  if (warnings.length === 0) {
    wl.innerHTML = '<p class="no-selection" style="font-family:\'DM Mono\',monospace;font-size:0.6rem;color:var(--dim)">✓ All clear</p>';
  } else {
    wl.innerHTML = warnings.slice(0, 6).map(w =>
      `<div class="warning-item ${w.level}">⚠ ${w.msg}</div>`
    ).join('');
  }

  document.getElementById('sv-density').textContent = maxD.toFixed(1);
  document.getElementById('sc-density').className = 'stat-card ' + (maxD > 5 ? 'danger' : maxD > 2 ? 'warn' : 'safe');
}

function updateSimStats() {
  let alive = 0;
  for (let i = 0; i < agentCount; i++) if (aalive[i]) alive++;
  document.getElementById('sv-agents').textContent = alive;
  document.getElementById('sv-evac').textContent = evacuatedCount;
  document.getElementById('sv-time').textContent = simElapsed.toFixed(0) + 's';
  document.getElementById('sv-total').textContent = totalSpawned;
  const pct = totalSpawned > 0 ? (evacuatedCount / totalSpawned * 100).toFixed(0) : 0;
  document.getElementById('evac-progress').style.width = pct + '%';
  document.getElementById('evac-pct').textContent = pct + '% of spawned evacuated';
}

/* ================================================================
   MODULE: RENDERING (Simulation)
   ================================================================ */
// Offscreen density canvas
const densityCanvas = document.createElement('canvas');
densityCanvas.width = DGW; densityCanvas.height = DGH;
const densityCtx = densityCanvas.getContext('2d');

// Trail canvas
const trailCanvas = document.createElement('canvas');
const trailCtx = trailCanvas.getContext('2d');

function renderSim() {
  if (STATE.mode !== 'sim') return;
  const W = canvasAgents.width, H = canvasAgents.height;

  // Ensure trail canvas matches
  if (trailCanvas.width !== W || trailCanvas.height !== H) {
    trailCanvas.width = W; trailCanvas.height = H;
  }

  ctxAgents.clearRect(0, 0, W, H);

  // Trails (fade old)
  if (SHOW_TRAIL) {
    trailCtx.fillStyle = 'rgba(8,11,16,0.003)';
    trailCtx.fillRect(0, 0, W, H);
    for (let i = 0; i < agentCount; i++) {
      if (!aalive[i]) continue;
      const p = w2s(ax[i], ay[i]);
      trailCtx.fillStyle = apanic[i] > 0.5 ? 'rgba(255, 50, 50, 0.7)' : 'rgba(34, 211, 238, 0.4)';
      trailCtx.beginPath(); trailCtx.arc(p.x, p.y, Math.max(2.5, wScale(1.8)), 0, Math.PI*2); trailCtx.fill();
    }
    ctxAgents.drawImage(trailCanvas, 0, 0);
  }

  // Density heatmap
  if (SHOW_HEAT) renderDensityHeatmap(W, H);

  // Danger overlay
  if (SHOW_DANGER) renderDangerOverlay(W, H);

  // Map layer on top
  drawMapLayer();

  // Agents — batched by color group for performance
  const r = Math.max(AGENT_DRAW_R, wScale(AGENT_RADIUS * 0.5));
  const groups = { blue: [], green: [], orange: [], red: [] };

  for (let i = 0; i < agentCount; i++) {
    if (!aalive[i]) continue;
    const p = w2s(ax[i], ay[i]);
    const pf = apanic[i];
    let grp;
    if (STATE.phase === 'evac' || STATE.phase === 'chaos') grp = pf > 0.5 ? 'red' : 'orange';
    else if (atype[i] === 1)   grp = 'green';
    else                        grp = 'blue';
    groups[grp].push(p.x, p.y);
  }

  const colMap = { blue:'#3b82f6', green:'#22c55e', orange:'#f97316', red:'#ef4444' };
  for (const [grp, pts] of Object.entries(groups)) {
    if (pts.length === 0) continue;
    ctxAgents.fillStyle = colMap[grp];
    ctxAgents.beginPath();
    for (let k = 0; k < pts.length; k += 2) {
      ctxAgents.moveTo(pts[k] + r, pts[k+1]);
      ctxAgents.arc(pts[k], pts[k+1], r, 0, Math.PI * 2);
    }
    ctxAgents.fill();
  }

  // Velocity vectors (only when toggled, only sample every 3rd agent for perf)
  if (SHOW_VEL) {
    ctxAgents.lineWidth = 0.8;
    for (let i = 0; i < agentCount; i += 3) {
      if (!aalive[i]) continue;
      const vMag = Math.hypot(avx[i], avy[i]);
      if (vMag < 0.001) continue;
      const p = w2s(ax[i], ay[i]);
      const pf = apanic[i];
      let grp = (STATE.phase === 'evac' || STATE.phase === 'chaos') ? (pf > 0.5 ? 'red' : 'orange') : (atype[i] === 1 ? 'green' : 'blue');
      ctxAgents.strokeStyle = colMap[grp] + '70';
      ctxAgents.beginPath();
      ctxAgents.moveTo(p.x, p.y);
      ctxAgents.lineTo(p.x + avx[i]*wScale(8), p.y + avy[i]*wScale(8));
      ctxAgents.stroke();
    }
  }

  // Spawn burst ring animations
  for (let b = spawnBursts.length - 1; b >= 0; b--) {
    const burst = spawnBursts[b];
    const p = w2s(burst.x, burst.y);
    const sr = wScale(burst.r);
    ctxAgents.beginPath();
    ctxAgents.arc(p.x, p.y, Math.max(sr, 4), 0, Math.PI * 2);
    ctxAgents.strokeStyle = `rgba(34,197,94,${burst.alpha})`;
    ctxAgents.lineWidth = 2.5;
    ctxAgents.stroke();
    if (burst.alpha > 0.6 && burst.count > 1) {
      ctxAgents.fillStyle = `rgba(34,197,94,${burst.alpha})`;
      ctxAgents.font = `bold ${Math.max(11, wScale(1.6))}px DM Mono, monospace`;
      ctxAgents.textAlign = 'center';
      ctxAgents.fillText(`+${burst.count}`, p.x, p.y - Math.max(sr, 4) - 7);
    }
    burst.r  += 0.5;
    burst.alpha -= 0.035;
    if (burst.alpha <= 0) spawnBursts.splice(b, 1);
  }
}

function renderDensityHeatmap(W, H) {
  const img = densityCtx.createImageData(DGW, DGH);
  let maxD = 0;
  for (const v of densityGrid) if (v > maxD) maxD = v;
  if (maxD < 0.01) return;

  for (let i = 0; i < DGW * DGH; i++) {
    const t = Math.min(densityGrid[i] / 6, 1); // 6 p/m² = full
    if (t < 0.01) continue;
    const r = Math.floor(255 * Math.min(t * 2, 1));
    const g = Math.floor(255 * (t < 0.5 ? t * 2 : 2 - t * 2));
    const b = Math.floor(255 * (1 - Math.min(t * 2, 1)));
    const idx = i * 4;
    img.data[idx] = r; img.data[idx+1] = g; img.data[idx+2] = b;
    img.data[idx+3] = Math.floor(140 * t);
  }
  densityCtx.putImageData(img, 0, 0);

  ctxAgents.imageSmoothingEnabled = true;
  ctxAgents.imageSmoothingQuality = 'high';
  const tl = w2s(0, 0), br = w2s(WORLD.w, WORLD.h);
  ctxAgents.drawImage(densityCanvas, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
}

function renderDangerOverlay(W, H) {
  for (let i = 0; i < DGW * DGH; i++) {
    if (densityGrid[i] < 5) continue;
    const cx = i % DGW, cy = Math.floor(i / DGW);
    const tl = w2s(cx * DCELL, cy * DCELL);
    const br = w2s((cx+1) * DCELL, (cy+1) * DCELL);
    ctxAgents.fillStyle = 'rgba(239,68,68,0.25)';
    ctxAgents.strokeStyle = 'rgba(239,68,68,0.6)';
    ctxAgents.lineWidth = 1;
    ctxAgents.fillRect(tl.x, tl.y, br.x-tl.x, br.y-tl.y);
    ctxAgents.strokeRect(tl.x, tl.y, br.x-tl.x, br.y-tl.y);
  }
}

/* ================================================================
   MODULE: EXPORT
   ================================================================ */
function exportData() {
  if (STATE.mode === 'edit') saveMapToJSON();
  else exportJSON();
}

function exportJSON() {
  let alive = 0;
  for (let i = 0; i < agentCount; i++) if (aalive[i]) alive++;
  const data = {
    metadata: {
      exportTime: new Date().toISOString(),
      simulatorVersion: '2.0',
      phase: STATE.phase,
      elapsedSeconds: simElapsed.toFixed(1),
      totalSpawned,
      agentsAlive: alive,
      evacuated: evacuatedCount,
      evacuationRate: totalSpawned > 0 ? (evacuatedCount/totalSpawned*100).toFixed(1)+'%' : '0%',
    },
    map: {
      entries: MAP.entries,
      exits: MAP.exits,
      zones: MAP.zones,
      obstacles: MAP.obstacles,
      boundary: MAP.boundary,
      worldSize: WORLD,
    },
    densityAnalysis: {
      peakDensity: Math.max(...densityGrid).toFixed(2),
      dangerCells: Array.from(densityGrid).filter(v => v > 5).length,
      crowdedCells: Array.from(densityGrid).filter(v => v >= 2 && v < 5).length,
      thresholds: { safe: '<2 ppl/m²', crowded: '2–5 ppl/m²', danger: '>5 ppl/m²' },
    },
    activeWarnings: warnings,
    timeSeriesStats: statsHistory,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `crowdguard-report-${Date.now()}.json`;
  a.click();
}

function exportCSV() {
  const rows = [
    ['time_s', 'agents_alive', 'total_spawned', 'evacuated', 'evac_rate_pct', 'peak_density_pm2', 'phase']
  ];
  for (const s of statsHistory) {
    const rate = s.total_spawned > 0 ? (s.evacuated / s.total_spawned * 100).toFixed(1) : '0';
    rows.push([s.time, s.agents_alive, s.total_spawned, s.evacuated, rate, s.peak_density, s.phase]);
  }
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `crowdguard-stats-${Date.now()}.csv`;
  a.click();
}

/* ================================================================
   INIT
   ================================================================ */
window.addEventListener('resize', () => { resizeCanvases(); });
resizeCanvases();

// Center world in view
STATE.panX = WORLD.w / 2;
STATE.panY = WORLD.h / 2;
STATE.zoom = Math.min(wrap.clientWidth / WORLD.w, wrap.clientHeight / WORLD.h) * 0.85;
document.getElementById('zoom-info').textContent = Math.round(STATE.zoom * 100) + '%';

// Load demo map on start
loadDefaultMap();
setTool('select');
