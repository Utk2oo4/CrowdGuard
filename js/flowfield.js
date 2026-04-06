/* ================================================================
   MODULE: FLOW FIELD PATHFINDING
   ================================================================
   BFS from each goal outward. Each cell stores best direction to
   reach goal while avoiding obstacles. Agents sample their cell
   each tick — no per-agent pathfinding cost.
   FF_CELL = 1m resolution (was 2m). Higher resolution allows the
   BFS to detect and block openings narrower than one agent body.
   isInObstacleFF uses rotated-rect math with a physics-based margin
   equal to AGENT_RADIUS, so any gap < 2*AGENT_RADIUS (the agent
   diameter) is treated as impassable in the pathfinding graph.
   ================================================================ */

// 1m resolution — changed from 2m so a 0.8m-radius agent's collision
// margin correctly seals gaps smaller than its physical diameter.
let FF_CELL = 1;
let FFW = Math.ceil(WORLD.w / FF_CELL);
let FFH = Math.ceil(WORLD.h / FF_CELL);
const _ffCache = new Map();

/* Called by resizeWorld / initSim whenever WORLD dimensions change. */
function recalcFlowFieldSize() {
  FFW = Math.ceil(WORLD.w / FF_CELL);
  FFH = Math.ceil(WORLD.h / FF_CELL);
  _ffCache.clear();
}

function markFlowFieldDirty() { _ffCache.clear(); }

function getFlowField(gx, gy) {
  const key = Math.round(gx / FF_CELL) + '_' + Math.round(gy / FF_CELL);
  if (_ffCache.has(key)) return _ffCache.get(key);
  const ff = buildFlowField(gx, gy);
  _ffCache.set(key, ff);
  return ff;
}

function buildFlowField(gx, gy) {
  const dx = new Float32Array(FFW * FFH);
  const dy = new Float32Array(FFW * FFH);
  const dist = new Float32Array(FFW * FFH).fill(Infinity);
  const gcx = Math.min(FFW - 1, Math.max(0, Math.floor(gx / FF_CELL)));
  const gcy = Math.min(FFH - 1, Math.max(0, Math.floor(gy / FF_CELL)));
  
  const queue = new Int32Array(FFW * FFH * 2);
  let qHead = 0, qTail = 0;
  dist[gcy * FFW + gcx] = 0;
  queue[qTail++] = gcx; queue[qTail++] = gcy;
  const DIRS = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, 1.41], [1, -1, 1.41], [-1, 1, 1.41], [1, 1, 1.41]];
  while (qHead < qTail) {
    const cx = queue[qHead++], cy = queue[qHead++];
    const cDist = dist[cy * FFW + cx];
    for (const [nx, ny, cost] of DIRS) {
      const nx2 = cx + nx, ny2 = cy + ny;
      if (nx2 < 0 || nx2 >= FFW || ny2 < 0 || ny2 >= FFH) continue;
      const wx = nx2 * FF_CELL + FF_CELL * 0.5, wy = ny2 * FF_CELL + FF_CELL * 0.5;
      if (isInObstacleFF(wx, wy)) continue;
      const newDist = cDist + cost;
      const nIdx = ny2 * FFW + nx2;
      if (newDist < dist[nIdx]) { dist[nIdx] = newDist; queue[qTail++] = nx2; queue[qTail++] = ny2; }
    }
  }
  
  for (let cy = 0; cy < FFH; cy++) {
    for (let cx = 0; cx < FFW; cx++) {
      const idx = cy * FFW + cx;
      const wx = cx * FF_CELL + FF_CELL * 0.5, wy = cy * FF_CELL + FF_CELL * 0.5;

      if (dist[idx] === Infinity) {
        // This cell is inside/near an obstacle — the BFS never reached it.
        // Instead of aiming straight at goal (which goes through walls),
        // search a radius (up to 4 cells) for the nearest cell that HAS a path.
        // This ensures the flowfield points them "out" to open space.
        let bestNd = Infinity, bnx = 0, bny = 0;
        let found = false;
        for (let r = 1; r <= 4 && !found; r++) {
          for (let dy2 = -r; dy2 <= r; dy2++) {
            for (let dx2 = -r; dx2 <= r; dx2++) {
              if (Math.abs(dx2) !== r && Math.abs(dy2) !== r) continue;
              const nx = cx + dx2, ny = cy + dy2;
              if (nx < 0 || nx >= FFW || ny < 0 || ny >= FFH) continue;
              const nd = dist[ny * FFW + nx];
              if (nd < bestNd) { bestNd = nd; bnx = dx2; bny = dy2; found = true; }
            }
          }
        }
        if (found) {
          const mag = Math.hypot(bnx, bny) || 1;
          dx[idx] = bnx / mag; dy[idx] = bny / mag;
        } else {
          // Last resort: aim at goal
          const fdx = gx - wx, fdy = gy - wy, fd = Math.hypot(fdx, fdy) || 1;
          dx[idx] = fdx / fd; dy[idx] = fdy / fd;
        }
        continue;
      }

      let bestD = dist[idx], bdx = 0, bdy = 0;
      for (const [nx, ny] of DIRS) {
        const nx2 = cx + nx, ny2 = cy + ny;
        if (nx2 < 0 || nx2 >= FFW || ny2 < 0 || ny2 >= FFH) continue;
        const nd = dist[ny2 * FFW + nx2];
        if (nd < bestD) { bestD = nd; bdx = nx; bdy = ny; }
      }
      if (bdx === 0 && bdy === 0) {
        const fdx = gx - wx, fdy = gy - wy, fd = Math.hypot(fdx, fdy) || 1;
        dx[idx] = fdx / fd; dy[idx] = fdy / fd;
      } else {
        const mag = Math.hypot(bdx, bdy);
        dx[idx] = bdx / mag; dy[idx] = bdy / mag;
      }
    }
  }
  return { dx, dy };
}

/* ----------------------------------------------------------------
   isInObstacleFF — Rotated-rect check for the BFS pathfinder.

   MARGIN = AGENT_RADIUS = 0.8m
   ─────────────────────────────
   By inflating each obstacle by exactly one agent radius, we make
   the BFS treat any corridor as impassable when the agent's disk
   (radius 0.8m, diameter 1.6m) would not fit through it.

   How it closes narrow gaps:
     - If two obstacles are 1.2m apart, each inflated by 0.8m would
       "reach" 0.8m into the gap from either side, filling it.
     - Any opening < 2*AGENT_RADIUS (1.6m) is sealed in the graph.
     - Agents are rerouted to wider openings before they ever try
       to push through a physically impossible gap.

   The +0.1m buffer prevents the agent from grazing an obstacle
   surface and getting stuck on a corner.
   ---------------------------------------------------------------- */
function isInObstacleFF(wx, wy) {
  // Use AGENT_RADIUS (defined in physics.js, loaded before this file)
  // with a tiny extra buffer so the margin is robust under rounding.
  const margin = (typeof AGENT_RADIUS !== 'undefined' ? AGENT_RADIUS : 0.8) + 0.1;
  for (const o of MAP.obstacles) {
    const angle = o.angle || 0;
    const ddx = wx - o.x, ddy = wy - o.y;
    const cos = Math.cos(-angle), sin = Math.sin(-angle);
    const lx = ddx * cos - ddy * sin, ly = ddx * sin + ddy * cos;
    if (Math.abs(lx) <= o.w / 2 + margin && Math.abs(ly) <= o.h / 2 + margin) return true;
  }
  return false;
}

function sampleFlowField(ff, wx, wy) {
  const cx = Math.min(FFW - 1, Math.max(0, Math.floor(wx / FF_CELL)));
  const cy = Math.min(FFH - 1, Math.max(0, Math.floor(wy / FF_CELL)));
  const idx = cy * FFW + cx;
  return { dx: ff.dx[idx], dy: ff.dy[idx] };
}
