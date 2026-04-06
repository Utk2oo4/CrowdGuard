/* ================================================================
   MODULE: STATE
   ================================================================ */
const STATE = {
  mode: 'edit',          // 'edit' | 'sim'
  tool: 'select',        // current edit tool
  phase: 'idle',         // idle | entry | buildup | evac
  running: false,
  zoom: 1,
  panX: 0,
  panY: 0,
  dragging: null,        // {elem, ox, oy}
  drawStart: null,       // for rect drawing
  boundaryPoints: [],    // temp boundary polygon points
  selectedId: null,
  floorplanImg: null,
  floorplanOpacity: 0.35,
};