const net = require('net');
const express = require('express');
const cors = require('cors');

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
`;



/* Stats format over the wire:
UNITINFO,replayID,frameNum,status,unitID,unitDefID,unitTeam,unitName // status is either 'created', 'finished', or 'destroyed'
PLAYERSTATS,replayID,frameNum,'playerStats',playerID,teamID,allyTeamID,metalIncomePerSecond,energyIncomePerSecond,metalStored,energyStored,activeUnits,unitsDied,unitsKilled,unitsCaptured,damageDealt,damageReceived

example: 
PLAYERSTATS,c0b6f1662dfda4d42e07d471a5a68f16,3720,playerStats,0,0,0,241.112488,1200,11.2847166,6.00932026,20,0,0,0,0,0
PLAYERSTATS,c0b6f1662dfda4d42e07d471a5a68f16,3720,playerStats,1,1,1,537.328369,1250,0.67817938,8.01397991,13,0,0,0,0,0
PLAYERSTATS,c0b6f1662dfda4d42e07d471a5a68f16,3730,playerStats,0,0,0,240.35556,1200,10.0805655,6.00932026,20,0,0,0,0,0
PLAYERSTATS,c0b6f1662dfda4d42e07d471a5a68f16,3730,playerStats,1,1,1,540.581543,1250,1.73333347,8.01397991,13,0,0,0,0,0
UNITINFO,c0b6f1662dfda4d42e07d471a5a68f16,3697,finished,20740,99,0,armflea
UNITINFO,c0b6f1662dfda4d42e07d471a5a68f16,3698,created,13662,321,1,corfav
*/

// collect stats per replay
const replayStats = {};

// check if --stats option is provided; default is true
const collectStats = process.argv.includes('--stats') ? true : !process.argv.includes('--no-stats');

// check if --log option is provided
const logData = process.argv.includes('--log');

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
    if (parts.length < 3) {
        console.error('--Invalid stats line:', line);
        return;
    }
    // Extract the type and replay ID
    const type = parts[0];
    const replayID = parts[1];
    // Initialize the replay stats if not already done
    if (!replayStats[replayID]) {
        replayStats[replayID] = {
            playerStats: [],
            unitInfo: []
        };
    }
    // Process based on the type
    if (type === 'PLAYERSTATS') {
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
        replayStats[replayID].playerStats.push(playerStats);
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
        replayStats[replayID].unitInfo.push(unitInfo);
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

    // Handle incoming data
    socket.on('data', (data) => {
        // data can contain multiple lines, so we need to process each line
        const lines = data.toString().split('\n');
        // Process each line
        lines.forEach(l => {
            const line = l.trim();
            if (line === '') {
                return; // skip empty lines
            }
            //console.log(`--Received data from ${socket.remoteAddress}:${socket.remotePort}:`);
            // write without newline
            if (logData) {
                process.stdout.write(line + '\n');
            }
            processStatsLine(line);
        });
    });

    // Handle client disconnection
    socket.on('end', () => {
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
    // DO NOT RECOMMEND USING THIS IN PRODUCTION, IT RETURNS ALL COLLECTED STATS WHICH CAN BE HUGE
    res.json(replayStats);
});
app.get('/stats/replays', (req, res) => {
    const replayIDs = Object.keys(replayStats);
    res.json(replayIDs);
});
app.get('/stats/:replayID', (req, res) => {
    const replayID = req.params.replayID;
    if (replayStats[replayID]) {
        res.json(replayStats[replayID]);
    } else {
        res.status(404).json({ error: 'Replay ID not found' });
    }
});
if (process.argv.includes('--web') ? true : !process.argv.includes('--no-web')) {
    // Enable web server if --web option is provided
    app.use(express.static('web')); // Serve static files from the 'web' directory
}
const webPort = process.argv.includes('--web-port') ? parseInt(process.argv[process.argv.indexOf('--web-port') + 1], 10) : 3000;
app.listen(webPort, () => {
    console.log(`--Web server listening on port ${webPort}`);
});
