// ==========================================================================
// Map & Routing Module (Leaflet + OSRM)
// ==========================================================================

const MapManager = {
  map: null,
  marker: null,
  routePolyline: null,
  hospitalMarker: null,
  
  // Coordinates for Demo (e.g., somewhere in a city)
  startCoord: [12.9716, 77.5946], // Bangalore center example
  hospitalCoord: [12.9850, 77.6050],
  
  initMap() {
    if (this.map) return; // Prevent double initialization

    // Initialize Leaflet Map
    this.map = L.map('map', {
      zoomControl: false // We repositioned it via CSS, but let's add custom one
    }).setView(this.startCoord, 14);

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    // Dark theme map tiles (CartoDB Dark Matter)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors & CartoDB',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(this.map);

    // Custom Ambulance Icon
    const ambIcon = L.divIcon({
      className: 'custom-div-icon',
      html: `<div style="background:var(--accent-red); width:20px; height:20px; border-radius:50%; border:3px solid white; box-shadow:0 0 15px rgba(255,59,48,0.8); display:flex; justify-content:center; align-items:center;"><i class="fa-solid fa-truck-medical" style="color:white; font-size:10px;"></i></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    this.marker = L.marker(this.startCoord, { icon: ambIcon }).addTo(this.map);

    // Custom Hospital Icon
    const hospitalIcon = L.divIcon({
      className: 'custom-div-icon',
      html: `<div style="background:var(--accent-blue); width:24px; height:24px; border-radius:8px; border:2px solid white; box-shadow:0 0 15px rgba(10,132,255,0.8); display:flex; justify-content:center; align-items:center;"><i class="fa-solid fa-square-h" style="color:white; font-size:14px;"></i></div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    this.hospitalMarker = L.marker(this.hospitalCoord, { icon: hospitalIcon }).addTo(this.map);

    // Fetch and draw route
    this.fetchRoute();
  },

  async fetchRoute() {
    // Generate route between start and hospital using OSRM
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${this.startCoord[1]},${this.startCoord[0]};${this.hospitalCoord[1]},${this.hospitalCoord[0]}?overview=full&geometries=geojson`;
    
    try {
      const response = await fetch(osrmUrl);
      const data = await response.json();
      
      if (data.code === 'Ok' && data.routes.length > 0) {
        const route = data.routes[0];
        const coordinates = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);
        
        // Draw Polyline
        this.routePolyline = L.polyline(coordinates, {
          color: 'var(--accent-blue)',
          weight: 5,
          opacity: 0.8,
          lineJoin: 'round',
          dashArray: '10, 10',
          className: 'route-line-anim'
        }).addTo(this.map);

        // Fit map bounds to show full route instantly, then zoom in later if needed
        this.map.fitBounds(this.routePolyline.getBounds(), { padding: [50, 50] });

        // Update ETA Display based on OSRM duration (seconds) -> minutes
        const durationMin = Math.ceil(route.duration / 60);
        const etaElement = document.getElementById('display-eta');
        if(etaElement) {
          etaElement.innerText = `${durationMin < 10 ? '0'+durationMin : durationMin} Min`;
        }
        
        // Voice Navigation initial announcement
        setTimeout(() => {
          VoiceNav.speak(`Emergency route generated. Estimated time of arrival is ${durationMin} minutes. Proceed to City General Hospital.`);
        }, 1500);

        // Simulate movement along the route
        this.simulateMovement(coordinates);
      }
    } catch (error) {
      console.error('Error fetching OSRM route:', error);
      showToast('Routing Error: Unable to fetch live path.', 'error');
    }
  },

  simulateMovement(coordinates) {
    let index = 0;
    const interval = setInterval(() => {
      if (index >= coordinates.length) {
        clearInterval(interval);
        VoiceNav.speak("You have arrived at your destination.");
        showToast("Destination Reached", "success");
        return;
      }
      const position = coordinates[index];
      this.marker.setLatLng(position);
      // Pan map smoothly occasionally
      if (index % 5 === 0) {
        this.map.panTo(position, { animate: true, duration: 2 });
      }
      
      // Update location UI string mock
      document.getElementById('display-location').innerText = `Lat: ${position[0].toFixed(4)}, Lng: ${position[1].toFixed(4)}`;

      index++;
    }, 1500); // Move every 1.5s
  }
};
