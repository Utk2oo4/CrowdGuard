/* ================================================================
   venue.js — Venue Setup Modal
   ================================================================
   This file is the bridge between the map tool (app.js / Leaflet)
   and the crowd simulator (map.js, state.js, etc.)

   It is self-contained — it does NOT modify app.js or any other
   existing simulator file. It only:
     1. Renders a modal with a Leaflet map inside
     2. Lets the user search a venue, draw a boundary, place gates
     3. On import, converts geo-coordinates → simulator world units
        and writes into the existing MAP object (from map.js)

   Public API (called from index.html):
     openVenueModal()   — open the modal
     closeVenueModal()  — close it
     importVenueToSim() — triggered by the Import button
   ================================================================ */

/* ----------------------------------------------------------------
   VENUE STATE
   ---------------------------------------------------------------- */
let venueMap        = null;   // Leaflet map instance (inside modal)
let venueBoundary   = null;   // The drawn boundary polygon layer
let venueDrawItems  = null;   // Leaflet FeatureGroup for drawn shapes
let venueDrawCtrl   = null;   // Leaflet.Draw control
let venueGates      = [];     // [{ type:'entry'|'exit', lat, lng, label, marker }]
let venueGateMode   = null;   // 'entry' | 'exit' | null — click-to-place mode
let venueLayoutUrl  = null;   // Data URL of uploaded layout image (optional)
let venueActiveTab  = 'map';  // 'map' | 'upload'

/* ----------------------------------------------------------------
   MODAL OPEN / CLOSE
   ---------------------------------------------------------------- */
function openVenueModal() {
  document.getElementById('venue-modal-overlay').style.display = 'flex';

  // Leaflet needs the container to be visible before init
  if (!venueMap) {
    // Small delay to let CSS display:flex paint first
    setTimeout(initVenueMap, 80);
  } else {
    venueMap.invalidateSize();
  }
}

function closeVenueModal() {
  document.getElementById('venue-modal-overlay').style.display = 'none';
  venueGateMode = null;
  _venueSetActiveTool(null);
}

/* ----------------------------------------------------------------
   LEAFLET MAP INIT
   ---------------------------------------------------------------- */
function initVenueMap() {
  const container = document.getElementById('venue-map');
  if (!container) return;

  venueMap = L.map('venue-map', {
    center: [28.6139, 77.2090], // Default: New Delhi
    zoom: 14,
    maxZoom: 19,
  });

  // Satellite layer (Esri)
  const satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles © Esri', maxZoom: 19 }
  );

  // Street layer (OSM)
  const street = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenStreetMap contributors', maxZoom: 22 }
  );

  satellite.addTo(venueMap);
  L.control.layers({ 'Satellite': satellite, 'Street Map': street }).addTo(venueMap);

  // Drawn items layer
  venueDrawItems = new L.FeatureGroup().addTo(venueMap);

  // Draw control (polygon + rectangle only)
  venueDrawCtrl = new L.Control.Draw({
    draw: {
      polygon: {
        allowIntersection: false,
        showArea: true,
        shapeOptions: { color: '#f97316', weight: 2, fillOpacity: 0.15 },
      },
      rectangle: {
        shapeOptions: { color: '#f97316', weight: 2, fillOpacity: 0.15 },
      },
      polyline:     false,
      circle:       false,
      circlemarker: false,
      marker:       false,
    },
    edit: { featureGroup: venueDrawItems, remove: true },
  });
  venueMap.addControl(venueDrawCtrl);

  // Events
  venueMap.on(L.Draw.Event.CREATED, _onVenueBoundaryDrawn);
  venueMap.on('click', _onVenueMapClick);

  // Enter key on search
  document.getElementById('venue-search-input')
    .addEventListener('keydown', e => { 
      if (e.key === 'Enter') {
        venueSearch(); 
        _venueHideSuggestions();
      } 
    });

  // Suggestions on input
  let searchTimeout = null;
  document.getElementById('venue-search-input')
    .addEventListener('input', e => {
      const q = e.target.value.trim();
      clearTimeout(searchTimeout);
      if (q.length < 3) {
        _venueHideSuggestions();
        return;
      }
      searchTimeout = setTimeout(() => _venueFetchSuggestions(q), 400);
    });

  // Hide suggestions when clicking outside
  document.addEventListener('click', e => {
    if (!e.target.closest('.vm-search-row') && !e.target.closest('.vm-suggestions')) {
      _venueHideSuggestions();
    }
  });
}

/* ----------------------------------------------------------------
   CURRENT LOCATION
   ---------------------------------------------------------------- */
function venueUseCurrentLocation() {
  const result = document.getElementById('venue-search-result');
  if (!navigator.geolocation) {
    _showVenueStatus('Geolocation is not supported by your browser.', 'error');
    return;
  }

  result.textContent = 'Locating…';
  result.style.color = 'var(--dim)';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      venueMap.flyTo([lat, lng], 17, { duration: 1.5 });
      result.textContent = `✓ Current Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
      result.style.color = 'var(--green)';
    },
    (err) => {
      let msg = 'Location access denied.';
      if (err.code === 2) msg = 'Location unavailable.';
      if (err.code === 3) msg = 'Location request timed out.';
      _showVenueStatus(msg, 'error');
      result.textContent = msg;
      result.style.color = 'var(--red)';
    },
    { enableHighAccuracy: true, timeout: 5000 }
  );
}

/* ----------------------------------------------------------------
   SEARCH SUGGESTIONS
   ---------------------------------------------------------------- */
async function _venueFetchSuggestions(q) {
  const sugCont = document.getElementById('venue-search-suggestions');
  try {
    const res  = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5`);
    const data = await res.json();

    if (data.length > 0) {
      sugCont.innerHTML = data.map(item => `
        <div class="vm-suggestion-item" onclick="venueSelectSuggestion('${item.lat}', '${item.lon}', '${item.display_name.replace(/'/g, "\\'")}')">
          ${item.display_name}
        </div>
      `).join('');
      sugCont.style.display = 'block';
    } else {
      _venueHideSuggestions();
    }
  } catch {
    _venueHideSuggestions();
  }
}

function venueSelectSuggestion(lat, lon, displayName) {
  document.getElementById('venue-search-input').value = displayName;
  venueMap.flyTo([parseFloat(lat), parseFloat(lon)], 16, { duration: 1.5 });
  
  const result = document.getElementById('venue-search-result');
  result.textContent = '✓ ' + displayName.split(',').slice(0, 2).join(', ');
  result.style.color = 'var(--green)';
  
  _venueHideSuggestions();
}

function _venueHideSuggestions() {
  const sugCont = document.getElementById('venue-search-suggestions');
  if (sugCont) sugCont.style.display = 'none';
}

/* ----------------------------------------------------------------
   BOUNDARY DRAWING
   ---------------------------------------------------------------- */
function _onVenueBoundaryDrawn(e) {
  // Replace any previous boundary
  if (venueBoundary) venueDrawItems.removeLayer(venueBoundary);
  venueBoundary = e.layer;
  venueDrawItems.addLayer(venueBoundary);

  // Calculate area + bounding box for display
  const geo    = venueBoundary.toGeoJSON();
  const area   = turf.area(geo);
  const bounds = venueBoundary.getBounds();
  const latM   = (bounds.getNorth() - bounds.getSouth()) * 111320;
  const cosLat = Math.cos(bounds.getCenter().lat * Math.PI / 180);
  const lngM   = (bounds.getEast() - bounds.getWest()) * 111320 * cosLat;

  document.getElementById('venue-area-val').textContent  = area.toFixed(0) + ' m²';
  document.getElementById('venue-bbox-val').textContent  = `${latM.toFixed(0)}m × ${lngM.toFixed(0)}m`;
  document.getElementById('venue-area-row').style.display = 'block';

  _venueSetActiveTool(null);
  _venueUpdateImportBtn();
  _showVenueStatus('Boundary drawn ✓ — now place entry and exit gates, then click Import.', 'success');
}

/* ----------------------------------------------------------------
   GATE PLACEMENT
   ---------------------------------------------------------------- */
function venueAddGateMode(type) {
  venueGateMode = type;
  _venueSetActiveTool('vmtool-' + type);
  _showVenueStatus(`Click anywhere on the map to place an ${type} gate.`, 'info');
}

function _onVenueMapClick(e) {
  if (!venueGateMode) return;

  const type  = venueGateMode;
  const n     = venueGates.filter(g => g.type === type).length + 1;
  const label = (type === 'entry' ? 'Entry ' : 'Exit ') + n;

  // Build a simple coloured div icon
  const color = type === 'entry' ? '#22c55e' : '#3b82f6';
  const glyph = type === 'entry' ? '▶' : '■';
  const icon  = L.divIcon({
    html: `<div style="
      width:22px;height:22px;border-radius:50%;
      background:${color};border:2px solid #fff;
      display:flex;align-items:center;justify-content:center;
      font-size:9px;color:#fff;font-weight:700;
      box-shadow:0 2px 8px rgba(0,0,0,0.5);
    ">${glyph}</div>`,
    iconSize:   [22, 22],
    iconAnchor: [11, 11],
    className:  '',
  });

  const marker = L.marker(e.latlng, { icon }).addTo(venueMap);

  // Popup with delete link
  const idx = venueGates.length;
  marker.bindPopup(
    `<b style="font-family:monospace">${label}</b>
     <br><small style="color:#666">${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}</small>
     <br><a href="#" onclick="venueDeleteGate(${idx});return false"
        style="color:#ef4444;font-size:11px">Delete</a>`
  );

  venueGates.push({ type, lat: e.latlng.lat, lng: e.latlng.lng, label, marker });
  _renderVenueGateList();
  _venueUpdateImportBtn();
}

function venueDeleteGate(idx) {
  const g = venueGates[idx];
  if (!g) return;
  venueMap.removeLayer(g.marker);
  venueGates.splice(idx, 1);
  // Re-index remaining gates' popup delete links
  venueGates.forEach((gate, i) => {
    gate.marker.setPopupContent(
      `<b style="font-family:monospace">${gate.label}</b>
       <br><small style="color:#666">${gate.lat.toFixed(5)}, ${gate.lng.toFixed(5)}</small>
       <br><a href="#" onclick="venueDeleteGate(${i});return false"
          style="color:#ef4444;font-size:11px">Delete</a>`
    );
  });
  _renderVenueGateList();
  _venueUpdateImportBtn();
}

function _renderVenueGateList() {
  const list  = document.getElementById('venue-gate-list');
  const count = venueGates.length;
  document.getElementById('venue-gate-count').textContent = `(${count})`;

  if (count === 0) {
    list.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:0.6rem;color:var(--dim);font-style:italic">No gates placed yet.</div>';
    return;
  }

  list.innerHTML = venueGates.map((g, i) => `
    <div style="display:flex;align-items:center;gap:6px;padding:4px 6px;
                background:var(--surface);border:1px solid var(--border);
                border-radius:3px;font-family:'DM Mono',monospace;font-size:0.6rem;">
      <div style="width:8px;height:8px;border-radius:50%;flex-shrink:0;
                  background:${g.type === 'entry' ? 'var(--green)' : 'var(--accent)'}"></div>
      <span style="flex:1;color:var(--text)">${g.label}</span>
      <span onclick="venueDeleteGate(${i})" style="color:var(--dim);cursor:pointer"
            onmouseover="this.style.color='var(--red)'" onmouseout="this.style.color='var(--dim)'">✕</span>
    </div>`).join('');
}

/* ----------------------------------------------------------------
   SEARCH
   ---------------------------------------------------------------- */
async function venueSearch() {
  const q      = document.getElementById('venue-search-input').value.trim();
  const result = document.getElementById('venue-search-result');
  if (!q) return;

  _venueHideSuggestions();

  result.textContent = 'Searching…';
  result.style.color = 'var(--dim)';

  try {
    const res  = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`);
    const data = await res.json();

    if (data.length > 0) {
      const { lat, lon, display_name } = data[0];
      venueMap.flyTo([parseFloat(lat), parseFloat(lon)], 16, { duration: 1.5 });
      result.textContent = '✓ ' + display_name.split(',').slice(0, 2).join(', ');
      result.style.color = 'var(--green)';
    } else {
      result.textContent = 'Not found.';
      result.style.color = 'var(--red)';
    }
  } catch {
    result.textContent = 'Search failed — check connection.';
    result.style.color = 'var(--red)';
  }
}

/* ----------------------------------------------------------------
   ACTIVATE BOUNDARY DRAW TOOL
   ---------------------------------------------------------------- */
function venueActivateBoundary() {
  venueGateMode = null;
  _venueSetActiveTool('vmtool-boundary');
  // Trigger Leaflet's polygon draw handler
  new L.Draw.Polygon(venueMap, venueDrawCtrl.options.draw.polygon).enable();
}

/* ----------------------------------------------------------------
   CLEAR ALL
   ---------------------------------------------------------------- */
function venueClearAll() {
  if (!confirm('Clear all venue drawings?')) return;
  venueDrawItems.clearLayers();
  venueGates.forEach(g => venueMap.removeLayer(g.marker));
  venueGates      = [];
  venueBoundary   = null;
  venueGateMode   = null;
  venueLayoutUrl  = null;

  document.getElementById('venue-area-row').style.display = 'none';
  document.getElementById('venue-gate-count').textContent = '(0)';
  document.getElementById('venue-gate-list').innerHTML =
    '<div style="font-family:\'DM Mono\',monospace;font-size:0.6rem;color:var(--dim);font-style:italic">No gates placed yet.</div>';

  _venueSetActiveTool(null);
  _venueUpdateImportBtn();
  _showVenueStatus('Canvas cleared.', 'info');
}

/* ----------------------------------------------------------------
   TAB SWITCH (Map Search ↔ Upload Layout)
   ---------------------------------------------------------------- */
function venueSwitchTab(tab) {
  venueActiveTab = tab;

  document.getElementById('vtab-map').classList.toggle('active',    tab === 'map');
  document.getElementById('vtab-upload').classList.toggle('active', tab === 'upload');
  document.getElementById('venue-map-panel').style.display    = tab === 'map'    ? '' : 'none';
  document.getElementById('venue-upload-panel').style.display = tab === 'upload' ? 'flex' : 'none';

  _venueUpdateImportBtn();
}

/* ----------------------------------------------------------------
   LAYOUT UPLOAD
   ---------------------------------------------------------------- */
function venueHandleUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    venueLayoutUrl = e.target.result;

    // Show preview
    const preview = document.getElementById('venue-upload-preview');
    document.getElementById('venue-preview-img').src = venueLayoutUrl;
    preview.style.display = 'block';

    _venueUpdateImportBtn();
    _showVenueStatus('Layout image loaded ✓ — click Import to use it as a floorplan overlay.', 'success');
  };
  reader.readAsDataURL(file);
}

/* ----------------------------------------------------------------
   CORE INTEGRATION: importVenueToSim()

   This is the only place venue.js touches the simulator's data.
   It writes into MAP (from map.js) and STATE (from state.js),
   which are already global by the time this runs.
   ---------------------------------------------------------------- */
function importVenueToSim() {

  // ── UPLOAD-ONLY PATH ─────────────────────────────────────────
  // User just uploaded a layout image — load it as floorplan overlay
  // and let them draw their own boundary + gates in the editor.
  if (venueActiveTab === 'upload') {
    if (!venueLayoutUrl) {
      _showVenueStatus('Please upload a layout image first.', 'error');
      return;
    }
    _loadLayoutAsFloorplan(venueLayoutUrl);
    closeVenueModal();
    _showImportBadge('Layout loaded as floorplan overlay');
    return;
  }

  // ── MAP PATH ─────────────────────────────────────────────────
  if (!venueBoundary) {
    _showVenueStatus('Please draw a venue boundary polygon first.', 'error');
    return;
  }

  // 1. Get the bounding box of the drawn polygon
  const bounds  = venueBoundary.getBounds();
  const sw      = bounds.getSouthWest();
  const ne      = bounds.getNorthEast();

  // 2. Work out real-world size in metres
  const cosLat  = Math.cos(((ne.lat + sw.lat) / 2) * Math.PI / 180);
  const realW   = (ne.lng - sw.lng) * 111320 * cosLat;  // metres east-west
  const realH   = (ne.lat - sw.lat) * 111320;            // metres north-south

  // 3. Resize simulator world to fit the real-world venue with 5m padding
  const padding = 5;
  const newW = Math.ceil(realW + padding * 2);
  const newH = Math.ceil(realH + padding * 2);
  
  if (typeof resizeWorld === 'function') {
    resizeWorld(newW, newH);
  } else {
    WORLD.w = newW;
    WORLD.h = newH;
  }

  // 4. Geo → world coordinate transform
  //    sw corner maps to (padding, newH - padding) — y is flipped (north = top)
  function geoToWorld(lat, lng) {
    return {
      x: (lng - sw.lng) * 111320 * cosLat + padding,
      y: (ne.lat - lat) * 111320 + padding,
    };
  }

  // 5. Clear existing simulator map data
  MAP.entries   = [];
  MAP.exits     = [];
  MAP.zones     = [];
  MAP.obstacles = [];
  MAP.chaos     = [];

  // 6. Import boundary polygon
  const geo    = venueBoundary.toGeoJSON();
  const coords = geo.geometry.coordinates[0]; // outer ring, [lng, lat] pairs
  MAP.boundary = coords.slice(0, -1).map(([lng, lat]) => geoToWorld(lat, lng));

  // 7. Import gates placed in the venue modal
  venueGates.forEach(g => {
    const pos = geoToWorld(g.lat, g.lng);
    if (g.type === 'entry') {
      MAP.entries.push({
        id: newId(),
        x: pos.x,
        y: pos.y,
        spawnRate: 60,
        convertToExit: true,
        label: g.label,
      });
    } else {
      MAP.exits.push({
        id:       newId(),
        x:        pos.x,
        y:        pos.y,
        capacity: 120,
        width:    2,
        label:    g.label,
      });
    }
  });

  // 8. If a layout image was also uploaded, use it as the floorplan overlay
  if (venueLayoutUrl) {
    _loadLayoutAsFloorplan(venueLayoutUrl);
  }

  // 9. Re-centre the simulator view is already handled by resizeWorld
  
  // 10. Refresh simulator UI
  updateElemList();
  drawAll();

  closeVenueModal();
  _showImportBadge(`Venue imported — ${MAP.entries.length} entries, ${MAP.exits.length} exits`);
}

/* ----------------------------------------------------------------
   HELPERS
   ---------------------------------------------------------------- */

// Load a data-URL image as the simulator's floorplan overlay
function _loadLayoutAsFloorplan(dataUrl) {
  const img   = new Image();
  img.onload  = () => {
    STATE.floorplanImg     = img;
    STATE.floorplanOpacity = 0.4;
    drawBackground();
  };
  img.src = dataUrl;
}

// Enable/disable the Import button based on current state
function _venueUpdateImportBtn() {
  const btn = document.getElementById('venue-import-btn');
  if (venueActiveTab === 'upload') {
    btn.disabled = !venueLayoutUrl;
  } else {
    // For map tab: require at least a boundary
    btn.disabled = !venueBoundary;
  }
}

// Highlight active tool button
function _venueSetActiveTool(activeId) {
  ['vmtool-boundary', 'vmtool-entry', 'vmtool-exit'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', el.id === activeId);
  });
}

// Status message inside the modal footer
function _showVenueStatus(msg, type) {
  const el = document.getElementById('venue-status');
  if (!el) return;
  const colors = { success: 'var(--green)', error: 'var(--red)', info: 'var(--dim)' };
  el.textContent = msg;
  el.style.color = colors[type] || 'var(--dim)';
}

// Brief success toast in the main toolbar after import
function _showImportBadge(msg) {
  const badge = document.getElementById('venue-import-badge');
  if (!badge) return;
  badge.textContent = '✓ ' + msg;
  badge.style.display = 'inline-block';
  setTimeout(() => { badge.style.display = 'none'; }, 4000);
}
