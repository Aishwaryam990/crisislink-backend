const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// Online blood-centre directory.
// Directory listings do not imply confirmed blood-stock availability.
const BLOOD_CENTRE_DIRECTORY = [
    {
        provider_name: "Sri Chamarajendra District Hospital Blood Bank",
        provider_type: "Blood Centre",
        district: "Hassan",
        address: "Hassan Institute of Medical Sciences, Hospital Road, Hassan",
        phone: "08172233677",
        availability: null,
        directoryOnly: true,
        source: "Karnataka State Disaster Management Authority district plan"
    },
    {
        provider_name: "Jeeva Raksha Blood Bank",
        provider_type: "Blood Centre",
        district: "Hassan",
        address: "Vokkaligara Hostel Building, Shankara Mutt Road, Hassan",
        phone: "08172262047",
        availability: null,
        directoryOnly: true,
        source: "Published Karnataka blood-bank directory"
    },
    {
        provider_name: "Hassan Blood Bank",
        provider_type: "Blood Centre",
        district: "Hassan",
        address: "4th Cross, Shankara Mutt Road, opposite Vijaya English School, K. R. Puram, Hassan",
        phone: "08172266124",
        availability: null,
        directoryOnly: true,
        source: "Karnataka State Disaster Management Authority district plan"
    },
    {
        provider_name: "J.S.S. Hospital Blood Bank",
        provider_type: "Blood Centre",
        district: "Mysuru",
        address: "Mahatma Gandhi Road, Mysuru, Karnataka",
        phone: "08212335009",
        availability: null,
        directoryOnly: true,
        source: "Published Karnataka blood-bank directory"
    },
    {
        provider_name: "K. R. Hospital Blood Bank",
        provider_type: "Blood Centre",
        district: "Mysuru",
        address: "MMC & RI, Sayaji Rao Road, Mysuru, Karnataka",
        phone: "08212429800",
        availability: null,
        directoryOnly: true,
        source: "Published Karnataka blood-bank directory"
    },
    {
        provider_name: "B.G.S. Apollo Hospital Blood Bank",
        provider_type: "Blood Centre",
        district: "Mysuru",
        address: "Kantharaj Urs Road, Kuvempunagar, Mysuru, Karnataka",
        phone: "08212566666",
        availability: null,
        directoryOnly: true,
        source: "Published Karnataka blood-bank directory"
    },
    {
        provider_name: "Rotary Mysore Chandrakala Hospital Blood Bank",
        provider_type: "Blood Centre",
        district: "Mysuru",
        address: "Plot A, Kalidasa Road, Jayalakshmipuram, Mysuru, Karnataka",
        phone: "08214288638",
        availability: null,
        directoryOnly: true,
        source: "Published Karnataka blood-bank directory"
    },
    {
        provider_name: "Holdsworth Memorial Mission Hospital Blood Bank",
        provider_type: "Blood Centre",
        district: "Mysuru",
        address: "Mandi Mohalla, Mysuru, Karnataka",
        phone: "08212521650",
        availability: null,
        directoryOnly: true,
        source: "Published Karnataka blood-bank directory"
    },
    {
        provider_name: "Sri Jayadeva Institute of Cardiovascular Sciences and Research Blood Bank",
        provider_type: "Blood Centre",
        district: "Mysuru",
        address: "Kumbarakoppal, Gokulam 3rd Stage, Mysuru, Karnataka",
        phone: "7411331290",
        availability: null,
        directoryOnly: true,
        source: "Published Karnataka blood-bank directory"
    },
    {
        provider_name: "Narayana Hrudayalaya Surgical Hospital",
        provider_type: "Blood Centre",
        district: "Mysuru",
        address: "CAH-1, 3rd Phase, Devanur, Mysuru, Karnataka",
        phone: "08217122222",
        availability: null,
        directoryOnly: true,
        source: "Published Karnataka blood-bank directory"
    },
    {
        provider_name: "Navjeevan Medical Relief and Research Foundation, St. Joseph's Hospital Blood Bank",
        provider_type: "Blood Centre",
        district: "Mysuru",
        address: "Bannimantap, St. Joseph's Hospital, Mysuru, Karnataka",
        phone: "9945636880",
        availability: null,
        directoryOnly: true,
        source: "Published Karnataka blood-bank directory"
    }
];
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());


// =====================================================
// DATABASE
// =====================================================

// Use Render's persistent disk when configured; otherwise use local storage.
const databasePath = process.env.BLOOD_DATABASE_PATH
    ? path.resolve(process.env.BLOOD_DATABASE_PATH)
    : path.join(__dirname, "blood.db");

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);

db.pragma("journal_mode = WAL");


// Blood providers / centres
db.exec(`
    CREATE TABLE IF NOT EXISTS blood_providers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_name TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        phone TEXT NOT NULL,
        district TEXT NOT NULL,
        address TEXT,
        latitude REAL,
        longitude REAL,
        availability TEXT DEFAULT 'Available',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
`);


// Blood inventory
db.exec(`
    CREATE TABLE IF NOT EXISTS blood_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id INTEGER NOT NULL,
        blood_group TEXT NOT NULL,
        component TEXT NOT NULL,
        units INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (provider_id)
            REFERENCES blood_providers(id)
            ON DELETE CASCADE
    );
`);


// Donors
db.exec(`
    CREATE TABLE IF NOT EXISTS blood_donors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        age INTEGER,
        gender TEXT,
        phone TEXT NOT NULL,
        blood_group TEXT NOT NULL,
        district TEXT NOT NULL,
        address TEXT,
        latitude REAL,
        longitude REAL,
        availability TEXT DEFAULT 'Available',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
`);


// Blood requests
db.exec(`
    CREATE TABLE IF NOT EXISTS blood_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id INTEGER,
        donor_id INTEGER,
        district TEXT NOT NULL,
        blood_group TEXT NOT NULL,
        component TEXT NOT NULL,
        units INTEGER NOT NULL,
        latitude REAL,
        longitude REAL,
        status TEXT DEFAULT 'Requested',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (provider_id)
            REFERENCES blood_providers(id)
            ON DELETE SET NULL,

        FOREIGN KEY (donor_id)
            REFERENCES blood_donors(id)
            ON DELETE SET NULL
    );
`);
// Add donor_id to existing blood_requests table if needed
try {
    db.prepare(`
        ALTER TABLE blood_requests
        ADD COLUMN donor_id INTEGER
    `).run();
} catch (error) {
    if (!error.message.includes("duplicate column name")) {
        throw error;
    }
}

// Add hospital and contact details to existing blood_requests table
const bloodRequestColumns = [
    ["hospital_name", "TEXT"],
    ["hospital_address", "TEXT"],
    ["contact_name", "TEXT"],
    ["contact_phone", "TEXT"],
    ["required_by", "TEXT"]
];

for (const [columnName, columnType] of bloodRequestColumns) {
    try {
        db.exec(
            `ALTER TABLE blood_requests ADD COLUMN ${columnName} ${columnType}`
        );
    } catch (error) {
        if (!error.message.includes("duplicate column name")) {
            throw error;
        }
    }
}
// =====================================================
// HELPERS
// =====================================================

function validBloodGroup(group) {
    return [
        "A+",
        "A-",
        "B+",
        "B-",
        "AB+",
        "AB-",
        "O+",
        "O-"
    ].includes(group);
}


function validComponent(component) {
    return [
        "Whole Blood",
        "Red Blood Cells",
        "Platelets",
        "Plasma",
        "Cryoprecipitate"
    ].includes(component);
}


function distanceKm(lat1, lon1, lat2, lon2) {

    const R = 6371;

    const dLat =
        (lat2 - lat1) * Math.PI / 180;

    const dLon =
        (lon2 - lon1) * Math.PI / 180;

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;

    const c =
        2 * Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );

    return R * c;
}


// =====================================================
// HEALTH
// =====================================================

app.get("/", (req, res) => {

    res.json({
        success: true,
        message: "CrisisLink Blood Services Backend is running",
        database: "SQLite",
        status: "online"
    });

});


app.get("/api/health", (req, res) => {

    res.json({
        success: true,
        service: "blood",
        database: "SQLite",
        status: "online"
    });

});


// =====================================================
// BLOOD PROVIDERS / BLOOD CENTRES
// =====================================================

// Register a blood centre/provider
app.post("/api/blood/providers", (req, res) => {

    try {

        const {
            provider_name,
            provider_type,
            phone,
            district,
            address,
            latitude,
            longitude
        } = req.body;


        if (
            !provider_name ||
            !provider_type ||
            !phone ||
            !district
        ) {

            return res.status(400).json({
                success: false,
                message: "Provider name, type, phone and district are required."
            });

        }


        const result = db.prepare(`
            INSERT INTO blood_providers
            (
                provider_name,
                provider_type,
                phone,
                district,
                address,
                latitude,
                longitude
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            provider_name,
            provider_type,
            phone,
            district,
            address || "",
            latitude ?? null,
            longitude ?? null
        );


        const provider = db.prepare(`
            SELECT *
            FROM blood_providers
            WHERE id = ?
        `).get(result.lastInsertRowid);


        res.status(201).json({
            success: true,
            provider
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Unable to register blood provider."
        });

    }

});


// Get blood providers
app.get("/api/blood/providers", (req, res) => {

    try {

        const {
            district,
            availability
        } = req.query;


        let query = `
            SELECT *
            FROM blood_providers
            WHERE 1 = 1
        `;

        const params = [];


        if (district) {

            query += `
                AND district = ?
            `;

            params.push(district);
        }


        if (availability) {

            query += `
                AND availability = ?
            `;

            params.push(availability);
        }


        query += `
            ORDER BY provider_name
        `;


        const providers =
            db.prepare(query).all(...params);


        res.json({
            success: true,
            count: providers.length,
            providers
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Unable to retrieve blood providers."
        });

    }

});


// Update provider availability
app.patch("/api/blood/providers/:id/status", (req, res) => {

    const allowed = [
        "Available",
        "Busy",
        "Offline"
    ];


    const status =
        req.body.availability;


    if (!allowed.includes(status)) {

        return res.status(400).json({
            success: false,
            message: "Invalid availability status."
        });

    }


    const result = db.prepare(`
        UPDATE blood_providers
        SET availability = ?
        WHERE id = ?
    `).run(
        status,
        req.params.id
    );


    if (result.changes === 0) {

        return res.status(404).json({
            success: false,
            message: "Blood provider not found."
        });

    }


    res.json({
        success: true,
        message: "Provider availability updated."
    });

});


// Delete provider
app.delete("/api/blood/providers/:id", (req, res) => {

    const result = db.prepare(`
        DELETE FROM blood_providers
        WHERE id = ?
    `).run(
        req.params.id
    );


    if (result.changes === 0) {

        return res.status(404).json({
            success: false,
            message: "Blood provider not found."
        });

    }


    res.json({
        success: true,
        message: "Blood provider deleted."
    });

});


// =====================================================
// BLOOD INVENTORY
// =====================================================

// Add/update inventory
app.post("/api/blood/inventory", (req, res) => {

    try {

        const {
            provider_id,
            blood_group,
            component,
            units
        } = req.body;


        if (
            !provider_id ||
            !validBloodGroup(blood_group) ||
            !validComponent(component) ||
            !Number.isInteger(Number(units)) ||
            Number(units) < 0
        ) {

            return res.status(400).json({
                success: false,
                message: "Invalid blood inventory details."
            });

        }


        const provider =
            db.prepare(`
                SELECT *
                FROM blood_providers
                WHERE id = ?
            `).get(provider_id);


        if (!provider) {

            return res.status(404).json({
                success: false,
                message: "Blood provider not found."
            });

        }


        const existing =
            db.prepare(`
                SELECT *
                FROM blood_inventory
                WHERE provider_id = ?
                AND blood_group = ?
                AND component = ?
            `).get(
                provider_id,
                blood_group,
                component
            );


        let inventory;


        if (existing) {

            db.prepare(`
                UPDATE blood_inventory
                SET units = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(
                Number(units),
                existing.id
            );

            inventory =
                db.prepare(`
                    SELECT *
                    FROM blood_inventory
                    WHERE id = ?
                `).get(existing.id);

        } else {

            const result =
                db.prepare(`
                    INSERT INTO blood_inventory
                    (
                        provider_id,
                        blood_group,
                        component,
                        units
                    )
                    VALUES (?, ?, ?, ?)
                `).run(
                    provider_id,
                    blood_group,
                    component,
                    Number(units)
                );


            inventory =
                db.prepare(`
                    SELECT *
                    FROM blood_inventory
                    WHERE id = ?
                `).get(result.lastInsertRowid);

        }


        res.status(201).json({
            success: true,
            inventory
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Unable to update blood inventory."
        });

    }

});


// Get provider inventory
app.get("/api/blood/inventory", (req, res) => {

    try {

        const {
            provider_id,
            blood_group,
            component
        } = req.query;


        let query = `
            SELECT
                blood_inventory.*,
                blood_providers.provider_name,
                blood_providers.provider_type,
                blood_providers.phone,
                blood_providers.district,
                blood_providers.address,
                blood_providers.latitude,
                blood_providers.longitude,
                blood_providers.availability
            FROM blood_inventory

            INNER JOIN blood_providers
                ON blood_inventory.provider_id =
                   blood_providers.id

            WHERE 1 = 1
        `;

        const params = [];


        if (provider_id) {

            query += `
                AND blood_inventory.provider_id = ?
            `;

            params.push(provider_id);
        }


        if (blood_group) {

            query += `
                AND blood_inventory.blood_group = ?
            `;

            params.push(blood_group);
        }


        if (component) {

            query += `
                AND blood_inventory.component = ?
            `;

            params.push(component);
        }


        query += `
            ORDER BY blood_providers.provider_name
        `;


        const inventory =
            db.prepare(query).all(...params);


        res.json({
            success: true,
            count: inventory.length,
            inventory
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Unable to retrieve blood inventory."
        });

    }

});


// =====================================================
// BLOOD AVAILABILITY SEARCH
// =====================================================

app.get("/api/blood/availability", (req, res) => {

    try {

        const {
            district,
            blood_group,
            component,
            units,
            latitude,
            longitude
        } = req.query;


        if (
            !district ||
            !validBloodGroup(blood_group) ||
            !validComponent(component) ||
            !units
        ) {

            return res.status(400).json({
                success: false,
                message: "District, blood group, component and units are required."
            });

        }


        const rows =
            db.prepare(`
                SELECT
                    blood_inventory.id,
                    blood_inventory.provider_id,
                    blood_inventory.blood_group,
                    blood_inventory.component,
                    blood_inventory.units,

                    blood_providers.provider_name,
                    blood_providers.provider_type,
                    blood_providers.phone,
                    blood_providers.district,
                    blood_providers.address,
                    blood_providers.latitude,
                    blood_providers.longitude,
                    blood_providers.availability

                FROM blood_inventory

                INNER JOIN blood_providers
                    ON blood_inventory.provider_id =
                       blood_providers.id

                WHERE blood_providers.district = ?
                AND blood_providers.availability = 'Available'
                AND blood_inventory.blood_group = ?
                AND blood_inventory.component = ?
                AND blood_inventory.units >= ?

                ORDER BY blood_inventory.units DESC
            `).all(
                district,
                blood_group,
                component,
                Number(units)
            );


        const userLat =
            Number(latitude);

        const userLon =
            Number(longitude);


        const results =
            rows.map(row => {

                let distance = null;


                if (
                    Number.isFinite(userLat) &&
                    Number.isFinite(userLon) &&
                    Number.isFinite(Number(row.latitude)) &&
                    Number.isFinite(Number(row.longitude))
                ) {

                    distance =
                        distanceKm(
                            userLat,
                            userLon,
                            Number(row.latitude),
                            Number(row.longitude)
                        );

                }


                return {
                    id: row.id,
                    provider_id: row.provider_id,
                    provider_name: row.provider_name,
                    provider_type: row.provider_type,
                    phone: row.phone,
                    district: row.district,
                    address: row.address,
                    blood_group: row.blood_group,
                    component: row.component,
                    units: row.units,
                    latitude: row.latitude,
                    longitude: row.longitude,
                    distance_km:
                        distance === null
                            ? null
                            : Number(distance.toFixed(2))
                };

            });


        results.sort((a, b) => {

            if (
                a.distance_km === null &&
                b.distance_km === null
            ) {
                return 0;
            }

            if (a.distance_km === null) {
                return 1;
            }

            if (b.distance_km === null) {
                return -1;
            }

            return a.distance_km - b.distance_km;

        });


        res.json({
            success: true,
            count: results.length,
            results
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Unable to search blood availability."
        });

    }

});


// =====================================================
// DONORS
// =====================================================

// Register donor
app.post("/api/blood/donors", (req, res) => {

    try {

        const {
            name,
            age,
            gender,
            phone,
            blood_group,
            district,
            address,
            latitude,
            longitude
        } = req.body;


        if (
            !name ||
            !phone ||
            !validBloodGroup(blood_group) ||
            !district
        ) {

            return res.status(400).json({
                success: false,
                message: "Name, phone, blood group and district are required."
            });

        }


        const result =
            db.prepare(`
                INSERT INTO blood_donors
                (
                    name,
                    age,
                    gender,
                    phone,
                    blood_group,
                    district,
                    address,
                    latitude,
                    longitude
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                name,
                age ?? null,
                gender ?? "",
                phone,
                blood_group,
                district,
                address || "",
                latitude ?? null,
                longitude ?? null
            );


        const donor =
            db.prepare(`
                SELECT *
                FROM blood_donors
                WHERE id = ?
            `).get(result.lastInsertRowid);


        res.status(201).json({
            success: true,
            donor
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Unable to register donor."
        });

    }

});


// Get donors
app.get("/api/blood/donors", (req, res) => {

    try {

        const {
            district,
            blood_group,
            availability
        } = req.query;


        let query = `
            SELECT *
            FROM blood_donors
            WHERE 1 = 1
        `;

        const params = [];


        if (district) {

            query += `
                AND district = ?
            `;

            params.push(district);
        }


        if (blood_group) {

            query += `
                AND blood_group = ?
            `;

            params.push(blood_group);
        }


        if (availability) {

            query += `
                AND availability = ?
            `;

            params.push(availability);
        }


        query += `
            ORDER BY name
        `;


        const donors =
            db.prepare(query).all(...params);


        res.json({
            success: true,
            count: donors.length,
            donors
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Unable to retrieve donors."
        });

    }

});


// Update donor availability
app.patch("/api/blood/donors/:id/status", (req, res) => {

    const allowed = [
        "Available",
        "Unavailable"
    ];


    const status =
        req.body.availability;


    if (!allowed.includes(status)) {

        return res.status(400).json({
            success: false,
            message: "Invalid donor availability."
        });

    }


    const result =
        db.prepare(`
            UPDATE blood_donors
            SET availability = ?
            WHERE id = ?
        `).run(
            status,
            req.params.id
        );


    if (result.changes === 0) {

        return res.status(404).json({
            success: false,
            message: "Donor not found."
        });

    }


    res.json({
        success: true,
        message: "Donor availability updated."
    });

});


// =====================================================
// BLOOD REQUESTS
// =====================================================

// Create blood request
// Create blood request
app.post("/api/blood/requests", (req, res) => {

    try {

        const {
    provider_id,
    donor_id,
    district,
    blood_group,
    component,
    units,
    latitude,
    longitude,
    hospital_name,
    hospital_address,
    contact_name,
    contact_phone,
    required_by
} = req.body;


        // Basic validation
        if (
            !district ||
            !validBloodGroup(blood_group) ||
            !validComponent(component) ||
            !Number.isInteger(Number(units)) ||
            Number(units) <= 0
        ) {

            return res.status(400).json({
                success: false,
                message: "Invalid blood request details."
            });

        }


        // Validate provider
        if (provider_id) {

            const provider =
                db.prepare(`
                    SELECT *
                    FROM blood_providers
                    WHERE id = ?
                    AND availability = 'Available'
                `).get(provider_id);


            if (!provider) {

                return res.status(404).json({
                    success: false,
                    message: "Selected blood provider is unavailable."
                });

            }

        }


        // Validate donor
        if (donor_id) {

            const donor =
                db.prepare(`
                    SELECT *
                    FROM blood_donors
                    WHERE id = ?
                    AND availability = 'Available'
                    AND blood_group = ?
                    AND district = ?
                `).get(
                    donor_id,
                    blood_group,
                    district
                );


            if (!donor) {

                return res.status(404).json({
                    success: false,
                    message: "Selected donor is unavailable or does not match the requirement."
                });

            }

        }


        // Create request
        const result =
            db.prepare(`
                INSERT INTO blood_requests
(
    provider_id,
    donor_id,
    district,
    blood_group,
    component,
    units,
    latitude,
    longitude,
    hospital_name,
    hospital_address,
    contact_name,
    contact_phone,
    required_by
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
    provider_id || null,
    donor_id || null,
    district,
    blood_group,
    component,
    Number(units),
    latitude ?? null,
    longitude ?? null,
    hospital_name || null,
    hospital_address || null,
    contact_name || null,
    contact_phone || null,
    required_by || null
);


        // Return created request with provider/donor information
        const request =
            db.prepare(`
                SELECT
                    blood_requests.*,

                    blood_providers.provider_name,
                    blood_providers.phone AS provider_phone,

                    blood_donors.name AS donor_name,
                    blood_donors.phone AS donor_phone

                FROM blood_requests

                LEFT JOIN blood_providers
                    ON blood_requests.provider_id =
                       blood_providers.id

                LEFT JOIN blood_donors
                    ON blood_requests.donor_id =
                       blood_donors.id

                WHERE blood_requests.id = ?
            `).get(result.lastInsertRowid);


        res.status(201).json({
            success: true,
            request
        });


    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Unable to create blood request."
        });

    }

});


// Get blood requests
// Get blood requests
app.get("/api/blood/requests", (req, res) => {

    try {

        const {
            district,
            status
        } = req.query;


        let query = `
            SELECT
                blood_requests.*,

                blood_providers.provider_name,
                blood_providers.phone AS provider_phone,

                blood_donors.name AS donor_name,
                blood_donors.phone AS donor_phone

            FROM blood_requests

            LEFT JOIN blood_providers
                ON blood_requests.provider_id =
                   blood_providers.id

            LEFT JOIN blood_donors
                ON blood_requests.donor_id =
                   blood_donors.id

            WHERE 1 = 1
        `;


        const params = [];


        if (district) {

            query += `
                AND blood_requests.district = ?
            `;

            params.push(district);
        }


        if (status) {

            query += `
                AND blood_requests.status = ?
            `;

            params.push(status);
        }


        query += `
            ORDER BY blood_requests.created_at DESC
        `;


        const requests =
            db.prepare(query).all(...params);


        res.json({
            success: true,
            count: requests.length,
            requests
        });


    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Unable to retrieve blood requests."
        });

    }

});


// Update blood request status
app.patch("/api/blood/requests/:id/status", (req, res) => {

    const allowed = [
        "Requested",
        "Matched",
        "Accepted",
        "Preparing",
        "Completed",
        "Cancelled"
    ];


    const status =
        req.body.status;


    if (!allowed.includes(status)) {

        return res.status(400).json({
            success: false,
            message: "Invalid blood request status."
        });

    }


    const result =
        db.prepare(`
            UPDATE blood_requests
            SET status = ?
            WHERE id = ?
        `).run(
            status,
            req.params.id
        );


    if (result.changes === 0) {

        return res.status(404).json({
            success: false,
            message: "Blood request not found."
        });

    }


    res.json({
        success: true,
        message: "Blood request status updated."
    });

});



// =====================================================
// START SERVER
// =====================================================

// Public blood-centre directory.
// Directory listings do not confirm current blood-stock availability.
app.get("/api/blood/directory", (req, res) => {
    try {
        const requestedDistrict = String(req.query.district || "")
            .trim()
            .toLowerCase();

        if (!requestedDistrict) {
            return res.status(400).json({
                success: false,
                message: "Please provide a district."
            });
        }

        const providers = BLOOD_CENTRE_DIRECTORY.filter(centre =>
            centre.district.toLowerCase() === requestedDistrict
        );

        return res.json({
            success: true,
            district: req.query.district,
            count: providers.length,
            providers
        });
    } catch (error) {
        console.error("Blood directory error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to load the blood-centre directory."
        });
    }
});

app.listen(PORT, () => {

    console.log(
        `CrisisLink Blood Services running on port ${PORT}`
    );

});