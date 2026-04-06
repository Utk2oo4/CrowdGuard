/* ================================================================
   MODULE: SIMULATION RENDERING
   ================================================================
   Renders agents, density heatmap, danger overlay, trails,
   and spawn burst animations.
   ================================================================ */

const densityCanvas = document.createElement("canvas");
densityCanvas.width = DGW;
densityCanvas.height = DGH;
const densityCtx = densityCanvas.getContext("2d");

const trailCanvas = document.createElement("canvas");
const trailCtx = trailCanvas.getContext("2d");

function renderSim() {
  if (STATE.mode !== "sim") return;
  const W = canvasAgents.width,
    H = canvasAgents.height;

  if (trailCanvas.width !== W || trailCanvas.height !== H) {
    trailCanvas.width = W;
    trailCanvas.height = H;
  }

  ctxAgents.clearRect(0, 0, W, H);

  // Trails: accumulate in background canvas with minimal fade so paths persist for the final snapshot
  trailCtx.fillStyle = "rgba(8,11,16,0.003)";
  trailCtx.fillRect(0, 0, W, H);
  for (let i = 0; i < agentCount; i++) {
    if (!aalive[i]) continue;
    const p = w2s(ax[i], ay[i]);
    // High contrast Cyan for normal, Bright Red for panic
    trailCtx.fillStyle =
      apanic[i] > 0.5 ? "rgba(255, 50, 50, 0.7)" : "rgba(34, 211, 238, 0.4)";
    trailCtx.beginPath();
    trailCtx.arc(p.x, p.y, Math.max(2.5, wScale(1.8)), 0, Math.PI * 2);
    trailCtx.fill();
  }

  drawMapLayer();

  const r = computeAgentDrawRadius();

  // Draw evacuating agents via batched paths (orange/red)
  const evacGroups = { orange: [], red: [] };
  
  for (let i = 0; i < agentCount; i++) {
    if (!aalive[i]) continue;
    const p = w2s(ax[i], ay[i]);
    const pf = apanic[i];
    
    if (STATE.phase === "evac" || STATE.phase === "chaos") {
      const grp = pf > 0.5 ? "red" : "orange";
      evacGroups[grp].push(p.x, p.y);
    } else {
      // Smooth transition from Blue (#3b82f6) to Green (#22c55e) based on distance
      let t = 0; // 0 = blue, 1 = green
      if (atype[i] === 1) {
        t = 1;
      } else {
        const zone = MAP.zones[atarget[i]];
        if (zone) {
          const zcx = zone.x + zone.w / 2, zcy = zone.y + zone.h / 2;
          const dist = Math.hypot(ax[i] - zcx, ay[i] - zcy);
          t = Math.max(0, Math.min(1, 1 - (dist - 10) / 30));
        }
      }
      
      const r_col = Math.floor(59 + t * (34 - 59));
      const g_col = Math.floor(130 + t * (197 - 130));
      const b_col = Math.floor(246 + t * (94 - 246));
      
      ctxAgents.fillStyle = `rgb(${r_col},${g_col},${b_col})`;
      ctxAgents.beginPath();
      ctxAgents.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctxAgents.fill();
    }
  }

  // Render batched evac agents
  const colMap = { orange: "#f97316", red: "#ef4444" };
  for (const [grp, pts] of Object.entries(evacGroups)) {
    if (pts.length === 0) continue;
    ctxAgents.fillStyle = colMap[grp];
    ctxAgents.beginPath();
    for (let k = 0; k < pts.length; k += 2) {
      ctxAgents.moveTo(pts[k] + r, pts[k + 1]);
      ctxAgents.arc(pts[k], pts[k + 1], r, 0, Math.PI * 2);
    }
    ctxAgents.fill();
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
      ctxAgents.textAlign = "center";
      ctxAgents.fillText(`+${burst.count}`, p.x, p.y - Math.max(sr, 4) - 7);
    }
    burst.r += 0.5;
    burst.alpha -= 0.035;
    if (burst.alpha <= 0) spawnBursts.splice(b, 1);
  }
}

/* ----------------------------------------------------------------
   SNAPSHOT RENDERING HELPERS
   ---------------------------------------------------------------- */

function renderDensityHeatmap(targetCtx, W, H, dGrid = densityGrid) {
  const img = densityCtx.createImageData(DGW, DGH);

  // Find max density — auto-scale gradient so any crowd is visible
  let maxD = 0;
  for (let i = 0; i < DGW * DGH; i++) if (dGrid[i] > maxD) maxD = dGrid[i];
  if (maxD < 0.001) {
    densityCtx.putImageData(img, 0, 0);
    return; // nothing to draw
  }

  for (let i = 0; i < DGW * DGH; i++) {
    const d = dGrid[i];
    if (d < 0.001) continue;

    const t = Math.min(d / maxD, 1.0); // relative to actual peak
    const alpha = Math.floor(160 + t * 90);

    let r, g, b;
    if (t < 0.5) {
      // Green (20,230,80) -> Yellow (255,230,0)
      const ratio = t * 2;
      r = Math.floor(20   + ratio * 235);
      g = 230;
      b = Math.floor(80   * (1 - ratio));
    } else {
      // Yellow (255,230,0) -> Dark Red (220,20,0)
      const ratio = (t - 0.5) * 2;
      r = 255;
      g = Math.floor(230 * (1 - ratio));
      b = 0;
    }

    const idx = i * 4;
    img.data[idx]     = r;
    img.data[idx + 1] = g;
    img.data[idx + 2] = b;
    img.data[idx + 3] = alpha;
  }
  densityCtx.putImageData(img, 0, 0);
  targetCtx.imageSmoothingEnabled = true;
  targetCtx.imageSmoothingQuality = "high";
  const tl = w2s(0, 0), br = w2s(WORLD.w, WORLD.h);
  targetCtx.drawImage(densityCanvas, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
}

function renderDangerOverlay(targetCtx, W, H, dGrid = densityGrid) {
  // Find the max density so we can scale danger relatively
  let maxD = 0;
  for (let i = 0; i < DGW * DGH; i++) if (dGrid[i] > maxD) maxD = dGrid[i];
  if (maxD < 0.001) return;

  // Danger = top 40% of density, at least any cell with >60% of peak
  const dangerThresh = Math.max(0.001, maxD * 0.5);

  for (let i = 0; i < DGW * DGH; i++) {
    if (dGrid[i] < dangerThresh) continue;
    const cx = i % DGW, cy = Math.floor(i / DGW);
    const intensity = Math.min(1, (dGrid[i] - dangerThresh) / ((maxD - dangerThresh) + 0.0001));
    const tl = w2s(cx * DCELL, cy * DCELL);
    const br = w2s((cx + 1) * DCELL, (cy + 1) * DCELL);
    targetCtx.fillStyle   = `rgba(239,68,68,${(0.3 + intensity * 0.5).toFixed(2)})`;
    targetCtx.strokeStyle = `rgba(255,50,50,${(0.55 + intensity * 0.4).toFixed(2)})`;
    targetCtx.lineWidth = 1;
    targetCtx.fillRect  (tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    targetCtx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  }
}

function renderVelocityVectors(targetCtx, s = null) {
  // Use snapshot arrays when provided, otherwise live globals
  const ac    = s ? s.agentCount : agentCount;
  const alive = s ? s.aalive     : aalive;
  const vx_   = s ? s.avx        : avx;
  const vy_   = s ? s.avy        : avy;
  const px_   = s ? s.ax         : ax;
  const py_   = s ? s.ay         : ay;
  const panic = s ? s.apanic     : apanic;
  const type_ = s ? s.atype      : atype;
  const tgt   = s ? s.atarget    : atarget;

  targetCtx.lineWidth = 1.5;

  for (let i = 0; i < ac; i++) {
    if (!alive[i]) continue;
    const vMag = Math.hypot(vx_[i], vy_[i]);
    if (vMag < 0.001) continue;
    const p = w2s(px_[i], py_[i]);

    let strokeColor;
    if (panic[i] > 0.5) {
      strokeColor = "rgba(239,68,68,0.9)";   // panicking = bright red
    } else if (panic[i] > 0.2) {
      strokeColor = "rgba(249,115,22,0.85)"; // stressed = orange
    } else {
      let t = 0;
      if (type_[i] === 1) t = 1;
      else {
        const zone = MAP.zones[tgt[i]];
        if (zone) {
          const dist = Math.hypot(px_[i] - (zone.x + zone.w/2), py_[i] - (zone.y + zone.h/2));
          t = Math.max(0, Math.min(1, 1 - (dist - 10) / 30));
        }
      }
      const rc = Math.floor(59  + t * (34  - 59));
      const gc = Math.floor(130 + t * (197 - 130));
      const bc = Math.floor(246 + t * (94  - 246));
      strokeColor = `rgba(${rc},${gc},${bc},0.8)`;
    }

    targetCtx.strokeStyle = strokeColor;
    targetCtx.beginPath();
    targetCtx.moveTo(p.x, p.y);
    // Scale arrow length by speed magnitude
    const scale = wScale(10) * Math.min(1.5, vMag * 10);
    targetCtx.lineTo(
      p.x + (vx_[i] / vMag) * scale,
      p.y + (vy_[i] / vMag) * scale
    );
    targetCtx.stroke();
  }
}

/* ----------------------------------------------------------------
   SNAPSHOT STATE MANAGEMENT
   ---------------------------------------------------------------- */

window.peakData = null;
window.snapshotsGenerated = false;
window.snapshots = { heat: false, vel: false, trail: false, danger: false };

window.capturePeakSnapshots = function() {
  if (!window.CAPTURE_HEAT && !window.CAPTURE_VEL && !window.CAPTURE_DANGER) return;

  // Instant backup of raw typed arrays — takes <1ms, zero rendering
  window.peakData = {
    densityGrid: new Float32Array(densityGrid),
    agentCount:  agentCount,
    aalive:      new Uint8Array(aalive),
    ax:          new Float32Array(ax),
    ay:          new Float32Array(ay),
    avx:         new Float32Array(avx),
    avy:         new Float32Array(avy),
    apanic:      new Float32Array(apanic),
    atype:       new Uint8Array(atype),
    atarget:     new Int16Array(atarget),
    w:           canvasAgents.width,
    h:           canvasAgents.height,
    baseCanvas:  document.createElement("canvas")
  };

  // Snapshot the current rendered frame for the base background
  const c = window.peakData.baseCanvas;
  c.width = window.peakData.w;
  c.height = window.peakData.h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#080b10";
  ctx.fillRect(0, 0, c.width, c.height);
  try { ctx.drawImage(document.getElementById('canvas-bg'),  0, 0); } catch(e){}
  try { ctx.drawImage(document.getElementById('canvas-map'), 0, 0); } catch(e){}
  try { ctx.drawImage(document.getElementById('canvas-agents'), 0, 0); } catch(e){}
};

window.captureFinalSnapshots = function() {
  if (!window.CAPTURE_TRAIL) return;
  const w = canvasAgents.width;
  const h = canvasAgents.height;
  if (!window.peakData) window.peakData = {};

  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");

  ctx.fillStyle = "#080b10";
  ctx.fillRect(0, 0, w, h);
  try { ctx.drawImage(document.getElementById('canvas-bg'),  0, 0); } catch(e){}
  try { ctx.drawImage(document.getElementById('canvas-map'), 0, 0); } catch(e){}
  ctx.drawImage(trailCanvas, 0, 0);
  try { ctx.drawImage(document.getElementById('canvas-agents'), 0, 0); } catch(e){}

  window.peakData.trailCanvas = c;
};

window.generateDeferredSnapshots = function() {
  if (window.snapshotsGenerated) return;
  window.snapshotsGenerated = true;

  const d = window.peakData;
  if (!d) return;
  const w = d.w || canvasAgents.width;
  const h = d.h || canvasAgents.height;

  window.snapshotCanvases = {
    heat:   document.createElement("canvas"),
    vel:    document.createElement("canvas"),
    trail:  document.createElement("canvas"),
    danger: document.createElement("canvas")
  };

  const drawBase = (ctx) => {
    if (d.baseCanvas) {
      ctx.drawImage(d.baseCanvas, 0, 0);
    } else {
      ctx.fillStyle = "#080b10";
      ctx.fillRect(0, 0, w, h);
    }
  };

  if (window.CAPTURE_HEAT) {
    const c = window.snapshotCanvases.heat;
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    drawBase(ctx);
    ctx.globalAlpha = 0.75; // semi-transparent so map shows through
    renderDensityHeatmap(ctx, w, h, d.densityGrid);
    ctx.globalAlpha = 1;
    window.snapshots.heat = true;
  }

  if (window.CAPTURE_VEL) {
    const c = window.snapshotCanvases.vel;
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    drawBase(ctx);
    renderVelocityVectors(ctx, d);
    window.snapshots.vel = true;
  }

  if (window.CAPTURE_DANGER) {
    const c = window.snapshotCanvases.danger;
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    drawBase(ctx);
    ctx.globalAlpha = 0.7;
    renderDangerOverlay(ctx, w, h, d.densityGrid);
    ctx.globalAlpha = 1;
    window.snapshots.danger = true;
  }

  if (window.CAPTURE_TRAIL && d.trailCanvas) {
    window.snapshotCanvases.trail = d.trailCanvas;
    window.snapshots.trail = true;
  }
};
