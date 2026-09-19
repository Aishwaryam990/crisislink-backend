const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================================
// MIDDLEWARE
// =====================================================

app.use(cors());
app.use(express.json());

// =====================================================
// DATABASE
// =====================================================

const db = new Database("crisislink.db");

db.pragma("journal_mode = WAL");

// =====================================================
// TABLES
// =====================================================

db.exec(`
    CREATE TABLE IF NOT EXISTS incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident TEXT NOT NULL,
        district TEXT NOT NULL,
        priority TEXT DEFAULT 'Monitoring',
        affected_people INTEGER DEFAULT 1,
        latitude REAL,
        longitude REAL,
        response_team TEXT,
        response_phone TEXT,
        status TEXT DEFAULT 'Reported',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS resource_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        district TEXT NOT NULL,
        incident TEXT NOT NULL,
        resources TEXT NOT NULL,
        latitude REAL,
        longitude REAL,
        target_team TEXT,
        target_phone TEXT,
        status TEXT DEFAULT 'Requested',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sos_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        district TEXT NOT NULL,
        incident TEXT NOT NULL,
        latitude REAL,
        longitude REAL,
        response_team TEXT,
        response_phone TEXT,
        status TEXT DEFAULT 'SOS Active',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
`);
// =====================================================
// REGISTERED RESCUE TEAMS
// =====================================================

db.exec(`
    CREATE TABLE IF NOT EXISTS rescue_teams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_name TEXT NOT NULL,
        district TEXT NOT NULL,
        service_types TEXT NOT NULL,
        phone TEXT NOT NULL,
        latitude REAL,
        longitude REAL,
        availability TEXT DEFAULT 'Available',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
`);

// =====================================================
// RESPONSE SERVICE DIRECTORY
// =====================================================

const responseServices = {
    Hassan: {
        "Flood": {
            team: "Hassan District Disaster Response",
            phone: "1077"
        },

        "Fire": {
            team: "Fire & Rescue Service – Hassan",
            phone: "101"
        },

        "Road Block": {
            team: "Hassan Traffic / Road Accident Help",
            phone: "1073"
        },

        "Accident": {
            team: "Hassan Ambulance / Emergency Medical Service",
            phone: "108"
        },

        "Medical Emergency": {
            team: "Hassan Ambulance / Emergency Medical Service",
            phone: "108"
        }
    }
};

// Standard emergency services for districts
// where a district-specific number has not been configured.

const standardServices = {
    "Flood": {
        team: "District Disaster Response / Emergency Services",
        phone: "112"
    },

    "Fire": {
        team: "Fire & Rescue Service",
        phone: "101"
    },

    "Road Block": {
        team: "Traffic / Road Emergency Response",
        phone: "112"
    },

    "Accident": {
        team: "Ambulance / Emergency Medical Service",
        phone: "108"
    },

    "Medical Emergency": {
        team: "Ambulance / Emergency Medical Service",
        phone: "108"
    }
};

function getResponseService(district, incident) {

    if (
        responseServices[district] &&
        responseServices[district][incident]
    ) {
        return responseServices[district][incident];
    }

    return standardServices[incident] || {
        team: "Unified Emergency Response",
        phone: "112"
    };
}

// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/", (req, res) => {

    res.json({
        success: true,
        message: "CrisisLink Backend is running",
        version: "1.2.0",
        database: "SQLite",
        status: "online"
    });

});

app.get("/api/health", (req, res) => {

    try {

        db.prepare("SELECT 1").get();

        res.json({
            success: true,
            server: "online",
            database: "connected",
            timestamp: new Date().toISOString()
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            server: "online",
            database: "error"
        });

    }

});

// =====================================================
// RESPONSE SERVICE
// =====================================================

app.get("/api/response-service", (req, res) => {

    try {

        const district = req.query.district;
        const incident = req.query.incident;

        if (!district || !incident) {

            return res.status(400).json({
                success: false,
                message: "District and incident are required"
            });

        }

        const service = getResponseService(
            district,
            incident
        );

        res.json({
            success: true,
            district,
            incident,
            response_team: service.team,
            response_phone: service.phone
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to find response service"
        });

    }

});

// =====================================================
// INCIDENTS
// =====================================================

// CREATE INCIDENT

app.post("/api/incidents", (req, res) => {

    try {

        const {
            incident,
            district,
            priority,
            affected_people,
            latitude,
            longitude,
            response_team,
            response_phone
        } = req.body;

        if (!incident || !district) {

            return res.status(400).json({
                success: false,
                message: "Incident and district are required"
            });

        }

        const service = getResponseService(
            district,
            incident
        );

        const finalTeam =
            response_team || service.team;

        const finalPhone =
            response_phone || service.phone;

        const stmt = db.prepare(`
            INSERT INTO incidents (
                incident,
                district,
                priority,
                affected_people,
                latitude,
                longitude,
                response_team,
                response_phone
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(

            incident,

            district,

            priority || "Monitoring",

            Number(affected_people) || 1,

            latitude !== undefined
                ? latitude
                : null,

            longitude !== undefined
                ? longitude
                : null,

            finalTeam,

            finalPhone

        );

        res.status(201).json({

            success: true,

            message: "Incident submitted successfully",

            incident_id: result.lastInsertRowid,

            response_team: finalTeam,

            response_phone: finalPhone

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to submit incident"
        });

    }

});

// =====================================================
// GET ALL INCIDENTS
// =====================================================

app.get("/api/incidents", (req, res) => {

    try {

        const incidents = db.prepare(`
            SELECT *
            FROM incidents
            ORDER BY id DESC
        `).all();

        res.json({

            success: true,

            count: incidents.length,

            incidents

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to fetch incidents"
        });

    }

});

// =====================================================
// GET SINGLE INCIDENT
// =====================================================

app.get("/api/incidents/:id", (req, res) => {

    try {

        const incident = db.prepare(`
            SELECT *
            FROM incidents
            WHERE id = ?
        `).get(req.params.id);

        if (!incident) {

            return res.status(404).json({
                success: false,
                message: "Incident not found"
            });

        }

        res.json({
            success: true,
            incident
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to fetch incident"
        });

    }

});

// =====================================================
// UPDATE INCIDENT STATUS
// =====================================================

app.patch("/api/incidents/:id/status", (req, res) => {

    try {

        const { status } = req.body;

        const allowedStatuses = [
            "Reported",
            "Monitoring",
            "Warning",
            "Crisis",
            "Resolved"
        ];

        if (!allowedStatuses.includes(status)) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid status. Use Reported, Monitoring, Warning, Crisis or Resolved."

            });

        }

        const result = db.prepare(`
            UPDATE incidents
            SET status = ?
            WHERE id = ?
        `).run(
            status,
            req.params.id
        );

        if (result.changes === 0) {

            return res.status(404).json({
                success: false,
                message: "Incident not found"
            });

        }

        res.json({

            success: true,

            message: "Incident status updated",

            incident_id: Number(req.params.id),

            status

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to update incident status"
        });

    }

});

// =====================================================
// DELETE INCIDENT
// =====================================================

// Delete incident
app.delete("/api/incidents/:id", (req, res) => {
    try {
        const { id } = req.params;

        const result = db.prepare(`
            DELETE FROM incidents
            WHERE id = ?
        `).run(id);

        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                message: "Incident not found"
            });
        }

        res.json({
            success: true,
            message: "Incident deleted successfully",
            incident_id: Number(id)
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to delete incident"
        });
    }
});
// =====================================================
// RESOURCE REQUESTS
// =====================================================

// CREATE RESOURCE REQUEST

app.post("/api/resources", (req, res) => {

    try {

        const {
            district,
            incident,
            resources,
            latitude,
            longitude,
            target_team,
            target_phone
        } = req.body;

        if (
            !district ||
            !incident ||
            !resources
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "District, incident and resources are required"

            });

        }

        const service = getResponseService(
            district,
            incident
        );

        const finalTeam =
            target_team || service.team;

        const finalPhone =
            target_phone || service.phone;

        const resourcesData =
            Array.isArray(resources)
                ? resources
                : [resources];

        const stmt = db.prepare(`
            INSERT INTO resource_requests (
                district,
                incident,
                resources,
                latitude,
                longitude,
                target_team,
                target_phone
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(

            district,

            incident,

            JSON.stringify(resourcesData),

            latitude !== undefined
                ? latitude
                : null,

            longitude !== undefined
                ? longitude
                : null,

            finalTeam,

            finalPhone

        );

        res.status(201).json({

            success: true,

            message:
                "Resource request submitted successfully",

            request_id:
                result.lastInsertRowid,

            target_team:
                finalTeam,

            target_phone:
                finalPhone

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({

            success: false,

            message:
                "Failed to submit resource request"

        });

    }

});

// =====================================================
// GET RESOURCE REQUESTS
// =====================================================

app.get("/api/resources", (req, res) => {

    try {

        const requests = db.prepare(`
            SELECT *
            FROM resource_requests
            ORDER BY id DESC
        `).all();

        requests.forEach(request => {

            try {

                request.resources =
                    JSON.parse(request.resources);

            } catch {

                // Keep original value

            }

        });

        res.json({

            success: true,

            count: requests.length,

            requests

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({

            success: false,

            message:
                "Failed to fetch resource requests"

        });

    }

});

// =====================================================
// UPDATE RESOURCE STATUS
// =====================================================

app.patch("/api/resources/:id/status", (req, res) => {

    try {

        const { status } = req.body;

        const allowedStatuses = [
            "Requested",
            "Assigned",
            "In Progress",
            "Delivered",
            "Completed",
            "Cancelled"
        ];

        if (!allowedStatuses.includes(status)) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid resource request status"

            });

        }

        const result = db.prepare(`
            UPDATE resource_requests
            SET status = ?
            WHERE id = ?
        `).run(
            status,
            req.params.id
        );

        if (result.changes === 0) {

            return res.status(404).json({

                success: false,

                message:
                    "Resource request not found"

            });

        }

        res.json({

            success: true,

            message:
                "Resource request status updated"

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({

            success: false,

            message:
                "Failed to update resource status"

        });

    }

});

// =====================================================
// SOS
// =====================================================

// CREATE SOS

app.post("/api/sos", (req, res) => {

    try {

        const {
            district,
            incident,
            latitude,
            longitude,
            response_team,
            response_phone
        } = req.body;

        if (!district || !incident) {

            return res.status(400).json({

                success: false,

                message:
                    "District and incident are required"

            });

        }

        const service = getResponseService(
            district,
            incident
        );

        const finalTeam =
            response_team || service.team;

        const finalPhone =
            response_phone || service.phone;

        const stmt = db.prepare(`
            INSERT INTO sos_requests (
                district,
                incident,
                latitude,
                longitude,
                response_team,
                response_phone
            )
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(

            district,

            incident,

            latitude !== undefined
                ? latitude
                : null,

            longitude !== undefined
                ? longitude
                : null,

            finalTeam,

            finalPhone

        );

        res.status(201).json({

            success: true,

            message:
                "SOS request received",

            sos_id:
                result.lastInsertRowid,

            response_team:
                finalTeam,

            response_phone:
                finalPhone

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({

            success: false,

            message:
                "Failed to submit SOS"

        });

    }

});

// =====================================================
// GET SOS REQUESTS
// =====================================================

app.get("/api/sos", (req, res) => {

    try {

        const requests = db.prepare(`
            SELECT *
            FROM sos_requests
            ORDER BY id DESC
        `).all();

        res.json({

            success: true,

            count: requests.length,

            requests

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({

            success: false,

            message:
                "Failed to fetch SOS requests"

        });

    }

});

// =====================================================
// UPDATE SOS STATUS
// =====================================================

app.patch("/api/sos/:id/status", (req, res) => {

    try {

        const { status } = req.body;

        const allowedStatuses = [
            "SOS Active",
            "Acknowledged",
            "Responding",
                       "Resolved",
            "Cancelled"
        ];

        if (!allowedStatuses.includes(status)) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid SOS status"

            });

        }

        const result = db.prepare(`
            UPDATE sos_requests
            SET status = ?
            WHERE id = ?
        `).run(
            status,
            req.params.id
        );

        if (result.changes === 0) {

            return res.status(404).json({

                success: false,

                message:
                    "SOS request not found"

            });

        }

        res.json({

            success: true,

            message:
                "SOS status updated"

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({

            success: false,

            message:
                "Failed to update SOS status"

        });

    }

});

// =====================================================
// DASHBOARD
// =====================================================

app.get("/api/dashboard", (req, res) => {

    try {

        const totalIncidents = db.prepare(`
            SELECT COUNT(*) AS count
            FROM incidents
        `).get().count;

        const activeIncidents = db.prepare(`
            SELECT COUNT(*) AS count
            FROM incidents
            WHERE status != 'Resolved'
        `).get().count;

        const crisisIncidents = db.prepare(`
            SELECT COUNT(*) AS count
            FROM incidents
            WHERE priority = 'Crisis'
            AND status != 'Resolved'
        `).get().count;

        const resourceRequests = db.prepare(`
            SELECT COUNT(*) AS count
            FROM resource_requests
        `).get().count;

        const pendingResources = db.prepare(`
            SELECT COUNT(*) AS count
            FROM resource_requests
            WHERE status NOT IN ('Completed', 'Cancelled')
        `).get().count;

        const sosRequests = db.prepare(`
            SELECT COUNT(*) AS count
            FROM sos_requests
        `).get().count;

        const activeSOS = db.prepare(`
            SELECT COUNT(*) AS count
            FROM sos_requests
            WHERE status NOT IN ('Resolved', 'Cancelled')
        `).get().count;

        res.json({

            success: true,

            summary: {

                total_incidents:
                    totalIncidents,

                active_incidents:
                    activeIncidents,

                crisis_incidents:
                    crisisIncidents,

                resource_requests:
                    resourceRequests,

                pending_resources:
                    pendingResources,

                sos_requests:
                    sosRequests,

                active_sos:
                    activeSOS

            }

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({

            success: false,

            message:
                "Failed to load dashboard"

        });

    }

});
// =====================================================
// REGISTERED RESCUE TEAMS
// =====================================================

// REGISTER A RESCUE TEAM

app.post("/api/rescue-teams", (req, res) => {

    try {

        const {
            team_name,
            district,
            service_types,
            phone,
            latitude,
            longitude,
            availability
        } = req.body;

        if (
            !team_name ||
            !district ||
            !service_types ||
            !phone
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Team name, district, service types and phone are required"
            });
        }

        const services = Array.isArray(service_types)
            ? service_types
            : [service_types];

        const allowedAvailability = [
            "Available",
            "Busy",
            "Offline"
        ];

        const finalAvailability =
            allowedAvailability.includes(availability)
                ? availability
                : "Available";

        const stmt = db.prepare(`
            INSERT INTO rescue_teams (
                team_name,
                district,
                service_types,
                phone,
                latitude,
                longitude,
                availability
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
            team_name,
            district,
            JSON.stringify(services),
            phone,
            latitude !== undefined ? latitude : null,
            longitude !== undefined ? longitude : null,
            finalAvailability
        );

        res.status(201).json({
            success: true,
            message: "Rescue team registered successfully",
            team_id: result.lastInsertRowid
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to register rescue team"
        });

    }

});


// GET REGISTERED RESCUE TEAMS

app.get("/api/rescue-teams", (req, res) => {

    try {

        const {
            district,
            incident,
            availability
        } = req.query;

        let teams = db.prepare(`
            SELECT *
            FROM rescue_teams
            ORDER BY id DESC
        `).all();

        teams = teams.filter(team => {

            if (
                district &&
                team.district.toLowerCase() !==
                district.toLowerCase()
            ) {
                return false;
            }

            if (
                availability &&
                team.availability !== availability
            ) {
                return false;
            }

            if (incident) {

                let services = [];

                try {
                    services = JSON.parse(team.service_types);
                } catch {
                    services = [];
                }

                const handlesIncident = services.some(
                    service =>
                        String(service).toLowerCase() ===
                        String(incident).toLowerCase()
                );

                if (!handlesIncident) {
                    return false;
                }
            }

            return true;
        });

        teams.forEach(team => {

            try {
                team.service_types =
                    JSON.parse(team.service_types);
            } catch {
                team.service_types = [];
            }

        });

        res.json({
            success: true,
            count: teams.length,
            teams
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to fetch rescue teams"
        });

    }

});


// UPDATE RESCUE TEAM AVAILABILITY

app.patch("/api/rescue-teams/:id/status", (req, res) => {

    try {

        const { availability } = req.body;

        const allowedAvailability = [
            "Available",
            "Busy",
            "Offline"
        ];

        if (!allowedAvailability.includes(availability)) {

            return res.status(400).json({
                success: false,
                message:
                    "Invalid availability. Use Available, Busy or Offline."
            });

        }

        const result = db.prepare(`
            UPDATE rescue_teams
            SET availability = ?
            WHERE id = ?
        `).run(
            availability,
            req.params.id
        );

        if (result.changes === 0) {

            return res.status(404).json({
                success: false,
                message: "Rescue team not found"
            });

        }

        res.json({
            success: true,
            message: "Rescue team availability updated",
            team_id: Number(req.params.id),
            availability
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message:
                "Failed to update rescue team availability"
        });

    }

});


// DELETE RESCUE TEAM

app.delete("/api/rescue-teams/:id", (req, res) => {

    try {

        const result = db.prepare(`
            DELETE FROM rescue_teams
            WHERE id = ?
        `).run(req.params.id);

        if (result.changes === 0) {

            return res.status(404).json({
                success: false,
                message: "Rescue team not found"
            });

        }

        res.json({
            success: true,
            message: "Rescue team deleted successfully",
            team_id: Number(req.params.id)
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to delete rescue team"
        });

    }

});

// =====================================================
// 404 HANDLER
// =====================================================

app.use((req, res) => {

    res.status(404).json({

        success: false,

        message:
            "API endpoint not found",

        path:
            req.originalUrl

    });

});

// =====================================================
// ERROR HANDLER
// =====================================================

app.use((error, req, res, next) => {

    console.error(error);

    res.status(500).json({

        success: false,

        message:
            "Internal server error"

    });

});

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, "0.0.0.0", () => {
    console.log("");
    console.log("======================================");
    console.log("       CRISISLINK BACKEND");
    console.log("======================================");
    console.log(`Server running on: http://localhost:${PORT}`);
    console.log("Database: SQLite");
    console.log("Version: 1.2.0");
    console.log("======================================");
    console.log("");

});