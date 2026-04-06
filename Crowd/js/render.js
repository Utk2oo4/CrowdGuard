/* ================================================================
   MODULE: MAP EDITOR — DRAWING
   ================================================================ */
function drawAll() {
  drawBackground();
  drawMapLayer();
  drawUILayer();

  // Sync pan sliders
  const px = document.getElementById("pan-x");
  const py = document.getElementById("pan-y");
  if (px) {
    px.max = WORLD.w;
    px.value = STATE.panX;
  }
  if (py) {
    py.max = WORLD.h;
    py.value = STATE.panY;
  }
}

function drawBackground() {
  const w = canvasBg.width,
    h = canvasBg.height;
  ctxBg.clearRect(0, 0, w, h);

  // Floorplan
  if (STATE.floorplanImg) {
    const tl = w2s(0, 0),
      br = w2s(WORLD.w, WORLD.h);
    ctxBg.globalAlpha = STATE.floorplanOpacity;
    ctxBg.drawImage(STATE.floorplanImg, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctxBg.globalAlpha = 1;
  }

  // Grid
  ctxBg.strokeStyle = "rgba(30,42,58,0.5)";
  ctxBg.lineWidth = 0.5;
  const gridSize = 10; // 10m grid
  const startX = Math.floor((STATE.panX - WORLD.w / 2) / gridSize) * gridSize;
  const startY = Math.floor((STATE.panY - WORLD.h / 2) / gridSize) * gridSize;
  for (let gx = startX; gx <= startX + WORLD.w * 2; gx += gridSize) {
    const p = w2s(gx, 0);
    ctxBg.beginPath();
    ctxBg.moveTo(p.x, 0);
    ctxBg.lineTo(p.x, canvasBg.height);
    ctxBg.stroke();
  }
  for (let gy = startY; gy <= startY + WORLD.h * 2; gy += gridSize) {
    const p = w2s(0, gy);
    ctxBg.beginPath();
    ctxBg.moveTo(0, p.y);
    ctxBg.lineTo(canvasBg.width, p.y);
    ctxBg.stroke();
  }

  // World boundary box
  const tl = w2s(0, 0),
    br = w2s(WORLD.w, WORLD.h);
  ctxBg.strokeStyle = "rgba(59,130,246,0.15)";
  ctxBg.lineWidth = 1;
  ctxBg.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
}

function drawMapLayer() {
  const w = canvasMap.width,
    h = canvasMap.height;
  ctxMap.clearRect(0, 0, w, h);

  // Boundary polygon
  if (MAP.boundary.length > 1) {
    ctxMap.beginPath();
    const p0 = w2s(MAP.boundary[0].x, MAP.boundary[0].y);
    ctxMap.moveTo(p0.x, p0.y);
    for (let i = 1; i < MAP.boundary.length; i++) {
      const p = w2s(MAP.boundary[i].x, MAP.boundary[i].y);
      ctxMap.lineTo(p.x, p.y);
    }
    ctxMap.closePath();
    ctxMap.fillStyle = "rgba(249,115,22,0.05)";
    ctxMap.fill();
    ctxMap.strokeStyle = "rgba(249,115,22,0.6)";
    ctxMap.lineWidth = 1.5;
    ctxMap.setLineDash([5, 4]);
    ctxMap.stroke();
    ctxMap.setLineDash([]);
    // Vertices
    MAP.boundary.forEach((pt, i) => {
      const p = w2s(pt.x, pt.y);
      ctxMap.fillStyle =
        STATE.selectedId === "bound-" + i ? "#f97316" : "rgba(249,115,22,0.7)";
      ctxMap.beginPath();
      ctxMap.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctxMap.fill();
    });
  }

  // ── Obstacles ─────────────────────────────────────────────────────────
  // Obstacles now store: center (o.x, o.y), size (o.w, o.h), angle (radians).
  // We use canvas transform (translate + rotate) so any angle is handled correctly.
  MAP.obstacles.forEach((o) => {
    const sel = STATE.selectedId === o.id;
    const angle = o.angle || 0;
    const center = w2s(o.x, o.y);

    // Half-extents in screen pixels
    const hw = (o.w / 2) * STATE.zoom;
    const hh = (o.h / 2) * STATE.zoom;

    ctxMap.save();
    ctxMap.translate(center.x, center.y);
    ctxMap.rotate(angle);

    ctxMap.fillStyle = sel ? "rgba(239,68,68,0.35)" : "rgba(239,68,68,0.18)";
    ctxMap.fillRect(-hw, -hh, hw * 2, hh * 2);

    ctxMap.strokeStyle = sel ? "#ef4444" : "rgba(239,68,68,0.6)";
    ctxMap.lineWidth = sel ? 2 : 1;
    ctxMap.strokeRect(-hw, -hh, hw * 2, hh * 2);

    // Label (drawn without rotation so it stays readable)
    ctxMap.restore();
    drawLabel(ctxMap, o.label || "Obstacle", center.x, center.y, "#ef4444");
  });

  // ── Barricades ─────────────────────────────────────────────────────────
  MAP.barricades.forEach((b) => {
    const sel = STATE.selectedId === b.id;
    const angle = b.angle || 0;
    const center = w2s(b.x, b.y);
    const hw = (b.w / 2) * STATE.zoom;
    const hh = (b.h / 2) * STATE.zoom;

    ctxMap.save();
    ctxMap.translate(center.x, center.y);
    ctxMap.rotate(angle);

    if (b.broken) {
      // Broken: ghost outline with cracked look
      ctxMap.fillStyle = 'rgba(107,114,128,0.08)';
      ctxMap.fillRect(-hw, -hh, hw * 2, hh * 2);
      ctxMap.strokeStyle = 'rgba(107,114,128,0.35)';
      ctxMap.lineWidth = 1;
      ctxMap.setLineDash([3, 5]);
      ctxMap.strokeRect(-hw, -hh, hw * 2, hh * 2);
      ctxMap.setLineDash([]);
      // Crack X pattern
      ctxMap.strokeStyle = 'rgba(239,68,68,0.3)';
      ctxMap.lineWidth = 1.5;
      ctxMap.beginPath();
      ctxMap.moveTo(-hw * 0.7, -hh * 0.7);
      ctxMap.lineTo(hw * 0.7, hh * 0.7);
      ctxMap.moveTo(hw * 0.7, -hh * 0.7);
      ctxMap.lineTo(-hw * 0.7, hh * 0.7);
      ctxMap.stroke();
    } else {
      // Intact: amber dashed border
      ctxMap.fillStyle = sel ? 'rgba(245,158,11,0.30)' : 'rgba(245,158,11,0.15)';
      ctxMap.fillRect(-hw, -hh, hw * 2, hh * 2);
      ctxMap.strokeStyle = sel ? '#f59e0b' : 'rgba(245,158,11,0.7)';
      ctxMap.lineWidth = sel ? 2 : 1.5;
      ctxMap.setLineDash([6, 4]);
      ctxMap.strokeRect(-hw, -hh, hw * 2, hh * 2);
      ctxMap.setLineDash([]);

      // Durability bar below the barricade
      const barW = hw * 2 * 0.8;
      const barH = Math.max(3, hh * 0.12);
      const barY = hh + 4;
      const durPct = b.maxDurability > 0 ? b.durability / b.maxDurability : 0;
      const durCol = durPct > 0.6 ? '#22c55e' : durPct > 0.25 ? '#f59e0b' : '#ef4444';
      ctxMap.fillStyle = 'rgba(30,42,58,0.5)';
      ctxMap.fillRect(-barW / 2, barY, barW, barH);
      ctxMap.fillStyle = durCol;
      ctxMap.fillRect(-barW / 2, barY, barW * durPct, barH);
    }

    ctxMap.restore();
    drawLabel(ctxMap, (b.broken ? '✕ ' : '🧱 ') + (b.label || 'Barricade'), center.x, center.y, b.broken ? '#6b7280' : '#f59e0b');
  });

  // Zones
  const zoneColors = {
    stage: "#f97316",
    food: "#eab308",
    rest: "#14b8a6",
    general: "#a855f7",
  };
  MAP.zones.forEach((z) => {
    const col = zoneColors[z.type] || "#a855f7";
    const tl = w2s(z.x, z.y),
      br = w2s(z.x + z.w, z.y + z.h);
    const sel = STATE.selectedId === z.id;
    ctxMap.fillStyle = sel ? col + "40" : col + "18";
    ctxMap.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctxMap.strokeStyle = sel ? col : col + "80";
    ctxMap.lineWidth = sel ? 2 : 1;
    ctxMap.setLineDash([4, 3]);
    ctxMap.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctxMap.setLineDash([]);
    drawLabel(
      ctxMap,
      z.label || z.type,
      (tl.x + br.x) / 2,
      (tl.y + br.y) / 2,
      col,
    );
  });

  // Entries
  MAP.entries.forEach((e) => {
    const isConverted =
      (STATE.phase === "evac" || STATE.phase === "chaos") && e.convertToExit;
    const p = w2s(e.x, e.y);
    const sel = STATE.selectedId === e.id;
    const r = wScale(isConverted ? 2.0 : 2.5);

    // Glow
    const grd = ctxMap.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
    grd.addColorStop(
      0,
      isConverted ? "rgba(59,130,246,0.3)" : "rgba(34,197,94,0.3)",
    );
    grd.addColorStop(
      1,
      isConverted ? "rgba(59,130,246,0)" : "rgba(34,197,94,0)",
    );
    ctxMap.fillStyle = grd;
    ctxMap.beginPath();
    ctxMap.arc(p.x, p.y, r * 3, 0, Math.PI * 2);
    ctxMap.fill();

    // Circle
    ctxMap.fillStyle = isConverted
      ? sel
        ? "#3b82f6"
        : "rgba(59,130,246,0.8)"
      : sel
        ? "#22c55e"
        : "rgba(34,197,94,0.8)";
    ctxMap.beginPath();
    ctxMap.arc(p.x, p.y, Math.max(r, 6), 0, Math.PI * 2);
    ctxMap.fill();
    if (sel) {
      ctxMap.strokeStyle = "#fff";
      ctxMap.lineWidth = 2;
      ctxMap.stroke();
    }

    if (isConverted) {
      drawLabel(
        ctxMap,
        (e.label || `Entry (${e.spawnRate}/min)`) + " \u2192 EXIT",
        p.x,
        p.y - Math.max(r, 6) - 8,
        "#3b82f6",
      );
    } else {
      drawArrow(ctxMap, p.x, p.y, 0, 1, r * 2, "#000");
      drawLabel(
        ctxMap,
        e.label || `Entry (${e.spawnRate}/min)`,
        p.x,
        p.y - Math.max(r, 6) - 8,
        "#22c55e",
      );
    }
  });

  // Exits
  MAP.exits.forEach((ex) => {
    const p = w2s(ex.x, ex.y);
    const sel = STATE.selectedId === ex.id;
    const r = wScale(Math.max(ex.width || 2, 1));
    const grd = ctxMap.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
    grd.addColorStop(0, "rgba(59,130,246,0.3)");
    grd.addColorStop(1, "rgba(59,130,246,0)");
    ctxMap.fillStyle = grd;
    ctxMap.beginPath();
    ctxMap.arc(p.x, p.y, r * 3, 0, Math.PI * 2);
    ctxMap.fill();
    ctxMap.fillStyle = sel ? "#3b82f6" : "rgba(59,130,246,0.8)";
    ctxMap.beginPath();
    ctxMap.arc(p.x, p.y, Math.max(r, 6), 0, Math.PI * 2);
    ctxMap.fill();
    if (sel) {
      ctxMap.strokeStyle = "#fff";
      ctxMap.lineWidth = 2;
      ctxMap.stroke();
    }
    drawLabel(
      ctxMap,
      ex.label || `Exit (${ex.capacity}/min)`,
      p.x,
      p.y - Math.max(r, 6) - 8,
      "#3b82f6",
    );
  });

  // Chaos points
  MAP.chaos.forEach((c) => {
    const tl = w2s(c.x, c.y),
      br = w2s(c.x + c.w, c.y + c.h);
    const sel = STATE.selectedId === c.id;
    
    // Read dynamic CSS variables
    const rootStyle = getComputedStyle(document.documentElement);
    const chaosCol = rootStyle.getPropertyValue('--chaos-col').trim() || '#ffffff';
    const chaosFill = rootStyle.getPropertyValue('--chaos-fill').trim() || '255, 255, 255';
    
    ctxMap.fillStyle = sel ? `rgba(${chaosFill}, 0.4)` : `rgba(${chaosFill}, 0.15)`;
    ctxMap.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctxMap.strokeStyle = sel ? chaosCol : `rgba(${chaosFill}, 0.8)`;
    ctxMap.lineWidth = sel ? 2 : 1;
    ctxMap.setLineDash([4, 4]);
    ctxMap.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctxMap.setLineDash([]);
    drawLabel(
      ctxMap,
      "💀 " + (c.label || "Chaos"),
      (tl.x + br.x) / 2,
      (tl.y + br.y) / 2,
      chaosCol,
    );
  });

  // ── Redraw obstacle handles on UI layer whenever the map layer redraws ─
  // (handles live on ctxUi; a drawMapLayer call clears ctxMap but leaves
  //  ctxUi intact — however explicit redraw here keeps them in sync after
  //  any pan / zoom that triggers drawAll → drawMapLayer)
  if (STATE.selectedId) {
    const selObs = MAP.obstacles.find((ob) => ob.id === STATE.selectedId)
               || MAP.barricades.find((ob) => ob.id === STATE.selectedId);
    if (selObs) {
      // Don't clear entire UI layer here (it may have in-progress drawings);
      // editor.js selectElement and updateObstacleHandleDrag do their own
      // ctxUi.clearRect + drawObstacleHandles. This call is the safety net
      // for pan/zoom redraws where no other code refreshes the handles.
      drawObstacleHandles(selObs);
    }
  }
}

function drawArrow(ctx, x, y, dx, dy, len, color) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + dx * len, y + dy * len);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + dx * len, y + dy * len);
  ctx.lineTo(x + dx * len - dy * 4 - dx * 5, y + dy * len + dx * 4 - dy * 5);
  ctx.lineTo(x + dx * len + dy * 4 - dx * 5, y + dy * len - dx * 4 - dy * 5);
  ctx.fill();
}

function drawLabel(ctx, text, x, y, color) {
  if (!text || wScale(1) < 0.4) return;
  ctx.font = `500 ${Math.max(10, wScale(1.2))}px DM Mono, monospace`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

function drawUILayer() {
  const w = canvasUi.width,
    h = canvasUi.height;
  ctxUi.clearRect(0, 0, w, h);

  // In-progress rect drawing is handled on mousemove — nothing static here

  // In-progress boundary
  if (STATE.tool === "boundary" && STATE.boundaryPoints.length > 0) {
    ctxUi.beginPath();
    const p0 = w2s(STATE.boundaryPoints[0].x, STATE.boundaryPoints[0].y);
    ctxUi.moveTo(p0.x, p0.y);
    STATE.boundaryPoints.forEach((pt, i) => {
      if (i > 0) {
        const p = w2s(pt.x, pt.y);
        ctxUi.lineTo(p.x, p.y);
      }
    });
    ctxUi.strokeStyle = "#f97316";
    ctxUi.lineWidth = 1.5;
    ctxUi.setLineDash([5, 4]);
    ctxUi.stroke();
    ctxUi.setLineDash([]);
    STATE.boundaryPoints.forEach((pt) => {
      const p = w2s(pt.x, pt.y);
      ctxUi.fillStyle = "#f97316";
      ctxUi.beginPath();
      ctxUi.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctxUi.fill();
    });
  }

  // Re-stamp obstacle handles on top after clearing the UI layer
  if (STATE.selectedId) {
    const selObs = MAP.obstacles.find((ob) => ob.id === STATE.selectedId)
               || MAP.barricades.find((ob) => ob.id === STATE.selectedId);
    if (selObs) drawObstacleHandles(selObs);
  }
}
