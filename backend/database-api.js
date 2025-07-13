const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const Datastore = require("@seald-io/nedb");
// Utility function to safely send response
function safeResponse(res, status, data) {
    if (!res.headersSent) {
        if (status >= 400) {
            res.status(status).json(data);
        } else {
            res.json(data);
        }
    }
}

// Helper to get or create a NeDB instance for a database
const nedbInstances = {};
function getNeDB(dbName) {
    const dbDir = path.join(__dirname, "data", dbName);
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
    const dbFile = path.join(dbDir, "nedb.db");
    if (!nedbInstances[dbName]) {
        nedbInstances[dbName] = new Datastore({ filename: dbFile, autoload: true });
    }
    return nedbInstances[dbName];
}

// Helper to get metadata file for all databases
const metaFile = path.join(__dirname, "data", "databases-meta.json");
function loadMeta() {
    if (!fs.existsSync(metaFile)) return {};
    return JSON.parse(fs.readFileSync(metaFile, "utf8"));
}
function saveMeta(meta) {
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
}

function registerDatabaseApi(app) {
    // List all databases (by scanning data folder)
    app.get("/databases", (req, res) => {
        const dataDir = path.join(__dirname, "data");
        let dbFolders = [];
        if (fs.existsSync(dataDir)) {
            dbFolders = fs.readdirSync(dataDir).filter((file) => {
                const fullPath = path.join(dataDir, file);
                return fs.statSync(fullPath).isDirectory();
            });
        }
        const meta = loadMeta();
        const databases = dbFolders.map((dbName) => ({
            name: dbName,
            ...(meta[dbName] || {}),
        }));
        safeResponse(res, 200, { databases, count: databases.length });
    });

    // Create database from schema
    app.post("/database/create", (req, res) => {
        const { schema, requestedSpace, allocatedPeers } = req.body;
        if (!schema || !schema.name) {
            return safeResponse(res, 400, { error: "Schema with name required" });
        }
        const dbName = schema.name;
        const dbDir = path.join(__dirname, "data", dbName);
        if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
        // Save metadata
        const meta = loadMeta();
        meta[dbName] = {
            id: schema.id || uuidv4(),
            name: dbName,
            tables: schema.tables || [],
            tablesCount: (schema.tables || []).length,
            createdAt: new Date().toISOString(),
            requestedSpace: requestedSpace || 0,
            usedSpace: 0,
            allocatedPeersCount: Array.isArray(allocatedPeers) ? allocatedPeers.length : 0,
            storageDistributionCount: 0,
        };
        saveMeta(meta);
        safeResponse(res, 200, {
            status: "created",
            database: dbName,
            tables: (schema.tables || []).map((t) => t.name),
            tablesCount: (schema.tables || []).length,
            allocatedSpace: requestedSpace || 0,
        });
    });

    // Add table to existing database
    app.post("/database/:dbName/table", (req, res) => {
        const { dbName } = req.params;
        const tableData = req.body;
        if (!tableData.name) {
            return safeResponse(res, 400, { error: "Table name is required" });
        }
        const meta = loadMeta();
        if (!meta[dbName]) {
            return safeResponse(res, 404, { error: "Database not found" });
        }
        if (!meta[dbName].tables) meta[dbName].tables = [];
        meta[dbName].tables.push({
            id: uuidv4(),
            name: tableData.name,
            columns: tableData.columns || [],
            createdAt: new Date().toISOString(),
        });
        meta[dbName].tablesCount = meta[dbName].tables.length;
        meta[dbName].updatedAt = new Date().toISOString();
        saveMeta(meta);
        safeResponse(res, 200, {
            success: true,
            message: `Table "${tableData.name}" added successfully`,
            table: tableData,
        });
    });

    // Get all tables for a specific database
    app.get("/database/:dbName/tables", (req, res) => {
        const { dbName } = req.params;
        const meta = loadMeta();
        if (!meta[dbName]) {
            return safeResponse(res, 404, { error: "Database not found" });
        }
        const tables = (meta[dbName].tables || []).map((table) => ({
            ...table,
            columnsCount: (table.columns || []).length,
        }));
        safeResponse(res, 200, {
            database: dbName,
            tables,
            count: tables.length,
        });
    });

    // Insert a record into a table
    app.post("/database/:dbName/:tableName", (req, res) => {
        const { dbName, tableName } = req.params;
        const record = req.body;
        if (!dbName || !tableName || !record) {
            return safeResponse(res, 400, {
                error: "Database, table, and record required",
            });
        }
        const meta = loadMeta();
        if (!meta[dbName]) {
            return safeResponse(res, 404, { error: "Database not found" });
        }
        const tableExists = (meta[dbName].tables || []).some(t => t.name === tableName);
        if (!tableExists) {
            return safeResponse(res, 404, { error: "Table not found" });
        }
        const db = getNeDB(dbName);
        record.id = record.id || uuidv4();
        record.createdAt = new Date().toISOString();
        record.table = tableName;
        db.insert(record, (err, newDoc) => {
            if (err) {
                return safeResponse(res, 500, { error: "Failed to insert record" });
            }
            safeResponse(res, 200, { success: true, record: newDoc });
        });
    });

    // Get all records from a table
    app.get("/database/:dbName/:tableName", (req, res) => {
        const { dbName, tableName } = req.params;
        const db = getNeDB(dbName);
        db.find({ table: tableName, deleted: { $ne: true } }, (err, docs) => {
            if (err) {
                return safeResponse(res, 500, { error: "Failed to fetch records" });
            }
            safeResponse(res, 200, {
                records: docs,
                count: docs.length,
                database: dbName,
                table: tableName,
            });
        });
    });

    // Update a record in a table
    app.put("/database/:dbName/:tableName/:id", (req, res) => {
        const { dbName, tableName, id } = req.params;
        const updateData = req.body;
        if (!dbName || !tableName || !id) {
            return safeResponse(res, 400, {
                error: "Database name, table name, and record ID are required",
            });
        }
        const db = getNeDB(dbName);
        updateData.updatedAt = new Date().toISOString();
        db.update({ id, table: tableName }, { $set: updateData }, {}, (err, numReplaced) => {
            if (err || numReplaced === 0) {
                return safeResponse(res, 404, { error: "Record not found or update failed" });
            }
            db.findOne({ id, table: tableName }, (err, doc) => {
                safeResponse(res, 200, {
                    success: true,
                    message: "Record updated successfully",
                    record: doc,
                });
            });
        });
    });

    // Delete a record in a table (soft delete)
    app.delete("/database/:dbName/:tableName/:id", (req, res) => {
        const { dbName, tableName, id } = req.params;
        const db = getNeDB(dbName);
        db.update({ id, table: tableName }, { $set: { deleted: true, deletedAt: new Date().toISOString() } }, {}, (err, numReplaced) => {
            if (err || numReplaced === 0) {
                return safeResponse(res, 404, { error: "Record not found or delete failed" });
            }
            safeResponse(res, 200, {
                success: true,
                message: "Record marked as deleted",
                id: id,
            });
        });
    });

    // Delete a table from a database (removes all records and table metadata)
    app.delete("/database/:dbName/table/:tableName", (req, res) => {
        const { dbName, tableName } = req.params;
        const db = getNeDB(dbName);
        db.update({ table: tableName }, { $set: { deleted: true, deletedAt: new Date().toISOString() } }, { multi: true }, (err) => {
            const meta = loadMeta();
            if (meta[dbName] && meta[dbName].tables) {
                meta[dbName].tables = meta[dbName].tables.filter((t) => t.name !== tableName);
                meta[dbName].tablesCount = meta[dbName].tables.length;
                meta[dbName].updatedAt = new Date().toISOString();
                saveMeta(meta);
            }
            safeResponse(res, 200, {
                success: true,
                message: `Table ${tableName} marked as deleted in ${dbName}`,
            });
        });
    });

    // Delete a database (removes all records and metadata)
    app.delete("/database/:dbName", (req, res) => {
        const { dbName } = req.params;
        const dbDir = path.join(__dirname, "data", dbName);
        const dbFile = path.join(dbDir, "nedb.db");
        if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
        if (fs.existsSync(dbDir)) fs.rmdirSync(dbDir, { recursive: true });
        const meta = loadMeta();
        delete meta[dbName];
        saveMeta(meta);
        safeResponse(res, 200, {
            success: true,
            message: `Database ${dbName} deleted`,
        });
    });

    // Rename a table in a database
    app.put("/database/:dbName/table/:tableName/rename", (req, res) => {
        const { dbName, tableName } = req.params;
        const { newName } = req.body;
        if (!newName) {
            return safeResponse(res, 400, { error: "New table name required" });
        }
        const db = getNeDB(dbName);
        db.update({ table: tableName }, { $set: { table: newName } }, { multi: true }, (err) => {
            const meta = loadMeta();
            if (meta[dbName] && meta[dbName].tables) {
                const table = meta[dbName].tables.find((t) => t.name === tableName);
                if (table) table.name = newName;
                meta[dbName].updatedAt = new Date().toISOString();
                saveMeta(meta);
            }
            safeResponse(res, 200, {
                success: true,
                message: `Table renamed from ${tableName} to ${newName}`,
            });
        });
    });
}

module.exports = { registerDatabaseApi };
