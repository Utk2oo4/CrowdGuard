/* ================================================================
   MODULE: CANVAS INTERACTION
   ================================================================ */
let isPanning = false,
  panStart = { x: 0, y: 0 },
  panOrigin = { x: 0, y: 0 };

canvasUi.addEventListener("mousedown", onMouseDown);
canvasUi.addEventListener("mousemove", onMouseMove);
canvasUi.addEventListener("mouseup", onMouseUp);
canvasUi.addEventListener("dblclick", onDblClick);
canvasUi.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  cancelCurrentAction();
});

function getEventPos(e) {
  const rect = canvasUi.getBoundingClientRect();
  return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
}

function onMouseDown(e) {
  const { sx, sy } = getEventPos(e);
  const w = s2w(sx, sy);

  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    isPanning = true;
    panStart = { x: sx, y: sy };
    panOrigin = { x: STATE.panX, y: STATE.panY };
    canvasUi.style.cursor = "grabbing";
    return;
  }

  if (STATE.mode === "edit") {
    handleEditMouseDown(e, sx, sy, w);
  }
}

function handleEditMouseDown(e, sx, sy, w) {
  if (STATE.tool === "select") {
    // ── 1. Check obstacle/barricade handles FIRST (only when one is selected) ──
    const handle = hitTestObstacleHandles(w.x, w.y);
    if (handle) {
      const o = MAP.obstacles.find((ob) => ob.id === STATE.selectedId)
             || MAP.barricades.find((ob) => ob.id === STATE.selectedId);
      if (o) {
        beginObstacleHandleDrag(handle, o, w.x, w.y);
        canvasUi.style.cursor = getCursorForHandle(handle.key);
        return;
      }
    }

    // ── 2. Normal element hit-test ────────────────────────────────────────
    const hit = hitTest(w.x, w.y);
    if (hit) {
      selectElement(hit.id);
      // For obstacles the drag origin is the center (x,y IS center now)
      STATE.dragging = {
        type: hit.type,
        id: hit.id,
        ox: w.x - hit.x,
        oy: w.y - hit.y,
        elem: hit,
      };
    } else {
      selectElement(null);
    }
  } else if (STATE.tool === "entry") {
    placeEntry(w.x, w.y);
  } else if (STATE.tool === "exit") {
    placeExit(w.x, w.y);
  } else if (
    STATE.tool === "zone" ||
    STATE.tool === "obstacle" ||
    STATE.tool === "chaos" ||
    STATE.tool === "barricade"
  ) {
    STATE.drawStart = { x: w.x, y: w.y };
  } else if (STATE.tool === "boundary") {
    if (STATE.boundaryPoints.length > 0) {
      const last = STATE.boundaryPoints[STATE.boundaryPoints.length - 1];
      if (checkBoundaryIntersect(last, w)) {
        showEditorAlert("Cannot draw boundary across existing objects");
        return;
      }
    }
    STATE.boundaryPoints.push({ x: w.x, y: w.y });
    drawUILayer();
  } else if (STATE.tool === "delete") {
    const hit = hitTest(w.x, w.y);
    if (hit) deleteElement(hit.id);
  }
}

function onMouseMove(e) {
  const { sx, sy } = getEventPos(e);
  const w = s2w(sx, sy);

  // Coordinate display
  document.getElementById("coord-info").textContent =
    `x:${w.x.toFixed(1)}m  y:${w.y.toFixed(1)}m`;

  // ── PANNING ────────────────────────────────────────────────────────────
  if (isPanning) {
    STATE.panX = panOrigin.x - (sx - panStart.x) / STATE.zoom;
    STATE.panY = panOrigin.y - (sy - panStart.y) / STATE.zoom;
    drawAll();
    return;
  }

  // ── OBSTACLE HANDLE DRAG ──────────────────────────────────────────────
  if (STATE.obHandle) {
    updateObstacleHandleDrag(w.x, w.y, e.shiftKey);
    return;
  }

  // ── ELEMENT DRAG (move) ───────────────────────────────────────────────
  if (STATE.dragging && STATE.mode === "edit") {
    const d = STATE.dragging;
    const elem = findElem(d.id);
    if (elem) {
      const newX = w.x - d.ox;
      const newY = w.y - d.oy;
      
      // Create a candidate clone with the new position to test overlap
      const candidate = { ...elem, x: newX, y: newY };
      if (!checkOverlap(d.type, candidate, d.id)) {
        // Only apply if no overlap
        elem.x = newX;
        elem.y = newY;
        
        // Redraw based on type
        if (d.type === "obstacle" || d.type === "barricade") {
          ctxUi.clearRect(0, 0, canvasUi.width, canvasUi.height);
          drawMapLayer();
          drawObstacleHandles(elem);
        } else {
          drawMapLayer();
        }
        updateElemList();
      }
    }
    return;
  }

  // ── LIVE RECT PREVIEW (while drawing zone/obstacle/chaos) ────────────
  if (STATE.drawStart && STATE.mode === "edit") {
    ctxUi.clearRect(0, 0, canvasUi.width, canvasUi.height);
    const p0 = w2s(STATE.drawStart.x, STATE.drawStart.y);
    const p1 = w2s(w.x, w.y);
    const rootStyle = getComputedStyle(document.documentElement);
    const col =
      STATE.tool === "zone"
        ? "#a855f7"
        : STATE.tool === "obstacle"
          ? "#ef4444"
          : STATE.tool === "barricade"
            ? "#f59e0b"
            : rootStyle.getPropertyValue('--chaos-col').trim() || "#ffffff";
    const fillCol = col + (STATE.tool === "chaos" ? "40" : STATE.tool === "barricade" ? "30" : "22");
    ctxUi.fillStyle = fillCol;
    ctxUi.strokeStyle = col;
    ctxUi.lineWidth = 1.5;
    ctxUi.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
    ctxUi.strokeRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
    // Size label
    const ww = Math.abs(w.x - STATE.drawStart.x).toFixed(1);
    const wh = Math.abs(w.y - STATE.drawStart.y).toFixed(1);
    ctxUi.fillStyle = col;
    ctxUi.font = "11px DM Mono, monospace";
    ctxUi.textAlign = "center";
    ctxUi.fillText(`${ww}m × ${wh}m`, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
    return;
  }

  // ── BOUNDARY PREVIEW LINE ─────────────────────────────────────────────
  if (STATE.tool === "boundary" && STATE.boundaryPoints.length > 0) {
    drawUILayer();
    const last = STATE.boundaryPoints[STATE.boundaryPoints.length - 1];
    const lp = w2s(last.x, last.y);
    const isBlocked = checkBoundaryIntersect(last, w);
    ctxUi.strokeStyle = isBlocked ? "rgba(239,68,68,0.8)" : "rgba(249,115,22,0.5)";
    ctxUi.lineWidth = isBlocked ? 2 : 1;
    ctxUi.setLineDash([4, 3]);
    ctxUi.beginPath();
    ctxUi.moveTo(lp.x, lp.y);
    ctxUi.lineTo(sx, sy);
    ctxUi.stroke();
    ctxUi.setLineDash([]);
    return;
  }

  // ── CURSOR FEEDBACK (hover over handles when an obstacle is selected) ─
  if (STATE.tool === "select" && STATE.mode === "edit") {
    const handle = hitTestObstacleHandles(w.x, w.y);
    if (handle) {
      canvasUi.style.cursor = getCursorForHandle(handle.key);
    } else {
      // If hovering any element, show pointer; otherwise crosshair
      const hit = hitTest(w.x, w.y);
      canvasUi.style.cursor = hit ? "pointer" : "crosshair";
    }
  }
}

function onMouseUp(e) {
  if (isPanning) {
    isPanning = false;
    canvasUi.style.cursor = "crosshair";
    return;
  }

  const { sx, sy } = getEventPos(e);
  const w = s2w(sx, sy);

  // ── End obstacle handle drag ──────────────────────────────────────────
  if (STATE.obHandle) {
    endObstacleHandleDrag();
    canvasUi.style.cursor = "crosshair";
    return;
  }

  // ── End element drag ──────────────────────────────────────────────────
  if (STATE.dragging) {
    STATE.dragging = null;
    // Redraw handles if an obstacle/barricade was being moved
    const o = MAP.obstacles.find((ob) => ob.id === STATE.selectedId)
           || MAP.barricades.find((ob) => ob.id === STATE.selectedId);
    if (o) {
      ctxUi.clearRect(0, 0, canvasUi.width, canvasUi.height);
      drawObstacleHandles(o);
    }
  }

  // ── Finish rect draw (zone / obstacle / chaos) ────────────────────────
  if (STATE.drawStart && STATE.mode === "edit") {
    const x0 = Math.min(STATE.drawStart.x, w.x);
    const y0 = Math.min(STATE.drawStart.y, w.y);
    const ww = Math.abs(w.x - STATE.drawStart.x);
    const hh = Math.abs(w.y - STATE.drawStart.y);
    if (ww > 1 && hh > 1) {
      if (STATE.tool === "zone") placeZone(x0, y0, ww, hh);
      if (STATE.tool === "obstacle") placeObstacle(x0, y0, ww, hh);
      if (STATE.tool === "chaos") placeChaos(x0, y0, ww, hh);
      if (STATE.tool === "barricade") placeBarricade(x0, y0, ww, hh);
    }
    STATE.drawStart = null;
    ctxUi.clearRect(0, 0, canvasUi.width, canvasUi.height);
    drawAll();
  }
}

function onDblClick(e) {
  if (STATE.tool === "boundary" && STATE.boundaryPoints.length >= 3) {
    MAP.boundary = [...STATE.boundaryPoints];
    STATE.boundaryPoints = [];
    drawAll();
  }
}

/* ================================================================
   MODULE: ZOOM & PAN CONTROLS
   ================================================================ */
function zoomIn() {
  const factor = 1.25;
  const wrap = document.getElementById("canvas-wrap");
  const cx = wrap.clientWidth / 2;
  const cy = wrap.clientHeight / 2;
  const before = s2w(cx, cy);
  STATE.zoom = Math.max(0.2, Math.min(10, STATE.zoom * factor));
  const after = s2w(cx, cy);
  STATE.panX += before.x - after.x;
  STATE.panY += before.y - after.y;
  document.getElementById("zoom-info").textContent =
    Math.round(STATE.zoom * 100) + "%";
  if (typeof computeAgentDrawRadius === "function") computeAgentDrawRadius();
  drawAll();
  // Redraw obstacle handles at new zoom scale
  const o = MAP.obstacles.find((ob) => ob.id === STATE.selectedId)
         || MAP.barricades.find((ob) => ob.id === STATE.selectedId);
  if (o) {
    ctxUi.clearRect(0, 0, canvasUi.width, canvasUi.height);
    drawObstacleHandles(o);
  }
}

function zoomOut() {
  const factor = 0.8;
  const wrap = document.getElementById("canvas-wrap");
  const cx = wrap.clientWidth / 2;
  const cy = wrap.clientHeight / 2;
  const before = s2w(cx, cy);
  STATE.zoom = Math.max(0.2, Math.min(10, STATE.zoom * factor));
  const after = s2w(cx, cy);
  STATE.panX += before.x - after.x;
  STATE.panY += before.y - after.y;
  document.getElementById("zoom-info").textContent =
    Math.round(STATE.zoom * 100) + "%";
  if (typeof computeAgentDrawRadius === "function") computeAgentDrawRadius();
  drawAll();
  // Redraw obstacle handles at new zoom scale
  const o = MAP.obstacles.find((ob) => ob.id === STATE.selectedId)
         || MAP.barricades.find((ob) => ob.id === STATE.selectedId);
  if (o) {
    ctxUi.clearRect(0, 0, canvasUi.width, canvasUi.height);
    drawObstacleHandles(o);
  }
}

function updatePanX(value) {
  STATE.panX = parseFloat(value);
  drawAll();
}

function updatePanY(value) {
  STATE.panY = parseFloat(value);
  drawAll();
}

function cancelCurrentAction() {
  if (STATE.tool === "boundary") {
    STATE.boundaryPoints = [];
    drawUILayer();
  }
  STATE.drawStart = null;
  STATE.obHandle = null;
  ctxUi.clearRect(0, 0, canvasUi.width, canvasUi.height);
  // Restore handles if obstacle/barricade still selected
  const o = MAP.obstacles.find((ob) => ob.id === STATE.selectedId)
         || MAP.barricades.find((ob) => ob.id === STATE.selectedId);
  if (o) drawObstacleHandles(o);
}
