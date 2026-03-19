// ==========================================================================
// Ambulance Dashboard - Map & Routing Module
// With Traffic Congestion, Sync & Route Clearing
// ==========================================================================

const MapManager = {
  map: null,
  marker: null,
  routePolyline: null,
  hospitalMarker: null,
  
  // All fetched route coordinates
  allCoords: [],
  currentIndex: 0,
  movementTimer: null,
  altRouteLayers: [],
  
  // Traffic congestion state
  trafficLayer: null,
  trafficCoords: [],
  trafficClearing: false,
  policeDispatched: false,
  congestionSpawnIndex: 0,
  congestionEndIndex: 0,

  // Hospital proximity flag
  hospitalAlerted: false,

  // Feature 2: V2X Lights
  trafficLightNodes: [],

  // Feature 3: GPS Mode
  isGPSMode: false,
  demoHospitals: null, // backup original hospitals

  // Multiple Hospitals for Feature 2
  hospitals: {
    'city_general': { name: 'City General Hospital', coords: [12.9850, 77.6050], phone: '+91-80-2222-1111' },
    'mercy_care': { name: 'Mercy Care Center', coords: [12.9600, 77.6100], phone: '+91-80-4444-3333' },
    'metro_health': { name: 'Metro Health Hub', coords: [12.9780, 77.5800], phone: '+91-80-6666-5555' }
  },

  // Coordinates for Demo
  startCoord: [12.9716, 77.5946],
  hospitalCoord: [12.9850, 77.6050],
  
  initMap() {
    if (this.map) return;

    // Feature 1 (AI): Inject AI-selected hospital if an override occurred
    if (window.initialHospitalId && this.hospitals[window.initialHospitalId]) {
      this.hospitalCoord = this.hospitals[window.initialHospitalId].coords;
      const dropEl = document.getElementById('hospital-dropdown');
      if (dropEl) dropEl.value = window.initialHospitalId;
      
      if (window.aiOverrideTriggered) {
        setTimeout(() => {
          const hName = this.hospitals[window.initialHospitalId].name;
          showToast(`<i class="fa-solid fa-robot"></i> <strong>AI OVERRIDE:</strong> Standard facility lacks capabilities. Rerouted to ${hName}.`, 'danger');
          VoiceNav.speak(`AI Triage override. Rerouted to ${hName} for specialized care.`, true);
        }, 1500);
      }
    }

    this.map = L.map('map', { zoomControl: false }).setView(this.startCoord, 14);
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    // CartoDB Dark Matter Tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap & CartoDB',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(this.map);

    // Ambulance Icon
    const ambIcon = L.divIcon({
      className: 'custom-div-icon',
      html: `<div id="amb-marker-el" style="background:var(--accent-red);width:20px;height:20px;border-radius:50%;border:3px solid white;box-shadow:0 0 15px rgba(255,59,48,0.9)"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });
    this.marker = L.marker(this.startCoord, { icon: ambIcon }).addTo(this.map);

    // Hospital Icon
    const hospitalIcon = L.divIcon({
      className: 'custom-div-icon',
      html: `<div style="background:var(--accent-blue);width:24px;height:24px;border-radius:8px;border:2px solid white;box-shadow:0 0 15px rgba(10,132,255,0.8);display:flex;justify-content:center;align-items:center;"><i class="fa-solid fa-square-h" style="color:white;font-size:14px;"></i></div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    this.hospitalMarker = L.marker(this.hospitalCoord, { icon: hospitalIcon }).addTo(this.map);

    // Feature 2: Hospital Change Event
    document.getElementById('hospital-dropdown').addEventListener('change', (e) => {
      const selectedId = e.target.value;
      const targetHospital = this.hospitals[selectedId];
      if (targetHospital) {
        this.hospitalCoord = targetHospital.coords;
        this.hospitalMarker.setLatLng(this.hospitalCoord);

        // Reset state for new route
        this.allCoords = [];
        this.currentIndex = 0;
        this.trafficCoords = [];
        this.policeDispatched = false;
        this.trafficClearing = false;
        clearInterval(this.movementTimer);
        
        if (this.trafficLayer) { this.map.removeLayer(this.trafficLayer); this.trafficLayer = null; }
        if (this.routePolyline) { this.map.removeLayer(this.routePolyline); this.routePolyline = null; }
        this.altRouteLayers.forEach(l => this.map.removeLayer(l));
        this.altRouteLayers = [];

        showToast(`<i class="fa-solid fa-route"></i> Rerouting to ${targetHospital.name}...`, 'info');
        VoiceNav.speak(`Rerouting to ${targetHospital.name}.`);
        this.fetchRoute();
      }
    });

    // Feature 3: GPS Toggle Event
    document.getElementById('locate-me-btn').addEventListener('click', () => this.toggleGPS());

    this.fetchRoute();

    // Poll the backend for police updates + tactical actions
    setInterval(async () => {
      if (!window.currentAmbulanceId || !navigator.onLine) return;
      try {
        const res = await fetch(`http://localhost:5000/ambulance-location?ambulanceId=${window.currentAmbulanceId}`);
        if (res.ok) {
          const data = await res.json();

          // --- Dispatch/Clear status ---
          if (data.status === 'DISPATCHED' && !this.policeDispatched) {
            this.onPoliceDispatched();
          } else if (data.status === 'CLEARED' && this.trafficCoords.length > 0 && !this.trafficClearing) {
            this.startRouteClearingAnimation();
          }

          // --- Tactical action from police buttons ---
          if (data.tacticalAction) {
            this.handleTacticalAction(data.tacticalAction);
            // Acknowledge immediately so it fires only once
            fetch('http://localhost:5000/ack-tactical', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ambulanceId: window.currentAmbulanceId })
            }).catch(() => {});
          }
        }
      } catch (err) {}
    }, 1500);
  },

  // =============================================
  // Feature 3: Smart Hybrid Geolocation
  // =============================================
  async toggleGPS() {
    const btn = document.getElementById('locate-me-btn');
    const badge = document.getElementById('gps-status-badge');
    
    if (this.isGPSMode) {
      // Revert to Simulation
      this.isGPSMode = false;
      btn.classList.remove('active');
      badge.innerHTML = '<span class="pulse-dot"></span> SIMULATION MODE';
      badge.classList.remove('live');
      
      // Restore Demo State
      this.startCoord = [12.9716, 77.5946];
      if (this.demoHospitals) {
        this.hospitals = JSON.parse(JSON.stringify(this.demoHospitals));
        this.updateHospitalUI();
      }
      
      const firstId = Object.keys(this.hospitals)[0];
      const hospitalName = this.hospitals[firstId].name;
      if (window.ApiService) {
          window.ApiService.startEmergency(window.currentAmbulanceId, hospitalName);
      }
      
      showToast('<i class="fa-solid fa-ghost"></i> Reverted to Simulation Mode', 'info');
      VoiceNav.speak("Reverting to simulation mode.");
      this.resetMovement();
      this.fetchRoute();
      return;
    }

    // Attempt Live GPS
    if (!navigator.geolocation) {
      showToast('Geolocation not supported.', 'danger');
      return;
    }

    showToast('<i class="fa-solid fa-satellite"></i> Searching for GPS signal...', 'info');
    
    navigator.geolocation.getCurrentPosition(async (pos) => {
      this.isGPSMode = true;
      btn.classList.add('active');
      badge.innerHTML = '<span class="pulse-dot" style="background:#28c840;"></span> LIVE TRACKING ACTIVE';
      badge.classList.add('live');

      this.startCoord = [pos.coords.latitude, pos.coords.longitude];
      
      // Move marker immediately
      if (this.marker) this.marker.setLatLng(this.startCoord);
      this.map.panTo(this.startCoord);

      // Backup demo hospitals if first time
      if (!this.demoHospitals) this.demoHospitals = JSON.parse(JSON.stringify(this.hospitals));

      showToast('<i class="fa-solid fa-map-location-dot"></i> GPS Lock Acquired. Finding hospitals...', 'info');
      
      const foundHospitals = await this.fetchNearbyHospitals(pos.coords.latitude, pos.coords.longitude);
      
      this.resetMovement();
      
      if (foundHospitals) {
          const firstId = Object.keys(this.hospitals)[0];
          const hospitalName = this.hospitals[firstId].name;
          
          // Re-sync with backend (Crucial for Police Dashboard)
          if (window.ApiService) {
              await window.ApiService.startEmergency(window.currentAmbulanceId, hospitalName);
          }
          
          this.fetchRoute();
          VoiceNav.speak(`Live tracking enabled. Rerouting to ${hospitalName}.`);
      } else {
          this.fetchRoute(); // fallback to whatever is set
          VoiceNav.speak("Live tracking enabled. Using fallback navigation.");
      }

    }, (err) => {
      showToast('GPS Access Denied or Failed.', 'danger');
      console.error(err);
    });
  },

  async fetchNearbyHospitals(lat, lng) {
    const query = `[out:json];node(around:5000,${lat},${lng})[amenity=hospital];out 3;`;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
    
    try {
      const res = await fetch(url);
      const data = await res.json();
      
      if (data.elements && data.elements.length > 0) {
        // Build new hospital dictionary
        const newHospitals = {};
        data.elements.forEach((el, idx) => {
          const id = `live_hosp_${idx}`;
          const h = el.tags;
          const phone = h.phone || h['contact:phone'] || '+91-0000-0000';
          newHospitals[el.id] = {
            name: h.name,
            coords: [el.lat, el.lon],
            phone: phone
          };
        });

        this.hospitals = newHospitals;
        const firstKey = Object.keys(newHospitals)[0];
        this.hospitalCoord = newHospitals[firstKey].coords;
        
        this.updateHospitalUI();
        showToast(`<i class="fa-solid fa-square-h"></i> Found ${data.elements.length} real hospitals nearby.`, 'info');
        return true;
      } else {
        showToast('No real hospitals found nearby. Using Simulation Data.', 'warning');
        return false;
      }
    } catch (err) {
      console.error("Overpass Error:", err);
      showToast('Failed to reach OpenStreetMap. Using Simulation Data.', 'warning');
      return false;
    }
  },

  updateHospitalUI() {
    const dropdown = document.getElementById('hospital-dropdown');
    if (!dropdown) return;

    dropdown.innerHTML = '';
    for (const [id, hosp] of Object.entries(this.hospitals)) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = hosp.name;
      dropdown.appendChild(opt);
    }
    
    // Update marker pos and tooltip
    if (this.hospitalMarker) {
        const currentHospId = Object.keys(this.hospitals).find(k => JSON.stringify(this.hospitals[k].coords) === JSON.stringify(this.hospitalCoord));
        const hosp = currentHospId ? this.hospitals[currentHospId] : null;
        const hospName = hosp ? hosp.name : "Selected Hospital";
        const hospPhone = hosp ? hosp.phone : "N/A";

        // Update Phone UI
        const phoneEl = document.getElementById('display-hospital-phone');
        if (phoneEl) phoneEl.innerText = hospPhone;
        
        this.hospitalMarker.setLatLng(this.hospitalCoord);
        this.hospitalMarker.bindTooltip(`<strong>${hospName}</strong>`, { permanent: true, direction: 'top', offset: [0, -10] }).openTooltip();
    }
  },

  resetMovement() {
    this.allCoords = [];
    this.currentIndex = 0;
    this.trafficCoords = [];
    this.policeDispatched = false;
    this.trafficClearing = false;
    clearInterval(this.movementTimer);
    if (this.trafficLayer) { this.map.removeLayer(this.trafficLayer); this.trafficLayer = null; }
    if (this.routePolyline) { this.map.removeLayer(this.routePolyline); this.routePolyline = null; }
    this.trafficLightNodes.forEach(node => this.map.removeLayer(node.marker));
    this.trafficLightNodes = [];
    this.altRouteLayers.forEach(l => this.map.removeLayer(l));
    this.altRouteLayers = [];
  },

  triggerRipple(pos) {
    if (!this.map) return;
    const ripple = L.circle(pos, {
      color: 'var(--accent-blue)',
      weight: 2,
      fillOpacity: 0.3,
      radius: 20
    }).addTo(this.map);

    let r = 20;
    const expand = setInterval(() => {
      r += 15;
      ripple.setRadius(r);
      ripple.setStyle({ fillOpacity: Math.max(0, 0.3 - r / 600), opacity: Math.max(0, 1 - r / 600) });
      if (r > 300) { clearInterval(expand); this.map.removeLayer(ripple); }
    }, 500); // Slower, elegant pulse
  },

  async fetchRoute() {
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${this.startCoord[1]},${this.startCoord[0]};${this.hospitalCoord[1]},${this.hospitalCoord[0]}?overview=full&geometries=geojson&alternatives=3`;
    try {
      const res = await fetch(osrmUrl);
      const data = await res.json();
      if (data.code === 'Ok' && data.routes.length > 0) {
        
        // Feature 4: Draw alternative routes first (background)
        this.altRouteLayers.forEach(l => this.map.removeLayer(l));
        this.altRouteLayers = [];
        if (data.routes.length > 1) {
          for (let i = 1; i < data.routes.length; i++) {
            const altCoords = data.routes[i].geometry.coordinates.map(c => [c[1], c[0]]);
            const altLine = L.polyline(altCoords, {
              color: '#888',
              weight: 3,
              opacity: 0.4,
              dashArray: '5, 10'
            }).bindTooltip("Alternative (Slower) Route", { sticky: true, className: "alt-route-tooltip" }).addTo(this.map);
            this.altRouteLayers.push(altLine);
          }
        }

        const route = data.routes[0];
        this.allCoords = route.geometry.coordinates.map(c => [c[1], c[0]]);

        // Draw base route polyline
        this.routePolyline = L.polyline(this.allCoords, {
          color: '#0a84ff',
          weight: 5,
          opacity: 0.7,
          lineJoin: 'round',
          dashArray: '10, 10'
        }).addTo(this.map);

        // Feature 2: Generate V2X Traffic Lights HUD
        this.trafficLightNodes.forEach(node => this.map.removeLayer(node.marker));
        this.trafficLightNodes = [];

        const numLights = 4;
        const step = Math.floor(this.allCoords.length / (numLights + 1));
        if (step > 0) {
          for (let i = 1; i <= numLights; i++) {
            const idx = i * step;
            if (idx < this.allCoords.length) {
              const coord = this.allCoords[idx];
              const icon = L.divIcon({
                className: 'custom-div-icon',
                html: `<div class="tl-box red-active"><div class="tl-bulb tl-red"></div><div class="tl-bulb tl-yellow"></div><div class="tl-bulb tl-green"></div></div>`,
                iconSize: [14, 32],
                iconAnchor: [7, 16]
              });
              const marker = L.marker(coord, { icon: icon }).addTo(this.map);
              this.trafficLightNodes.push({ marker, latlng: L.latLng(coord), triggered: false });
            }
          }
        }

        // Store route in backend
        if (window.currentAmbulanceId) {
          fetch(`${window.location.origin}/store-route`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ambulanceId: window.currentAmbulanceId, route: this.allCoords })
          }).catch(e => {});
        }

        this.map.fitBounds(this.routePolyline.getBounds(), { padding: [50, 50] });

        // Update ETA
        const durationMin = Math.ceil(route.duration / 60);
        const etaEl = document.getElementById('display-eta');
        if (etaEl) etaEl.innerText = `${durationMin < 10 ? '0' + durationMin : durationMin} Min`;

        // Initial voice
        setTimeout(() => {
          const hName = this.hospitals[Object.keys(this.hospitals).find(k => JSON.stringify(this.hospitals[k].coords) === JSON.stringify(this.hospitalCoord))]?.name || "the hospital";
          VoiceNav.speak(`Emergency route generated. Estimated time to ${hName}: ${durationMin} minutes.`);
        }, 1500);

        // Start movement
        this.simulateMovement();

        // Spawn traffic congestion after 5 seconds (demo drama)
        setTimeout(() => this.spawnTrafficCongestion(), 5000);
      }
    } catch (err) {
      console.error('Routing error:', err);
    }
  },

  simulateMovement() {
    this.movementTimer = setInterval(() => {
      if (this.currentIndex >= this.allCoords.length) {
        clearInterval(this.movementTimer);
        VoiceNav.speak("You have arrived at your destination.", true);
        showToast("🏥 Destination Reached", "success");
        return;
      }
      const pos = this.allCoords[this.currentIndex];
      this.marker.setLatLng(pos);

      document.getElementById('display-location').innerText = `${pos[0].toFixed(4)}, ${pos[1].toFixed(4)}`;

      if (this.currentIndex % 5 === 0) {
        this.map.panTo(pos, { animate: true, duration: 2 });
      }

      // Feature 2: V2X Light Preemption HUD
      const ambLatLng = L.latLng(pos);
      this.trafficLightNodes.forEach(node => {
        if (!node.triggered && ambLatLng.distanceTo(node.latlng) < 300) {
          node.triggered = true;
          // Turn light green
          const greenIcon = L.divIcon({
            className: 'custom-div-icon',
            html: `<div class="tl-box green-active"><div class="tl-bulb tl-red"></div><div class="tl-bulb tl-yellow"></div><div class="tl-bulb tl-green"></div></div>`,
            iconSize: [14, 32], iconAnchor: [7, 16]
          });
          node.marker.setIcon(greenIcon);
          // Visual Ripple
          this.triggerRipple([node.latlng.lat, node.latlng.lng]);
          
          showToast('<i class="fa-solid fa-satellite-dish"></i> V2X: INTERSECTION SECURED (GREEN WAVE)', 'success');
          VoiceNav.speak("Intersection secured.");
        }
      });

      // Check distance to congestion zone
      if (this.trafficCoords.length > 0 && !this.trafficClearing) {
        const congestionStart = L.latLng(this.trafficCoords[0]);
        const ambPos = L.latLng(pos);
        const dist = ambPos.distanceTo(congestionStart);
        if (dist < 300 && this.policeDispatched) {
          this.startRouteClearingAnimation();
        }
      }

      // POST location to server
      if (window.currentAmbulanceId && navigator.onLine) {
        fetch(`${window.location.origin}/update-location`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ambulanceId: window.currentAmbulanceId, lat: pos[0], lng: pos[1] })
        })
        .then(r => {
           if (r.ok) {
             if (typeof setSyncStatus === 'function') setSyncStatus("Telemetry Synced with Command Center", "success");
           } else {
             if (typeof setSyncStatus === 'function') setSyncStatus("Sync Error: Backend Rejected Data", "danger");
           }
        })
        .catch(e => {
           if (typeof setSyncStatus === 'function') setSyncStatus("Connection Lost: Server Unreachable", "danger");
        });
      } else if (!window.currentAmbulanceId) {
         if (typeof setSyncStatus === 'function') setSyncStatus("Offline Mode: No Ambulance ID", "warning");
      }

      // Alert near hospital
      const hospitalPos = L.latLng(this.hospitalCoord);
      const ambPos = L.latLng(pos);
      if (!this.hospitalAlerted && ambPos.distanceTo(hospitalPos) < 200) {
        this.hospitalAlerted = true;
        setTimeout(() => VoiceNav.speak("You are approaching the hospital. Prepare for arrival.", true), 500);
      }

      this.currentIndex++;
    }, 1500);
  },

  spawnTrafficCongestion() {
    if (this.allCoords.length < 10) return;
    
    // Congestion segment is ~10 nodes ahead of current ambulance position
    const spawnStart = Math.min(this.currentIndex + 6, this.allCoords.length - 10);
    const spawnEnd   = Math.min(spawnStart + 8, this.allCoords.length - 1);
    
    this.congestionSpawnIndex = spawnStart;
    this.congestionEndIndex   = spawnEnd;
    this.trafficCoords = this.allCoords.slice(spawnStart, spawnEnd + 1);

    // Draw red congestion polyline on top
    this.trafficLayer = L.polyline(this.trafficCoords, {
      color: '#ff2030',
      weight: 8,
      opacity: 0.9,
      lineJoin: 'round'
    }).addTo(this.map);

    // Notify user
    showToast('<i class="fa-solid fa-triangle-exclamation"></i> Traffic Congestion Detected Ahead!', 'danger');

    // Voice — paced delay
    setTimeout(() => VoiceNav.speak("Heavy traffic detected ahead. Requesting clearance is recommended.", true), 500);

    // Broadcast alert to backend
    if (window.currentAmbulanceId && navigator.onLine) {
      fetch('http://localhost:5000/report-jam', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ambulanceId: window.currentAmbulanceId,
          jamPoint: this.trafficCoords
        })
      }).catch(e => {});
    }
  },

  // When police have dispatched, watch ambulance and start clearing
  onPoliceDispatched() {
    this.policeDispatched = true;
    setSyncStatus("Police team dispatched. Clearing route…", "info");
    setTimeout(() => VoiceNav.speak("Police units are on the way. Maintain current route.", true), 300);
    showToast('<i class="fa-solid fa-shield-halved"></i> Police team dispatched. Clearing route…', 'info');
  },

  startRouteClearingAnimation() {
    if (this.trafficClearing) return;
    this.trafficClearing = true;

    showToast('<i class="fa-solid fa-road-circle-check"></i> Route clearance in progress…', 'info');

    // Phase 1: RED → YELLOW (1.5s)
    setTimeout(() => {
      if (this.trafficLayer) {
        this.trafficLayer.setStyle({ color: '#ffc107', weight: 7, opacity: 0.9 });
      }
    }, 1000);

    // Phase 2: YELLOW → GREEN (3s)
    setTimeout(() => {
      if (this.trafficLayer) {
        this.trafficLayer.setStyle({ color: '#28c840', weight: 6, opacity: 0.9 });
      }
      setSyncStatus("Route ahead is now clear!", "success");
      showToast('<i class="fa-solid fa-circle-check"></i> Route ahead is now clear!', 'success');
      VoiceNav.speak("Route ahead is now clear. Continue on the current path.", true);

      // Fade out the cleared traffic after a beat
      setTimeout(() => {
        if (this.trafficLayer) {
          this.map.removeLayer(this.trafficLayer);
          this.trafficLayer = null;
        }
      }, 3000);
    }, 3500);
  },

  // =============================================
  // Handle real-time tactical actions from Police
  // =============================================
  handleTacticalAction(action) {
    switch (action) {
      case 'MANUAL_CLEAR':
        setSyncStatus('Dispatch cleared route ahead', 'success');
        showToast('<i class="fa-solid fa-road-circle-check"></i> Dispatch has manually cleared the route ahead', 'success');
        VoiceNav.speak('Attention. Dispatch has manually cleared the route ahead. You may proceed.', true);
        if (this.marker && this.map) {
          const pos = this.marker.getLatLng();
          const ripple = L.circle(pos, { color: '#28c840', weight: 2, fillOpacity: 0.1, radius: 30 }).addTo(this.map);
          let r = 30;
          const t = setInterval(() => {
            r += 25; ripple.setRadius(r);
            ripple.setStyle({ opacity: Math.max(0, 1 - r / 500) });
            if (r > 450) { clearInterval(t); this.map.removeLayer(ripple); }
          }, 40);
        }
        break;

      case 'INTERSECTION_BLOCKED':
        setSyncStatus('Warning: Intersection blocked ahead', 'danger');
        showToast('<i class="fa-solid fa-ban"></i> Warning: next intersection blocked for civilians — proceed with priority', 'danger');
        VoiceNav.speak('Warning. The next intersection has been blocked for civilian traffic. You have clear priority. Continue.', true);
        if (this.marker && this.map) {
          const pos = this.marker.getLatLng();
          const ripple = L.circle([pos.lat + 0.002, pos.lng + 0.002], { color: '#ff3b30', weight: 2, fillOpacity: 0.15, radius: 30 }).addTo(this.map);
          let r = 30;
          const t = setInterval(() => {
            r += 25; ripple.setRadius(r);
            ripple.setStyle({ opacity: Math.max(0, 1 - r / 500) });
            if (r > 400) { clearInterval(t); this.map.removeLayer(ripple); }
          }, 40);
        }
        break;

      case 'UNITS_ALERTED':
        setSyncStatus('Backup units standing by', 'info');
        showToast('<i class="fa-solid fa-shield-halved"></i> Backup patrol units alerted and standing by to assist', 'info');
        VoiceNav.speak('Backup patrol units have been notified and are standing by along your route. Continue on current path.', true);
        if (this.marker && this.map) {
          const pos = this.marker.getLatLng();
          const ripple = L.circle(pos, { color: '#0a84ff', weight: 2, fillOpacity: 0.1, radius: 30 }).addTo(this.map);
          let r = 30;
          const t = setInterval(() => {
            r += 25; ripple.setRadius(r);
            ripple.setStyle({ opacity: Math.max(0, 1 - r / 600) });
            if (r > 500) { clearInterval(t); this.map.removeLayer(ripple); }
          }, 40);
        }
        break;
    }
  }
};
