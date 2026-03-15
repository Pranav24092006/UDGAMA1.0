// ============================================================
// Smart Ambulance Interface - app.js
// Map: Leaflet.js | Routing: OSRM (free road routes, no API key)
// Hospitals: OpenStreetMap Overpass API
// Backend Auth: API_KEY in all fetch headers
// ============================================================

const BACKEND_URL = 'http://localhost:5000';
const API_KEY     = 'a3f57487332515c5d7550721286de53a';
const MAX_RADIUS_KM  = 50;
const MOVE_INTERVAL  = 1200; // ms between each step (much faster now)

// Global State
let currentAmbulanceId = '';
let currentHospital    = null;
let currentPos         = null;        // real GPS starting position
let routeWaypoints     = [];          // OSRM road waypoints array
let waypointIndex      = 0;           // current position in waypoints
let locationInterval   = null;
let map = null, myMarker = null, hospMarker = null, routeLine = null;

// DOM refs
const startFormCard   = document.getElementById('start-form');
const activeDashboard = document.getElementById('active-dashboard');
const statusDisplay   = document.getElementById('status-display');
const statusText      = statusDisplay.querySelector('.text');
const pulseRing       = document.getElementById('recording-pulse');
const errorMsg        = document.getElementById('error-msg');
const inputId         = document.getElementById('ambulance-id');
const startBtn        = document.getElementById('start-btn');
const displayHospital = document.getElementById('display-hospital');
const latVal          = document.getElementById('lat-val');
const lngVal          = document.getElementById('lng-val');
const aiText          = document.getElementById('ai-text');

// Button events
startBtn.addEventListener('click', startEmergency);
document.getElementById('stop-btn').addEventListener('click', stopEmergency);
document.getElementById('test-voice-btn').addEventListener('click', () =>
    speakInstruction("Test successful. AI navigation voice active."));

// ── Helpers ───────────────────────────────────────────────────
function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.remove('hidden');
    setTimeout(() => errorMsg.classList.add('hidden'), 6000);
}

function calcDist(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 +
        Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
        Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── Step 1: Get GPS, then build map ──────────────────────────
function initApp() {
    startBtn.disabled = true;
    startBtn.textContent = '📡 Getting your location...';

    if (!navigator.geolocation) {
        showError("Geolocation not supported by this browser.");
        return;
    }
    navigator.geolocation.getCurrentPosition(
        pos => onGpsSuccess(pos.coords.latitude, pos.coords.longitude),
        ()  => showError("❌ GPS denied. Allow location permission and refresh."),
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

function onGpsSuccess(lat, lng) {
    currentPos = { lat, lng };

    map = L.map('map').setView([lat, lng], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
    }).addTo(map);

    placeAmbuMarker(lat, lng, false);
    startBtn.textContent = '🏥 Finding nearby hospitals...';
    fetchNearbyHospitals(lat, lng);
}

// ── Overpass helper ───────────────────────────────────────────
async function runOverpassQuery(query) {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST', body: query
    });
    const data = await res.json();
    return data.elements
        .filter(el => el.tags && el.tags.name)
        .map(el => ({
            name: el.tags.name,
            lat:  el.lat  ?? el.center?.lat,
            lng:  el.lon  ?? el.center?.lon,
            emergency: el.tags.emergency === 'yes'
        }))
        .filter(h => h.lat && h.lng);
}

// ── Step 2: Fetch real MAJOR hospitals ────────────────────────
async function fetchNearbyHospitals(lat, lng) {
    const radiusMeters = MAX_RADIUS_KM * 1000;

    const queryEmergency = `[out:json][timeout:20];
        (
          node["amenity"="hospital"]["emergency"="yes"](around:${radiusMeters},${lat},${lng});
          way["amenity"="hospital"]["emergency"="yes"](around:${radiusMeters},${lat},${lng});
        );out center;`;

    const queryGeneral = `[out:json][timeout:20];
        (
          way["amenity"="hospital"]["healthcare"!="clinic"](around:${radiusMeters},${lat},${lng});
        );out center;`;

    try {
        let hospitals = await runOverpassQuery(queryEmergency);
        if (!hospitals.length) {
            hospitals = await runOverpassQuery(queryGeneral);
        }

        if (!hospitals.length) {
            showError("No major hospitals found within 50 km.");
            startBtn.textContent = "No Hospitals Found";
            return;
        }

        let nearest = hospitals[0];
        let minDist = calcDist(lat, lng, nearest.lat, nearest.lng);
        hospitals.forEach(h => {
            const d = calcDist(lat, lng, h.lat, h.lng);
            if (d < minDist) { minDist = d; nearest = h; }
        });

        currentHospital = nearest;
        startBtn.disabled = false;
        startBtn.textContent = `🚨 Start Emergency → ${currentHospital.name} (${minDist.toFixed(1)} km)`;

    } catch (err) {
        showError("Failed to load hospitals. Check internet connection.");
        startBtn.textContent = "Retry — reload page";
        console.error(err);
    }
}

// ── Step 3: Fetch REAL ROAD route from OSRM (finding the WORST route) ──
async function fetchRoadRoute(fromLat, fromLng, toLat, toLng) {
    // Request true alternatives AND steps to get turn-by-turn voice directions
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson&alternatives=true&steps=true`;
    try {
        const res  = await fetch(url);
        const data = await res.json();

        if (data.code !== 'Ok' || !data.routes.length) {
            throw new Error("OSRM returned no route");
        }

        // Find the worst possible route (longest duration)
        let worstRoute = data.routes[0];
        data.routes.forEach(r => {
            if (r.duration > worstRoute.duration) worstRoute = r;
        });

        console.log(`Picked worst route: ${(worstRoute.distance/1000).toFixed(1)}km, ${(worstRoute.duration/60).toFixed(1)}mins`);

        // GeoJSON coordinates are [lng, lat] — flip to [lat, lng] for Leaflet
        const coords = worstRoute.geometry.coordinates;
        
        let waypoints = coords.map((c, i) => ({ lat: c[1], lng: c[0], index: i, instruction: null }));
        
        // Map turn-by-turn instructions to specific waypoint indices
        if (worstRoute.legs && worstRoute.legs[0] && worstRoute.legs[0].steps) {
            let waypointCounter = 0;
            worstRoute.legs[0].steps.forEach(step => {
                if (step.maneuver && step.maneuver.instruction && waypoints[waypointCounter]) {
                    // E.g. "Turn right onto Main St"
                    waypoints[waypointCounter].instruction = step.maneuver.instruction;
                }
                // Advance the index by how many coordinates make up this step
                if (step.geometry && step.geometry.coordinates) {
                   waypointCounter += step.geometry.coordinates.length;
                }
            });
        }
        
        // Inject a simulated traffic jam halfway through the route
        const jamIndex = Math.floor(waypoints.length * 0.4);
        
        // Trigger a backend traffic jam alert for police dashboard to see
        fetch(`${BACKEND_URL}/report-jam`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}`, 'x-api-key': API_KEY },
            body: JSON.stringify({
                ambulanceId: currentAmbulanceId || inputId.value.trim(),
                jamPoint: waypoints[jamIndex]
            })
        }).catch(e => console.warn("Failed to report traffic jam"));

        return waypoints;

    } catch (e) {
        console.warn("OSRM routing failed, using straight line:", e);
        // Fallback: generate intermediate straight-line waypoints
        const steps = 30;
        const waypoints = [];
        for (let i = 0; i <= steps; i++) {
            waypoints.push({
                lat: fromLat + (toLat - fromLat) * (i / steps),
                lng: fromLng + (toLng - fromLng) * (i / steps)
            });
        }
        return waypoints;
    }
}

// ── Map marker helpers ────────────────────────────────────────
function makeIcon(emoji, pulse) {
    return L.divIcon({
        className: '',
        html: `<div style="position:relative;width:40px;height:40px;">
            ${pulse ? '<div class="lf-pulse"></div>' : ''}
            <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:24px;text-shadow:0 2px 4px rgba(0,0,0,.3);">${emoji}</div>
        </div>`,
        iconSize: [40, 40], iconAnchor: [20, 20]
    });
}

function placeAmbuMarker(lat, lng, active) {
    if (myMarker) {
        myMarker.setLatLng([lat, lng]);
        myMarker.setIcon(makeIcon('🚑', active));
    } else {
        myMarker = L.marker([lat, lng], { icon: makeIcon('🚑', active) }).addTo(map);
    }
}

// ── Start Emergency ───────────────────────────────────────────
async function startEmergency() {
    const ambId = inputId.value.trim();
    if (!ambId) { showError("Please enter Ambulance ID."); return; }

    startBtn.disabled = true;
    startBtn.textContent = '🗺️ Calculating road route...';

    try {
        // 1. Register emergency with backend
        const res = await fetch(`${BACKEND_URL}/start-emergency`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`,
                'x-api-key': API_KEY
            },
            body: JSON.stringify({
                ambulanceId: ambId,
                destinationHospital: currentHospital.name
            })
        });
        if (!res.ok) throw new Error("Backend error");

        // 2. Fetch real road waypoints from OSRM
        routeWaypoints = await fetchRoadRoute(
            currentPos.lat, currentPos.lng,
            currentHospital.lat, currentHospital.lng
        );
        waypointIndex = 0;

        // 2b. Push full route to backend so police dashboard can draw it
        fetch(`${BACKEND_URL}/store-route`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`,
                'x-api-key': API_KEY
            },
            body: JSON.stringify({ ambulanceId: ambId, route: routeWaypoints })
        }).catch(e => console.warn("Route store failed:", e));

        // 3. Draw the actual road route on map
        drawOsrmRoute(routeWaypoints);

        // 4. Place hospital marker
        currentAmbulanceId = ambId;
        displayHospital.textContent = currentHospital.name;
        statusDisplay.className = 'status emergency';
        statusText.textContent   = 'EMERGENCY ACTIVE';
        pulseRing.style.display  = 'block';

        startFormCard.classList.add('hidden');
        activeDashboard.classList.remove('hidden');

        if (!hospMarker) {
            hospMarker = L.marker([currentHospital.lat, currentHospital.lng], {
                icon: makeIcon('🏥', false)
            }).addTo(map);
            hospMarker.bindPopup(`<b>${currentHospital.name}</b><br/>Destination`).openPopup();
        }

        // 5. Fit map to show full route
        map.fitBounds(routeLine.getBounds().pad(0.15));

        speakInstruction(`Emergency dispatched. Road route calculated to ${currentHospital.name}.`);

        // 6. Start moving along waypoints
        moveAlongRoute();
        locationInterval = setInterval(moveAlongRoute, MOVE_INTERVAL);

    } catch (e) {
        showError("Connection failed. Is the backend running at port 5000?");
        startBtn.disabled = false;
        startBtn.textContent = `🚨 Start Emergency → ${currentHospital.name}`;
        console.error(e);
    }
}

// ── Draw OSRM road route on map ───────────────────────────────
function drawOsrmRoute(waypoints) {
    const latlngs = waypoints.map(w => [w.lat, w.lng]);

    if (routeLine) {
        routeLine.setLatLngs(latlngs);
    } else {
        routeLine = L.polyline(latlngs, {
            color: '#3b82f6',
            weight: 5,
            opacity: 0.75,
            dashArray: '10, 8'
        }).addTo(map);
    }
}

// ── Move ambulance along road waypoints ───────────────────────
async function moveAlongRoute() {
    if (!routeWaypoints.length) return;

    // Clamp index at the last waypoint (destination)
    if (waypointIndex >= routeWaypoints.length) {
        waypointIndex = routeWaypoints.length - 1;
        clearInterval(locationInterval);
        speakInstruction("You have arrived at the destination. Emergency Bay reached.");
        return;
    }

    const wp = routeWaypoints[waypointIndex];
    currentPos = { lat: wp.lat, lng: wp.lng };
    waypointIndex++;

    // Update UI only if tab is visible (eco-mode)
    if (!document.hidden) {
        latVal.textContent = wp.lat.toFixed(5);
        lngVal.textContent = wp.lng.toFixed(5);
        placeAmbuMarker(wp.lat, wp.lng, true);
    }

    // Send position to backend (always, even if tab hidden)
    await pushCoordsToBackend(wp.lat, wp.lng);

    // Voice Cues: Speak turn-by-turn navigation if available on this node
    if (wp.instruction) {
        speakInstruction(wp.instruction);
    } 
    // Otherwise fallback to occasional distance remaining updates
    else {
        const distLeft = calcDist(wp.lat, wp.lng, currentHospital.lat, currentHospital.lng);
        if (waypointIndex % 15 === 0) {
            speakInstruction(`Approximately ${(distLeft).toFixed(1)} kilometres remaining.`);
        }
    }
}

// ── Push coords to backend ────────────────────────────────────
async function pushCoordsToBackend(lat, lng) {
    try {
        await fetch(`${BACKEND_URL}/update-location`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`,
                'x-api-key': API_KEY
            },
            body: JSON.stringify({ ambulanceId: currentAmbulanceId, lat, lng })
        });
    } catch (e) {
        console.error("Location push failed:", e);
    }
}

// ── Stop Emergency ────────────────────────────────────────────
function stopEmergency() {
    clearInterval(locationInterval);

    statusDisplay.className = 'status inactive';
    statusText.textContent  = 'INACTIVE';
    pulseRing.style.display = 'none';

    activeDashboard.classList.add('hidden');
    startFormCard.classList.remove('hidden');
    startBtn.disabled = false;
    startBtn.textContent = `🚨 Start Emergency → ${currentHospital?.name ?? '...'}`;
    inputId.value = '';

    routeWaypoints = []; waypointIndex = 0;

    if (routeLine)  { map.removeLayer(routeLine);  routeLine  = null; }
    if (hospMarker) { map.removeLayer(hospMarker); hospMarker = null; }

    placeAmbuMarker(currentPos.lat, currentPos.lng, false);
    speakInstruction("Emergency ended. Tracking stopped.");
}

// ── AI Voice ──────────────────────────────────────────────────
function speakInstruction(text) {
    aiText.textContent = text;
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utt = new SpeechSynthesisUtterance(text);
        utt.rate = 0.95;
        const preferred = window.speechSynthesis.getVoices().find(v => v.lang.startsWith('en'));
        if (preferred) utt.voice = preferred;
        window.speechSynthesis.speak(utt);
    }
}
if (window.speechSynthesis?.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

// Boot
initApp();
