/* ================================================================
   MODULE: AGENT SIMULATION — Config, Arrays, Init, Loop, Phases
   ================================================================ */

// Simulation config
let SIM_SPEED = 1;
let AGENT_DRAW_R = 2; // dynamically recomputed via computeAgentDrawRadius()
let SHOW_HEAT = true;
let SHOW_VEL = false;
let SHOW_TRAIL = false;
let SHOW_DANGER = true;
let SPAWN_MULT = 1.0;
let totalSpawned = 0;

// Spawn burst animations [{x,y,r,alpha,col}]
const spawnBursts = [];

// Agent arrays (Float32 for perf)
let MAX_AGENTS = 3000;
let ax, ay, avx, avy, apanic, aalive, atarget, atype, aentry, astall, abannedExit, acheckX, acheckY, aoscill;
// atype: 0=entering  1=gathering  2=evacuating
let agentCount = 0;
let simStartTime = 0;
let simElapsed = 0;
let spawnAccumulators = [];
let simTick = 0;
let evacuatedCount = 0;
let simPaused = false;
let simLoopId = null;

// Density grid (world units / 5 = cells)
const DCELL = 5;
let DGW = Math.ceil(WORLD.w / DCELL);
let DGH = Math.ceil(WORLD.h / DCELL);
let densityGrid = new Float32Array(DGW * DGH);

// Spatial hash
const SCELL = 4;
let SGW = Math.ceil(WORLD.w / SCELL);
let SGH = Math.ceil(WORLD.h / SCELL);
let spatialGrid = [];

// Stats history for export
const statsHistory = [];

function initSim() {
  ax = new Float32Array(MAX_AGENTS);
  ay = new Float32Array(MAX_AGENTS);
  avx = new Float32Array(MAX_AGENTS);
  avy = new Float32Array(MAX_AGENTS);
  apanic = new Float32Array(MAX_AGENTS);
  aalive = new Uint8Array(MAX_AGENTS);
  atarget = new Uint16Array(MAX_AGENTS);
  atype = new Uint8Array(MAX_AGENTS);
  aentry = new Uint8Array(MAX_AGENTS);
  astall = new Uint16Array(MAX_AGENTS);     // persistent stall counter per agent
  abannedExit = new Int8Array(MAX_AGENTS).fill(-1); // exit index to avoid (-1 = none)
  acheckX = new Float32Array(MAX_AGENTS);   // position checkpoint X (sampled every ~2s)
  acheckY = new Float32Array(MAX_AGENTS);   // position checkpoint Y (sampled every ~2s)
  aoscill = new Uint16Array(MAX_AGENTS);    // oscillation frame counter (anti-vibration)
  astuckCount = new Uint16Array(MAX_AGENTS); // Number of consecutive stuck checks (for 10s rule)
  agentCount = 0;
  evacuatedCount = 0;
  totalSpawned = 0;
  simTick = 0;
  simElapsed = 0;
  simStartTime = performance.now();
  spawnAccumulators = MAP.entries.map(() => 0);
  statsHistory.length = 0;
  spawnBursts.length = 0;
  window.maxPeakDensity = 0;
  window.snapshotsGenerated = false;
  if (typeof resetTimeline === 'function') resetTimeline();

  // Reset barricade durabilities
  for (const b of MAP.barricades) {
    b.broken = false;
    b.durability = b.maxDurability;
  }

  _sgBuckets = Array.from({ length: SGW * SGH }, () => []);

  STATE.phase = "idle";
  markFlowFieldDirty();
  updatePhaseUI();
  renderEntrySpawnList();
}

function resetSim() {
  stopSimLoop();
  initSim();
  ctxAgents.clearRect(0, 0, canvasAgents.width, canvasAgents.height);
  updateSimStats();
}

function togglePause() {
  simPaused = !simPaused;
  document.getElementById("btn-play-pause").textContent = simPaused
    ? "▶ Resume"
    : "⏸ Pause";
  if (!simPaused && simLoopId === null) startSimLoop();
}

function startSimLoop() {
  simPaused = false;
  if (simLoopId) return;
  let _lastTs = 0,
    _fpsSmooth = 60;
  function loop(ts) {
    if (!simPaused && STATE.mode === "sim") {
      if (_lastTs) {
        const fps = 1000 / (ts - _lastTs);
        _fpsSmooth = _fpsSmooth * 0.9 + fps * 0.1;
        if (simTick % 20 === 0) {
          const el = document.getElementById("fps-counter");
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
  if (simLoopId) {
    cancelAnimationFrame(simLoopId);
    simLoopId = null;
  }
}

function triggerPhase(phase) {
  const prevPhase = STATE.phase;
  STATE.phase = phase;
  updatePhaseUI();
  if (typeof drawMapLayer === "function") drawMapLayer();

  // ── Timeline logging ─────────────────────────────────────────
  if (typeof logTimeline === 'function') {
    const labels = {
      entry:   '▶ Entry phase started — agents are now spawning from gates',
      buildup: '⏸ Entry closed — crowd buildup phase started',
      evac:    '🚨 EVACUATION triggered — all agents heading to exits',
      chaos:   '💀 CHAOS phase triggered — agents fleeing from chaos zones',
      idle:    '⏹ Simulation returned to idle',
    };
    logTimeline('phase', labels[phase] || `Phase changed to ${phase}`);
  }

  // Guarantee a snapshot is taken when evacuation starts
  if ((phase === 'evac' || phase === 'chaos') && typeof window.capturePeakSnapshots === 'function') {
    // Small delay so density/velocity state is fresh
    setTimeout(window.capturePeakSnapshots, 300);
  }
}

function endEvacuation() {
  if (STATE.phase !== 'evac' && STATE.phase !== 'chaos') return;

  // Set phase to idle FIRST — this makes checkEvacComplete's guard
  // (STATE.phase !== 'evac' && STATE.phase !== 'chaos') return early,
  // preventing the auto-completion from double-firing.
  STATE.phase = 'idle';

  // Capture final trail snapshot (same as natural end)
  if (typeof captureFinalSnapshots === 'function') {
    captureFinalSnapshots();
  }

  // Log to timeline
  if (typeof logTimeline === 'function') {
    let alive = 0;
    for (let i = 0; i < agentCount; i++) if (aalive[i]) alive++;
    logTimeline('evac', `⏹ Evacuation manually ended — ${evacuatedCount} evacuated, ${alive} still inside`);
  }

  // Enable the snapshot view button
  const viewBtn = document.getElementById('btn-view-snapshots');
  if (viewBtn) {
    viewBtn.style.display = 'block';
    viewBtn.style.animation = 'timelineFadeIn 0.5s ease';
  }

  // Update UI and redraw map
  updatePhaseUI();
  if (typeof drawMapLayer === 'function') drawMapLayer();

  // Show the same popup as natural evacuation end
  if (typeof _showEvacCompletePopup === 'function') {
    _showEvacCompletePopup();
  }
}

function updatePhaseUI() {
  const pi = document.getElementById("phase-indicator");
  const labels = {
    idle: "IDLE",
    entry: "ENTRY PHASE",
    buildup: "CROWD BUILDUP",
    evac: "EVACUATION",
    chaos: "CHAOS EVACUATION",
  };
  const cls = {
    idle: "ph-idle",
    entry: "ph-entry",
    buildup: "ph-buildup",
    evac: "ph-evac",
    chaos: "ph-evac",
  };
  pi.textContent = labels[STATE.phase] || "IDLE";
  pi.className = cls[STATE.phase] || "ph-idle";

  const hint = document.getElementById("spawn-phase-hint");
  if (hint) {
    const hintText = {
      idle: 'Press <span style="color:var(--green)">START EVENT</span> to begin spawning agents from entry points.',
      entry:
        '🟢 <span style="color:var(--green)">Agents are spawning</span> from entry points below. Watch them stream in!',
      buildup:
        '🟡 <span style="color:var(--yellow)">Entry closed.</span> Agents wander toward attraction zones.',
      evac: '🔴 <span style="color:var(--red)">EVACUATION active.</span> All agents heading to exits.',
      chaos:
        '💀 <span style="color:#fff">CHAOS active.</span> Agents fleeing from chaos sources towards exits.',
    };
    hint.innerHTML = `<span style="font-family:'DM Mono',monospace;font-size:0.6rem">${hintText[STATE.phase] || ""}</span>`;
  }

  // Show/hide the manual END EVACUATION button
  const endEvacBtn = document.getElementById('btn-end-evac');
  if (endEvacBtn) {
    const isEvacPhase = STATE.phase === 'evac' || STATE.phase === 'chaos';
    endEvacBtn.disabled = !isEvacPhase;
  }

  renderEntrySpawnList();
}

function renderEntrySpawnList() {
  const el = document.getElementById("entry-spawn-list");
  if (!el) return;
  if (MAP.entries.length === 0) {
    el.innerHTML =
      "<div style=\"font-family:'DM Mono',monospace;font-size:0.6rem;color:var(--dim);font-style:italic\">No entry points on map.<br>Go to Map Editor → add Entry.</div>";
    return;
  }
  el.innerHTML = MAP.entries
    .map((entry, ei) => {
      const isActive = STATE.phase === "entry";
      return `
    <div style="background:var(--surface2);border:1px solid ${isActive ? "rgba(34,197,94,0.4)" : "var(--border)"};border-radius:4px;padding:8px 10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <span style="font-family:'DM Mono',monospace;font-size:0.65rem;color:var(--text)">${entry.label || "Entry " + (ei + 1)}</span>
        ${isActive
          ? "<span style=\"font-size:0.55rem;color:var(--green);font-family:'DM Mono',monospace;animation:pulse 1s infinite\">● ACTIVE</span>"
          : "<span style=\"font-size:0.55rem;color:var(--dim);font-family:'DM Mono',monospace\">○ IDLE</span>"
        }
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
          <div style="height:100%;background:var(--green);border-radius:1px;width:${isActive ? "100%" : "0%"};transition:width 0.5s"></div>
        </div>
      </div>
    </div>`;
    })
    .join("");
}

function dropCrowd(n) {
  if (MAP.entries.length === 0) {
    alert("Add at least one Entry point on the map first!");
    return;
  }
  const perEntry = Math.ceil(n / MAP.entries.length);
  MAP.entries.forEach((entry, ei) => dropFromEntry(ei, perEntry));
}

function dropFromEntry(entryIdx, n) {
  const entry = MAP.entries[entryIdx];
  if (!entry) return;
  if (STATE.phase === "idle") {
    STATE.phase = "entry";
    updatePhaseUI();
    if (typeof logTimeline === 'function') {
      logTimeline('spawn', `First crowd dropped at ${entry.label || 'Entry ' + (entryIdx + 1)} (${n} agents)`);
    }
  }
  let added = 0;
  for (let k = 0; k < n && agentCount < MAX_AGENTS; k++) {
    const idx = agentCount++;
    totalSpawned++;
    ax[idx] = entry.x + (Math.random() - 0.5) * 4;
    ay[idx] = entry.y + (Math.random() - 0.5) * 4;
    avx[idx] = 0;
    avy[idx] = 0;
    apanic[idx] = 0;
    aalive[idx] = 1;
    atype[idx] = 0;
    aentry[idx] = entryIdx;
    atarget[idx] = pickZoneWithCapacity();
    added++;
  }
  const p = w2s(entry.x, entry.y);
  spawnBursts.push({
    x: entry.x,
    y: entry.y,
    r: 0,
    maxR: 8,
    alpha: 1,
    col: "#22c55e",
    count: added,
  });
}

/* ----------------------------------------------------------------
   Dynamic agent draw radius — scales by venue area
   ---------------------------------------------------------------- */
function computeVenueArea() {
  if (MAP.boundary && MAP.boundary.length >= 3) {
    let area = 0;
    const pts = MAP.boundary;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      area += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
    }
    return Math.abs(area) / 2;
  }
  return WORLD.w * WORLD.h;
}

function computeAgentDrawRadius() {
  const referenceArea = WORLD.w * WORLD.h;
  const venueArea = computeVenueArea();
  const ratio = venueArea / referenceArea;
  const scaleFactor = 1 / Math.sqrt(ratio);
  const worldRadius = Math.max(
    0.25,
    Math.min(3.0, AGENT_RADIUS * 0.85 * scaleFactor),
  );
  const screenRadius = Math.max(1.5, worldRadius * STATE.zoom);
  AGENT_DRAW_R = screenRadius;
  return screenRadius;
}

// Returns how many alive agents are currently targeting a given zone index
function countAgentsTargetingZone(zi) {
  let count = 0;
  for (let i = 0; i < agentCount; i++) {
    if (aalive[i] && atarget[i] === zi) count++;
  }
  return count;
}

// Picks a zone index respecting soft capacity (2 ppl/m² per zone area).
// Falls back to least crowded zone if all zones are over cap.
function pickZoneWithCapacity() {
  if (MAP.zones.length === 0) return 0;
  const counts = MAP.zones.map((_, zi) => countAgentsTargetingZone(zi));
  const softCaps = MAP.zones.map(z => z.w * z.h * 2);
  const total = MAP.zones.reduce((s, z) => s + (z.attraction || 0.5), 0);
  let roll = Math.random() * total, cumul = 0;
  let fallback = 0, fallbackRatio = Infinity;
  for (let zi = 0; zi < MAP.zones.length; zi++) {
    const ratio = counts[zi] / (softCaps[zi] || 1);
    if (ratio < fallbackRatio) { fallbackRatio = ratio; fallback = zi; }
    cumul += (MAP.zones[zi].attraction || 0.5);
    if (roll <= cumul && counts[zi] < softCaps[zi]) return zi;
  }
  return fallback;
}

function spawnAgents() {
  if (STATE.phase !== "entry") return;
  const dt = 1 / 60;
  MAP.entries.forEach((entry, ei) => {
    spawnAccumulators[ei] =
      (spawnAccumulators[ei] || 0) + (entry.spawnRate * SPAWN_MULT * dt) / 60;
    let justSpawned = 0;
    while (spawnAccumulators[ei] >= 1 && agentCount < MAX_AGENTS) {
      spawnAccumulators[ei] -= 1;
      const idx = agentCount++;
      totalSpawned++;
      ax[idx] = entry.x + (Math.random() - 0.5) * 3;
      ay[idx] = entry.y + (Math.random() - 0.5) * 3;
      avx[idx] = 0;
      avy[idx] = 0;
      apanic[idx] = 0;
      aalive[idx] = 1;
      atype[idx] = 0;
      aentry[idx] = ei;
      atarget[idx] = pickZoneWithCapacity();
      justSpawned++;
    }
    if (justSpawned > 0 && simTick % 10 === ei % 10) {
      spawnBursts.push({
        x: entry.x,
        y: entry.y,
        r: 0,
        maxR: 6,
        alpha: 0.8,
        col: "#22c55e",
        count: justSpawned,
      });
    }
  });
}
