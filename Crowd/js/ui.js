/* ================================================================
   MODULE: MODE SWITCHING
   ================================================================ */
function setMode(mode) {
  STATE.mode = mode;
  document.getElementById('tab-edit').classList.toggle('active', mode === 'edit');
  document.getElementById('tab-sim').classList.toggle('active', mode === 'sim');
  document.getElementById('sb-edit').style.display = mode === 'edit' ? '' : 'none';
  document.getElementById('sb-sim').style.display  = mode === 'sim'  ? '' : 'none';
  // Phase buttons only active in sim mode
  ['btn-start','btn-end','btn-evac','btn-chaos','btn-end-evac'].forEach(id => {
    document.getElementById(id).disabled = mode !== 'sim';
  });
  if (mode === 'sim') {
    initSim();
    renderEntrySpawnList();
    startSimLoop();
  } else {
    stopSimLoop();
    drawAll();
  }
}

function setTool(tool) {
  STATE.tool = tool;
  STATE.drawStart = null;
  STATE.boundaryPoints = [];
  
  // Auto-deselect when switching to a creation/action tool
  if (tool !== 'select') {
    selectElement(null);
  }

  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('tool-' + tool);
  if (btn) btn.classList.add('active');
  // Cursor
  const cursors = { select:'default', delete:'not-allowed', boundary:'crosshair', entry:'cell', exit:'cell', zone:'crosshair', obstacle:'crosshair', barricade:'crosshair', chaos:'crosshair' };
  canvasUi.style.cursor = cursors[tool] || 'crosshair';
  drawAll();
}
