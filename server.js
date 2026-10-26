const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET =
    process.env.JWT_SECRET ||
    "crisislink-jwt-secret-change-this-in-render";

const ADMIN_EMAIL =
    (process.env.ADMIN_EMAIL || "admin@crisislink.com").toLowerCase();

const ADMIN_PASSWORD =
    process.env.ADMIN_PASSWORD || "CrisisLink@123";

app.use(cors());
app.use(express.json());

const db = new Database("crisislink.db");

db.pragma("journal_mode = WAL");


// =====================================================
// DATABASE TABLES
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

CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT DEFAULT 'CrisisLink Administrator',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// Add a secure status token for SOS requests.
// Existing SOS records remain unchanged.
try {
    db.exec(`
        ALTER TABLE sos_requests
        ADD COLUMN status_token TEXT
    `);
} catch (error) {
    if (!String(error.message).includes("duplicate column name")) {
        throw error;
    }
}


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
// ADMIN ACCOUNT
// =====================================================

function ensureAdminAccount() {

    const existingAdmin = db
        .prepare("SELECT id FROM admins WHERE email = ?")
        .get(ADMIN_EMAIL);

    if (!existingAdmin) {

        const passwordHash = bcrypt.hashSync(
            ADMIN_PASSWORD,
            12
        );

        db.prepare(`
            INSERT INTO admins (
                email,
                password_hash,
                name
            )
            VALUES (?, ?, ?)
        `).run(
            ADMIN_EMAIL,
            passwordHash,
            "CrisisLink Administrator"
        );

        console.log(
            `Admin account created: ${ADMIN_EMAIL}`
        );
    }
}

ensureAdminAccount();


// =====================================================
// ADMIN AUTHENTICATION MIDDLEWARE
// =====================================================

function requireAdmin(req, res, next) {

    const authorization =
        req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {

        return res.status(401).json({
            success: false,
            message: "Admin authentication required"
        });
    }

    const token =
        authorization.slice(7);

    try {

        const decoded =
            jwt.verify(token, JWT_SECRET);

        if (decoded.role !== "admin") {
            throw new Error("Invalid role");
        }

        req.admin = decoded;

        next();

    } catch (error) {

        return res.status(401).json({
            success: false,
            message: "Invalid or expired admin token"
        });
    }
}


// =====================================================
// HEALTH
// =====================================================

app.get("/", (req, res) => {

    res.json({
        success: true,
        message: "CrisisLink Backend is running",
        version: "1.3.0",
        database: "SQLite",
        authentication: "JWT + bcrypt",
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

        console.error(error);

        res.status(500).json({
            success: false,
            server: "online",
            database: "error"
        });
    }
});


// =====================================================
// ADMIN LOGIN
// =====================================================

app.post("/api/auth/admin/login", (req, res) => {

    try {

        const email =
            String(req.body.email || "")
                .trim()
                .toLowerCase();

        const password =
            String(req.body.password || "");

        if (!email || !password) {

            return res.status(400).json({
                success: false,
                message: "Email and password are required"
            });
        }

        const admin = db
            .prepare(
                "SELECT * FROM admins WHERE email = ?"
            )
            .get(email);

        if (
            !admin ||
            !bcrypt.compareSync(
                password,
                admin.password_hash
            )
        ) {

            return res.status(401).json({
                success: false,
                message: "Invalid admin email or password"
            });
        }

        const token = jwt.sign(
            {
                id: admin.id,
                email: admin.email,
                name: admin.name,
                role: "admin"
            },
            JWT_SECRET,
            {
                expiresIn: "8h"
            }
        );

        res.json({
            success: true,
            message: "Admin login successful",
            token,

            admin: {
                id: admin.id,
                email: admin.email,
                name: admin.name,
                role: "admin"
            }
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Admin login failed"
        });
    }
});


// =====================================================
// CHECK ADMIN SESSION
// =====================================================

app.get(
    "/api/auth/admin/me",
    requireAdmin,
    (req, res) => {

        res.json({
            success: true,
            admin: req.admin
        });
    }
);


// =====================================================
// RESPONSE SERVICE
// =====================================================

app.get("/api/response-service", (req, res) => {

    try {

        const {
            district,
            incident
        } = req.query;

        if (!district || !incident) {

            return res.status(400).json({
                success: false,
                message:
                    "District and incident are required"
            });
        }

        const service =
            getResponseService(
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
            message:
                "Failed to find response service"
        });
    }
});


// =====================================================
// INCIDENTS
// =====================================================

// CREATE INCIDENT
// User can submit incidents.

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
                message:
                    "Incident and district are required"
            });
        }

        const service =
            getResponseService(
                district,
                incident
            );

        const finalTeam =
            response_team || service.team;

        const finalPhone =
            response_phone || service.phone;

        const result = db.prepare(`
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
        `).run(

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

            message:
                "Incident submitted successfully",

            incident_id:
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
                "Failed to submit incident"
        });
    }
});


// ADMIN ONLY
// GET ALL INCIDENTS

app.get(
    "/api/incidents",
    requireAdmin,
    (req, res) => {

        try {

            const incidents =
                db.prepare(`
                    SELECT *
                    FROM incidents
                    ORDER BY id DESC
                `).all();

            res.json({

                success: true,

                count:
                    incidents.length,

                incidents
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Failed to fetch incidents"
            });
        }
    }
);


// GET SINGLE INCIDENT
// Kept available so the user can check a submitted incident.

app.get("/api/incidents/:id", (req, res) => {

    try {

        const incident =
            db.prepare(`
                SELECT *
                FROM incidents
                WHERE id = ?
            `).get(req.params.id);

        if (!incident) {

            return res.status(404).json({
                success: false,
                message:
                    "Incident not found"
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
            message:
                "Failed to fetch incident"
        });
    }
});


// ADMIN ONLY
// UPDATE INCIDENT STATUS

app.patch(
    "/api/incidents/:id/status",
    requireAdmin,
    (req, res) => {

        try {

            const {
                status
            } = req.body;

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

            const result =
                db.prepare(`
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
                    message:
                        "Incident not found"
                });
            }

            res.json({

                success: true,

                message:
                    "Incident status updated",

                incident_id:
                    Number(req.params.id),

                status
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Failed to update incident status"
            });
        }
    }
);


// ADMIN ONLY
// DELETE INCIDENT

app.delete(
    "/api/incidents/:id",
    requireAdmin,
    (req, res) => {

        try {

            const result =
                db.prepare(`
                    DELETE FROM incidents
                    WHERE id = ?
                `).run(req.params.id);

            if (result.changes === 0) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Incident not found"
                });
            }

            res.json({

                success: true,

                message:
                    "Incident deleted successfully",

                incident_id:
                    Number(req.params.id)
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Failed to delete incident"
            });
        }
    }
);


// =====================================================
// RESOURCE REQUESTS
// =====================================================

// CREATE RESOURCE REQUEST
// User can submit resource requests.

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

        const service =
            getResponseService(
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

        const result = db.prepare(`
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
        `).run(

            district,

            incident,

            JSON.stringify(
                resourcesData
            ),

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


// ADMIN ONLY
// GET RESOURCE REQUESTS

app.get(
    "/api/resources",
    requireAdmin,
    (req, res) => {

        try {

            const requests =
                db.prepare(`
                    SELECT *
                    FROM resource_requests
                    ORDER BY id DESC
                `).all();

            requests.forEach(
                request => {

                    try {

                        request.resources =
                            JSON.parse(
                                request.resources
                            );

                    } catch {
                        // Keep original value.
                    }
                }
            );

            res.json({

                success: true,

                count:
                    requests.length,

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
    }
);


// ADMIN ONLY
// UPDATE RESOURCE STATUS

app.patch(
    "/api/resources/:id/status",
    requireAdmin,
    (req, res) => {

        try {

            const {
                status
            } = req.body;

            const allowedStatuses = [
                "Requested",
                "Assigned",
                "In Progress",
                "Delivered",
                "Completed",
                "Cancelled"
            ];

            if (
                !allowedStatuses.includes(status)
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid resource request status"
                });
            }

            const result =
                db.prepare(`
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
                    "Resource request status updated",

                request_id:
                    Number(req.params.id),

                status
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({

                success: false,

                message:
                    "Failed to update resource status"
            });
        }
    }
);


// =====================================================
// SOS
// =====================================================

// CREATE SOS
// User can create an SOS without being Admin.

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

        const service =
            getResponseService(
                district,
                incident
            );

        const finalTeam =
            response_team || service.team;

        const finalPhone =
            response_phone || service.phone;

        // Generate a secure token for checking this SOS status.
const statusToken = crypto.randomBytes(32).toString("hex");

const result = db.prepare(`
    INSERT INTO sos_requests (
        district,
        incident,
        latitude,
        longitude,
        response_team,
        response_phone,
        status_token
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(
    district,
    incident,
    latitude !== undefined ? latitude : null,
    longitude !== undefined ? longitude : null,
    finalTeam,
    finalPhone,
    statusToken
);

        res.status(201).json({

            success: true,

            message:
                "SOS request received",

            sos_id:
                result.lastInsertRowid,
                status_token: statusToken,

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


// ADMIN ONLY
// GET ALL SOS REQUESTS

app.get(
    "/api/sos",
    requireAdmin,
    (req, res) => {

        try {

            const requests =
                db.prepare(`
                    SELECT *
                    FROM sos_requests
                    ORDER BY id DESC
                `).all();

            res.json({

                success: true,

                count:
                    requests.length,

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
    }
);


// GET SINGLE SOS
// Used by the user to check their SOS response status.

// Get an individual SOS request.
// Admins can access any SOS; users must be verified separately.
app.get("/api/sos/:id", requireAdmin, (req, res) => {
    try {
        const request = db.prepare(`
            SELECT *
            FROM sos_requests
            WHERE id = ?
        `).get(req.params.id);

        if (!request) {
            return res.status(404).json({
                success: false,
                message: "SOS request not found"
            });
        }

        return res.json({
            success: true,
            request
        });

    } catch (error) {
        console.error("Failed to fetch SOS request:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch SOS request"
        });
    }
});

// Allow a user to check their own SOS status using their secret token.
app.get("/api/sos/:id/status", (req, res) => {
    try {
        const sosId = req.params.id;
        const statusToken = req.get("X-SOS-Status-Token");

        if (!/^\d+$/.test(sosId) || !statusToken) {
            return res.status(401).json({
                success: false,
                message: "Valid SOS ID and status token are required."
            });
        }

        const request = db.prepare(`
            SELECT id, status
            FROM sos_requests
            WHERE id = ? AND status_token = ?
        `).get(sosId, statusToken);

        if (!request) {
            return res.status(404).json({
                success: false,
                message: "SOS request not found or access denied."
            });
        }

        return res.json({
            success: true,
            sos_id: request.id,
            status: request.status || "SOS Active"
        });

    } catch (error) {
        console.error("SOS status lookup failed:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to retrieve SOS status."
        });
    }
});


// ADMIN ONLY
// UPDATE SOS STATUS

app.patch(
    "/api/sos/:id/status",
    requireAdmin,
    (req, res) => {

        try {

            const {
                status
            } = req.body;

            const allowedStatuses = [
                "SOS Active",
                "Acknowledged",
                "Responding",
                "Resolved",
                "Cancelled"
            ];

            if (
                !allowedStatuses.includes(status)
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid SOS status"
                });
            }

            const result =
                db.prepare(`
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
                    "SOS status updated",

                sos_id:
                    Number(req.params.id),

                status
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({

                success: false,

                message:
                    "Failed to update SOS status"
            });
        }
    }
);


// =====================================================
// ADMIN DASHBOARD
// =====================================================

app.get(
    "/api/dashboard",
    requireAdmin,
    (req, res) => {

        try {

            const totalIncidents =
                db.prepare(`
                    SELECT COUNT(*) count
                    FROM incidents
                `).get().count;

            const activeIncidents =
                db.prepare(`
                    SELECT COUNT(*) count
                    FROM incidents
                    WHERE status != 'Resolved'
                `).get().count;

            const crisisIncidents =
                db.prepare(`
                    SELECT COUNT(*) count
                    FROM incidents
                    WHERE priority = 'Crisis'
                    AND status != 'Resolved'
                `).get().count;

            const resourceRequests =
                db.prepare(`
                    SELECT COUNT(*) count
                    FROM resource_requests
                `).get().count;

            const pendingResources =
                db.prepare(`
                    SELECT COUNT(*) count
                    FROM resource_requests
                    WHERE status NOT IN (
                        'Completed',
                        'Cancelled'
                    )
                `).get().count;

            const sosRequests =
                db.prepare(`
                    SELECT COUNT(*) count
                    FROM sos_requests
                `).get().count;

            const activeSOS =
                db.prepare(`
                    SELECT COUNT(*) count
                    FROM sos_requests
                    WHERE status NOT IN (
                        'Resolved',
                        'Cancelled'
                    )
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
    }
);


// =====================================================
// REGISTERED RESCUE TEAMS
// =====================================================

// ADMIN ONLY
// REGISTER RESCUE TEAM

app.post(
    "/api/rescue-teams",
    requireAdmin,
    (req, res) => {

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

            const services =
                Array.isArray(service_types)
                    ? service_types
                    : [service_types];

            const allowedAvailability = [
                "Available",
                "Busy",
                "Offline"
            ];

            const finalAvailability =
                allowedAvailability.includes(
                    availability
                )
                    ? availability
                    : "Available";

            const result = db.prepare(`
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
            `).run(

                team_name,

                district,

                JSON.stringify(services),

                phone,

                latitude !== undefined
                    ? latitude
                    : null,

                longitude !== undefined
                    ? longitude
                    : null,

                finalAvailability
            );

            res.status(201).json({

                success: true,

                message:
                    "Rescue team registered successfully",

                team_id:
                    result.lastInsertRowid
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({

                success: false,

                message:
                    "Failed to register rescue team"
            });
        }
    }
);


// GET REGISTERED RESCUE TEAMS
// Kept public for nearby-help functionality.

app.get(
    "/api/rescue-teams",
    (req, res) => {

        try {

            const {
                district,
                incident,
                availability
            } = req.query;

            let teams =
                db.prepare(`
                    SELECT *
                    FROM rescue_teams
                    ORDER BY id DESC
                `).all();

            teams = teams.filter(
                team => {

                    if (
                        district &&
                        team.district.toLowerCase() !==
                        district.toLowerCase()
                    ) {
                        return false;
                    }

                    if (
                        availability &&
                        team.availability !==
                        availability
                    ) {
                        return false;
                    }

                    if (incident) {

                        let services = [];

                        try {

                            services =
                                JSON.parse(
                                    team.service_types
                                );

                        } catch {
                            services = [];
                        }

                        const handlesIncident =
                            services.some(
                                service =>
                                    String(service)
                                        .toLowerCase() ===
                                    String(incident)
                                        .toLowerCase()
                            );

                        if (!handlesIncident) {
                            return false;
                        }
                    }

                    return true;
                }
            );

            teams.forEach(
                team => {

                    try {

                        team.service_types =
                            JSON.parse(
                                team.service_types
                            );

                    } catch {

                        team.service_types = [];
                    }
                }
            );

            res.json({

                success: true,

                count:
                    teams.length,

                teams
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({

                success: false,

                message:
                    "Failed to fetch rescue teams"
            });
        }
    }
);


// ADMIN ONLY
// UPDATE RESCUE TEAM AVAILABILITY

app.patch(
    "/api/rescue-teams/:id/status",
    requireAdmin,
    (req, res) => {

        try {

            const {
                availability
            } = req.body;

            const allowedAvailability = [
                "Available",
                "Busy",
                "Offline"
            ];

            if (
                !allowedAvailability.includes(
                    availability
                )
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid availability. Use Available, Busy or Offline."
                });
            }

            const result =
                db.prepare(`
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

                    message:
                        "Rescue team not found"
                });
            }

            res.json({

                success: true,

                message:
                    "Rescue team availability updated",

                team_id:
                    Number(req.params.id),

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
    }
);


// ADMIN ONLY
// DELETE RESCUE TEAM

app.delete(
    "/api/rescue-teams/:id",
    requireAdmin,
    (req, res) => {

        try {

            const result =
                db.prepare(`
                    DELETE FROM rescue_teams
                    WHERE id = ?
                `).run(req.params.id);

            if (result.changes === 0) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Rescue team not found"
                });
            }

            res.json({

                success: true,

                message:
                    "Rescue team deleted successfully",

                team_id:
                    Number(req.params.id)
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({

                success: false,

                message:
                    "Failed to delete rescue team"
            });
        }
    }
);


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

app.use(
    (error, req, res, next) => {

        console.error(error);

        res.status(500).json({

            success: false,

            message:
                "Internal server error"
        });
    }
);


// =====================================================
// START SERVER
// =====================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "======================================"
        );

        console.log(
            "       CRISISLINK BACKEND"
        );

        console.log(
            "======================================"
        );

        console.log(
            `Server running on: http://localhost:${PORT}`
        );

        console.log(
            "Database: SQLite"
        );

        console.log(
            "Authentication: JWT + bcrypt"
        );

        console.log(
            "Admin login endpoint: /api/auth/admin/login"
        );

        console.log(
            "Version: 1.3.0"
        );

        console.log(
            "======================================"
        );
    }
);