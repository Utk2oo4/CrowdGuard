/* ================================================================
   MODULE: SIMULATION TIMELINE
   ================================================================
   Records timestamped events during the simulation:
   - Phase transitions (entry, buildup, evac, chaos)
   - Warnings (first danger zone, exit overloads)
   - Milestones (first agent spawned, evacuation complete)
   - Simulation end
   ================================================================ */

const simTimeline = [];
let _timelineEvacComplete = false;
let _timelineFirstDanger = false;

// ── Event types & icons ──────────────────────────────────────────
const TL_ICONS = {
  phase:      '🔄',
  spawn:      '🟢',
  warning:    '⚠️',
  danger:     '🔴',
  evac:       '🏁',
  info:       'ℹ️',
  barricade:  '🧱',
};

const TL_COLORS = {
  phase:      'var(--accent)',
  spawn:      'var(--green)',
  warning:    'var(--yellow)',
  danger:     'var(--red)',
  evac:       '#22c55e',
  info:       'var(--dim)',
  barricade:  '#f59e0b',
};

/**
 * Add an event to the simulation timeline.
 * @param {string} type — one of: phase, spawn, warning, danger, evac, info
 * @param {string} message — human-readable description
 * @param {object} [meta] — optional extra data (agents, density, etc.)
 */
function logTimeline(type, message, meta) {
  const wallClock = new Date().toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const entry = {
    simTime:   simElapsed.toFixed(1),
    wallClock: wallClock,
    type:      type,
    message:   message,
    phase:     STATE.phase,
    agents:    (() => { let c = 0; for (let i = 0; i < agentCount; i++) if (aalive[i]) c++; return c; })(),
    evacuated: evacuatedCount,
    totalSpawned: totalSpawned,
  };
  if (meta) entry.meta = meta;
  simTimeline.push(entry);
  renderTimeline();
}

/**
 * Clear all timeline entries (called on sim reset).
 */
function resetTimeline() {
  simTimeline.length = 0;
  _timelineEvacComplete = false;
  _timelineFirstDanger = false;
  renderTimeline();
}

/**
 * Render the timeline list into the sidebar panel.
 */
function renderTimeline() {
  const el = document.getElementById('timeline-list');
  if (!el) return;

  // Update count badge
  const countEl = document.getElementById('timeline-count');
  if (countEl) countEl.textContent = `(${simTimeline.length})`;

  if (simTimeline.length === 0) {
    el.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:0.58rem;color:var(--dim);font-style:italic;padding:4px 0">No events yet. Start the simulation.</div>';
    return;
  }

  // Show most recent first, cap at 50 for performance
  const entries = simTimeline.slice(-50).reverse();
  el.innerHTML = entries.map((ev, idx) => {
    const icon = TL_ICONS[ev.type] || 'ℹ️';
    const col  = TL_COLORS[ev.type] || 'var(--dim)';
    const isLatest = idx === 0;

    return `<div style="
      display:flex;gap:6px;align-items:flex-start;
      padding:5px 6px;border-radius:3px;
      background:${isLatest ? 'rgba(59,130,246,0.08)' : 'transparent'};
      border-left:2px solid ${col};
      margin-bottom:2px;
      ${isLatest ? 'animation:timelineFadeIn 0.3s ease' : ''}
    ">
      <div style="flex-shrink:0;font-size:0.65rem;line-height:1">${icon}</div>
      <div style="flex:1;min-width:0">
        <div style="font-family:'DM Mono',monospace;font-size:0.58rem;color:var(--text);line-height:1.4;word-break:break-word">${ev.message}</div>
        <div style="display:flex;gap:8px;margin-top:2px">
          <span style="font-family:'DM Mono',monospace;font-size:0.5rem;color:var(--dim)" title="Simulation time">⏱ ${ev.simTime}s</span>
          <span style="font-family:'DM Mono',monospace;font-size:0.5rem;color:var(--dim)" title="Wall clock time">🕐 ${ev.wallClock}</span>
          <span style="font-family:'DM Mono',monospace;font-size:0.5rem;color:var(--dim)" title="Agents alive">👥 ${ev.agents}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

/**
 * Check if evacuation is complete (all spawned agents evacuated).
 * Called from simStep() periodically.
 */
function checkEvacComplete() {
  if (_timelineEvacComplete) return;
  if (STATE.phase !== 'evac' && STATE.phase !== 'chaos') return;
  if (totalSpawned === 0) return;

  let alive = 0;
  for (let i = 0; i < agentCount; i++) if (aalive[i]) alive++;

  if (alive === 0 && evacuatedCount > 0) {
    _timelineEvacComplete = true;
    logTimeline('evac', `Evacuation complete — all ${evacuatedCount} agents evacuated`);
    
    // Capture final snapshot for movement trails
    if (typeof captureFinalSnapshots === 'function') {
      captureFinalSnapshots();
    }
    
    // Enable Snapshot UI
    const viewBtn = document.getElementById('btn-view-snapshots');
    if (viewBtn) {
      viewBtn.style.display = 'block';
      viewBtn.style.animation = 'timelineFadeIn 0.5s ease';
    }

    // ── Build timeline text & show chatbot redirect popup ─────────
    _showEvacCompletePopup();
  }
}

/**
 * Build a plain-text summary of the full simulation timeline,
 * store it in localStorage, then show a redirect popup.
 */
function _showEvacCompletePopup() {
  // ── 1. Format timeline ───────────────────────────────────────
  const lines = ['=== CROWDGUARD SIMULATION — EVENT TIMELINE ===', ''];
  simTimeline.forEach((ev, i) => {
    const icon = TL_ICONS[ev.type] || 'ℹ️';
    lines.push(`[${String(i + 1).padStart(3, '0')}] ${icon} [${ev.wallClock}] [T+${ev.simTime}s]`);
    lines.push(`        Phase: ${ev.phase.toUpperCase()} | Agents alive: ${ev.agents} | Evacuated: ${ev.evacuated} / ${ev.totalSpawned}`);
    lines.push(`        ${ev.message}`);
    lines.push('');
  });
  lines.push('=== END OF TIMELINE ===');
  const timelineText = lines.join('\n');

  // ── 2. Persist in localStorage so chatbot.html can pick it up ─
  localStorage.setItem('cg-pending-timeline', timelineText);

  // ── 3. Build popup overlay ────────────────────────────────────
  const old = document.getElementById('_evac-popup-overlay');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = '_evac-popup-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:9999;
    display:flex;align-items:center;justify-content:center;
    background:rgba(0,0,0,0.65);backdrop-filter:blur(6px);
    animation:timelineFadeIn 0.3s ease;
  `;

  overlay.innerHTML = `
    <div style="
      background:var(--surface2,#1e2130);
      border:1px solid rgba(59,130,246,0.4);
      border-radius:12px;
      padding:32px 36px;
      max-width:440px;width:90%;
      box-shadow:0 8px 40px rgba(0,0,0,0.6);
      text-align:center;
      font-family:'Syne',sans-serif;
    ">
      <div style="font-size:2.5rem;margin-bottom:12px">🏁</div>
      <div style="font-size:1.15rem;font-weight:800;color:var(--text,#e2e8f0);margin-bottom:8px">
        Evacuation Complete!
      </div>
      <div style="font-size:0.78rem;color:var(--dim,#64748b);font-family:'DM Mono',monospace;margin-bottom:22px;line-height:1.6">
        All agents have evacuated.<br>
        The full event timeline has been captured.<br>
        Would you like to analyse it with the AI Chatbot?
      </div>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
        <button id="_evac-popup-go" style="
          padding:10px 22px;border-radius:8px;
          background:var(--accent,#3b82f6);color:#fff;
          font-family:'Syne',sans-serif;font-weight:700;font-size:0.85rem;
          border:none;cursor:pointer;
          box-shadow:0 2px 12px rgba(59,130,246,0.35);
        ">🤖 Analyse in AI Chatbot</button>
        <button id="_evac-popup-stay" style="
          padding:10px 22px;border-radius:8px;
          background:transparent;color:var(--dim,#64748b);
          font-family:'Syne',sans-serif;font-weight:600;font-size:0.85rem;
          border:1px solid var(--border,#2d3748);cursor:pointer;
        ">Stay Here</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  document.getElementById('_evac-popup-go').addEventListener('click', () => {
    overlay.remove();
    // Ensure deferred snapshots are generated first
    if (typeof window.generateDeferredSnapshots === 'function') {
      window.generateDeferredSnapshots();
    }
    // Save snapshot DataURLs so chatbot page can embed them in the PDF
    if (window.snapshotCanvases) {
      const snaps = {};
      ['heat', 'vel', 'trail', 'danger'].forEach(k => {
        try {
          if (window.snapshotCanvases[k]) {
            snaps[k] = window.snapshotCanvases[k].toDataURL('image/png');
          }
        } catch (e) { /* skip if canvas tainted */ }
      });
      try {
        localStorage.setItem('cg-pending-snapshots', JSON.stringify(snaps));
      } catch (e) { /* quota exceeded — skip */ }
    }
    window.location.href = 'chatbot.html';
  });

  document.getElementById('_evac-popup-stay').addEventListener('click', () => {
    overlay.remove();
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}
