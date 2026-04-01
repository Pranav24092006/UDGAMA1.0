# Smart Ambulance Coordination System 🚑🚓

An intelligent, synchronized dual-interface web application designed to eliminate emergency transit delays by connecting ambulance drivers directly with police traffic dispatchers in real time.

## 🌟 Overview
Emergency medical response often suffers from critical delays caused by unpredictable traffic and communication gaps. The **Smart Ambulance Coordination System** addresses this problem by providing a synchronized platform for ambulance drivers and police dispatchers. 

The system integrates real-time GPS tracking, dynamic hospital discovery (via OpenStreetMap Overpass API), and intelligent route calculation (using OSRM). It allows drivers to follow a voice-navigated optimal route, while police dispatchers monitor the ambulance's live location and clear traffic jams proactively.

## ✨ Key Features
- **Real-Time GPS Polling**: True live ambulance tracking using browser geolocation.
- **Dynamic Hospital Discovery**: Finds the nearest emergency hospitals using OSM Overpass API.
- **Intelligent Road Routing**: Calculates the best emergency route via OSRM.
- **Turn-by-Turn AI Voice Navigation**: Uses the browser's SpeechSynthesis API so drivers can focus on the road.
- **Police Dispatcher Dashboard**: Features instant, flashing traffic jam alerts synced from the active ambulance for proactive road clearance.
- **V2X Traffic Light Preemption**: Simulates automated "Green Corridor" clearing as the ambulance approaches intersections.
- **Cost-Effective System**: Built entirely on free, open-source mapping architecture (Leaflet, OSM, OSRM) instead of expensive enterprise APIs.

## 🛠️ Technology Stack
- **Frontend**: HTML5, Vanilla JavaScript, Vanilla CSS (Modern aesthetic with glassmorphism).
- **Backend**: Node.js, Express.js.
- **Mapping & Routing**: Leaflet.js, OpenStreetMap Overpass API, Project OSRM.
- **Other APIs**: Web Speech API for AI voice navigation.

## 🚀 How to Run Locally

### Prerequisites
- Node.js installed on your machine.

### Installation & Execution
1. Open a terminal and navigate to the project directory.
2. Navigate to the backend folder:
   ```bash
   cd backend
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the server (runs on port 5000 by default):
   ```bash
   node server.js
   ```
   *(Wait for the message: `🚀 Smart Ambulance API running on port 5000`)*

### Access the Interfaces
Because geolocation APIs require a secure context, the frontend is served statically by the Node.js backend. You can access the interfaces through these URLs:
- **Ambulance Interface**: [http://localhost:5000/ambulance](http://localhost:5000/ambulance)
- **Police Dashboard**: [http://localhost:5000/police](http://localhost:5000/police)
- **Health Check**: [http://localhost:5000/](http://localhost:5000/)

## 📝 Usage Guide
1. **Open both links** in different browser windows/tabs.
2. **On the Ambulance Interface**:
   - Enter an Ambulance ID (e.g., `AMB-101`) and start the emergency.
   - The system will find the nearest hospital and calculate the route.
   - You can toggle **Live GPS Location** to use your real location, or stick to the simulation.
   - You can manually trigger a traffic alert using the **Send Traffic Alert** button.
3. **On the Police Dashboard**:
   - The map will automatically sync and track the moving ambulance.
   - If traffic congestion is detected (or simulated halfway through the route), a red warning will flash.
   - Click **Dispatch Tactical Team** to simulate clearing the route, which will turn the alert green and notify the ambulance.

## 🔮 Future Scalability
- Migrate to WebSockets (Socket.io) instead of HTTP polling.
- Direct IoT integration with city traffic light control systems.
- Centralized pre-arrival patient data transmission to destination ERs.

---
*Built to save time and save lives during critical urban emergencies.*
