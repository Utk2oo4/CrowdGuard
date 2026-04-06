// MAP DATA
const MAP = {
  entries:   [],  // {id, x, y, spawnRate, label}
  exits:     [],  // {id, x, y, capacity, width, label}
  obstacles: [],  // {id, x, y, w, h, label}
  zones:     [],  // {id, x, y, w, h, type, attraction, label}
  chaos:     [],  // {id, x, y, radius, intensity, label}
  barricades: [], // {id, x, y, w, h, angle, durability, maxDurability, broken, label}
  boundary:  [],  // [{x,y}] polygon points
};

// World dimensions (in metres — 1 unit = 1m)
let WORLD = { w: 200, h: 150 };

let elemIdCounter = 1;
function newId() { return 'e' + (elemIdCounter++); }
