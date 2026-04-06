/* ================================================================
   MODULE: EXPORT
   ================================================================ */
function exportData() {
  if (STATE.mode === "edit") saveMapToJSON();
  else exportJSON();
}

function exportJSON() {
  let alive = 0;
  for (let i = 0; i < agentCount; i++) if (aalive[i]) alive++;
  // Build a plain-text summary report for the AI Chatbot
  let summaryReport = `CROWDGUARD SIMULATION SUMMARY REPORT\n`;
  summaryReport += `===================================\n`;
  summaryReport += `Venue: ${MAP.name || "Custom Layout"} (${WORLD.w}m x ${WORLD.h}m)\n`;
  summaryReport += `Total Spawned: ${totalSpawned}\n`;
  summaryReport += `Total Evacuated: ${evacuatedCount}\n`;
  summaryReport += `Evacuation Rate: ${totalSpawned > 0 ? ((evacuatedCount / totalSpawned) * 100).toFixed(1) + "%" : "0%"}\n`;
  summaryReport += `Agents Remaining Inside: ${alive}\n`;
  summaryReport += `Total Elapsed Time: ${simElapsed.toFixed(1)} seconds\n`;
  summaryReport += `Peak Density Reached: ${Math.max(...densityGrid).toFixed(2)} people/m²\n\n`;

  const tl = typeof simTimeline !== 'undefined' ? simTimeline : [];
  const warningsList = tl.filter(e => e.type === "warning");
  if (warningsList.length > 0) {
    summaryReport += `CONGESTION BOTTLENECKS REPORTED:\n`;
    // Deduplicate warnings by location text
    const uniqueWarnings = new Set();
    warningsList.forEach(w => uniqueWarnings.add(w.text));
    uniqueWarnings.forEach(w => summaryReport += `- ${w}\n`);
  } else {
    summaryReport += `No major congestion bottlenecks reported during the simulation.\n`;
  }
  summaryReport += `\nEnd of Report.`;

  const data = {
    summaryReport: summaryReport,
    metadata: {
      exportTime: new Date().toISOString(),
      simulatorVersion: "2.0",
      phase: STATE.phase,
      elapsedSeconds: simElapsed.toFixed(1),
      totalSpawned,
      agentsAlive: alive,
      evacuated: evacuatedCount,
      evacuationRate:
        totalSpawned > 0
          ? ((evacuatedCount / totalSpawned) * 100).toFixed(1) + "%"
          : "0%",
    },
    map: {
      entries: MAP.entries,
      exits: MAP.exits,
      zones: MAP.zones,
      obstacles: MAP.obstacles,
      boundary: MAP.boundary,
      worldSize: WORLD,
    },
    densityAnalysis: {
      peakDensity: Math.max(...densityGrid).toFixed(2),
      dangerCells: Array.from(densityGrid).filter((v) => v > 5).length,
      crowdedCells: Array.from(densityGrid).filter((v) => v >= 2 && v < 5)
        .length,
      thresholds: {
        safe: "<2 ppl/m²",
        crowded: "2–5 ppl/m²",
        danger: ">5 ppl/m²",
      },
    },
    activeWarnings: warnings,
    timeSeriesStats: statsHistory,
    eventTimeline: tl,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `crowdguard-report-${Date.now()}.json`;
  a.click();
}

function exportCSV() {
  const rows = [
    [
      "time_s",
      "agents_alive",
      "total_spawned",
      "evacuated",
      "evac_rate_pct",
      "peak_density_pm2",
      "phase",
    ],
  ];
  for (const s of statsHistory) {
    const rate =
      s.total_spawned > 0
        ? ((s.evacuated / s.total_spawned) * 100).toFixed(1)
        : "0";
    rows.push([
      s.time,
      s.agents_alive,
      s.total_spawned,
      s.evacuated,
      rate,
      s.peak_density,
      s.phase,
    ]);
  }
  const csv = rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `crowdguard-stats-${Date.now()}.csv`;
  a.click();
}
