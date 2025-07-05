# BAR Replay Analyzer

Tools for analyzing [Beyond All Reason](https://www.beyondallreason.info/) replays. The stats server works on both Windows and Linux, but the replay analyzer currently only supports Windows.

Because replays only contain command lists and chat logs, the entire game must be simulated to extract useful statistics. BAR ships with a headless version of the engine, `spring-headless`, which is perfect for this purpose!

## Features

- **Replay Download**: Automatically download replays from the BAR API
- **Batch Analysis**: Analyze multiple replays automatically (Windows only)
- **Real-time Stats Server**: TCP server that collects statistics during replay analysis
- **SQLite Database**: Persistent storage of replay statistics with transaction support
- **Session Tracking**: Monitor active replays and cleanup orphaned data
- **Web API**: REST endpoints to query collected statistics
- **Performance Optimized**: High-speed data collection with delayed disk writes
- **Replay Info Storage**: Captures and stores detailed replay metadata including players, map, and game settings
- **Web Interface**: Visual representation of replay statistics with interactive charts and replay information

## Components

### 1. Replay Downloader (`download_replays.js`)
Downloads replays from the BAR API and stores metadata.

### 2. Replay Analyzer (`analyze_replays.js`)
Runs replays through the headless engine to extract statistics. **Currently Windows only.**

### 3. Stats Server (`stats_server.js`)
Real-time statistics collection server with database storage and web API. Works on Windows and Linux.

### 4. Analysis Widget (`stats_test.lua`)
Lua widget that collects statistics during replay playback and sends them to the stats server.

### 5. Web Interface
Interactive visualization of replay statistics with charts and detailed replay information.

## Getting Started

### Prerequisites

1. **Beyond All Reason** installed
2. **Node.js** with npm

### Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```

### Setup

1. **Download replays:**
   ```bash
   node download_replays.js
   ```
   To download more replays later, remove `data.json` and re-run.

2. **Set BAR path:**
   Set the `BAR_PATH` environment variable to your BAR `data` folder:
   ```bash
   # Windows
   set BAR_PATH=C:\Users\YourName\Documents\My Games\Beyond All Reason\data

   # Linux
   export BAR_PATH=/home/yourname/.local/share/Beyond All Reason/data
   ```

3. **Start the stats server:**
   ```bash
   node stats_server.js
   ```

4. **Analyze replays (Windows only):**
   ```bash
   node analyze_replays.js
   ```

## Stats Server

The stats server collects real-time statistics during replay analysis and provides a web API for querying the data.

### Command Line Options

```bash
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
```

### Message Protocol

The stats server accepts these message types over TCP:

```
HELLO,replayID                    # Start new replay session, clear old data
INFO,replayID,<raw JSON data>     # Information about the replay
PLAYERSTATS,replayID,frameNum,... # Player statistics data
UNITINFO,replayID,frameNum,...    # Unit information data
BYE,replayID                      # End session, commit to database
```

### Database Features

- **Transaction-based**: Data is buffered in memory until `BYE` message
- **High Performance**: Uses `synchronous = OFF` with manual sync on completion
- **WAL Mode**: Write-Ahead Logging for better concurrent access
- **Session Tracking**: Monitor active replays and cleanup orphaned data
- **Automatic Indexing**: Optimized queries for replay and frame-based lookups

### Web API Endpoints

#### Memory-based Endpoints (fallback when DB disabled)
- `GET /stats/all` - All collected statistics
- `GET /stats/replays` - List of replay IDs
- `GET /stats/:replayID` - Statistics for specific replay

#### Database Endpoints
- `GET /db/replays` - All replay IDs from database
- `GET /db/stats/:replayID` - Complete stats for replay
- `GET /db/stats/:replayID/players` - Player stats only
- `GET /db/stats/:replayID/units` - Unit info only
- `GET /db/stats/:replayID/info` - Replay metadata and information
- `GET /db/info` - Database statistics and info
- `GET /db/sessions` - All replay sessions (with optional ?status= filter)
- `GET /db/sessions/active` - Currently active replay sessions
- `POST /db/cleanup` - Manually trigger cleanup of orphaned replays

### Example Usage

```bash
# Start server with custom database
node stats_server.js --db ./my_stats.sqlite --port 8080

# Start without database (memory only)
node stats_server.js --no-db

# Enable logging for debugging
node stats_server.js --log
```

## Analysis Widget Requirements

The repository includes an analysis widget (`stats_test.lua`) that collects statistics during replay playback and sends them to the stats server.

### Automatic Installation

The `analyze_replays.js` script automatically handles widget installation by:
1. Creating a temporary BAR data folder for analysis
2. Copying the `stats_test.lua` widget into the appropriate directory
3. Running replays in this isolated environment

**No manual widget installation is required** when using the batch analyzer.

### Manual Installation (Optional)

If you want to use the widget outside of the batch analyzer, copy `stats_test.lua` to your BAR widgets directory:
- **Windows**: `%USERPROFILE%\Documents\My Games\Beyond All Reason\data\LuaUI\Widgets\`
- **Linux**: `~/.local/share/Beyond All Reason/data/LuaUI/Widgets/`

## File Structure

- `download_replays.js` - Replay downloader
- `analyze_replays.js` - Batch replay analyzer (Windows only)
- `stats_server.js` - Statistics collection server
- `stats_test.lua` - Analysis widget for BAR
- `data.json` - Downloaded replay metadata
- `versions.json` - Game version tracking
- `demos/` - Downloaded replay files
- `replay_data/` - Analysis output
- `stats.sqlite` - Statistics database (created automatically)
- `web/` - Static web files

## Performance Notes

- The stats server uses SQLite with optimized settings for high-throughput data collection
- Database writes are batched per replay for maximum performance
- WAL mode allows concurrent reads during analysis
- Transaction-based approach ensures data consistency

## Troubleshooting

1. **Connection errors**: Ensure stats server is running before starting analysis
2. **Database locked**: Only one analysis should run at a time
3. **Missing data**: Check that BYE messages are sent to commit transactions
4. **Performance issues**: Monitor database size and consider periodic cleanup

## Web Interface

The web interface provides a visual representation of replay statistics with interactive charts and detailed replay information.

### Features

- **Replay Selection**: Choose from available replays with an easy-to-use dropdown
- **Replay Information**: View detailed metadata about the replay including:
  - Game version and engine information
  - Map details
  - Player information (names, factions, teams, skills)
  - Game duration and start time
  - Awards and achievements
- **Interactive Charts**: Visualize game statistics with dynamic charts:
  - Metal and energy income/storage
  - Unit counts and lifecycle
  - Damage dealt and received
- **Unit Information**: Detailed breakdown of units created, destroyed, and completed
- **Category Filtering**: Toggle between different stat categories (metal, energy, units, damage)
- **Raw Data Access**: Option to view the underlying JSON data

### Accessing the Web Interface

The web interface is automatically served when the stats server is running. By default, it's available at:

```
http://localhost:3000
```

You can customize the web port using the `--web-port` option when starting the stats server.

## Contributing

Feel free to submit issues and pull requests. The codebase supports both Windows and Linux environments.
