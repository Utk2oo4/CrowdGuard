function showSnapshotModal() {
  if (typeof window.generateDeferredSnapshots === 'function') {
    window.generateDeferredSnapshots();
  }
  document.getElementById('snapshot-modal-overlay').style.display = 'flex';
  
  const heatImg = document.getElementById('snap-img-heat');
  const velImg = document.getElementById('snap-img-vel');
  const trailImg = document.getElementById('snap-img-trail');
  const dangerImg = document.getElementById('snap-img-danger');

  if (window.snapshots.heat) heatImg.src = window.snapshotCanvases.heat.toDataURL("image/png");
  if (window.snapshots.vel) velImg.src = window.snapshotCanvases.vel.toDataURL("image/png");
  if (window.snapshots.trail) trailImg.src = window.snapshotCanvases.trail.toDataURL("image/png");
  if (window.snapshots.danger) dangerImg.src = window.snapshotCanvases.danger.toDataURL("image/png");
}

function closeSnapshotModal() {
  document.getElementById('snapshot-modal-overlay').style.display = 'none';
}

function downloadSnapshot(layer) {
  const dataStr = window.snapshotCanvases[layer].toDataURL("image/png");
  if (!dataStr) {
    alert("This layer wasn't captured. Make sure its capture checkbox is checked before starting evacuation.");
    return;
  }
  const a = document.createElement("a");
  a.href = dataStr;
  a.download = `crowdguard-snapshot-${layer}-${Date.now()}.png`;
  a.click();
}
