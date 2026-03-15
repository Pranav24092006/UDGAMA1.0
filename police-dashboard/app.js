// ============================================================
// Police Dispatch Dashboard - app.js
// Map: Leaflet.js | Real location via browser GPS
// Backend Auth: uses API_KEY in all fetch headers
// ============================================================

const BACKEND_URL = 'http://localhost:5000';
const POLL_INTERVAL = 5000;
const API_KEY = 'a3f57487332515c5d7550721286de53a'; // Backend security token

// DOM Elements
const statusIndicator   = document.getElementById('connection-status');
const activeCountEl     = document.getElementById('active-count');
const idleCountEl       = document.getElementById('idle-count');
const unitListContainer = document.getElementById('ambulance-list');
const simToggle         = document.getElementById('sim-route-toggle');
const trafficAlertPanel = document.getElementById('traffic-alert');
const jamDetailsText    = document.getElementById('jam-details');
const clearJamBtn       = document.getElementById('clear-jam-btn');

// State
let map;
let mapMarkers      = new Map();
let simulatedRoutes = new Map();
let activeJams      = new Set();

// Event to manually dismiss banner
clearJamBtn.addEventListener('click', () => {
    trafficAlertPanel.classList.add('hidden');
});

// ─── Boot: get GPS first, then build map ─────────────────────
function initMap() {
    if (!navigator.geolocation) {
        bootMap(13.0878, 80.2785); // fallback
        return;
    }
    navigator.geolocation.getCurrentPosition(
        pos => bootMap(pos.coords.latitude, pos.coords.longitude),
        ()  => bootMap(13.0878, 80.2785),  // GPS blocked fallback (Chennai)
        { enableHighAccuracy: true, timeout: 8000 }
    );
}

function bootMap(lat, lng) {
    map = L.map('map').setView([lat, lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);

    // Start polling after map is ready
    fetchAmbulanceLocations();
    setInterval(() => {
        if (document.hidden) return; // eco-mode
        fetchAmbulanceLocations();
    }, POLL_INTERVAL);
}

// ─── Core: Fetch ambulance data from backend ──────────────────
async function fetchAmbulanceLocations() {
    try {
        const res = await fetch(`${BACKEND_URL}/ambulance-location`, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'x-api-key': API_KEY
            }
        });
        if (!res.ok) throw new Error('API Error');

        const data = await res.json();
        statusIndicator.className = 'status connected';
        statusIndicator.querySelector('.text').textContent = 'API Online';
        processDashboardData(data);

    } catch {
        statusIndicator.className = 'status error';
        statusIndicator.querySelector('.text').textContent = 'API Offline';
    }
}

// ─── Process JSON → sidebar + map ────────────────────────────
function processDashboardData(ambulances) {
    let emergencyCount = 0, idleCount = 0;
    unitListContainer.innerHTML = '';

    if (!ambulances.length) {
        unitListContainer.innerHTML = '<li class="empty-state">No units currently being tracked.</li>';
        activeCountEl.textContent = '0';
        idleCountEl.textContent   = '0';
        return;
    }

    ambulances.sort((a, b) => {
        if (a.status === 'EMERGENCY' && b.status !== 'EMERGENCY') return -1;
        if (b.status === 'EMERGENCY' && a.status !== 'EMERGENCY') return 1;
        return new Date(b.updatedAt) - new Date(a.updatedAt);
    });

    ambulances.forEach(unit => {
        if (!unit.location) return;

        const isEmergency = unit.status === 'EMERGENCY';
        isEmergency ? emergencyCount++ : idleCount++;

        const li = document.createElement('li');
        li.className = `list-item ${isEmergency ? 'emergency' : 'active'}`;
        li.innerHTML = `
            <div class="item-header">
                <span class="item-name">🚑 ${unit.ambulanceId}</span>
                <span class="item-badge ${isEmergency ? 'badge-emergency' : 'badge-active'}">${unit.status}</span>
            </div>
            <div class="item-dest">📍 ${unit.destinationHospital}</div>
            <div class="item-coords">LOC: [${unit.location.lat.toFixed(4)}, ${unit.location.lng.toFixed(4)}]</div>
        `;
        li.addEventListener('click', () => map.setView([unit.location.lat, unit.location.lng], 16, { animate: true }));
        unitListContainer.appendChild(li);

        updateMapElements(unit);
    });

    activeCountEl.textContent = emergencyCount;
    idleCountEl.textContent   = idleCount;
}

// ─── Map marker builder ───────────────────────────────────────
function buildIcon(isEmergency) {
    return L.divIcon({
        className: '',
        html: `<div style="position:relative;width:40px;height:40px;">
            <div class="map-pulse ${isEmergency ? 'pulse-red' : 'pulse-blue'}"></div>
            <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:22px;text-shadow:0 2px 4px rgba(0,0,0,.4);">🚑</div>
        </div>`,
        iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -22]
    });
}

function updateMapElements(unit) {
    const { ambulanceId: id, location, status, destinationHospital } = unit;
    const isEmergency = status === 'EMERGENCY';
    const latlng = [location.lat, location.lng];

    const popupHtml = `
        <div style="text-align:center;">
            <h4 style="margin:0 0 4px;font-size:14px;">${id}</h4>
            <span style="background:${isEmergency ? '#fee2e2':'#dbeafe'};color:${isEmergency ? '#991b1b':'#1e40af'};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">${status}</span>
            <p style="margin:6px 0 0;font-size:12px;"><b>Dest:</b> ${destinationHospital}</p>
        </div>`;

    // A. Ambulance marker
    if (mapMarkers.has(id)) {
        const marker = mapMarkers.get(id);
        marker.setLatLng(latlng);
        marker.setIcon(buildIcon(isEmergency));
        marker.setPopupContent(popupHtml);
    } else {
        const marker = L.marker(latlng, { icon: buildIcon(isEmergency) }).addTo(map);
        marker.bindPopup(popupHtml);
        mapMarkers.set(id, marker);
        simulatedRoutes.set(id, {
            points: [latlng],     
            trailLine: null,      
            fullRouteLine: null,  
            jamMarker: null
        });
        if (mapMarkers.size === 1) map.setView(latlng, 14);
    }

    // B. Trail of visited positions
    const rd = simulatedRoutes.get(id);
    const last = rd.points[rd.points.length - 1];
    if (last[0] !== latlng[0] || last[1] !== latlng[1]) {
        rd.points.push(latlng);
        if (rd.points.length > 200) rd.points.shift();
    }

    const trailColor = isEmergency ? '#ef4444' : '#3b82f6';
    if (simToggle.checked) {
        if (!rd.trailLine) {
            rd.trailLine = L.polyline(rd.points, {
                color: trailColor, weight: 4, opacity: 0.85
            }).addTo(map);
        } else {
            rd.trailLine.setLatLngs(rd.points);
            rd.trailLine.setStyle({ color: trailColor });
        }
    } else if (rd.trailLine) {
        map.removeLayer(rd.trailLine);
        rd.trailLine = null;
    }

    // C. Full planned route from backend (drawn once per unit, updated if route changes)
    if (unit.route && unit.route.length > 1) {
        const fullPath = unit.route.map(wp => [wp.lat, wp.lng]);
        if (!rd.fullRouteLine) {
            rd.fullRouteLine = L.polyline(fullPath, {
                color: '#94a3b8',      // light grey — "planned ahead" route
                weight: 3,
                opacity: 0.6,
                dashArray: '6, 6'
            }).addTo(map);
        } else {
            rd.fullRouteLine.setLatLngs(fullPath);
        }
    }

    // D. Traffic Jam Handling
    if (unit.jam && isEmergency) {
        // Show banner if new jam
        if (!activeJams.has(id)) {
            activeJams.add(id);
            trafficAlertPanel.classList.remove('hidden');
            jamDetailsText.textContent = `Ambulance ${id} hit a traffic block on the route to ${unit.destinationHospital}.`;
        }
        
        // Draw map marker
        if (!rd.jamMarker) {
            rd.jamMarker = L.marker([unit.jam.lat, unit.jam.lng], {
                icon: L.divIcon({
                    className: '',
                    html: '<div style="font-size:28px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));">⚠️</div>',
                    iconSize: [30, 30], iconAnchor: [15, 15]
                })
            }).addTo(map);
            rd.jamMarker.bindPopup(`<b>Traffic Block</b><br>Affecting Unit: ${id}`);
        }
    } else if (!unit.jam && activeJams.has(id)) {
        activeJams.delete(id);
        if (rd.jamMarker) {
            map.removeLayer(rd.jamMarker);
            rd.jamMarker = null;
        }
        if (activeJams.size === 0) trafficAlertPanel.classList.add('hidden');
    }
}


// ─── Toggle listener ──────────────────────────────────────────
simToggle.addEventListener('change', () => {
    simulatedRoutes.forEach(rd => {
        if (!simToggle.checked && rd.lineStr) { map.removeLayer(rd.lineStr); rd.lineStr = null; }
    });
    if (simToggle.checked) fetchAmbulanceLocations();
});

// ─── Boot ──────────────────────────────────────────────────────
initMap();
