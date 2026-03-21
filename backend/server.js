const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Redirects to ensure trailing slashes so relative CSS/JS paths work perfectly on Render
app.use((req, res, next) => {
  if (req.path === '/ambulance') return res.redirect('/ambulance/');
  if (req.path === '/police') return res.redirect('/police/');
  next();
});

// Serve frontend files over HTTP (so GPS works in browser)
app.use('/ambulance', express.static(path.join(__dirname, '../ambulance-interface')));
app.use('/police',    express.static(path.join(__dirname, '../police-dashboard')));

// -------------------------------
// Root Route (Prevents "Cannot GET /")
// -------------------------------
app.get("/", (req, res) => {
  res.send("🚑 Smart Ambulance Coordination Backend is Running");
});

// -------------------------------
// In-memory storage (No DB needed)
// -------------------------------
const activeAmbulances = {};

// -------------------------------
// Start Emergency
// -------------------------------
app.post("/start-emergency", (req, res) => {
  const { ambulanceId, destinationHospital } = req.body;

  if (!ambulanceId || !destinationHospital) {
    return res.status(400).json({
      error: "ambulanceId and destinationHospital are required",
    });
  }

  activeAmbulances[ambulanceId] = {
    ambulanceId,
    destinationHospital,
    location: null,
    route: [],        // full road waypoints stored here
    jam: null,        // reported traffic jam coordinate {lat, lng}
    status: "EMERGENCY",
    startedAt: new Date().toISOString(),
  };

  console.log(
    `🚑 Emergency started: Ambulance ${ambulanceId} → ${destinationHospital}`
  );

  res.json({
    message: "Emergency started successfully",
    ambulance: activeAmbulances[ambulanceId],
  });
});

// -------------------------------
// Store Full Road Route
// -------------------------------
app.post("/store-route", (req, res) => {
  const { ambulanceId, route } = req.body;
  if (!ambulanceId || !Array.isArray(route)) {
    return res.status(400).json({ error: "req missing" });
  }
  if (activeAmbulances[ambulanceId]) {
    activeAmbulances[ambulanceId].route = route;
  }
  res.json({ message: "Route stored" });
});

// -------------------------------
// Report Traffic Jam
// -------------------------------
app.post("/report-jam", (req, res) => {
  const { ambulanceId, jamPoint } = req.body;
  if (activeAmbulances[ambulanceId]) {
    activeAmbulances[ambulanceId].jam = jamPoint;
  }
  res.json({ message: "Jam registered" });
});

// -------------------------------
// Tactical Button Actions
// -------------------------------
app.post("/manual-clear", (req, res) => {
  const { ambulanceId } = req.body;
  if (activeAmbulances[ambulanceId]) {
    activeAmbulances[ambulanceId].tacticalAction = "MANUAL_CLEAR";
    console.log(`✅ Manual route clear ordered for: ${ambulanceId}`);
  }
  res.json({ message: "Manual clear ordered" });
});

app.post("/block-intersection", (req, res) => {
  const { ambulanceId } = req.body;
  if (activeAmbulances[ambulanceId]) {
    activeAmbulances[ambulanceId].tacticalAction = "INTERSECTION_BLOCKED";
    console.log(`🚧 Intersection blocked for: ${ambulanceId}`);
  }
  res.json({ message: "Intersection blocked" });
});

app.post("/alert-units", (req, res) => {
  const { ambulanceId } = req.body;
  if (activeAmbulances[ambulanceId]) {
    activeAmbulances[ambulanceId].tacticalAction = "UNITS_ALERTED";
    console.log(`📢 Nearby units alerted for: ${ambulanceId}`);
  }
  res.json({ message: "Units alerted" });
});

// Acknowledge (clear) the tactical action after ambulance reads it
app.post("/ack-tactical", (req, res) => {
  const { ambulanceId } = req.body;
  if (activeAmbulances[ambulanceId]) {
    activeAmbulances[ambulanceId].tacticalAction = null;
  }
  res.json({ message: "Acknowledged" });
});


app.post("/update-location", (req, res) => {
  const { ambulanceId, lat, lng, eta, signals } = req.body;

  if (!ambulanceId || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  if (!activeAmbulances[ambulanceId]) {
    activeAmbulances[ambulanceId] = {
      ambulanceId,
      destinationHospital: "Unknown",
      location: { lat, lng },
      eta: eta || "N/A",
      signals: signals || [],
      status: "ACTIVE",
      jam: null,
      updatedAt: new Date().toISOString(),
    };
  } else {
    activeAmbulances[ambulanceId].location = { lat, lng };
    if (eta) activeAmbulances[ambulanceId].eta = eta;
    if (signals) activeAmbulances[ambulanceId].signals = signals;
    activeAmbulances[ambulanceId].updatedAt = new Date().toISOString();
  }

  res.json({ message: "Location updated", ambulance: activeAmbulances[ambulanceId] });
});

// -------------------------------
// Dispatch Police & Clear Route
// -------------------------------
app.post("/dispatch-police", (req, res) => {
  const { ambulanceId } = req.body;
  if (activeAmbulances[ambulanceId]) {
    activeAmbulances[ambulanceId].status = "DISPATCHED";
  }
  res.json({ message: "Police dispatched" });
});

app.post("/clear-route", (req, res) => {
  const { ambulanceId } = req.body;
  if (activeAmbulances[ambulanceId]) {
    activeAmbulances[ambulanceId].status = "CLEARED";
    activeAmbulances[ambulanceId].jam = null;
  }
  res.json({ message: "Route cleared" });
});

// -------------------------------
// Get Ambulance Location
// -------------------------------
app.get("/ambulance-location", (req, res) => {
  const { ambulanceId } = req.query;

  if (ambulanceId) {
    const ambulance = activeAmbulances[ambulanceId];

    if (!ambulance) {
      return res.status(404).json({
        error: "Ambulance not found",
      });
    }

    return res.json(ambulance);
  }

  res.json(Object.values(activeAmbulances).sort((a, b) => {
    const timeA = new Date(a.updatedAt || a.startedAt || 0).getTime();
    const timeB = new Date(b.updatedAt || b.startedAt || 0).getTime();
    return timeB - timeA;
  }));
});

// -------------------------------
// Health Check Route
// -------------------------------
app.get("/health", (req, res) => {
  res.json({
    status: "Server Running",
    activeAmbulances: Object.keys(activeAmbulances).length,
  });
});

// -------------------------------
// 404 Handler (Prevents Confusion)
// -------------------------------
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
  });
});

// -------------------------------
// Start Server
// -------------------------------
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Smart Ambulance API running on port ${PORT}`);
});
