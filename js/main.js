/* ================================================================
   MODULE: BOOT / INIT
   ================================================================
   All logic has been split into dedicated modules:
     flowfield.js  — BFS flow field pathfinding
     simulation.js — agent arrays, sim loop, phase management, spawning
     physics.js    — simStep(), spatial grid, geometry, density, stats
     simrender.js  — agent rendering, heatmap, danger overlay
     floorplan.js  — floorplan image + map save/load/defaults
     export.js     — JSON & CSV export
   This file only handles initial setup and window resize.
   ================================================================ */

// Snapshot configuration
window.CAPTURE_HEAT = true;
window.CAPTURE_VEL = true;
window.CAPTURE_TRAIL = true;
window.CAPTURE_DANGER = true;
window.snapshots = { heat: "", vel: "", trail: "", danger: "" };

window.addEventListener("resize", () => {
  resizeCanvases();
});
resizeCanvases();

STATE.panX = WORLD.w / 2;
STATE.panY = WORLD.h / 2;
STATE.zoom =
  Math.min(wrap.clientWidth / WORLD.w, wrap.clientHeight / WORLD.h) * 0.85;
document.getElementById("zoom-info").textContent =
  Math.round(STATE.zoom * 100) + "%";

loadDefaultMap();
computeAgentDrawRadius();
initSim();
setTool("select");
