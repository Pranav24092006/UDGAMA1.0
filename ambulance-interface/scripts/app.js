// ==========================================================================
// Main Application Logic
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('start-btn');
  const ambulanceInput = document.getElementById('ambulance-id');
  
  const landingPage = document.getElementById('landing-page');
  const transitionScreen = document.getElementById('transition-screen');
  const dashboardPage = document.getElementById('dashboard-page');
  
  const transitionVehicle = document.getElementById('ambulance-transition-vehicle');
  const alertBtn = document.getElementById('alert-button');

  // Handle Start Emergency Button
  startBtn.addEventListener('click', () => {
    const ambId = ambulanceInput.value.trim();
    if (!ambId) {
      alert("Please enter an Ambulance ID to begin.");
      ambulanceInput.focus();
      return;
    }

    // Update Dashboard Data
    document.getElementById('display-ambulance-id').innerText = ambId.toUpperCase();

    // 1. Hide Landing Page
    landingPage.classList.remove('active');

    // 2. Show Transition Screen and Trigger Animation
    transitionScreen.classList.add('active');
    transitionVehicle.classList.add('drive-across');
    
    // Play siren sound here if you have an audio file, using Voice for now
    VoiceNav.speak("Emergency initiated. Dispatching ambulance.");

    // 3. Wait for Animation to Finish (2.5s) then show Dashboard
    setTimeout(() => {
      transitionScreen.classList.remove('active');
      dashboardPage.classList.add('active');
      
      // Initialize Map
      MapManager.initMap();
    }, 2500);
  });

  // Handle Send Traffic Alert Button
  alertBtn.addEventListener('click', () => {
    showToast('<i class="fa-solid fa-triangle-exclamation"></i> Police Notified – Route Clearance in Progress', 'alert');
    VoiceNav.speak("Traffic alert sent to local authorities. Requesting route clearance.");
    
    // Pulse animation on button
    alertBtn.style.transform = 'scale(0.95)';
    setTimeout(() => {
      alertBtn.style.transform = 'scale(1)';
    }, 200);
  });

  // Handle Enter Key on Input
  ambulanceInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      startBtn.click();
    }
  });
});

// ==========================================================================
// Global Utility Functions
// ==========================================================================

function showToast(messageHtml, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  
  if (type === 'alert') {
    toast.style.borderColor = 'rgba(255, 59, 48, 0.5)';
    toast.style.borderLeftColor = 'var(--accent-red)';
  } else if (type === 'success') {
    toast.style.borderColor = 'rgba(40, 200, 64, 0.5)';
    toast.style.borderLeftColor = '#28c840';
  }

  toast.innerHTML = messageHtml;
  container.appendChild(toast);

  // Remove toast after 4 seconds
  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 4000);
}
