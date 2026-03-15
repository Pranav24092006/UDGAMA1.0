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
    console.log(`🚨 TRAFFIC JAM REPORTED: Unit ${ambulanceId} at ${jamPoint.lat}, ${jamPoint.lng}`);
  }
  res.json({ message: "Jam registered" });
});


app.post("/update-location", (req, res) => {
  const { ambulanceId, lat, lng } = req.body;

  if (!ambulanceId || lat === undefined || lng === undefined) {
    return res.status(400).json({
      error: "ambulanceId, lat and lng are required",
    });
  }

  if (!activeAmbulances[ambulanceId]) {
    activeAmbulances[ambulanceId] = {
      ambulanceId,
      destinationHospital: "Unknown",
      location: { lat, lng },
      status: "ACTIVE",
      updatedAt: new Date().toISOString(),
    };
  } else {
    activeAmbulances[ambulanceId].location = { lat, lng };
    activeAmbulances[ambulanceId].updatedAt = new Date().toISOString();
  }

  console.log(
    `📍 Location update: ${ambulanceId} → (${lat}, ${lng})`
  );

  res.json({
    message: "Location updated successfully",
    ambulance: activeAmbulances[ambulanceId],
  });
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

  res.json(Object.values(activeAmbulances));
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
