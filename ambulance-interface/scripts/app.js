// ==========================================================================
// Ambulance App - Main Interaction Controller
// ==========================================================================

// =============================================
// API Service replacing SyncBus
// =============================================
const API_BASE = window.location.origin;

const ApiService = {
  async startEmergency(ambulanceId, destinationHospital) {
    try {
      const res = await fetch(`${API_BASE}/start-emergency`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ambulanceId, destinationHospital })
      });
      return await res.json();
    } catch (e) { console.error(e); }
  },
  async reportJam(ambulanceId, jamPoint) {
    try {
      await fetch(`${API_BASE}/report-jam`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ambulanceId, jamPoint })
      });
    } catch (e) { console.error(e); }
  }
};

window.currentAmbulanceId = "";

// =============================================
// setSyncStatus: Update the status bar on the ambulance panel
// =============================================
function setSyncStatus(message, type) {
  const bar = document.getElementById('sync-status-bar');
  if (!bar) return;
  bar.innerHTML = `<span class="signal-ping ${type === 'danger' ? 'danger' : ''}"></span>${message}`;
  bar.className = `sync-status-bar visible ${type}`;
}

// =============================================
// showToast: Global Ambulance Toast function
// =============================================
function showToast(messageHtml, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';

  if (type === 'danger') {
    toast.style.borderColor = 'rgba(255, 59, 48, 0.5)';
    toast.style.borderLeftColor = 'var(--accent-red)';
  } else if (type === 'success') {
    toast.style.borderColor = 'rgba(40, 200, 64, 0.5)';
    toast.style.borderLeftColor = '#28c840';
  } else if (type === 'info') {
    toast.style.borderColor = 'rgba(10, 132, 255, 0.5)';
    toast.style.borderLeftColor = 'var(--accent-blue)';
  }

  toast.innerHTML = messageHtml;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, 5000);
}

// =============================================
// DOM Ready
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  const startBtn        = document.getElementById('start-btn');
  const ambulanceInput  = document.getElementById('ambulance-id');
  const emergencyDescInput = document.getElementById('emergency-desc');
  const landingPage     = document.getElementById('landing-page');
  const transitionScreen= document.getElementById('transition-screen');
  const dashboardPage   = document.getElementById('dashboard-page');
  const transitionVehicle = document.getElementById('ambulance-transition-vehicle');
  const alertBtn        = document.getElementById('alert-button');

  // ---- Start Emergency ----
  startBtn.addEventListener('click', async () => {
    const ambId = ambulanceInput.value.trim();
    if (!ambId) {
      alert("Please enter an Ambulance ID to begin.");
      ambulanceInput.focus();
      return;
    }

    const desc = emergencyDescInput ? emergencyDescInput.value.toLowerCase() : "";
    let aiTargetHospitalId = "city_general"; // Default nearest
    window.aiOverrideTriggered = false;

    // --- MOCK AI TRIAGE ENGINE ---
    if (desc.includes("burn") || desc.includes("fire")) {
      aiTargetHospitalId = "metro_health"; // Specialized Burn Center
      window.aiOverrideTriggered = true;
    } else if (desc.includes("cardiac") || desc.includes("heart") || desc.includes("attack")) {
      aiTargetHospitalId = "mercy_care"; // Specialized Cardiac Unit
      window.aiOverrideTriggered = true;
    }
    
    // Store for MapManager
    window.initialHospitalId = aiTargetHospitalId;

    document.getElementById('display-ambulance-id').innerText = ambId.toUpperCase();
    window.currentAmbulanceId = ambId;

    // Call backend
    await ApiService.startEmergency(ambId, aiTargetHospitalId);

    // Clear stale sync events just in case
    localStorage.removeItem('emergency_sync_event');

    // Transition
    landingPage.classList.remove('active');
    transitionScreen.classList.add('active');
    transitionVehicle.classList.add('drive-across');
    
    // --- Feature 1: AI Visuals ---
    if (window.aiOverrideTriggered) {
      const aiText = document.createElement('div');
      aiText.innerHTML = '<h2 style="color:var(--accent-red); text-align:center; margin-top: 20px;"><i class="fa-solid fa-brain"></i> AI TRIAGE ACTIVE<br><span style="font-size:1rem;color:#fff;">Analyzing capabilities... Redirecting to specialized facility.</span></h2>';
      aiText.id = "ai-processing-text";
      transitionScreen.appendChild(aiText);
      VoiceNav.speak("AI Triage engaged. Scanning for specialized facilities.");
    } else {
      VoiceNav.speak("Emergency initiated. Dispatching ambulance.");
    }

    // Delay slightly longer to let AI anim play
    setTimeout(() => {
      transitionScreen.classList.remove('active');
      dashboardPage.classList.add('active');
      const aiTxt = document.getElementById('ai-processing-text');
      if (aiTxt) aiTxt.remove();
      MapManager.initMap();
    }, window.aiOverrideTriggered ? 3800 : 2500);
  });

  // ---- AI Voice Assistant ----
  const voiceBtn = document.getElementById('voice-assistant-btn');
  if (voiceBtn) {
    voiceBtn.addEventListener('click', () => {
      VoiceAssistant.start((transcript) => {
        if (emergencyDescInput) {
          emergencyDescInput.value = transcript;
          document.getElementById('voice-overlay-text').innerText = `"${transcript}"`;
          setTimeout(() => {
            VoiceAssistant.stop();
            // Optional: Auto-start if high confidence or just let user click start
            // For hackathon "Wow", let's pulse the start button
            startBtn.classList.add('pulse-active');
          }, 1000);
        }
      });
    });
  }

  // ---- Quick Chips ----
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const caseDesc = chip.getAttribute('data-case');
      if (emergencyDescInput) {
        emergencyDescInput.value = caseDesc;
        // Visual feedback
        chip.style.borderColor = 'var(--accent-red)';
        chip.style.background = 'rgba(255,59,48,0.1)';
        setTimeout(() => {
          chip.style.borderColor = '';
          chip.style.background = '';
        }, 500);
      }
    });
  });

  // ---- Send Traffic Alert Button ----
  alertBtn.addEventListener('click', () => {
    // Pulse animation on button
    alertBtn.style.transform = 'scale(0.95)';
    setTimeout(() => { alertBtn.style.transform = 'scale(1)'; }, 200);

    // Only useful if traffic was already detected
    setSyncStatus("Alert sent to traffic control", "info");

    // Ripple on marker position
    if (MapManager.marker && MapManager.map) {
      const pos = MapManager.marker.getLatLng();
      const ripple = L.circle(pos, {
        color: '#ff3b30',
        weight: 3,
        fillOpacity: 0.2,
        radius: 30
      }).addTo(MapManager.map);

      let r = 30;
      const expand = setInterval(() => {
        r += 20;
        ripple.setRadius(r);
        ripple.setStyle({ fillOpacity: Math.max(0, 0.2 - r / 500), opacity: Math.max(0, 1 - r / 500) });
        if (r > 400) { clearInterval(expand); MapManager.map.removeLayer(ripple); }
      }, 40);
    }

    // Post to backend
    if (MapManager.trafficCoords && MapManager.trafficCoords.length > 0) {
      const jamStart = MapManager.trafficCoords[0];
      ApiService.reportJam(window.currentAmbulanceId, { lat: jamStart[0], lng: jamStart[1] });
    }

    showToast('<i class="fa-solid fa-tower-broadcast"></i> Alert sent to traffic control', 'info');
    setTimeout(() => VoiceNav.speak("Traffic control notified. Awaiting response.", true), 500);
  });

  // ---- Enter Key on Input ----
  ambulanceInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') startBtn.click();
  });

  // ---- Offline Mode Detection ----
  const netStatus = document.getElementById('network-status');
  const netText = document.getElementById('network-text');

  window.addEventListener('offline', () => {
    netStatus.className = 'status-indicator offline-mode';
    netText.innerText = 'OFFLINE';
    showToast('<i class="fa-solid fa-wifi-slash"></i> Running in offline mode. Using cached data.', 'danger');
    VoiceNav.speak("Connection lost. Operating in offline mode with cached geographical data.", true);
  });

  window.addEventListener('online', () => {
    netStatus.className = 'status-indicator online-mode';
    netText.innerText = 'ONLINE';
    showToast('<i class="fa-solid fa-wifi"></i> Connection restored. Live updates resumed.', 'success');
    VoiceNav.speak("Connection restored.", true);
  });
});
