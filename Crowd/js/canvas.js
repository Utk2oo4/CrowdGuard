/* ================================================================
   MODULE: CANVAS SETUP
   ================================================================ */
const canvasBg     = document.getElementById('canvas-bg');
const canvasMap    = document.getElementById('canvas-map');
const canvasAgents = document.getElementById('canvas-agents');
const canvasUi     = document.getElementById('canvas-ui');
const wrap         = document.getElementById('canvas-wrap');
const ctxBg        = canvasBg.getContext('2d');
const ctxMap       = canvasMap.getContext('2d');
const ctxAgents    = canvasAgents.getContext('2d');
const ctxUi        = canvasUi.getContext('2d');

function resizeCanvases() {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  [canvasBg, canvasMap, canvasAgents, canvasUi].forEach(c => {
    c.width = w; c.height = h;
  });
  drawAll();
}

// World ↔ screen transform
function w2s(wx, wy) {
  return {
    x: (wx - STATE.panX) * STATE.zoom + wrap.clientWidth / 2,
    y: (wy - STATE.panY) * STATE.zoom + wrap.clientHeight / 2
  };
}
function s2w(sx, sy) {
  return {
    x: (sx - wrap.clientWidth / 2) / STATE.zoom + STATE.panX,
    y: (sy - wrap.clientHeight / 2) / STATE.zoom + STATE.panY
  };
}
function wScale(v) { return v * STATE.zoom; }
