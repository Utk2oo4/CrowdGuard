/* ================================================================
   MODULE: FLOORPLAN & MAP I/O + MAP PRESETS
   ================================================================ */
function loadFloorplan(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      STATE.floorplanImg = img;
      drawBackground();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  input.value = "";
}

function clearFloorplan() {
  STATE.floorplanImg = null;
  drawBackground();
}

/* ================================================================
   SAVE / LOAD MAP
   ================================================================ */
function saveMapToJSON() {
  const data = JSON.stringify({ MAP, WORLD, version: 2 }, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "crowdguard-map.json";
  a.click();
}

function loadMapFromFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (data.WORLD) {
        WORLD.w = data.WORLD.w || 200;
        WORLD.h = data.WORLD.h || 150;
      }
      Object.assign(MAP, data.MAP);
      markFlowFieldDirty();
      updateElemList();
      drawAll();
    } catch (e) {
      alert("Invalid map file");
    }
  };
  reader.readAsText(file);
  input.value = "";
}

/* ================================================================
   APPLY MAP DATA — shared helper used by all presets
   Accepts { world, entries, exits, zones, obstacles, boundary, chaos }
   ================================================================ */
function applyMapData(preset) {
  if (preset.world) {
    WORLD.w = preset.world.w;
    WORLD.h = preset.world.h;
    DGW = Math.ceil(WORLD.w / DCELL);
    DGH = Math.ceil(WORLD.h / DCELL);
    densityGrid = new Float32Array(DGW * DGH);
    SGW = Math.ceil(WORLD.w / SCELL);
    SGH = Math.ceil(WORLD.h / SCELL);
  }
  MAP.entries   = (preset.entries   || []).map(e => ({ ...e, id: newId() }));
  MAP.exits     = (preset.exits     || []).map(e => ({ ...e, id: newId() }));
  MAP.zones     = (preset.zones     || []).map(e => ({ ...e, id: newId() }));
  MAP.obstacles = (preset.obstacles || []).map(e => ({ ...e, id: newId() }));
  MAP.boundary  = preset.boundary  || [];
  MAP.chaos     = (preset.chaos     || []).map(e => ({ ...e, id: newId() }));
  MAP.barricades = (preset.barricades || []).map(e => ({ ...e, id: newId() }));
  elemIdCounter += 50;
  markFlowFieldDirty();
  updateElemList();
  STATE.panX = WORLD.w / 2;
  STATE.panY = WORLD.h / 2;
  STATE.zoom =
    Math.min(wrap.clientWidth / WORLD.w, wrap.clientHeight / WORLD.h) * 0.9;
  if (typeof initSim === "function") initSim();
  drawAll();
}

/* ================================================================
   MAP PRESETS
   Each preset defines a complete venue with proper boundaries,
   obstacles, zones, exits, and entries.
   ================================================================ */
const MAP_PRESETS = {

  /* ── 1. OUTDOOR FESTIVAL (original, fixed) ──────────────────── */
  "outdoor-festival": {
    name: "🎪 Outdoor Festival",
    desc: "Open-air festival with stage, food court, and rest area (200×150m)",
    world: { w: 200, h: 150 },
    entries: [
      { x: 10,  y: 75, spawnRate: 80,  convertToExit: true, label: "North Gate" },
      { x: 100, y: 5,  spawnRate: 60,  convertToExit: true, label: "West Gate" },
      { x: 190, y: 75, spawnRate: 100, convertToExit: true, label: "East Gate" },
    ],
    exits: [
      { x: 10,  y: 40,  capacity: 120, width: 3, label: "Exit A" },
      { x: 10,  y: 110, capacity: 90,  width: 2, label: "Exit B" },
      { x: 190, y: 40,  capacity: 150, width: 4, label: "Exit C" },
      { x: 100, y: 145, capacity: 80,  width: 2, label: "Exit D" },
    ],
    zones: [
      { x: 60,  y: 35, w: 80, h: 50, type: "stage", attraction: 0.7, label: "Main Stage" },
      { x: 10,  y: 90, w: 35, h: 40, type: "food",  attraction: 0.2, label: "Food Court" },
      { x: 155, y: 90, w: 35, h: 40, type: "rest",  attraction: 0.1, label: "Rest Area" },
    ],
    obstacles: [
      { x: 47.5,  y: 75,  w: 5, h: 90, angle: 0, label: "Barrier L" },
      { x: 152.5, y: 75,  w: 5, h: 90, angle: 0, label: "Barrier R" },
      { x: 100,   y: 22,  w: 30, h: 5, angle: 0, label: "Stage Wall" },
    ],
    boundary: [
      { x: 5, y: 5 }, { x: 195, y: 5 }, { x: 195, y: 145 }, { x: 5, y: 145 },
    ],
  },

  /* ── 2. INDOOR STADIUM ─────────────────────────────────────── */
  "indoor-stadium": {
    name: "🏟️ Indoor Stadium",
    desc: "Rectangular arena with tiered seating zones and 6 exits (250×180m)",
    world: { w: 250, h: 180 },
    entries: [
      { x: 5,   y: 90,  spawnRate: 100, convertToExit: true, label: "West Entrance" },
      { x: 245, y: 90,  spawnRate: 100, convertToExit: true, label: "East Entrance" },
      { x: 125, y: 5,   spawnRate: 80,  convertToExit: true, label: "North Entrance" },
      { x: 125, y: 175, spawnRate: 80,  convertToExit: true, label: "South Entrance" },
    ],
    exits: [
      { x: 5,   y: 45,  capacity: 150, width: 4, label: "Exit NW" },
      { x: 5,   y: 135, capacity: 150, width: 4, label: "Exit SW" },
      { x: 245, y: 45,  capacity: 150, width: 4, label: "Exit NE" },
      { x: 245, y: 135, capacity: 150, width: 4, label: "Exit SE" },
      { x: 80,  y: 5,   capacity: 100, width: 3, label: "Exit N1" },
      { x: 170, y: 5,   capacity: 100, width: 3, label: "Exit N2" },
    ],
    zones: [
      { x: 80,  y: 55, w: 90, h: 70, type: "stage", attraction: 0.6, label: "Center Court" },
      { x: 20,  y: 30, w: 50, h: 50, type: "gen",   attraction: 0.3, label: "West Stand" },
      { x: 180, y: 30, w: 50, h: 50, type: "gen",   attraction: 0.3, label: "East Stand" },
      { x: 20,  y: 100, w: 50, h: 50, type: "gen",  attraction: 0.3, label: "West Lower" },
      { x: 180, y: 100, w: 50, h: 50, type: "gen",  attraction: 0.3, label: "East Lower" },
      { x: 90,  y: 140, w: 70, h: 30, type: "food", attraction: 0.15, label: "Concession Area" },
    ],
    obstacles: [
      { x: 75,  y: 90, w: 4, h: 80, angle: 0, label: "West Railing" },
      { x: 175, y: 90, w: 4, h: 80, angle: 0, label: "East Railing" },
      { x: 125, y: 50, w: 100, h: 4, angle: 0, label: "North Barrier" },
      { x: 125, y: 130, w: 100, h: 4, angle: 0, label: "South Barrier" },
      { x: 40,  y: 85, w: 20, h: 3, angle: 0.3, label: "West Stair Wall" },
      { x: 210, y: 85, w: 20, h: 3, angle: -0.3, label: "East Stair Wall" },
    ],
    boundary: [
      { x: 3, y: 3 }, { x: 247, y: 3 }, { x: 247, y: 177 }, { x: 3, y: 177 },
    ],
  },

  /* ── 3. CONFERENCE CENTER ─────────────────────────────────── */
  "conference-center": {
    name: "🏢 Conference Center",
    desc: "Multi-room conference with lobby, halls, and breakout rooms (220×160m)",
    world: { w: 220, h: 160 },
    entries: [
      { x: 110, y: 5,   spawnRate: 90,  convertToExit: true, label: "Main Entrance" },
      { x: 5,   y: 80,  spawnRate: 40,  convertToExit: true, label: "Side Entrance" },
    ],
    exits: [
      { x: 110, y: 5,   capacity: 200, width: 5, label: "Main Exit" },
      { x: 5,   y: 80,  capacity: 120, width: 3, label: "Side Exit" },
      { x: 215, y: 80,  capacity: 120, width: 3, label: "Emergency Exit E" },
      { x: 110, y: 155, capacity: 120, width: 3, label: "Rear Exit" },
      { x: 5,   y: 40,  capacity: 100, width: 3, label: "NW Emergency" },
      { x: 215, y: 40,  capacity: 100, width: 3, label: "NE Emergency" },
    ],
    zones: [
      { x: 30,  y: 15,  w: 70, h: 30, type: "gen",   attraction: 0.15, label: "Entrance Lobby" },
      { x: 120, y: 15,  w: 70, h: 30, type: "gen",   attraction: 0.15, label: "Registration Desk" },
      { x: 20,  y: 65,  w: 80, h: 45, type: "stage", attraction: 0.5,  label: "Main Hall A" },
      { x: 120, y: 65,  w: 80, h: 45, type: "stage", attraction: 0.4,  label: "Main Hall B" },
      { x: 20,  y: 120, w: 55, h: 30, type: "gen",   attraction: 0.2,  label: "Breakout Room 1" },
      { x: 85,  y: 120, w: 55, h: 30, type: "gen",   attraction: 0.2,  label: "Breakout Room 2" },
      { x: 150, y: 120, w: 55, h: 30, type: "food",  attraction: 0.15, label: "Catering Hall" },
    ],
    obstacles: [
      // Lobby Back Wall — TWO segments with 15m doorway gaps (not one solid wall!)
      { x: 50,  y: 50,  w: 60, h: 3,  angle: 0, label: "Lobby Wall West" },
      { x: 170, y: 50,  w: 60, h: 3,  angle: 0, label: "Lobby Wall East" },
      // Hall divider — moved down, shorter, with gap for cross-hall flow
      { x: 110, y: 72,  w: 4,  h: 20, angle: 0, label: "Hall Divider" },
      // Corridor Wall — short segments with doorway gaps
      { x: 45,  y: 115, w: 35, h: 3,  angle: 0, label: "Corridor Wall W" },
      { x: 175, y: 115, w: 35, h: 3,  angle: 0, label: "Corridor Wall E" },
      // Room divider walls
      { x: 75,  y: 130, w: 3,  h: 20, angle: 0, label: "Room 1 Wall" },
      { x: 140, y: 130, w: 3,  h: 20, angle: 0, label: "Room 2 Wall" },
    ],
    boundary: [
      { x: 3, y: 3 }, { x: 217, y: 3 }, { x: 217, y: 157 }, { x: 3, y: 157 },
    ],
  },

  /* ── 4. SHOPPING MALL ─────────────────────────────────────── */
  "shopping-mall": {
    name: "🛍️ Shopping Mall",
    desc: "Three-wing mall with central atrium and multiple stores (240×180m)",
    world: { w: 240, h: 180 },
    entries: [
      { x: 120, y: 5,   spawnRate: 100, convertToExit: true, label: "North Entrance" },
      { x: 120, y: 175, spawnRate: 80,  convertToExit: true, label: "South Entrance" },
      { x: 5,   y: 90,  spawnRate: 60,  convertToExit: true, label: "West Entrance" },
      { x: 235, y: 90,  spawnRate: 60,  convertToExit: true, label: "East Entrance" },
    ],
    exits: [
      { x: 120, y: 5,   capacity: 180, width: 5, label: "North Exit" },
      { x: 120, y: 175, capacity: 150, width: 4, label: "South Exit" },
      { x: 5,   y: 90,  capacity: 120, width: 3, label: "West Exit" },
      { x: 235, y: 90,  capacity: 120, width: 3, label: "East Exit" },
      { x: 60,  y: 5,   capacity: 80,  width: 2, label: "Emergency NW" },
      { x: 180, y: 175, capacity: 80,  width: 2, label: "Emergency SE" },
    ],
    zones: [
      { x: 85,  y: 60,  w: 70, h: 60, type: "gen",  attraction: 0.3,  label: "Central Atrium" },
      { x: 15,  y: 15,  w: 55, h: 55, type: "gen",  attraction: 0.25, label: "West Wing Shops" },
      { x: 170, y: 15,  w: 55, h: 55, type: "gen",  attraction: 0.25, label: "East Wing Shops" },
      { x: 15,  y: 110, w: 55, h: 55, type: "gen",  attraction: 0.2,  label: "SW Department Store" },
      { x: 170, y: 110, w: 55, h: 55, type: "gen",  attraction: 0.2,  label: "SE Department Store" },
      { x: 85,  y: 130, w: 70, h: 35, type: "food", attraction: 0.2,  label: "Food Court" },
      { x: 85,  y: 15,  w: 70, h: 35, type: "rest", attraction: 0.1,  label: "Lounge Area" },
    ],
    obstacles: [
      { x: 80,  y: 45,  w: 4,  h: 70, angle: 0, label: "West Corridor Wall" },
      { x: 160, y: 45,  w: 4,  h: 70, angle: 0, label: "East Corridor Wall" },
      { x: 80,  y: 135, w: 4,  h: 70, angle: 0, label: "SW Corridor Wall" },
      { x: 160, y: 135, w: 4,  h: 70, angle: 0, label: "SE Corridor Wall" },
      { x: 120, y: 58,  w: 50, h: 3,  angle: 0, label: "Atrium North Rail" },
      { x: 120, y: 122, w: 50, h: 3,  angle: 0, label: "Atrium South Rail" },
      { x: 45,  y: 90,  w: 30, h: 3,  angle: 0, label: "West Wing Separator" },
      { x: 195, y: 90,  w: 30, h: 3,  angle: 0, label: "East Wing Separator" },
    ],
    boundary: [
      { x: 3, y: 3 }, { x: 237, y: 3 }, { x: 237, y: 177 }, { x: 3, y: 177 },
    ],
  },

  /* ── 5. CITY PARK EVENT ───────────────────────────────────── */
  "park-event": {
    name: "🌳 Park Event",
    desc: "Open park with amphitheater, pond, and picnic areas (260×200m)",
    world: { w: 260, h: 200 },
    entries: [
      { x: 5,   y: 100, spawnRate: 70, convertToExit: true, label: "West Path Gate" },
      { x: 130, y: 5,   spawnRate: 90, convertToExit: true, label: "North Gate" },
      { x: 255, y: 100, spawnRate: 70, convertToExit: true, label: "East Path Gate" },
      { x: 130, y: 195, spawnRate: 50, convertToExit: true, label: "South Gate" },
    ],
    exits: [
      { x: 5,   y: 50,  capacity: 100, width: 3, label: "Exit W1" },
      { x: 5,   y: 150, capacity: 100, width: 3, label: "Exit W2" },
      { x: 255, y: 50,  capacity: 100, width: 3, label: "Exit E1" },
      { x: 255, y: 150, capacity: 100, width: 3, label: "Exit E2" },
      { x: 70,  y: 5,   capacity: 80,  width: 2, label: "Exit N1" },
      { x: 190, y: 5,   capacity: 80,  width: 2, label: "Exit N2" },
    ],
    zones: [
      { x: 80,  y: 50,  w: 100, h: 60, type: "stage", attraction: 0.5, label: "Amphitheater" },
      { x: 15,  y: 20,  w: 50,  h: 40, type: "food",  attraction: 0.2, label: "Food Stalls" },
      { x: 195, y: 20,  w: 50,  h: 40, type: "food",  attraction: 0.2, label: "Drink Stands" },
      { x: 20,  y: 130, w: 60,  h: 50, type: "rest",  attraction: 0.15, label: "Picnic Area West" },
      { x: 180, y: 130, w: 60,  h: 50, type: "rest",  attraction: 0.15, label: "Picnic Area East" },
      { x: 100, y: 130, w: 60,  h: 50, type: "gen",   attraction: 0.1,  label: "Open Lawn" },
    ],
    obstacles: [
      { x: 130, y: 120, w: 30, h: 20, angle: 0,   label: "Pond" },
      { x: 75,  y: 80,  w: 4,  h: 60, angle: 0,   label: "West Path Fence" },
      { x: 185, y: 80,  w: 4,  h: 60, angle: 0,   label: "East Path Fence" },
      { x: 130, y: 45,  w: 110, h: 4, angle: 0,   label: "Stage Front Barrier" },
      { x: 50,  y: 100, w: 20,  h: 3, angle: 0.4, label: "Hedge Row W" },
      { x: 210, y: 100, w: 20,  h: 3, angle: -0.4, label: "Hedge Row E" },
    ],
    boundary: [
      { x: 3, y: 3 }, { x: 257, y: 3 }, { x: 257, y: 197 }, { x: 3, y: 197 },
    ],
  },

  /* ── 6. PRAYAGRAJ SANGAM ──────────────────────────────────── */
  "prayagraj-sangam": {
    name: "📿 Prayagraj Sangam",
    desc: "Sangam nose, main stage area with riverfront (240×200m)",
    world: { w: 240, h: 200 },
    entries: [
      { x: 42.65966754155731, y: 116.2729658792651, spawnRate: 60, convertToExit: true, label: "Entry 1" },
      { x: 226.3867016622922, y: 102.6246719160105, spawnRate: 60, convertToExit: true, label: "Entry 2" },
      { x: 163.7445319335083, y: 185.2143482064742, spawnRate: 60, convertToExit: true, label: "Entry 3" }
    ],
    exits: [
      { x: 118.60017497812774, y: 186.2642169728784, capacity: 120, width: 2, label: "Exit 1" },
      { x: 227.7865266841645, y: 68.67891513560804, capacity: 120, width: 2, label: "Exit 2" }
    ],
    obstacles: [],
    zones: [
      { x: 39.86001749781275, y: 33.33333333333334, w: 50.04374453193351, h: 43.74453193350831, type: "general", attraction: 0.7, label: "Sangam Nose" },
      { x: 7.664041994750647, y: 9.186351706036746, w: 32.89588801399826, h: 23.797025371828525, type: "stage", attraction: 2.7, label: "Amrit Snan Ghat" },
      { x: 40.909886264217, y: 8.836395450568673, w: 184.07699037620299, h: 21.69728783902012, type: "stage", attraction: 1.7, label: "Yamuna" },
      { x: 8.363954505686792, y: 33.6832895888014, w: 29.396325459317595, h: 150.4811898512686, type: "stage", attraction: 1.7, label: "Ganga" },
      { x: 142.7471566054243, y: 116.97287839020125, w: 72.44094488188978, h: 43.04461942257218, type: "general", attraction: 0.7, label: "Magh Mela Area Settlement" },
      { x: 90.95363079615049, y: 31.93350831146106, w: 17.847769028871397, h: 39.895013123359576, type: "general", attraction: 0.7, label: "Magh Mela Area" },
      { x: 126.64916885389327, y: 52.93088363954506, w: 29.046369203849522, h: 15.39807524059492, type: "general", attraction: 0.7, label: "Triveni Ghat" },
      { x: 57.70778652668416, y: 127.12160979877513, w: 25.54680664916885, h: 52.14348206474193, type: "general", attraction: 0.7, label: "Sangam Ghat Prayagraj" }
    ],
    barricades: [
      { x: 39.47887421042838, y: 145.69183683788904, w: 1, h: 83.94403774206926, angle: -0.004712862918277327, durability: 20, maxDurability: 20, broken: false, label: "Barricade 1" },
      { x: 198.21522309711287, y: 31.083552055993017, w: 59.84251968503946, h: 1, angle: 0, durability: 20, maxDurability: 20, broken: false, label: "Barricade 2" }
    ],
    chaos: [],
    boundary: [
      { x: 7.314085739282589, y: 8.486439195100616 },
      { x: 228.48643919510062, y: 8.486439195100616 },
      { x: 229.88626421697288, y: 188.71391076115486 },
      { x: 8.363954505686792, y: 188.3639545056868 },
      { x: 7.314085739282589, y: 9.536307961504804 }
    ],
  },
};

/* ================================================================
   LOAD MAP PRESET — called from UI dropdown
   ================================================================ */
function loadMapPreset(presetKey) {
  const preset = MAP_PRESETS[presetKey];
  if (!preset) return;
  applyMapData(preset);
}

/* Backward compat — "Load Demo Map" calls the outdoor-festival preset */
function loadDefaultMap() {
  loadMapPreset("outdoor-festival");
}
