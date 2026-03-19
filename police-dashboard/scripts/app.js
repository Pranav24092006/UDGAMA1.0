// ==========================================================================
// Police Dashboard - Application Logic
// With LocalStorage Sync Listener + Dispatch
// ==========================================================================

// Shared traffic data received from ambulance
let receivedTrafficCoords = [];

document.addEventListener('DOMContentLoaded', () => {

  // =============================================
  // 1. Loading Screen Sequence
  // =============================================
  const loadingScreen = document.getElementById('loading-screen');
  const dashboardPage = document.getElementById('dashboard-page');

  setTimeout(() => {
    loadingScreen.classList.remove('active');
    setTimeout(() => {
      loadingScreen.style.display = 'none';
      dashboardPage.classList.add('active');
      PoliceMapManager.initMap();
    }, 600);
  }, 2500);

  // =============================================
  // 2. Camera Widget Time Sync
  // =============================================
  const camTimeEl = document.getElementById('cam-time');
  setInterval(() => {
    const now = new Date();
    camTimeEl.innerText = now.toTimeString().split(' ')[0];
  }, 1000);

  // =============================================
  // 3. Existing Tactical Controls
  // =============================================
  const btnClear = document.getElementById('btn-clear-route');
  const btnBlock = document.getElementById('btn-block');
  const btnAlert = document.getElementById('btn-alert');

  btnClear.addEventListener('click', async () => {
    showTacticalToast('<i class="fa-solid fa-road-circle-check"></i> ROUTE CLEARED AHEAD OF AMBULANCE', 'success');
    if (PoliceMapManager.ambMarker) {
      PoliceMapManager.triggerRipple(PoliceMapManager.ambMarker.getLatLng(), '#28c840', 1000);
    }
    if (window.currentAmbulanceId) {
      await fetch(`${window.location.origin}/manual-clear`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ambulanceId: window.currentAmbulanceId })
      });
    }
  });

  btnBlock.addEventListener('click', async () => {
    showTacticalToast('<i class="fa-solid fa-ban"></i> NEXT INTERSECTION BLOCKED FOR CIVILIAN TRAFFIC', 'danger');
    if (PoliceMapManager.ambMarker) {
      const pos = PoliceMapManager.ambMarker.getLatLng();
      PoliceMapManager.triggerRipple([pos.lat + 0.002, pos.lng + 0.002], '#ef4444', 800);
    }
    if (window.currentAmbulanceId) {
      await fetch(`${window.location.origin}/block-intersection`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ambulanceId: window.currentAmbulanceId })
      });
    }
  });

  btnAlert.addEventListener('click', async () => {
    showTacticalToast('<i class="fa-solid fa-bullhorn"></i> NEARBY PATROL UNITS ALERTED TO ASSIST', 'info');
    if (PoliceMapManager.ambMarker) {
      PoliceMapManager.triggerRipple(PoliceMapManager.ambMarker.getLatLng(), '#0ea5e9', 1500);
    }
    if (window.currentAmbulanceId) {
      await fetch(`${window.location.origin}/alert-units`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ambulanceId: window.currentAmbulanceId })
      });
    }
  });

  // =============================================
  // 4. DISPATCH TEAM Button (visible after alert)
  // =============================================
  const btnDispatch = document.getElementById('btn-dispatch');
  const policeSyncStatus = document.getElementById('police-sync-status');

  btnDispatch.addEventListener('click', async () => {
    // Visual feedback
    btnDispatch.disabled = true;
    btnDispatch.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> DISPATCHING...';
    btnDispatch.style.opacity = '0.6';

    showTacticalToast('<i class="fa-solid fa-car-burst"></i> POLICE UNITS DISPATCHED TO CONGESTED ZONE', 'danger');

    // Animate police units on the map
    PoliceMapManager.animateDispatch(receivedTrafficCoords);

    // Update police status
    policeSyncStatus.innerHTML = '<span style="color:#ffc107;">⏳ Clearing in progress...</span>';
    policeSyncStatus.style.display = 'block';

    if (window.currentAmbulanceId) {
      await fetch(`${window.location.origin}/dispatch-police`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ambulanceId: window.currentAmbulanceId })
      });
    }

    // Police Dashboard will clear after a few seconds and tell backend to clear route
    setTimeout(async () => {
      if (window.currentAmbulanceId) {
        await fetch(`${window.location.origin}/clear-route`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ambulanceId: window.currentAmbulanceId })
        });
      }
      policeSyncStatus.innerHTML = '<span style="color:#28c840;">✅ Route clearance confirmed</span>';
      showTacticalToast('<i class="fa-solid fa-circle-check"></i> ROUTE CLEARANCE CONFIRMED', 'success');
      btnDispatch.innerHTML = '<i class="fa-solid fa-check"></i> DISPATCHED';
      btnDispatch.style.background = 'rgba(40,200,64,0.2)';
      btnDispatch.style.borderColor = '#28c840';
      btnDispatch.style.color = '#28c840';
    }, 5000);
  });

  // =============================================
  // 5. Backend Polling Loop (Replaces LocalStorage)
  // =============================================
  window.currentAmbulanceId = null;

  setInterval(async () => {
    try {
      const res = await fetch(`${window.location.origin}/ambulance-location`);
      if (res.ok) {
        const ambulances = await res.json();
        // Since it's a demo, just pick the first active ambulance
        if (ambulances.length > 0) {
          const amb = ambulances[0];
          window.currentAmbulanceId = amb.ambulanceId;
          
          // Clear any 'stale' ghosts once we have fresh signal
          PoliceMapManager.resetGhostTracking();

          if (amb.location) {
            const age = Date.now() - new Date(amb.updatedAt).getTime();
            if (age > 4500 && amb.route) {
              // Signal silent for >4.5s (3 cycles) -> Extrapolate locally
              PoliceMapManager.ghostTrackAmbulance(amb.route);
            } else {
              // Signal alive
              PoliceMapManager.updateAmbulanceLocation(amb.location.lat, amb.location.lng);
              PoliceMapManager.resetGhostTracking();
            }
          }
          if (amb.destinationHospital) {
            // Fix: Destination is the 3rd detail row child
            const destEl = document.querySelector('.tracking-details .detail-row:nth-child(3) .value');
            if (destEl) destEl.innerText = amb.destinationHospital;
          }

          if (amb.route && amb.route.length > 0) {
            // Use the last point of the route as the hospital location if it's a new city
            const hospCoord = amb.route[amb.route.length - 1];
            PoliceMapManager.drawRoute(amb.route, hospCoord);
          }

          if (amb.jam && !PoliceMapManager.trafficLayer) {
            handleAlertPolice({ trafficCoords: amb.jam });
          }

          if (amb.status === 'CLEARED' && PoliceMapManager.trafficLayer) {
            handleRouteCleared();
          }
        }
      }
    } catch (err) {}
  }, 1500);
});

// =============================================
// Sync Event Handlers
// =============================================

function handleTrafficDetected(data) {
  if (data && data.trafficCoords) {
    receivedTrafficCoords = data.trafficCoords;
    // Show the congestion line on the police map
    PoliceMapManager.showTrafficCongestion(receivedTrafficCoords);
    showTacticalToast('<i class="fa-solid fa-triangle-exclamation"></i> TRAFFIC CONGESTION DETECTED ON AMBULANCE ROUTE', 'danger');
  }
}

function handleAlertPolice(data) {
  if (data && data.trafficCoords && data.trafficCoords.length > 0) {
    receivedTrafficCoords = data.trafficCoords;
    // Ensure congestion is highlighted
    PoliceMapManager.showTrafficCongestion(receivedTrafficCoords);
  }

  // Show the emergency dispatch section
  const dispatchSection = document.getElementById('dispatch-section');
  if (dispatchSection) {
    dispatchSection.style.display = 'block';
    dispatchSection.style.animation = 'slideDownToast 0.4s ease forwards';
  }

  // High-priority notification
  showTacticalToast('<i class="fa-solid fa-siren"></i> 🚨 EMERGENCY ALERT: AMBULANCE REQUIRES IMMEDIATE ROUTE CLEARANCE', 'danger');
  
  // Update emergency status to CRITICAL
  const statusEl = document.getElementById('emergency-status');
  if (statusEl) {
    statusEl.innerText = 'CRITICAL';
    statusEl.className = 'stat-value text-red blink-text';
  }
}

function handleRouteCleared() {
  // Clear traffic highlight on police map too
  PoliceMapManager.clearTraffic();
  showTacticalToast('<i class="fa-solid fa-circle-check"></i> ROUTE HAS BEEN FULLY CLEARED', 'success');

  const statusEl = document.getElementById('emergency-status');
  if (statusEl) {
    statusEl.innerText = 'CLEARED';
    statusEl.classList.remove('blink-text');
    statusEl.className = 'stat-value text-blue';
  }
}

// =============================================
// Tactical Toast Notifications
// =============================================
function showTacticalToast(messageHtml, type) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  
  if (type === 'danger') {
    toast.style.borderColor = 'rgba(239, 68, 68, 0.5)';
    toast.style.borderLeftColor = '#ef4444';
    toast.style.color = '#ff9a9a';
  } else if (type === 'success') {
    toast.style.borderColor = 'rgba(40, 200, 64, 0.5)';
    toast.style.borderLeftColor = '#28c840';
    toast.style.color = '#80ffaa';
  }

  toast.innerHTML = messageHtml;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, 5000);
}
