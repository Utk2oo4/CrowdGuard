/* ================================================================
   MODULE: SIMULATION PHYSICS
   ================================================================
   simStep(), spatial grid, geometry helpers, density detection,
   bottleneck warnings, and sim stats.
   ================================================================ */

// ── SIMULATION STEP (Physics)
const INERTIA = 0.84;
const AGENT_RADIUS = 0.8; // metres
const BASE_SPEED = 0.04; // m/frame (~1.4 m/s walking pace)

let _sgBuckets = Array.from({ length: SGW * SGH }, () => []);
let maxPeakDensity = 0;

function resizeWorld(newW, newH) {
  WORLD.w = newW;
  WORLD.h = newH;

  DGW = Math.ceil(WORLD.w / DCELL);
  DGH = Math.ceil(WORLD.h / DCELL);
  densityGrid = new Float32Array(DGW * DGH);

  SGW = Math.ceil(WORLD.w / SCELL);
  SGH = Math.ceil(WORLD.h / SCELL);
  _sgBuckets = Array.from({ length: SGW * SGH }, () => []);

  // Keep flow field grid in sync with new world dimensions.
  // recalcFlowFieldSize is defined in flowfield.js (loaded before this).
  if (typeof recalcFlowFieldSize === 'function') recalcFlowFieldSize();

  const wrap = document.getElementById("canvas-wrap");
  STATE.panX = WORLD.w / 2;
  STATE.panY = WORLD.h / 2;
  STATE.zoom =
    Math.min(wrap.clientWidth / WORLD.w, wrap.clientHeight / WORLD.h) * 0.9;

  if (typeof initSim === "function") initSim();
  if (typeof drawAll === "function") drawAll();
}

function buildSpatialGrid() {
  for (let k = 0; k < _sgBuckets.length; k++) _sgBuckets[k].length = 0;
  spatialGrid = _sgBuckets;
  for (let i = 0; i < agentCount; i++) {
    if (!aalive[i]) continue;
    const cx = Math.min(SGW - 1, Math.floor(ax[i] / SCELL)) | 0;
    const cy = Math.min(SGH - 1, Math.floor(ay[i] / SCELL)) | 0;
    _sgBuckets[cy * SGW + cx].push(i);
  }
}

function getNeighbors(x, y, radius) {
  const result = [];
  const r = Math.ceil(radius / SCELL);
  const cx0 = Math.max(0, Math.floor(x / SCELL) - r);
  const cx1 = Math.min(SGW - 1, Math.floor(x / SCELL) + r);
  const cy0 = Math.max(0, Math.floor(y / SCELL) - r);
  const cy1 = Math.min(SGH - 1, Math.floor(y / SCELL) + r);
  for (let cy = cy0; cy <= cy1; cy++)
    for (let cx = cx0; cx <= cx1; cx++)
      for (const j of spatialGrid[cy * SGW + cx]) result.push(j);
  return result;
}

function nearestExit(x, y) {
  let best = null,
    bestD = Infinity;
  for (const ex of MAP.exits) {
    const d = Math.hypot(x - ex.x, y - ex.y);
    if (d < bestD) {
      bestD = d;
      best = ex;
    }
  }
  return { exit: best, dist: bestD };
}

/* ----------------------------------------------------------------
   isInObstacle(x, y, radius)
   ----------------------------------------------------------------
   Previously a point-in-rotated-rect test. Now a DISK test.

   Instead of checking whether the agent's centre (x, y) is inside
   an obstacle, we find the closest surface point on each obstacle
   and check whether that point is within `radius` of the agent.

   This means:
     • An agent is "in obstacle" if ANY part of its body overlaps.
     • Agents can no longer clip into walls because their centre
       appears to be in open space while their edge is in geometry.
     • Crucially, agents can no longer enter a gap that is narrower
       than their diameter (2 × radius) because the disk check will
       detect the overlap with the wall on the far side.

   radius defaults to AGENT_RADIUS (0.8m) when not supplied.
   It is called with 0 from legacy paths that only need a point
   check (e.g. spawnability tests), though those are rare.
   ---------------------------------------------------------------- */
function isInObstacle(x, y, radius) {
  // Default to the physical agent body size.
  const r = (radius !== undefined) ? radius : AGENT_RADIUS;
  for (const o of MAP.obstacles) {
    const cp = closestPointOnRotatedRect(x, y, o);
    const dist = Math.hypot(x - cp.x, y - cp.y);
    if (dist <= r) return true;
  }
  // Non-broken barricades act as solid obstacles
  for (const b of MAP.barricades) {
    if (b.broken) continue;
    const cp = closestPointOnRotatedRect(x, y, b);
    const dist = Math.hypot(x - cp.x, y - cp.y);
    if (dist <= r) return true;
  }
  return false;
}

/*
  closestPointOnRotatedRect(px, py, o) — returns the closest point on
  the surface of a rotated rectangle, in world space.
  Used for obstacle repulsion forces in simStep().
*/
function closestPointOnRotatedRect(px, py, o) {
  const angle = o.angle || 0;
  const dx = px - o.x;
  const dy = py - o.y;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  // Point in local frame
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  // Clamp to box
  const clampedLx = Math.max(-o.w / 2, Math.min(o.w / 2, lx));
  const clampedLy = Math.max(-o.h / 2, Math.min(o.h / 2, ly));
  // Back to world frame
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  return {
    x: o.x + clampedLx * cosA - clampedLy * sinA,
    y: o.y + clampedLx * sinA + clampedLy * cosA,
  };
}

function inBoundary(x, y) {
  if (MAP.boundary.length < 3)
    return x >= 0 && x <= WORLD.w && y >= 0 && y <= WORLD.h;
  let inside = false;
  const pts = MAP.boundary;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x,
      yi = pts[i].y,
      xj = pts[j].x,
      yj = pts[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1,
    dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) {
    const rx = px - x1,
      ry = py - y1;
    return { dist: Math.hypot(rx, ry), rx, ry };
  }
  let t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
  const projX = x1 + t * dx,
    projY = y1 + t * dy;
  const rx = px - projX,
    ry = py - projY;
  return { dist: Math.hypot(rx, ry), rx, ry };
}

/* ================================================================
   simStep — main physics loop
   ================================================================ */
function simStep() {
  simTick++;
  simElapsed += 1 / 60; // virtual time: advances in sync with SIM_SPEED

  spawnAgents();
  buildSpatialGrid();

  // Pre-compute exit list (includes converted entries during evac/chaos)
  let allExits = MAP.exits;
  if (STATE.phase === "evac" || STATE.phase === "chaos") {
    allExits = [
      ...MAP.exits,
      ...MAP.entries
        .filter((e) => e.convertToExit)
        .map((e) => ({
          ...e,
          isEntryConverted: true,
          capacity: 120,
          width: 2,
        })),
    ];
  }

  // Exit queue counts for capacity throttling
  const exitQueues = allExits.map(() => 0);
  for (let i = 0; i < agentCount; i++) {
    if (!aalive[i]) continue;
    if (STATE.phase === "evac" || STATE.phase === "chaos") {
      let bestD = Infinity,
        bestEi = 0,
        isRealExit = true;
      for (let ei = 0; ei < allExits.length; ei++) {
        let inChaos = false;
        if (STATE.phase === "chaos") {
          for (const c of MAP.chaos) {
            if (
              allExits[ei].x >= c.x &&
              allExits[ei].x <= c.x + c.w &&
              allExits[ei].y >= c.y &&
              allExits[ei].y <= c.y + c.h
            ) {
              inChaos = true;
              break;
            }
          }
        }
        if (inChaos) continue;
        const d = Math.hypot(ax[i] - allExits[ei].x, ay[i] - allExits[ei].y);
        if (d < bestD) {
          bestD = d;
          bestEi = ei;
          isRealExit = !allExits[ei].isEntryConverted;
        }
      }
      if (bestD < 15 && bestD !== Infinity && isRealExit) exitQueues[bestEi]++;
    }
  }

  // ── DENSITY-DRIVEN PANIC SPREAD ──────────────────────────────────────────
  if (STATE.phase === "evac" || STATE.phase === "chaos") {
    for (let i = 0; i < agentCount; i++) {
      if (!aalive[i]) continue;
      const dgx = Math.min(DGW - 1, Math.floor(ax[i] / DCELL)) | 0;
      const dgy = Math.min(DGH - 1, Math.floor(ay[i] / DCELL)) | 0;
      const localDensity = densityGrid[dgy * DGW + dgx] || 0;
      if (localDensity >= 5) apanic[i] = Math.min(1, apanic[i] + 0.012);
      else if (localDensity >= 2) apanic[i] = Math.min(1, apanic[i] + 0.003);
      else apanic[i] = Math.max(0, apanic[i] - 0.004);
      if (apanic[i] < 0.5) continue;
      const densityFactor = Math.min(1, localDensity / 5);
      if (densityFactor < 0.1) continue;
      const spreadRate = 0.004 * densityFactor;
      const nb = getNeighbors(ax[i], ay[i], 4);
      for (const j of nb) {
        if (j !== i && aalive[j]) {
          const ndgx = Math.min(DGW - 1, Math.floor(ax[j] / DCELL)) | 0;
          const ndgy = Math.min(DGH - 1, Math.floor(ay[j] / DCELL)) | 0;
          if ((densityGrid[ndgy * DGW + ndgx] || 0) >= 2)
            apanic[j] = Math.min(1, apanic[j] + spreadRate);
        }
      }
    }
  }

  const nx = new Float32Array(agentCount);
  const ny = new Float32Array(agentCount);
  for (let i = 0; i < agentCount; i++) {
    nx[i] = ax[i];
    ny[i] = ay[i];
  }

  for (let i = 0; i < agentCount; i++) {
    if (!aalive[i]) continue;
    const x = ax[i],
      y = ay[i];

    // Evac/chaos panic controlled entirely by density-driven pass above.
    if (STATE.phase !== "evac" && STATE.phase !== "chaos") {
      apanic[i] = Math.max(0, apanic[i] - 0.003);
    }
    const pf = apanic[i];
    const speed = BASE_SPEED * (1 + pf * 0.7);

    let tx = x,
      ty = y;
    let shouldMove = true;

    // ── PHASE: EVAC / CHAOS ─────────────────────────────────────────
    if (STATE.phase === "evac" || STATE.phase === "chaos") {
      let bestD = Infinity,
        bestEx = null,
        bestEi = -1;
      for (let ei = 0; ei < allExits.length; ei++) {
        const ex = allExits[ei];
        let inChaos = false;
        if (STATE.phase === "chaos") {
          for (const c of MAP.chaos) {
            if (
              ex.x >= c.x &&
              ex.x <= c.x + c.w &&
              ex.y >= c.y &&
              ex.y <= c.y + c.h
            ) {
              inChaos = true;
              break;
            }
          }
        }
        if (inChaos) continue;

        // Skip banned exit (agent was stuck there)
        if (abannedExit[i] === ei) continue;

        const d = Math.hypot(x - ex.x, y - ex.y);

        // ── ENTRY MEMORY ─────────────────────────────────────────────
        const familiarityStrength = 1 - pf;
        let familiarityBonus = 0;
        if (familiarityStrength > 0 && MAP.entries[aentry[i]]) {
          const spawnEntry = MAP.entries[aentry[i]];
          let entryBlockedByChaos = false;
          for (const c of MAP.chaos) {
            const chaosCheckRadius = Math.max(c.w, c.h) / 2 + 1;
            if (Math.hypot(spawnEntry.x - (c.x + c.w / 2), spawnEntry.y - (c.y + c.h / 2)) < chaosCheckRadius) {
              entryBlockedByChaos = true; break;
            }
          }
          if (!entryBlockedByChaos) {
            const distExitToEntry = Math.hypot(ex.x - spawnEntry.x, ex.y - spawnEntry.y);
            familiarityBonus = -Math.min(d * 0.4, distExitToEntry < 15 ? d * 0.4 : 0) * familiarityStrength;
          }
        }

        // ── DENSITY / CONGESTION PENALTY ─────────────────────────────
        let congestionPenalty = 0;
        if (pf < 0.7) {
          const dgx = Math.min(DGW - 1, Math.floor(ex.x / DCELL)) | 0;
          const dgy = Math.min(DGH - 1, Math.floor(ex.y / DCELL)) | 0;
          congestionPenalty = (densityGrid[dgy * DGW + dgx] || 0) * (1 - pf) * 4.0;
        }

        const queuePenalty = exitQueues[ei] > ex.capacity / 6 ? d * 0.3 : 0;
        const effectiveCost = d + familiarityBonus + congestionPenalty + queuePenalty;
        if (effectiveCost < bestD) { bestD = effectiveCost; bestEx = ex; bestEi = ei; }
      }
      if (bestEx) {
        // ── FLOW FIELD STEERING ────────────────────────────────────────
        const ffExitDist = Math.hypot(x - bestEx.x, y - bestEx.y);
        if (ffExitDist > FF_CELL * 2) {
          const ff = getFlowField(bestEx.x, bestEx.y);
          const dir = sampleFlowField(ff, x, y);
          tx = x + dir.dx * 10;
          ty = y + dir.dy * 10;
        } else {
          tx = bestEx.x; ty = bestEx.y;
        }
        const realDist = Math.hypot(x - bestEx.x, y - bestEx.y);
        const exitR = Math.max(bestEx.width || 2, 1.5);
        if (realDist < exitR) {
          const maxPerTick = bestEx.capacity / 60 / 60;
          let aliveCount = 0;
          for (let _a = 0; _a < agentCount; _a++) if (aalive[_a]) aliveCount++;
          if (aliveCount <= 10 || Math.random() < maxPerTick + 0.02) {
            aalive[i] = 0; evacuatedCount++; continue;
          }
        }
      }

      // ── PHASE: ENTRY ─────────────────────────────────────────────
    } else if (STATE.phase === "entry") {
      const zone = MAP.zones[atarget[i]];
      if (zone) {
        const cx = zone.x + zone.w / 2, cy = zone.y + zone.h / 2;
        const inZone = x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h;
        if (inZone) {
          atype[i] = 1;
          // ── ZONE-AWARE WANDER ──────────────────────────────────────
          const zType = zone.type || "gen";
          let attractX, attractY;
          if (zType === "stage") {
            attractX = zone.x + zone.w * (0.2 + (i % 11) / 11.0 * 0.6);
            attractY = zone.y + zone.h * (0.55 + (i % 5) / 5.0 * 0.35);
          } else if (zType === "food") {
            attractX = zone.x + zone.w * (0.15 + (i % 13) / 13.0 * 0.7);
            attractY = zone.y + zone.h * (0.15 + (i % 7) / 7.0 * 0.7);
          } else {
            const ebX = (i % 2 === 0) ? 0.1 + (i % 5) / 5.0 * 0.3 : 0.6 + (i % 5) / 5.0 * 0.3;
            const ebY = (i % 3 === 0) ? 0.1 + (i % 4) / 4.0 * 0.3 : 0.6 + (i % 4) / 4.0 * 0.3;
            attractX = zone.x + zone.w * ebX;
            attractY = zone.y + zone.h * ebY;
          }
          tx = attractX + (Math.random() - 0.5) * 0.8;
          ty = attractY + (Math.random() - 0.5) * 0.8;
        } else {
          // Flow field routes around obstacles toward zone center
          const ffZDist = Math.hypot(x - cx, y - cy);
          if (ffZDist > FF_CELL * 2) {
            const ffZ = getFlowField(cx, cy);
            const dirZ = sampleFlowField(ffZ, x, y);
            tx = x + dirZ.dx * 10; ty = y + dirZ.dy * 10;
          } else { tx = cx; ty = cy; }
        }
      } else if (MAP.zones.length === 0) {
        tx = x + (Math.random() - 0.5) * 3;
        ty = y + (Math.random() - 0.5) * 3;
      }

      // ── PHASE: BUILDUP ───────────────────────────────────────────
    } else if (STATE.phase === "buildup") {
      const zone = MAP.zones[atarget[i]];
      if (zone) {
        const inZone =
          x >= zone.x &&
          x <= zone.x + zone.w &&
          y >= zone.y &&
          y <= zone.y + zone.h;
        if (inZone) {
          if (simTick % 300 === i % 300 && Math.random() < 0.15) {
            atarget[i] = pickWeightedZone();
          }
          // ── ZONE-AWARE WANDER (buildup) ────────────────────────────
          const zTypeB = zone.type || "gen";
          let attractBX, attractBY;
          if (zTypeB === "stage") {
            attractBX = zone.x + zone.w * (0.2 + (i % 11) / 11.0 * 0.6);
            attractBY = zone.y + zone.h * (0.55 + (i % 5) / 5.0 * 0.35);
          } else if (zTypeB === "food") {
            attractBX = zone.x + zone.w * (0.15 + (i % 13) / 13.0 * 0.7);
            attractBY = zone.y + zone.h * (0.15 + (i % 7) / 7.0 * 0.7);
          } else {
            const ebX = (i % 2 === 0) ? 0.1 + (i % 5) / 5.0 * 0.3 : 0.6 + (i % 5) / 5.0 * 0.3;
            const ebY = (i % 3 === 0) ? 0.1 + (i % 4) / 4.0 * 0.3 : 0.6 + (i % 4) / 4.0 * 0.3;
            attractBX = zone.x + zone.w * ebX;
            attractBY = zone.y + zone.h * ebY;
          }
          tx = attractBX + (Math.random() - 0.5) * 1.5;
          ty = attractBY + (Math.random() - 0.5) * 1.5;
        } else {
          // Flow field routes around obstacles toward zone center
          const bzCx = zone.x + zone.w / 2, bzCy = zone.y + zone.h / 2;
          const ffBZDist = Math.hypot(x - bzCx, y - bzCy);
          if (ffBZDist > FF_CELL * 2) {
            const ffBZ = getFlowField(bzCx, bzCy);
            const dirBZ = sampleFlowField(ffBZ, x, y);
            tx = x + dirBZ.dx * 10; ty = y + dirBZ.dy * 10;
          } else { tx = bzCx; ty = bzCy; }
        }
      }

      // ── PHASE: IDLE ──────────────────────────────────────────────
    } else {
      shouldMove = false;
    }

    if (!shouldMove) {
      nx[i] = x;
      ny[i] = y;
      continue;
    }

    // Desired velocity toward target
    let ddx = tx - x,
      ddy = ty - y;
    const dd = Math.hypot(ddx, ddy);
    if (dd > 0.001) {
      ddx /= dd;
      ddy /= dd;
    } else {
      ddx = 0;
      ddy = 0;
    }
    let desVx = ddx * speed,
      desVy = ddy * speed;

    // Social force: Helbing exponential repulsion + New Zippering & Flocking
    let sfx = 0, sfy = 0;
    let frontBlockedStr = 0; // Accumulate pressure pushing directly against desired path
    let followX = 0, followY = 0, followCount = 0; // For flocking

    const nb = getNeighbors(x, y, AGENT_RADIUS * 5);
    for (const j of nb) {
      if (j === i || !aalive[j]) continue;
      let rx = x - ax[j],
          ry = y - ay[j];
      const rd = Math.hypot(rx, ry);
      const minD = AGENT_RADIUS * 2;
      
      if (rd < minD * 2.5 && rd > 0.001) {
        const overlap = minD - rd;
        const str = 0.45 * Math.exp(overlap / 0.7) * 0.28;
        
        const forceX = (rx / rd) * str;
        const forceY = (ry / rd) * str;
        sfx += forceX;
        sfy += forceY;

        // ── DYNAMIC AVOIDANCE (ZIPPERING) ──────────────────
        // Check if neighbor is in front of us
        const dirToNeighborX = -rx / rd; // from us to them
        const dirToNeighborY = -ry / rd;
        const dotDesired = dirToNeighborX * ddx + dirToNeighborY * ddy;
        
        if (dotDesired > 0.6) {
          // They are physically blocking our front arc. Add to block intensity.
          frontBlockedStr += str * dotDesired;
        }

        // ── FLOCKING / FOLLOWING ───────────────────────────
        // If neighbor is slightly ahead (but maybe not touching physically) 
        // and moving in a similar direction, follow their slipstream.
        if (dotDesired > 0.4 && rd < minD * 3.5) {
          const theirSpeed = Math.hypot(avx[j], avy[j]);
          if (theirSpeed > 0.2) {
            const theirDirX = avx[j] / theirSpeed;
            const theirDirY = avy[j] / theirSpeed;
            // Are they moving in the rough direction we want to go?
            if (theirDirX * ddx + theirDirY * ddy > 0.5) {
              followX += theirDirX;
              followY += theirDirY;
              followCount++;
            }
          }
        }
      }
    }

    // Apply slipstream/flocking if available (organic line formation)
    if (followCount > 0) {
      followX /= followCount;
      followY /= followCount;
      // Blend 30% of their direction into our desired direction
      desVx = desVx * 0.7 + (followX * speed) * 0.3;
      desVy = desVy * 0.7 + (followY * speed) * 0.3;
    }

    // Apply Zippering (lateral sliding) when heavily blocked in front
    if (frontBlockedStr > 0.15) {
      // Create an orthogonal vector to our desired path
      const perpX = -ddy, perpY = ddx; 
      // Pick a side based on agent ID parity to ensure crowds interleave
      const slideSign = (i % 2 === 0) ? 1 : -1;
      // Inject lateral force scaled by blockage severity
      sfx += perpX * speed * 0.6 * slideSign;
      sfy += perpY * speed * 0.6 * slideSign;
    }

    // Chaos repulsion
    for (const c of MAP.chaos) {
      const cx = c.x + c.w / 2,
        cy = c.y + c.h / 2;
      const clx = Math.max(c.x, Math.min(c.x + c.w, x));
      const cly = Math.max(c.y, Math.min(c.y + c.h, y));
      let crx = x - clx,
        cry = y - cly;
      let cd = Math.hypot(crx, cry);
      if (cd < 0.001) {
        crx = x - cx;
        cry = y - cy;
        cd = Math.hypot(crx, cry);
        if (cd < 0.001) {
          crx = 1;
          cry = 0;
          cd = 1;
        }
      }
      if (STATE.phase === "chaos") {
        const effectRadius = Math.max(c.w, c.h) / 2 + 1;
        const dCenter = Math.hypot(x - cx, y - cy);
        if (dCenter < effectRadius) {
          const force =
            (1 - dCenter / effectRadius) * (c.intensity || 1.0) * 4.0;
          sfx += (crx / cd) * force;
          sfy += (cry / cd) * force;
          if (dCenter < effectRadius * 0.7) apanic[i] = 1.0;
        }
      }
    }

    // ── Obstacle repulsion (rotated-rect aware) ──────────────────────
    let totalObstacleForceX = 0, totalObstacleForceY = 0;
    const allSolidRects = [...MAP.obstacles, ...MAP.barricades.filter(b => !b.broken)];
    for (const o of allSolidRects) {
      const cp = closestPointOnRotatedRect(x, y, o);
      const orx = x - cp.x;
      const ory = y - cp.y;
      const od = Math.hypot(orx, ory);
      if (od < 6 && od > 0.001) {
        // Strong close push + softer far push for smoother paths
        const force = od < 3.5
          ? Math.exp((1.5 - od) / 0.8) * 0.7
          : (6 - od) / 6 * 0.35;
        const fx = (orx / od) * force;
        const fy = (ory / od) * force;
        sfx += fx;
        sfy += fy;
        totalObstacleForceX += fx;
        totalObstacleForceY += fy;

        // ── CORNER-ESCAPE: tangential slide along obstacle surface ────
        if (od < 5.0 && (STATE.phase === 'evac' || STATE.phase === 'chaos')) {
          const normalX = orx / od, normalY = ory / od;
          const desiredDotNormal = ddx * normalX + ddy * normalY;
          if (desiredDotNormal < 0.3) {
            const t1x = -normalY, t1y = normalX;
            const t2x = normalY,  t2y = -normalX;
            const dot1 = t1x * ddx + t1y * ddy;
            const dot2 = t2x * ddx + t2y * ddy;
            const blockFactor = Math.max(0, -desiredDotNormal);
            const slideStr = 0.9 * (1 - od / 5.0) * (0.5 + blockFactor);
            if (dot1 >= dot2) {
              sfx += t1x * slideStr;
              sfy += t1y * slideStr;
            } else {
              sfx += t2x * slideStr;
              sfy += t2y * slideStr;
            }
          }
        }
      }
    }

    // Boundary / wall repulsion
    let isInsidePolygon = true;
    if (MAP.boundary && MAP.boundary.length > 2) {
      isInsidePolygon = inBoundary(x, y);
      if (!isInsidePolygon) {
        let bCx = 0,
          bCy = 0;
        for (const pt of MAP.boundary) {
          bCx += pt.x;
          bCy += pt.y;
        }
        bCx /= MAP.boundary.length;
        bCy /= MAP.boundary.length;
        const fX = bCx - x,
          fY = bCy - y,
          fD = Math.hypot(fX, fY);
        if (fD > 0.001) {
          sfx += (fX / fD) * 1.5;
          sfy += (fY / fD) * 1.5;
        }
      } else {
        const pts = MAP.boundary;
        for (let j = 0; j < pts.length; j++) {
          const p1 = pts[j];
          const p2 = pts[(j + 1) % pts.length];
          const res = distToSegment(x, y, p1.x, p1.y, p2.x, p2.y);
          if (res.dist < 1.5 && res.dist > 0.001) {
            sfx += (res.rx / res.dist) * Math.exp((1.5 - res.dist) / 0.8) * 0.7;
            sfy += (res.ry / res.dist) * Math.exp((1.5 - res.dist) / 0.8) * 0.7;
          }
        }
      }
    } else {
      const wr = 1.5;
      if (x < wr) sfx += Math.exp((wr - x) / 0.8) * 0.7;
      if (x > WORLD.w - wr) sfx -= Math.exp((x - (WORLD.w - wr)) / 0.8) * 0.7;
      if (y < wr) sfy += Math.exp((wr - y) / 0.8) * 0.7;
      if (y > WORLD.h - wr) sfy -= Math.exp((y - (WORLD.h - wr)) / 0.8) * 0.7;
      isInsidePolygon = x >= 0 && x <= WORLD.w && y >= 0 && y <= WORLD.h;
    }

    // Panic noise
    if (pf > 0.25) {
      desVx += (Math.random() - 0.5) * pf * BASE_SPEED * 1.5;
      desVy += (Math.random() - 0.5) * pf * BASE_SPEED * 1.5;
    }

    // Cap social/obstacle force
    const sfMag = Math.hypot(sfx, sfy);
    const maxSF = speed * 3.0;
    if (sfMag > maxSF) { sfx *= maxSF / sfMag; sfy *= maxSF / sfMag; }

    // Compose & clamp velocity
    let tvx = desVx + sfx, tvy = desVy + sfy;
    const tmag = Math.hypot(tvx, tvy);
    const maxV = speed * 1.6;
    if (tmag > maxV) { tvx *= maxV / tmag; tvy *= maxV / tmag; }

    // Inertia
    avx[i] = avx[i] * INERTIA + tvx * (1 - INERTIA);
    avy[i] = avy[i] * INERTIA + tvy * (1 - INERTIA);

    // ── ANTI-VIBRATION: detect when repulsion fights desired direction ──
    // When obstacle repulsion force opposes the desired movement direction
    // for many consecutive frames, the agent is stuck/vibrating.
    // After a threshold, apply a sideways nudge to break the deadlock.
    if (STATE.phase === 'evac' || STATE.phase === 'chaos') {
      const obstForceDotDesired = totalObstacleForceX * ddx + totalObstacleForceY * ddy;
      // obstForceDotDesired < 0 means repulsion is pushing AGAINST where we want to go
      if (obstForceDotDesired < -0.05 && Math.hypot(totalObstacleForceX, totalObstacleForceY) > 0.05) {
        aoscill[i] = Math.min(60, aoscill[i] + 1);
      } else {
        aoscill[i] = Math.max(0, aoscill[i] - 2);
      }
      // After ~0.25s of fighting an obstacle, break out with a lateral nudge
      if (aoscill[i] > 15) {
        // Perpendicular nudge to escape the blockage
        const perpX = -ddy, perpY = ddx; // 90° rotation of desired direction
        const nudgeSign = (Math.random() < 0.5) ? 1 : -1;
        avx[i] = perpX * speed * 1.2 * nudgeSign;
        avy[i] = perpY * speed * 1.2 * nudgeSign;
        aoscill[i] = 0;
      }
    }

    // ── POSITION-BASED STUCK DETECTION & EXIT REROUTING (10-Second Rule) ──
    if (STATE.phase === "evac" || STATE.phase === "chaos") {
      // Checkpoint every 120 ticks (2 seconds) as requested
      if (simTick % 120 === (i % 120)) {
        const displacement = Math.hypot(x - acheckX[i], y - acheckY[i]);

        if (displacement < 1.5 && acheckX[i] !== 0) {
          // They haven't moved meaningfully in the last 2 seconds. Increment stuck counter.
          astuckCount[i] = (astuckCount[i] || 0) + 1;
        } else {
          // Moved fine, reset stuck tracking.
          astuckCount[i] = 0;
        }

        // If stuck consecutively for 5 checks (5 * 2s = 10s rule enforced)
        if (astuckCount[i] >= 5) {
          // Agent is rigidly stuck. Ban their current exit to force re-routing.
          let nearestEi = -1, nearestD = Infinity;
          for (let ei = 0; ei < allExits.length; ei++) {
            if (abannedExit[i] === ei) continue;
            const d = Math.hypot(x - allExits[ei].x, y - allExits[ei].y);
            if (d < nearestD) { nearestD = d; nearestEi = ei; }
          }
          if (nearestEi >= 0) abannedExit[i] = nearestEi;

          // ── PHYSICAL ESCAPE: eject toward nearest obstacle corner ────
          // Find the nearest obstacle and compute an escape point at
          // the closest corner + 3m offset into open space.
          let escObs = null, escDist = Infinity;
          for (const o of MAP.obstacles) {
            const ecp = closestPointOnRotatedRect(x, y, o);
            const ed = Math.hypot(x - ecp.x, y - ecp.y);
            if (ed < escDist) { escDist = ed; escObs = o; }
          }
          if (escObs && escDist < 8) {
            // Get the 4 corners of the obstacle in world space
            const ang = escObs.angle || 0;
            const cosA = Math.cos(ang), sinA = Math.sin(ang);
            const hw = escObs.w / 2, hh = escObs.h / 2;
            const corners = [
              { cx: escObs.x + hw * cosA - hh * sinA, cy: escObs.y + hw * sinA + hh * cosA },
              { cx: escObs.x - hw * cosA - hh * sinA, cy: escObs.y - hw * sinA + hh * cosA },
              { cx: escObs.x - hw * cosA + hh * sinA, cy: escObs.y - hw * sinA - hh * cosA },
              { cx: escObs.x + hw * cosA + hh * sinA, cy: escObs.y + hw * sinA - hh * cosA },
            ];
            // Find closest corner
            let bestCorner = corners[0], bestCD = Infinity;
            for (const c of corners) {
              const cd = Math.hypot(x - c.cx, y - c.cy);
              if (cd < bestCD) { bestCD = cd; bestCorner = c; }
            }
            // Escape point = corner + 3m outward from obstacle center
            const escDir = Math.hypot(bestCorner.cx - escObs.x, bestCorner.cy - escObs.y) || 1;
            const escX = bestCorner.cx + (bestCorner.cx - escObs.x) / escDir * 3;
            const escY = bestCorner.cy + (bestCorner.cy - escObs.y) / escDir * 3;
            // Apply strong impulse toward escape point
            const impDx = escX - x, impDy = escY - y;
            const impD = Math.hypot(impDx, impDy) || 1;
            avx[i] = (impDx / impD) * speed * 1.5;
            avy[i] = (impDy / impD) * speed * 1.5;
          }
        } else {
          // Agent is moving fine — clear any previous ban
          if (abannedExit[i] >= 0) abannedExit[i] = -1;
        }

        // Save current position as checkpoint
        acheckX[i] = x;
        acheckY[i] = y;
      }
    }

    let newx = x + avx[i];
    let newy = y + avy[i];
    newx = Math.max(0.5, Math.min(WORLD.w - 0.5, newx));
    newy = Math.max(0.5, Math.min(WORLD.h - 0.5, newy));

    // ── Obstacle collision: slide → half-step → stop (disk-based) ────────
    // isInObstacle now uses full AGENT_RADIUS disk check, so this correctly
    // prevents the agent from entering any space narrower than its body.
    if (isInObstacle(newx, newy, AGENT_RADIUS)) {
      if (!isInObstacle(newx, y, AGENT_RADIUS)) { newy = y; avy[i] = 0; }
      else if (!isInObstacle(x, newy, AGENT_RADIUS)) { newx = x; avx[i] = 0; }
      else if (!isInObstacle(x + avx[i] * 0.5, y + avy[i] * 0.5, AGENT_RADIUS)) {
        newx = x + avx[i] * 0.5; newy = y + avy[i] * 0.5;
      } else {
        newx = x; newy = y; avx[i] = 0; avy[i] = 0;
      }
    }

    // Boundary hard constraint
    if (MAP.boundary && MAP.boundary.length > 2 && isInsidePolygon) {
      if (!inBoundary(newx, newy)) {
        if (inBoundary(newx, y)) {
          newy = y;
          avy[i] *= -0.5;
        } else if (inBoundary(x, newy)) {
          newx = x;
          avx[i] *= -0.5;
        } else {
          newx = x;
          newy = y;
          avx[i] *= -0.5;
          avy[i] *= -0.5;
        }
      }
    }

    nx[i] = newx;
    ny[i] = newy;
  }

  for (let i = 0; i < agentCount; i++) {
    ax[i] = nx[i];
    ay[i] = ny[i];
  }

  computeDensity();
  detectBottlenecks();
  updateSimStats();
  if (simTick % 30 === 0 && typeof checkEvacComplete === 'function') checkEvacComplete();

  if (simTick % 60 === 0) {
    let peakD = 0;
    for (const v of densityGrid) if (v > peakD) peakD = v;
    statsHistory.push({
      time: simElapsed.toFixed(1),
      agents_alive: (() => {
        let c = 0;
        for (let i = 0; i < agentCount; i++) if (aalive[i]) c++;
        return c;
      })(),
      total_spawned: totalSpawned,
      evacuated: evacuatedCount,
      peak_density: peakD.toFixed(2),
      phase: STATE.phase,
    });
    
    // Check for new peak density to capture peak snapshots during evacuation/chaos
    if ((STATE.phase === "evac" || STATE.phase === "chaos") && peakD >= (window.maxPeakDensity || 0) + 0.01 && peakD > 0.05) {
      window.maxPeakDensity = peakD;
      if (typeof window.capturePeakSnapshots === 'function') {
        window.capturePeakSnapshots();
      }
    }
  }

  // ── BARRICADE COLLISION TRACKING & BREAKING ──────────────────────
  if (STATE.phase !== 'idle') {
    for (const b of MAP.barricades) {
      if (b.broken) continue;
      // Count agents pressing against this barricade
      let pressCount = 0;
      for (let i = 0; i < agentCount; i++) {
        if (!aalive[i]) continue;
        const cp = closestPointOnRotatedRect(ax[i], ay[i], b);
        const dist = Math.hypot(ax[i] - cp.x, ay[i] - cp.y);
        if (dist < 2.5) pressCount++;
      }
      
      // If ≥3 agents are pressing, decrement durability
      if (pressCount >= 3) {
        // Decrease by 0.05 per frame so 20 durability lasts ~7 seconds at 60fps
        b.durability = Math.max(0, b.durability - 0.05);

        // Log pressure warning (throttled)
        if (simTick % 120 === 0 && typeof logTimeline === 'function') {
          const areaName = getAreaName(b.x, b.y);
          logTimeline('warning', `🧱 ${b.label || 'Barricade'} under pressure at ${areaName} — ${Math.ceil(b.durability)}/${b.maxDurability} durability (${pressCount} agents pushing)`);
        }
        
        // Check if it broke
        if (b.durability <= 0) {
          b.broken = true;
          b.durability = 0;
          if (typeof logTimeline === 'function') {
            const areaName = getAreaName(b.x, b.y);
            logTimeline('barricade', `🧱 ${b.label || 'Barricade'} BROKE at ${areaName} — ${pressCount} agents overwhelmed it!`);
          }
          // Redraw to show broken state
          if (typeof drawMapLayer === 'function') drawMapLayer();
        }
      }
    }
  }
}

function pickWeightedZone() {
  if (MAP.zones.length === 0) return 0;
  const total = MAP.zones.reduce((s, z) => s + (z.attraction || 0.5), 0);
  let roll = Math.random() * total,
    cumul = 0;
  for (let zi = 0; zi < MAP.zones.length; zi++) {
    cumul += MAP.zones[zi].attraction || 0.5;
    if (roll <= cumul) return zi;
  }
  return MAP.zones.length - 1;
}

function computeDensity() {
  densityGrid.fill(0);
  for (let i = 0; i < agentCount; i++) {
    if (!aalive[i]) continue;
    const cx = Math.min(DGW - 1, Math.floor(ax[i] / DCELL));
    const cy = Math.min(DGH - 1, Math.floor(ay[i] / DCELL));
    densityGrid[cy * DGW + cx]++;
  }
  const cellArea = DCELL * DCELL;
  for (let i = 0; i < densityGrid.length; i++) densityGrid[i] /= cellArea;
}

/* ================================================================
   getAreaName(x, y) — resolve human-readable area name from coords.
   Priority: zone label → nearby exit/entry name → map quadrant.
   Does NOT change any detection logic — only provides display names.
   ================================================================ */
function getAreaName(x, y) {
  const coords = `(${Math.round(x)}m, ${Math.round(y)}m)`;

  // 1. Inside a named zone?
  for (const z of MAP.zones) {
    if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) {
      return (z.label || z.type || 'Zone') + ' ' + coords;
    }
  }

  // 2. Near any exit? (within 15m)
  let nearestFeature = null, nearestDist = 15;
  for (const ex of MAP.exits) {
    const d = Math.hypot(x - ex.x, y - ex.y);
    if (d < nearestDist) {
      nearestDist = d;
      nearestFeature = (ex.label || 'Exit') + ' Area';
    }
  }
  // 3. Near any entry/gate? (within 15m)
  for (const en of MAP.entries) {
    const d = Math.hypot(x - en.x, y - en.y);
    if (d < nearestDist) {
      nearestDist = d;
      nearestFeature = (en.label || 'Gate') + ' Area';
    }
  }
  // 4. Near any obstacle/barrier? (within 10m)
  for (const o of MAP.obstacles) {
    const d = Math.hypot(x - o.x, y - o.y);
    if (d < Math.min(nearestDist, 10)) {
      nearestDist = d;
      nearestFeature = 'Near ' + (o.label || 'Barrier');
    }
  }
  // 4b. Near any barricade? (within 10m)
  for (const b of MAP.barricades) {
    const d = Math.hypot(x - b.x, y - b.y);
    if (d < Math.min(nearestDist, 10)) {
      nearestDist = d;
      nearestFeature = 'Near ' + (b.label || 'Barricade');
    }
  }
  if (nearestFeature) return nearestFeature + ' ' + coords;

  // 5. Map quadrant fallback — split into 3×3 grid with human names
  const fracX = x / WORLD.w;
  const fracY = y / WORLD.h;
  const col = fracX < 0.33 ? 'West' : fracX > 0.66 ? 'East' : 'Central';
  const row = fracY < 0.33 ? 'North' : fracY > 0.66 ? 'South' : 'Central';
  let name;
  if (col === 'Central' && row === 'Central') name = 'Central Area';
  else if (col === 'Central') name = row + ' Corridor';
  else if (row === 'Central') name = col + ' Corridor';
  else name = row + '-' + col + ' Area';
  return name + ' ' + coords;
}

const warnings = [];
function detectBottlenecks() {
  warnings.length = 0;
  let maxD = 0;

  const dangerCells = [];
  for (let i = 0; i < DGW * DGH; i++) {
    const d = densityGrid[i];
    if (d > maxD) maxD = d;
    if (d > 5) {
      const cx = (i % DGW) * DCELL + DCELL / 2;
      const cy = Math.floor(i / DGW) * DCELL + DCELL / 2;
      let zoneName = null;
      for (const z of MAP.zones) {
        if (cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h) {
          zoneName = z.label || z.type;
          break;
        }
      }
      dangerCells.push({ cx, cy, d, zoneName });
    }
  }

  const clusters = [];
  for (const cell of dangerCells) {
    let merged = false;
    for (const cl of clusters) {
      if (Math.hypot(cell.cx - cl.cx, cell.cy - cl.cy) < DCELL * 2) {
        cl.d = Math.max(cl.d, cell.d);
        cl.zoneName = cl.zoneName || cell.zoneName;
        merged = true;
        break;
      }
    }
    if (!merged) clusters.push({ ...cell });
  }

  for (const cl of clusters.slice(0, 4)) {
    const label = cl.zoneName
      ? `"${cl.zoneName}"`
      : getAreaName(cl.cx, cl.cy);
    warnings.push({
      level: "danger",
      msg: `DANGER ${label}: ${cl.d.toFixed(1)} ppl/m²`,
    });
  }
  // Timeline: log first danger zone detection
  if (clusters.length > 0 && !_timelineFirstDanger && typeof logTimeline === 'function') {
    _timelineFirstDanger = true;
    const cl = clusters[0];
    const label = cl.zoneName ? `"${cl.zoneName}"` : getAreaName(cl.cx, cl.cy);
    logTimeline('danger', `⚠ First DANGER zone at ${label} — ${cl.d.toFixed(1)} ppl/m²`);
  }

  let warnCount = 0;
  for (let i = 0; i < DGW * DGH; i++) {
    if (densityGrid[i] >= 2 && densityGrid[i] < 5 && warnCount < 2) {
      const cx = (i % DGW) * DCELL + DCELL / 2;
      const cy = Math.floor(i / DGW) * DCELL + DCELL / 2;
      let zoneName = null;
      for (const z of MAP.zones) {
        if (cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h) {
          zoneName = z.label || z.type;
          break;
        }
      }
      const label = zoneName
        ? `"${zoneName}"`
        : getAreaName(cx, cy);
      warnings.push({
        level: "warn",
        msg: `Crowded at ${label}: ${densityGrid[i].toFixed(1)} ppl/m²`,
      });
      warnCount++;
    }
  }

  if (STATE.phase === "evac" || STATE.phase === "chaos") {
    let checkExits = [
      ...MAP.exits,
      ...MAP.entries
        .filter((e) => e.convertToExit)
        .map((e) => ({
          ...e,
          isEntryConverted: true,
          capacity: 120,
          width: 2,
        })),
    ];
    for (const ex of checkExits) {
      let queueLen = 0;
      for (let i = 0; i < agentCount; i++) {
        if (aalive[i] && Math.hypot(ax[i] - ex.x, ay[i] - ex.y) < 12)
          queueLen++;
      }
      const maxQueue = ex.capacity / 5;
      if (queueLen > maxQueue) {
        warnings.push({
          level: "danger",
          msg: `${ex.label || "Exit"}: overloaded (${queueLen} queued, cap ${ex.capacity}/min)`,
        });
        // Timeline: log exit overload (throttled to avoid spam)
        if (typeof logTimeline === 'function' && simTick % 300 === 0) {
          const exitArea = getAreaName(ex.x, ex.y);
          logTimeline('warning', `${ex.label || "Exit"} overloaded at ${exitArea} — ${queueLen} agents queued (cap ${ex.capacity}/min)`);
        }
      } else if (queueLen > maxQueue * 0.6) {
        warnings.push({
          level: "warn",
          msg: `${ex.label || "Exit"}: congestion forming (${queueLen} queued)`,
        });
      }
    }
    if (checkExits.length === 0) {
      warnings.push({
        level: "danger",
        msg: "No exits on map! Add exits in Map Editor.",
      });
    }
  }

  const wl = document.getElementById("warnings-list");

  // Add barricade pressure warnings
  for (const b of MAP.barricades) {
    if (b.broken) {
      warnings.push({
        level: "info",
        msg: `🧱 ${b.label || 'Barricade'}: BROKEN — agents passing through`,
      });
    } else if (b.durability < b.maxDurability) {
      const durPct = (b.durability / b.maxDurability * 100).toFixed(0);
      warnings.push({
        level: b.durability < b.maxDurability * 0.25 ? "danger" : "warn",
        msg: `🧱 ${b.label || 'Barricade'}: ${durPct}% integrity (${Math.ceil(b.durability)}/${b.maxDurability})`,
      });
    }
  }

  if (warnings.length === 0) {
    wl.innerHTML =
      '<p class="no-selection" style="font-family:\'DM Mono\',monospace;font-size:0.6rem;color:var(--dim)">✓ All clear</p>';
  } else {
    wl.innerHTML = warnings
      .slice(0, 6)
      .map((w) => `<div class="warning-item ${w.level}">⚠ ${w.msg}</div>`)
      .join("");
  }

  document.getElementById("sv-density").textContent = maxD.toFixed(1);
  document.getElementById("sc-density").className =
    "stat-card " + (maxD > 5 ? "danger" : maxD > 2 ? "warn" : "safe");
}

function updateSimStats() {
  let alive = 0;
  for (let i = 0; i < agentCount; i++) if (aalive[i]) alive++;
  document.getElementById("sv-agents").textContent = alive;
  document.getElementById("sv-evac").textContent = evacuatedCount;
  document.getElementById("sv-time").textContent = simElapsed.toFixed(0) + "s";
  document.getElementById("sv-total").textContent = totalSpawned;
  const pct =
    totalSpawned > 0 ? ((evacuatedCount / totalSpawned) * 100).toFixed(0) : 0;
  document.getElementById("evac-progress").style.width = pct + "%";
  document.getElementById("evac-pct").textContent =
    pct + "% of spawned evacuated";

  // Venue area + agent scale badge
  const venueAreaEl = document.getElementById("sv-venue-area");
  const agentScaleEl = document.getElementById("sv-agent-scale");
  if (venueAreaEl) {
    const area = computeVenueArea();
    venueAreaEl.textContent = area.toFixed(0) + " m²";
  }
  if (agentScaleEl) {
    const referenceArea = WORLD.w * WORLD.h;
    const venueArea = computeVenueArea();
    const ratio = venueArea / referenceArea;
    const scaleFactor = 1 / Math.sqrt(ratio);
    let badge, col;
    if (scaleFactor >= 2.0) {
      badge = "XL";
      col = "#ef4444";
    } else if (scaleFactor >= 1.4) {
      badge = "LG";
      col = "#f97316";
    } else if (scaleFactor >= 0.8) {
      badge = "MD";
      col = "#22c55e";
    } else if (scaleFactor >= 0.5) {
      badge = "SM";
      col = "#3b82f6";
    } else {
      badge = "XS";
      col = "#a855f7";
    }
    agentScaleEl.innerHTML = `<span style="color:${col};font-weight:600">${badge}</span>`;
  }
}
