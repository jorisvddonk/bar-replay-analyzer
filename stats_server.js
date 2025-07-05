const net = require('net');
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// command line usage:
const usage = `Usage:
node stats_server.js [options]
Options:
--port <port>    Specify the port to listen on (default: 12406)
--web-port <port> Specify the port for the web server (default: 3000)
--help           Show this help message
--log            Enable logging of received data (default: false)
--stats          Enable collection of stats (default: true)
--web            Enable web server (default: true)
--db <path>      Specify SQLite database path (default: ./stats.sqlite)
--no-db          Disable database storage (default: enabled)
`;



/* Stats format over the wire:
HELLO,replayID // emitted when a new replay starts
INFO,replayID,<raw JSON data> // emitted with all available replay info (e.g. game version, engine version, etc.)
UNITINFO,replayID,frameNum,status,unitID,unitDefID,unitTeam,unitName // status is either 'created', 'finished', or 'destroyed'
PLAYERSTATS,replayID,frameNum,'playerStats',playerID,teamID,allyTeamID,metalIncomePerSecond,energyIncomePerSecond,metalStored,energyStored,activeUnits,unitsDied,unitsKilled,unitsCaptured,damageDealt,damageReceived
BYE,replayID // emitted when the replay has ended

example: 
HELLO,c0b6f1662dfda4d42e07d471a5a68f16
INFO,c0b6f1662dfda4d42e07d471a5a68f16,{"id":"c0b6f1662dfda4d42e07d471a5a68f16","fileName":"2024-09-23_20-51-03-602.... SHORTENED FOR BREVITY ...}
PLAYERSTATS,c0b6f1662dfda4d42e07d471a5a68f16,3720,playerStats,0,0,0,241.112488,1200,11.2847166,6.00932026,20,0,0,0,0,0
PLAYERSTATS,c0b6f1662dfda4d42e07d471a5a68f16,3720,playerStats,1,1,1,537.328369,1250,0.67817938,8.01397991,13,0,0,0,0,0
PLAYERSTATS,c0b6f1662dfda4d42e07d471a5a68f16,3730,playerStats,0,0,0,240.35556,1200,10.0805655,6.00932026,20,0,0,0,0,0
PLAYERSTATS,c0b6f1662dfda4d42e07d471a5a68f16,3730,playerStats,1,1,1,540.581543,1250,1.73333347,8.01397991,13,0,0,0,0,0
UNITINFO,c0b6f1662dfda4d42e07d471a5a68f16,3697,finished,20740,99,0,armflea
UNITINFO,c0b6f1662dfda4d42e07d471a5a68f16,3698,created,13662,321,1,corfav
BYE,c0b6f1662dfda4d42e07d471a5a68f16
*/

// collect stats per replay
const replayStats = {};

// check if --stats option is provided; default is true
const collectStats = process.argv.includes('--stats') ? true : !process.argv.includes('--no-stats');

// check if --log option is provided
const logData = process.argv.includes('--log');

// Database configuration
const enableDatabase = !process.argv.includes('--no-db');
const dbPath = process.argv.includes('--db') ? 
    process.argv[process.argv.indexOf('--db') + 1] : 
    './stats.sqlite';

let db = null;
const activeReplays = new Set(); // Track active replays (simpler than transactions)

// Cleanup function for orphaned replays
function cleanupOrphanedReplays() {
    if (!enableDatabase || !db) return;
    
    // Find replays that have been active for more than 3 hours without activity
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    
    db.all(`SELECT replay_id FROM replay_sessions 
            WHERE status = 'active' AND last_activity < ?`, 
           [threeHoursAgo], (err, rows) => {
        if (err) {
            console.error('--Error finding orphaned replays:', err.message);
            return;
        }
        
        if (rows.length > 0) {
            console.log(`--Found ${rows.length} orphaned replay(s), cleaning up...`);
            
            rows.forEach(row => {
                const replayID = row.replay_id;
                
                db.serialize(() => {
                    // Clean up data for orphaned replay
                    db.run(`DELETE FROM player_stats WHERE replay_id = ?`, [replayID]);
                    db.run(`DELETE FROM unit_info WHERE replay_id = ?`, [replayID]);
                    db.run(`UPDATE replay_sessions SET status = 'orphaned' WHERE replay_id = ?`, [replayID]);
                    
                    // Remove from active replays
                    activeReplays.delete(replayID);
                    
                    console.log(`--Cleaned up orphaned replay: ${replayID}`);
                });
            });
        }
    });
}

// Run cleanup every 30 minutes
setInterval(cleanupOrphanedReplays, 30 * 60 * 1000);

// Initialize database if enabled
if (enableDatabase) {
    db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            console.error('--Error opening database:', err.message);
            process.exit(1);
        }
        console.log(`--Connected to SQLite database: ${dbPath}`);
    });

    // Configure SQLite for maximum performance with concurrent access
    db.serialize(() => {
        // Use WAL mode for better concurrent access and performance
        db.run("PRAGMA journal_mode = WAL");
        // Increase cache size for better performance
        db.run("PRAGMA cache_size = 10000");
        // Use OFF synchronous mode for maximum performance (data loss risk on system crash)
        db.run("PRAGMA synchronous = OFF");
        // Disable auto-checkpoint for better performance
        db.run("PRAGMA wal_autocheckpoint = 0");
        // Enable concurrent access
        db.run("PRAGMA busy_timeout = 30000");
    });

    // Create tables if they don't exist
    db.serialize(() => {
        // Replay tracking table
        db.run(`CREATE TABLE IF NOT EXISTS replay_sessions (
            replay_id TEXT PRIMARY KEY,
            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'active',
            last_activity DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Player stats table
        db.run(`CREATE TABLE IF NOT EXISTS player_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            replay_id TEXT NOT NULL,
            frame_num INTEGER NOT NULL,
            player_id INTEGER NOT NULL,
            team_id INTEGER NOT NULL,
            ally_team_id INTEGER NOT NULL,
            metal_income_per_second REAL NOT NULL,
            energy_income_per_second REAL NOT NULL,
            metal_stored REAL NOT NULL,
            energy_stored REAL NOT NULL,
            active_units INTEGER NOT NULL,
            units_died INTEGER NOT NULL,
            units_killed INTEGER NOT NULL,
            units_captured INTEGER NOT NULL,
            damage_dealt REAL NOT NULL,
            damage_received REAL NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Unit info table
        db.run(`CREATE TABLE IF NOT EXISTS unit_info (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            replay_id TEXT NOT NULL,
            frame_num INTEGER NOT NULL,
            status TEXT NOT NULL,
            unit_id INTEGER NOT NULL,
            unit_def_id INTEGER NOT NULL,
            unit_team INTEGER NOT NULL,
            unit_name TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Create indexes for better query performance
        db.run(`CREATE INDEX IF NOT EXISTS idx_replay_sessions_status ON replay_sessions(status)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_player_stats_replay_id ON player_stats(replay_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_unit_info_replay_id ON unit_info(replay_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_player_stats_frame ON player_stats(frame_num)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_unit_info_frame ON unit_info(frame_num)`);
    });
}

// Helper function to transform database rows to camelCase format
function transformPlayerStats(rows) {
    return rows.map(row => ({
        frameNum: row.frame_num,
        playerID: row.player_id,
        teamID: row.team_id,
        allyTeamID: row.ally_team_id,
        metalIncomePerSecond: row.metal_income_per_second,
        energyIncomePerSecond: row.energy_income_per_second,
        metalStored: row.metal_stored,
        energyStored: row.energy_stored,
        activeUnits: row.active_units,
        unitsDied: row.units_died,
        unitsKilled: row.units_killed,
        unitsCaptured: row.units_captured,
        damageDealt: row.damage_dealt,
        damageReceived: row.damage_received
    }));
}

// Helper function to parse replay info JSON
function parseReplayInfo(infoJson) {
    try {
        return JSON.parse(infoJson);
    } catch (e) {
        console.error('--Error parsing replay info JSON:', e.message);
        return { error: 'Invalid JSON format', raw: infoJson };
    }
}

function transformUnitInfo(rows) {
    return rows.map(row => ({
        frameNum: row.frame_num,
        status: row.status,
        unitID: row.unit_id,
        unitDefID: row.unit_def_id,
        unitTeam: row.unit_team,
        unitName: row.unit_name
    }));
}

// log help if needed
if (process.argv.includes('--help')) {
    console.log(usage);
    process.exit(0);
}

function processStatsLine(line) {
    if (!collectStats) {
        return; // skip processing if stats collection is disabled
    }
    
    // Split the line by commas
    const parts = line.split(',');
    if (parts.length < 2) {
        console.error('--Invalid stats line:', line);
        return;
    }
    // Extract the type and replay ID
    const type = parts[0];
    const replayID = parts[1];
    
    // Initialize the replay stats if not already done (only if database is disabled)
    if (!enableDatabase && !replayStats[replayID]) {
        replayStats[replayID] = {
            playerStats: [],
            unitInfo: []
        };
    }
    // Process based on the type
    if (type === 'HELLO') {
        // Clear previous stats for this replay ID from both memory and database
        console.log(`--Starting new replay session: ${replayID}`);
        
        // Clear from memory (only if database is disabled)
        if (!enableDatabase && replayStats[replayID]) {
            delete replayStats[replayID];
        }
        
        // Clear from database and track session if enabled
        if (enableDatabase && db) {
            // Clear existing data for this replay
            db.serialize(() => {
                // Clean up any existing data
                db.run(`DELETE FROM player_stats WHERE replay_id = ?`, [replayID], function(err) {
                    if (err) {
                        console.error('--Error clearing player stats from database:', err.message);
                    } else if (this.changes > 0) {
                        console.log(`--Cleared ${this.changes} player stats records for replay ${replayID}`);
                    }
                });
                
                db.run(`DELETE FROM unit_info WHERE replay_id = ?`, [replayID], function(err) {
                    if (err) {
                        console.error('--Error clearing unit info from database:', err.message);
                    } else if (this.changes > 0) {
                        console.log(`--Cleared ${this.changes} unit info records for replay ${replayID}`);
                    }
                });
                
                // Insert or update replay session tracking
                db.run(`INSERT OR REPLACE INTO replay_sessions (replay_id, started_at, status, last_activity) 
                        VALUES (?, CURRENT_TIMESTAMP, 'active', CURRENT_TIMESTAMP)`, 
                       [replayID], (err) => {
                    if (err) {
                        console.error('--Error tracking replay session:', err.message);
                    } else {
                        console.log(`--Started tracking session for replay: ${replayID}`);
                        activeReplays.add(replayID);
                    }
                });
            });
        }
    }
    else if (type === 'BYE') {
        // End replay session and sync to disk
        console.log(`--Ending replay session: ${replayID}`);
        
        if (enableDatabase && db && activeReplays.has(replayID)) {
            // Force synchronous write to disk
            db.run('PRAGMA wal_checkpoint(FULL)', (err) => {
                if (err) {
                    console.error('--Error forcing sync to disk:', err.message);
                } else {
                    console.log(`--Forced sync to disk for replay: ${replayID}`);
                }
            });
            
            // Mark session as completed
            db.run(`UPDATE replay_sessions SET status = 'completed', last_activity = CURRENT_TIMESTAMP 
                    WHERE replay_id = ?`, [replayID], (err) => {
                if (err) {
                    console.error('--Error updating replay session status:', err.message);
                } else {
                    console.log(`--Marked replay session as completed: ${replayID}`);
                }
            });
            
            activeReplays.delete(replayID);
        }
    }
    else if (type === 'INFO') {
        // Ensure the line has enough parts for info
        if (parts.length < 3) {
            console.error('--Invalid INFO line:', line);
            return;
        }
        // Extract info
        const replayInfo = {
            replayID: parts[1],
            data: parts.slice(2).join(',') // since the remainder of the data contains commas
        };

        // Store in memory if database is disabled
        if (!enableDatabase) {
            if (!replayStats[replayID]) {
                replayStats[replayID] = { playerStats: [], unitInfo: [], info: null };
            }
            try {
                // Parse the JSON data
                replayStats[replayID].info = JSON.parse(replayInfo.data);
            } catch (e) {
                console.error(`--Error parsing INFO JSON for replay ${replayID}:`, e.message);
                // Store as string if parsing fails
                replayStats[replayID].info = replayInfo.data;
            }
        }

        // Store in database if enabled
        if (enableDatabase && db) {
            // First, check if we need to create a replay_info table
            db.serialize(() => {
                // Create replay_info table if it doesn't exist
                db.run(`CREATE TABLE IF NOT EXISTS replay_info (
                    replay_id TEXT PRIMARY KEY,
                    info_json TEXT NOT NULL,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, (err) => {
                    if (err) {
                        console.error('--Error creating replay_info table:', err.message);
                        return;
                    }
                    
                    // Insert or replace the replay info
                    const stmt = db.prepare(`INSERT OR REPLACE INTO replay_info (
                        replay_id, info_json
                    ) VALUES (?, ?)`);
                    
                    stmt.run([replayID, replayInfo.data], function(err) {
                        if (err) {
                            console.error('--Error inserting replay info:', err.message);
                        } else if (logData) {
                            console.log(`--Stored INFO data for replay ${replayID}`);
                        }
                    });
                    stmt.finalize();
                    
                    // Update last activity for this replay
                    db.run(`UPDATE replay_sessions SET last_activity = CURRENT_TIMESTAMP WHERE replay_id = ?`, 
                           [replayID], (err) => {
                        if (err) {
                            console.error('--Error updating replay activity:', err.message);
                        }
                    });
                });
            });
        }
    }
    else if (type === 'PLAYERSTATS') {
        // Ensure the line has enough parts for player stats
        if (parts.length < 15) {
            console.error('--Invalid PLAYERSTATS line:', line);
            return;
        }
        // Extract player stats
        const playerStats = {
            frameNum: parseInt(parts[2], 10),
            playerID: parseInt(parts[4], 10),
            teamID: parseInt(parts[5], 10),
            allyTeamID: parseInt(parts[6], 10),
            metalIncomePerSecond: parseFloat(parts[7]),
            energyIncomePerSecond: parseFloat(parts[8]),
            metalStored: parseFloat(parts[9]),
            energyStored: parseFloat(parts[10]),
            activeUnits: parseInt(parts[11], 10),
            unitsDied: parseInt(parts[12], 10),
            unitsKilled: parseInt(parts[13], 10),
            unitsCaptured: parseInt(parts[14], 10),
            damageDealt: parseFloat(parts[15]),
            damageReceived: parseFloat(parts[16])
        };
        
        // Store in memory only if database is disabled
        if (!enableDatabase) {
            if (!replayStats[replayID]) {
                replayStats[replayID] = { playerStats: [], unitInfo: [] };
            }
            replayStats[replayID].playerStats.push(playerStats);
        }

        // Store in database if enabled
        if (enableDatabase && db) {
            // Update last activity for this replay
            db.run(`UPDATE replay_sessions SET last_activity = CURRENT_TIMESTAMP WHERE replay_id = ?`, 
                   [replayID], (err) => {
                if (err) {
                    console.error('--Error updating replay activity:', err.message);
                }
            });
            
            const stmt = db.prepare(`INSERT INTO player_stats (
                replay_id, frame_num, player_id, team_id, ally_team_id,
                metal_income_per_second, energy_income_per_second, metal_stored, energy_stored,
                active_units, units_died, units_killed, units_captured, damage_dealt, damage_received
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            
            stmt.run([
                replayID, playerStats.frameNum, playerStats.playerID, playerStats.teamID, playerStats.allyTeamID,
                playerStats.metalIncomePerSecond, playerStats.energyIncomePerSecond, playerStats.metalStored, playerStats.energyStored,
                playerStats.activeUnits, playerStats.unitsDied, playerStats.unitsKilled, playerStats.unitsCaptured,
                playerStats.damageDealt, playerStats.damageReceived
            ], function(err) {
                if (err) {
                    console.error('--Error inserting player stats:', err.message);
                }
            });
            stmt.finalize();
        }
    }
    else if (type === 'UNITINFO') {
        // Ensure the line has enough parts for unit info
        if (parts.length < 7) {
            console.error('--Invalid UNITINFO line:', line);
            return;
        }
        // Extract unit info
        const unitInfo = {
            frameNum: parseInt(parts[2], 10),
            status: parts[3], // 'created', 'finished', or 'destroyed'
            unitID: parseInt(parts[4], 10),
            unitDefID: parseInt(parts[5], 10),
            unitTeam: parseInt(parts[6], 10),
            unitName: parts.slice(7).join(',') // in case the name contains commas
        };
        
        // Store in memory only if database is disabled
        if (!enableDatabase) {
            if (!replayStats[replayID]) {
                replayStats[replayID] = { playerStats: [], unitInfo: [] };
            }
            replayStats[replayID].unitInfo.push(unitInfo);
        }

        // Store in database if enabled
        if (enableDatabase && db) {
            // Update last activity for this replay
            db.run(`UPDATE replay_sessions SET last_activity = CURRENT_TIMESTAMP WHERE replay_id = ?`, 
                   [replayID], (err) => {
                if (err) {
                    console.error('--Error updating replay activity:', err.message);
                }
            });
            
            const stmt = db.prepare(`INSERT INTO unit_info (
                replay_id, frame_num, status, unit_id, unit_def_id, unit_team, unit_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
            
            stmt.run([
                replayID, unitInfo.frameNum, unitInfo.status, unitInfo.unitID,
                unitInfo.unitDefID, unitInfo.unitTeam, unitInfo.unitName
            ], function(err) {
                if (err) {
                    console.error('--Error inserting unit info:', err.message);
                }
            });
            stmt.finalize();
        }
    }
    else {
        console.error('--Unknown stats type:', type);
    }
}


// Create a TCP server
const server = net.createServer((socket) => {
    // Log when a new client connects
    console.log(`--Client connected: ${socket.remoteAddress}:${socket.remotePort}`);

    // Set the encoding for incoming data (optional)
    socket.setEncoding('utf8');

    // Buffer for incomplete lines
    let buffer = '';

    // Handle incoming data
    socket.on('data', (data) => {
        // Add new data to buffer
        buffer += data.toString();
        
        // Process complete lines
        let lines = buffer.split('\n');
        
        // Keep the last incomplete line in buffer
        buffer = lines.pop() || '';
        
        // Process each complete line
        lines.forEach(line => {
            line = line.trim();
            if (line === '') {
                return; // skip empty lines
            }
            
            if (logData) {
                process.stdout.write(line + '\n');
            }
            processStatsLine(line);
        });
    });

    // Handle client disconnection
    socket.on('end', () => {
        // Process any remaining data in buffer
        if (buffer.trim() !== '') {
            const line = buffer.trim();
            if (logData) {
                process.stdout.write(line + '\n');
            }
            processStatsLine(line);
        }
        console.log(`--Client disconnected: ${socket.remoteAddress}:${socket.remotePort}`);
    });

    // Handle errors
    socket.on('error', (err) => {
        console.error(`--Socket error with ${socket.remoteAddress}:${socket.remotePort}:`, err);
    });
});

// Handle server errors
server.on('error', (err) => {
    console.error('--Server error:', err);
});

// Start listening on port 12406 or the port specified by --port option
const port = process.argv.includes('--port') ? parseInt(process.argv[process.argv.indexOf('--port') + 1], 10) : 12406;
server.listen(port, () => {
    console.log(`--TCP server listening on port ${port}`);
});

// Add web server to serve collected stats (only if web server is enabled):
const app = express();
app.use(cors());
app.use(express.json());
app.get('/stats/all', (req, res) => {
    if (enableDatabase && db) {
        // Get all data from database
        db.all(`SELECT DISTINCT replay_id FROM player_stats 
                UNION 
                SELECT DISTINCT replay_id FROM unit_info 
                UNION
                SELECT DISTINCT replay_id FROM replay_info
                ORDER BY replay_id`, (err, replayRows) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            
            const allStats = {};
            let completed = 0;
            const totalReplays = replayRows.length;
            
            if (totalReplays === 0) {
                res.json(allStats);
                return;
            }
            
            replayRows.forEach(row => {
                const replayID = row.replay_id;
                allStats[replayID] = { playerStats: [], unitInfo: [], info: null };
                
                // Get player stats
                db.all(`SELECT * FROM player_stats WHERE replay_id = ? ORDER BY frame_num, player_id`, 
                       [replayID], (err, playerStats) => {
                    if (err) {
                        res.status(500).json({ error: err.message });
                        return;
                    }
                    
                    allStats[replayID].playerStats = transformPlayerStats(playerStats);
                    
                    // Get unit info
                    db.all(`SELECT * FROM unit_info WHERE replay_id = ? ORDER BY frame_num`, 
                           [replayID], (err, unitInfo) => {
                        if (err) {
                            res.status(500).json({ error: err.message });
                            return;
                        }
                        
                        allStats[replayID].unitInfo = transformUnitInfo(unitInfo);
                        
                        // Get replay info
                        db.get(`SELECT info_json FROM replay_info WHERE replay_id = ?`, 
                               [replayID], (err, infoRow) => {
                            if (err) {
                                console.error('--Error fetching replay info:', err.message);
                            } else if (infoRow && infoRow.info_json) {
                                allStats[replayID].info = parseReplayInfo(infoRow.info_json);
                            }
                            
                            completed++;
                            
                            if (completed === totalReplays) {
                                res.json(allStats);
                            }
                        });
                    });
                });
            });
        });
    } else {
        // Fallback to memory data if database is disabled
        // DO NOT RECOMMEND USING THIS IN PRODUCTION, IT RETURNS ALL COLLECTED STATS WHICH CAN BE HUGE
        res.json(replayStats);
    }
});

app.get('/stats/replays', (req, res) => {
    if (enableDatabase && db) {
        // Get replay IDs from database
        db.all(`SELECT DISTINCT replay_id FROM player_stats 
                UNION 
                SELECT DISTINCT replay_id FROM unit_info 
                UNION
                SELECT DISTINCT replay_id FROM replay_info
                ORDER BY replay_id`, (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json(rows.map(row => row.replay_id));
        });
    } else {
        // Fallback to memory data if database is disabled
        const replayIDs = Object.keys(replayStats);
        res.json(replayIDs);
    }
});

app.get('/stats/:replayID', (req, res) => {
    const replayID = req.params.replayID;
    
    if (enableDatabase && db) {
        // Get data from database
        db.all(`SELECT * FROM player_stats WHERE replay_id = ? ORDER BY frame_num, player_id`, 
               [replayID], (err, playerStats) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            
            db.all(`SELECT * FROM unit_info WHERE replay_id = ? ORDER BY frame_num`, 
                   [replayID], (err, unitInfo) => {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }
                
                // Get replay info if available
                db.get(`SELECT info_json FROM replay_info WHERE replay_id = ?`, 
                       [replayID], (err, infoRow) => {
                    if (err) {
                        console.error('--Error fetching replay info:', err.message);
                    }
                    
                    if (playerStats.length === 0 && unitInfo.length === 0 && (!infoRow || !infoRow.info_json)) {
                        res.status(404).json({ error: 'Replay ID not found' });
                    } else {
                        const result = {
                            playerStats: transformPlayerStats(playerStats),
                            unitInfo: transformUnitInfo(unitInfo)
                        };
                        
                        // Add info if available
                        if (infoRow && infoRow.info_json) {
                            result.info = parseReplayInfo(infoRow.info_json);
                        }
                        
                        res.json(result);
                    }
                });
            });
        });
    } else {
        // Fallback to memory data if database is disabled
        if (replayStats[replayID]) {
            res.json(replayStats[replayID]);
        } else {
            res.status(404).json({ error: 'Replay ID not found' });
        }
    }
});

// Database-based API endpoints (if database is enabled)
if (enableDatabase && db) {
    // Get all replay IDs from database
    app.get('/db/replays', (req, res) => {
        db.all(`SELECT DISTINCT replay_id FROM player_stats 
                UNION 
                SELECT DISTINCT replay_id FROM unit_info 
                ORDER BY replay_id`, (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json(rows.map(row => row.replay_id));
        });
    });

    // Get player stats for a specific replay from database
    app.get('/db/stats/:replayID/players', (req, res) => {
        const replayID = req.params.replayID;
        db.all(`SELECT * FROM player_stats WHERE replay_id = ? ORDER BY frame_num, player_id`, 
               [replayID], (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json(transformPlayerStats(rows));
        });
    });

    // Get unit info for a specific replay from database
    app.get('/db/stats/:replayID/units', (req, res) => {
        const replayID = req.params.replayID;
        db.all(`SELECT * FROM unit_info WHERE replay_id = ? ORDER BY frame_num`, 
               [replayID], (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json(transformUnitInfo(rows));
        });
    });

    // Get replay info for a specific replay from database
    app.get('/db/stats/:replayID/info', (req, res) => {
        const replayID = req.params.replayID;
        db.get(`SELECT info_json FROM replay_info WHERE replay_id = ?`, 
               [replayID], (err, row) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            
            if (!row) {
                res.status(404).json({ error: 'Replay info not found' });
                return;
            }
            
            res.json(parseReplayInfo(row.info_json));
        });
    });

    // Get combined stats for a specific replay from database
    app.get('/db/stats/:replayID', (req, res) => {
        const replayID = req.params.replayID;
        
        // Get player stats
        db.all(`SELECT * FROM player_stats WHERE replay_id = ? ORDER BY frame_num, player_id`, 
               [replayID], (err, playerStats) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            
            // Get unit info
            db.all(`SELECT * FROM unit_info WHERE replay_id = ? ORDER BY frame_num`, 
                   [replayID], (err, unitInfo) => {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }
                
                // Get replay info
                db.get(`SELECT info_json FROM replay_info WHERE replay_id = ?`, 
                       [replayID], (err, infoRow) => {
                    if (err) {
                        console.error('--Error fetching replay info:', err.message);
                    }
                    
                    const result = {
                        playerStats: transformPlayerStats(playerStats),
                        unitInfo: transformUnitInfo(unitInfo)
                    };
                    
                    // Add info if available
                    if (infoRow && infoRow.info_json) {
                        result.info = parseReplayInfo(infoRow.info_json);
                    }
                    
                    res.json(result);
                });
            });
        });
    });

    // Get database statistics
    app.get('/db/info', (req, res) => {
        db.get(`SELECT COUNT(*) as player_stats_count FROM player_stats`, (err, playerCount) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            
            db.get(`SELECT COUNT(*) as unit_info_count FROM unit_info`, (err, unitCount) => {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }
                
                db.get(`SELECT COUNT(*) as replay_info_count FROM replay_info`, (err, infoCount) => {
                    if (err) {
                        // Table might not exist yet
                        infoCount = { replay_info_count: 0 };
                    }
                    
                    db.get(`SELECT COUNT(DISTINCT replay_id) as replay_count FROM (
                        SELECT replay_id FROM player_stats 
                        UNION 
                        SELECT replay_id FROM unit_info
                        UNION
                        SELECT replay_id FROM replay_info
                    )`, (err, replayCount) => {
                        if (err) {
                            res.status(500).json({ error: err.message });
                            return;
                        }
                        
                        db.all(`SELECT status, COUNT(*) as count FROM replay_sessions GROUP BY status`, (err, sessionStats) => {
                            if (err) {
                                res.status(500).json({ error: err.message });
                                return;
                            }
                            
                            res.json({
                                database_path: dbPath,
                                player_stats_count: playerCount.player_stats_count,
                                unit_info_count: unitCount.unit_info_count,
                                replay_info_count: infoCount.replay_info_count || 0,
                                replay_count: replayCount.replay_count,
                                session_stats: sessionStats
                            });
                        });
                    });
                });
            });
        });
    });

    // Get replay session information
    app.get('/db/sessions', (req, res) => {
        const status = req.query.status; // optional filter by status
        let query = 'SELECT * FROM replay_sessions';
        let params = [];
        
        if (status) {
            query += ' WHERE status = ?';
            params.push(status);
        }
        
        query += ' ORDER BY started_at DESC';
        
        db.all(query, params, (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json(rows);
        });
    });

    // Get active replay sessions
    app.get('/db/sessions/active', (req, res) => {
        db.all(`SELECT * FROM replay_sessions WHERE status = 'active' ORDER BY started_at DESC`, (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json(rows);
        });
    });

    // Manually cleanup orphaned replays
    app.post('/db/cleanup', (req, res) => {
        cleanupOrphanedReplays();
        res.json({ message: 'Cleanup initiated' });
    });
}
if (process.argv.includes('--web') ? true : !process.argv.includes('--no-web')) {
    // Enable web server if --web option is provided
    app.use(express.static('web')); // Serve static files from the 'web' directory
}
const webPort = process.argv.includes('--web-port') ? parseInt(process.argv[process.argv.indexOf('--web-port') + 1], 10) : 3000;
app.listen(webPort, () => {
    console.log(`--Web server listening on port ${webPort}`);
});

// Graceful shutdown handling
process.on('SIGINT', () => {
    console.log('\n--Received SIGINT, shutting down gracefully...');
    server.close(() => {
        console.log('--TCP server closed');
        if (enableDatabase && db) {
            // Mark any active sessions as interrupted
            if (activeReplays.size > 0) {
                console.log(`--Marking ${activeReplays.size} active sessions as interrupted...`);
                
                // Mark active sessions as interrupted
                db.run(`UPDATE replay_sessions SET status = 'interrupted' WHERE status = 'active'`, (err) => {
                    if (err) {
                        console.error('--Error marking sessions as interrupted:', err.message);
                    }
                    
                    db.close((err) => {
                        if (err) {
                            console.error('--Error closing database:', err.message);
                        } else {
                            console.log('--Database connection closed');
                        }
                        process.exit(0);
                    });
                });
            } else {
                db.close((err) => {
                    if (err) {
                        console.error('--Error closing database:', err.message);
                    } else {
                        console.log('--Database connection closed');
                    }
                    process.exit(0);
                });
            }
        } else {
            process.exit(0);
        }
    });
});

process.on('SIGTERM', () => {
    console.log('\n--Received SIGTERM, shutting down gracefully...');
    server.close(() => {
        console.log('--TCP server closed');
        if (enableDatabase && db) {
            // Mark any active sessions as interrupted
            if (activeReplays.size > 0) {
                console.log(`--Marking ${activeReplays.size} active sessions as interrupted...`);
                
                // Mark active sessions as interrupted
                db.run(`UPDATE replay_sessions SET status = 'interrupted' WHERE status = 'active'`, (err) => {
                    if (err) {
                        console.error('--Error marking sessions as interrupted:', err.message);
                    }
                    
                    db.close((err) => {
                        if (err) {
                            console.error('--Error closing database:', err.message);
                        } else {
                            console.log('--Database connection closed');
                        }
                        process.exit(0);
                    });
                });
            } else {
                db.close((err) => {
                    if (err) {
                        console.error('--Error closing database:', err.message);
                    } else {
                        console.log('--Database connection closed');
                    }
                    process.exit(0);
                });
            }
        } else {
            process.exit(0);
        }
    });
});
