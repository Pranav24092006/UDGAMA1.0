// ==========================================================================
// Police Dashboard - Map & Routing Module
// With Traffic Highlight + Dispatch Animation
// ==========================================================================

const PoliceMapManager = {
  map: null,
  ambMarker: null,
  hospMarker: null,
  routePolyline: null,
  allCoords: [],
  trafficLayer: null,
  trafficStartCoord: null,
  policeUnitMarkers: [],
  trafficLightNodes: [],
  
  ghostIndex: -1,
  isGhosting: false,
  
  // Coordinates synced with ambulance dashboard
  startCoord: [12.9716, 77.5946],
  hospitalCoord: [12.9850, 77.6050],
  
  initMap() {
    if (this.map) return;

    this.map = L.map('map', { zoomControl: false }).setView(this.startCoord, 14);
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    // CartoDB Dark Matter tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap & CartoDB',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(this.map);

    // Ambulance Marker (pulsing blue target)
    const ambIcon = L.divIcon({
      className: 'custom-div-icon',
      html: `<div style="background:var(--neon-blue);width:16px;height:16px;border-radius:50%;box-shadow:0 0 20px 5px var(--neon-blue-glow);border:2px solid #fff;"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
    this.ambMarker = L.marker(this.startCoord, { icon: ambIcon, zIndexOffset: 1000 }).addTo(this.map);

    // Hospital Icon
    const hospitalIcon = L.divIcon({
      className: 'custom-div-icon',
      html: `<div style="background:var(--neon-amber);width:20px;height:20px;border-radius:4px;border:2px solid white;box-shadow:0 0 15px rgba(245,158,11,0.6);display:flex;justify-content:center;align-items:center;"><i class="fa-solid fa-square-h" style="color:white;font-size:12px;"></i></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });
    L.marker(this.hospitalCoord, { icon: hospitalIcon }).addTo(this.map);

    // Removed local fetchRoute as route comes from ambulance backend
  },

  drawRoute(coordinates, hospitalCoord) {
    // Optimization: Don't redraw if it's the exact same route (prevents V2X reset on poll)
    if (this.routePolyline && this.allCoords && this.allCoords.length === coordinates.length) {
        const firstMatch = this.allCoords[0][0] === coordinates[0][0] && this.allCoords[0][1] === coordinates[0][1];
        const lastMatch = this.allCoords[this.allCoords.length-1][0] === coordinates[coordinates.length-1][0];
        if (firstMatch && lastMatch) return; 
    }
    
    this.allCoords = coordinates;

    // Clear existing route layers if they exist
    if (this.routePolyline) {
      this.map.removeLayer(this.routePolyline);
      this.routePolyline = null;
    }
    // Also remove animated comms lines
    this.map.eachLayer(layer => {
        if (layer instanceof L.Polyline && layer.options.className === 'comms-line-anim') {
            this.map.removeLayer(layer);
        }
    });

    if (hospitalCoord) {
        this.hospitalCoord = hospitalCoord;
        if (this.hospMarker) {
            this.hospMarker.setLatLng(hospitalCoord);
        } else {
            const hospitalIcon = L.divIcon({
              className: 'custom-div-icon',
              html: `<div style="background:var(--neon-amber);width:20px;height:20px;border-radius:4px;border:2px solid white;box-shadow:0 0 15px rgba(245,158,11,0.6);display:flex;justify-content:center;align-items:center;"><i class="fa-solid fa-square-h" style="color:white;font-size:12px;"></i></div>`,
              iconSize: [20, 20],
              iconAnchor: [10, 10]
            });
            this.hospMarker = L.marker(this.hospitalCoord, { icon: hospitalIcon }).addTo(this.map);
        }
    }

    this.routePolyline = L.polyline(coordinates, {
      color: 'var(--neon-blue)',
      weight: 4,
      opacity: 0.5,
      lineJoin: 'round'
    }).addTo(this.map);

    // Animated comms line
    L.polyline(coordinates, {
      color: '#fff',
      weight: 2,
      opacity: 0.8,
      dashArray: '10, 20',
      className: 'comms-line-anim'
    }).addTo(this.map);

    // Feature 2: Generate V2X Traffic Lights
    this.trafficLightNodes.forEach(node => this.map.removeLayer(node.marker));
    this.trafficLightNodes = [];

    const numLights = 4;
    let step = Math.floor(coordinates.length / (numLights + 1));
    if (step < 1) step = 1; // Safety for very short routes
    for (let i = 1; i <= numLights; i++) {
      const idx = i * step;
      if (idx < coordinates.length) {
        const coord = coordinates[idx];
        const icon = L.divIcon({
          className: 'custom-div-icon',
          html: `<div class="tl-box red-active"><div class="tl-bulb tl-red"></div><div class="tl-bulb tl-yellow"></div><div class="tl-bulb tl-green"></div></div>`,
          iconSize: [12, 28],
          iconAnchor: [6, 14]
        });
        const marker = L.marker(coord, { icon: icon }).addTo(this.map);
        this.trafficLightNodes.push({ marker, latlng: L.latLng(coord), triggered: false });
      }
    }

    this.map.fitBounds(this.routePolyline.getBounds(), { padding: [50, 50] });
  },

  updateAmbulanceLocation(lat, lng) {
    const pos = [lat, lng];
    if (this.ambMarker) {
      this.ambMarker.setLatLng(pos);
      this.map.panTo(pos, { animate: true, duration: 1.5 });
    }
    const coordsEl = document.getElementById('live-coords');
    if (coordsEl) coordsEl.innerText = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

    // Feature 3: Dynamic Distance to Congestion
    const distEl = document.getElementById('dist-to-jam');
    if (distEl) {
      if (this.trafficStartCoord) {
        const dist = L.latLng(lat, lng).distanceTo(L.latLng(this.trafficStartCoord[0], this.trafficStartCoord[1]));
        const distRounded = Math.round(dist);
        distEl.innerText = `${distRounded}m`;
        
        distEl.className = 'value mono'; // reset
        if (distRounded > 500) distEl.classList.add('text-red');
        else if (distRounded > 200) distEl.classList.add('text-amber');
        else distEl.classList.add('text-green');
      } else if (distEl.innerText !== 'CLEARED' && distEl.innerText !== 'NO JAM') {
        distEl.innerText = 'NO JAM';
        distEl.className = 'value mono text-gray';
      }
    }

    // V2X Preemption Check
    const ambLatLng = L.latLng(lat, lng);
    this.trafficLightNodes.forEach(node => {
      if (!node.triggered && ambLatLng.distanceTo(node.latlng) < 300) {
        node.triggered = true;
        // Turn light green
        const greenIcon = L.divIcon({
          className: 'custom-div-icon',
          html: `<div class="tl-box green-active"><div class="tl-bulb tl-red"></div><div class="tl-bulb tl-yellow"></div><div class="tl-bulb tl-green"></div></div>`,
          iconSize: [12, 28], iconAnchor: [6, 14]
        });
        node.marker.setIcon(greenIcon);
        // Dispatch ripple signal
        this.triggerRipple([node.latlng.lat, node.latlng.lng], '#0ea5e9', 300);
        
        if (typeof showTacticalToast === 'function') {
          showTacticalToast('<i class="fa-solid fa-satellite-dish"></i> V2X PREEMPTION: INTERSECTION CLEARED AHEAD', 'info');
        }
      }
    });
  },

  resetGhostTracking() {
    if (this.isGhosting) {
      this.isGhosting = false;
      this.ghostIndex = -1;
      
      // Restore standard blue icon
      const ambIcon = L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background:var(--neon-blue);width:16px;height:16px;border-radius:50%;box-shadow:0 0 20px 5px var(--neon-blue-glow);border:2px solid #fff;"></div>`,
        iconSize: [16, 16], iconAnchor: [8, 8]
      });
      if (this.ambMarker) this.ambMarker.setIcon(ambIcon);
      
      const el = document.getElementById('emergency-status');
      if (el && el.innerText.includes('SIGNAL LOST')) { 
        el.innerText = 'ONLINE'; el.className = 'stat-value text-blue'; 
      }
    }
  },

  ghostTrackAmbulance(routeCoords) {
    if (!this.ambMarker || !routeCoords || routeCoords.length === 0) return;
    
    if (!this.isGhosting) {
      this.isGhosting = true;
      const el = document.getElementById('emergency-status');
      if (el) { el.innerText = 'SIGNAL LOST (GHOSTING)'; el.className = 'stat-value text-amber blink-text'; }
      if (typeof showTacticalToast === 'function') {
        showTacticalToast('<i class="fa-solid fa-satellite-slash"></i> SIGNAL LOST. EXTRAPOLATING ROUTE...', 'danger');
      }
      
      // Switch icon to ghost style
      const ghostIcon = L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background:var(--neon-amber);width:16px;height:16px;border-radius:50%;box-shadow:0 0 10px rgba(245,158,11,0.5);border:2px dashed #fff; opacity:0.8;"></div>`,
        iconSize: [16, 16], iconAnchor: [8, 8]
      });
      this.ambMarker.setIcon(ghostIcon);

      // Find nearest point on route to start ghosting from
      const currentLoc = this.ambMarker.getLatLng();
      let minDist = Infinity;
      let minIdx = 0;
      for (let i = 0; i < routeCoords.length; i++) {
        const dist = currentLoc.distanceTo(L.latLng(routeCoords[i]));
        if (dist < minDist) { minDist = dist; minIdx = i; }
      }
      this.ghostIndex = minIdx;
    }

    // Advance ghost marker (incrementing by 1 node per cycle to match typical ambulance speed)
    if (this.ghostIndex < routeCoords.length - 1) {
      this.ghostIndex += 1;
      const pos = routeCoords[this.ghostIndex];
      this.ambMarker.setLatLng(pos);
      
      // Pan occasionally
      if (this.ghostIndex % 4 === 0) {
        this.map.panTo(pos, { animate: true, duration: 1.5 });
      }
      
      const coordsEl = document.getElementById('live-coords');
      if (coordsEl) coordsEl.innerText = `${pos[0].toFixed(4)}, ${pos[1].toFixed(4)} (EST)`;
    }
  },

  // =============================================
  // Highlight traffic congestion on police map
  // =============================================
  showTrafficCongestion(trafficCoords) {
    if (!trafficCoords || trafficCoords.length === 0) return;

    // Remove previous if any
    if (this.trafficLayer) {
      this.map.removeLayer(this.trafficLayer);
    }

    this.trafficStartCoord = trafficCoords[0];

    this.trafficLayer = L.polyline(trafficCoords, {
      color: '#ff2030',
      weight: 8,
      opacity: 0.9,
      lineJoin: 'round'
    }).addTo(this.map);

    // Pan to the congestion
    this.map.panTo(trafficCoords[0], { animate: true, duration: 1 });

    // Ripple at congestion start
    this.triggerRipple(trafficCoords[0], '#ff2030', 1200);
  },

  // =============================================
  // Dispatch animation: police units rush to zone
  // =============================================
  animateDispatch(trafficCoords) {
    if (!trafficCoords || trafficCoords.length === 0) return;

    // Target = middle of congestion zone
    const targetIndex = Math.floor(trafficCoords.length / 2);
    const target = trafficCoords[targetIndex];

    // Spawn 2 police unit markers from offset positions
    const offsets = [
      [target[0] - 0.005, target[1] - 0.005],
      [target[0] + 0.004, target[1] - 0.003]
    ];

    offsets.forEach((start, i) => {
      const policeIcon = L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background:#ffc107;width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 0 12px rgba(255,193,7,0.8);"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });
      const m = L.marker(start, { icon: policeIcon }).addTo(this.map);
      this.policeUnitMarkers.push(m);

      // Animate movement toward target over time
      let steps = 20;
      let step = 0;
      const latStep = (target[0] - start[0]) / steps;
      const lngStep = (target[1] - start[1]) / steps;
      const anim = setInterval(() => {
        step++;
        const newLat = start[0] + latStep * step;
        const newLng = start[1] + lngStep * step;
        m.setLatLng([newLat, newLng]);
        if (step >= steps) {
          clearInterval(anim);
          // Flash at target
          this.triggerRipple([newLat, newLng], '#ffc107', 600);
        }
      }, 150);
    });

    // Flashing zone on congestion
    const flashCircle = L.circle(target, {
      color: '#ff2030',
      fillColor: '#ff2030',
      fillOpacity: 0.15,
      radius: 200,
      weight: 2,
      dashArray: '5, 10'
    }).addTo(this.map);

    let flashCount = 0;
    const flashInterval = setInterval(() => {
      flashCount++;
      flashCircle.setStyle({ fillOpacity: flashCount % 2 === 0 ? 0.15 : 0.05 });
      if (flashCount > 10) {
        clearInterval(flashInterval);
        this.map.removeLayer(flashCircle);
      }
    }, 500);
  },

  // =============================================
  // Clear traffic visualization
  // =============================================
  clearTraffic() {
    this.trafficStartCoord = null;
    const distEl = document.getElementById('dist-to-jam');
    if (distEl) {
      distEl.innerText = 'CLEARED';
      distEl.className = 'value mono text-blue';
    }

    if (this.trafficLayer) {
      // Transition: RED -> YELLOW -> GREEN -> remove
      this.trafficLayer.setStyle({ color: '#ffc107' });
      setTimeout(() => {
        if (this.trafficLayer) {
          this.trafficLayer.setStyle({ color: '#28c840' });
        }
        setTimeout(() => {
          if (this.trafficLayer) {
            this.map.removeLayer(this.trafficLayer);
            this.trafficLayer = null;
          }
          // Remove police unit markers
          this.policeUnitMarkers.forEach(m => this.map.removeLayer(m));
          this.policeUnitMarkers = [];
        }, 2000);
      }, 1500);
    }
  },

  // Reusable ripple effect
  triggerRipple(latlng, color, maxRadius) {
    const circle = L.circle(latlng, {
      color: color,
      fillColor: color,
      fillOpacity: 0.2,
      radius: 50
    }).addTo(this.map);

    let r = 50;
    const anim = setInterval(() => {
      r += 20;
      circle.setRadius(r);
      const opacity = Math.max(0, 0.2 - (r / (maxRadius * 5)));
      circle.setStyle({ fillOpacity: opacity, opacity: opacity });
      if (r > maxRadius) {
        clearInterval(anim);
        this.map.removeLayer(circle);
      }
    }, 50);
  }
};
