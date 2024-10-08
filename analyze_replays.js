// Analyze BAR replays!
// Uses the replay analyzer widget.

const NUM_WORKERS = 1; // increase this to spawn more parallel workers!

const fs = require('fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const util = require('node:util');
const exec = util.promisify(require('node:child_process').exec);

let barPath = process.env.BAR_PATH;
if (!barPath) {
    barPath = path.resolve(`${process.env.LOCALAPPDATA}/Programs/Beyond-All-Reason/data`)
}
console.log("BAR path: " + barPath);

let workers = new Set();
let port = 31337;

function getScript(replayPath) {
    port += 1;
    if (port >= 32337) {
        port = 31337;
    }
    return `[modoptions]
{
	MinSpeed = 9999;
	MaxSpeed = 9999;
}
[game]  
{  
    demofile="${replayPath}";
    hostport=${port};
}`
}

let downloadedGames = [];

function getGameVersions() {
    let versions;
    try {
        versions = JSON.parse(fs.readFileSync("./versions.json"));
    } catch (e) {
        versions = [];
        fs.writeFileSync("./versions.json", JSON.stringify(versions, null, 2));
    }
    return versions;
}

function hasGameVersion(version) {
    return getGameVersions().indexOf(version) > -1;
}

async function download(args) {
    await new Promise((resolve, reject) => {
        let outbuffer = [];
        let errbuffer = [];
        let start = new Date().getTime();
        const proc = spawn(`${barPath}/../bin/pr-downloader.exe`, ["--filesystem-writepath", barPath].concat(args), {
            cwd: barPath,
            env: Object.assign({}, process.env, {
                PRD_RAPID_USE_STREAMER: 'false',
                PRD_RAPID_REPO_MASTER: 'https://repos-cdn.beyondallreason.dev/repos.gz',
                PRD_HTTP_SEARCH_URL: 'https://files-cdn.beyondallreason.dev/find'
            })
        });
        proc.stdout.on('data', (data) => {
            outbuffer.push(data);
            if (outbuffer.length > 10) {
                outbuffer.shift();
            }
            if (new Date().getTime() - start > 20000) {
                process.stdout.write(data);
            }
        });
        proc.stderr.on('data', (data) => {
            errbuffer.push(data);
            if (errbuffer.length > 10) {
                errbuffer.shift();
            }   
            if (new Date().getTime() - start > 20000) {
                process.stderr.write(data);
            }
        });
        proc.on('close', (code) => {
            if (code > 0) {
                //reject(outbuffer.join('') + "\n-------\n" + errbuffer.join(''));
                reject(errbuffer.join(''));
            } else {
                resolve();
            }
        });
    });
}

async function downloadMap(mapname) {
    return download(["--download-map", mapname]);
}

async function downloadGame(gamename) {
    await download(["--download-game", gamename]);
    let versions = getGameVersions().concat(gamename);
    fs.writeFileSync("./versions.json", JSON.stringify(versions, null, 2));
}

async function makeJunction(folder, tgt) {
    const f = await exec(`mklink /J "${path.resolve(folder)}" "${path.resolve(tgt)}"`);
    //console.log(f.stdout);
    //console.log(f.stderr);
}

async function analyzeGame(gameFilename) {
    const data = JSON.parse(fs.readFileSync(`./replay_data/${gameFilename}`));
    const outPath = `./analysis_data/${data.id}.csv`;

    if (!fs.existsSync(outPath)) {
        const dataFolder = fs.mkdtempSync(`${path.resolve("./datadirs")}/data`);
        await makeJunction(`${dataFolder}/engine`, `${barPath}/engine`);
        await makeJunction(`${dataFolder}/pool`, `${barPath}/pool`);
        await makeJunction(`${dataFolder}/packages`, `${barPath}/packages`);
        await makeJunction(`${dataFolder}/rapid`, `${barPath}/rapid`);
        await makeJunction(`${dataFolder}/maps`, `${barPath}/maps`);
        await makeJunction(`${dataFolder}/games`, `${barPath}/games`);
        await makeJunction(`${dataFolder}/LuaUI`, `${barPath}/LuaUI`);
        
        if (!hasGameVersion(data.gameVersion)) {
            console.log(`Downloading game version: ${data.gameVersion}    used by ${gameFilename} in ${data.fileName}`);
            await downloadGame(data.gameVersion);
        }

        // check if the map is there; if not download it!
        if (!fs.existsSync(`${barPath}/maps/${data.Map.fileName}.sd7`)) {
            console.log("Need to download ", data.Map.scriptName);
            await downloadMap(data.Map.scriptName);
        }

        let analyzed = await analyzeReplay(path.resolve(dataFolder), path.resolve(`./demos/${data.fileName}`), data.engineVersion);
        if (analyzed) {
            // copy the results!
            fs.copyFileSync(`${dataFolder}/stats.csv`, outPath);
            fs.unlinkSync(`${dataFolder}/stats.csv`);
        }
        return true;
    }
    return false;
}

let ignoredReplays = [
    // add absolute path to .sdfz files here to ignore them!
]

async function analyzeReplay(dataDir, replayFilePath, engineVersion) {
    if (ignoredReplays.indexOf(replayFilePath) > -1 ) {
        console.log("Skipping replay ", replayFilePath);
        return false;
    }
    fs.writeFileSync(dataDir + "/_analyze_script.txt", getScript(replayFilePath));
    let exePath = `${dataDir}/engine/${engineVersion.split(' ')[0].toLowerCase()} bar/spring-headless.exe`;
    if (!fs.existsSync(exePath)) {
        console.log("Skipping replay ", replayFilePath, " -- reason: Engine version not found: ", engineVersion);
        return false;
    }
    console.log("analyzing ", replayFilePath);
    await new Promise((resolve, reject) => {
        let outbuffer = [];
        let errbuffer = [];
        let start = new Date().getTime();
        const proc = spawn(exePath, ["--write-dir", dataDir, "--isolation", "./_analyze_script.txt"], {
            cwd: dataDir
        });
        proc.stdout.on('data', (data) => {
            outbuffer.push(data);
            if (outbuffer.length > 10) {
                outbuffer.shift();
            }
            if (new Date().getTime() - start > 120000) {
                process.stdout.write(data);
            }
        });
        proc.stderr.on('data', (data) => {
            errbuffer.push(data);
            if (errbuffer.length > 10) {
                errbuffer.shift();
            }   
            if (new Date().getTime() - start > 120000) {
                process.stderr.write(data);
            }
        });
        proc.on('close', (code) => {
            if (code > 0) {
                //reject(outbuffer.join('') + "\n-------\n" + errbuffer.join(''));
                reject(errbuffer.join(''));
            } else {
                resolve();
            }
        });
    });
    return true;
}

function sleep(duration) {
    return new Promise(res => setTimeout(res, duration));
}

async function slotFree() {
    while(workers.size >= NUM_WORKERS) {
        //console.log("-------SLEEPING-------", workers.size);
        await sleep(100);
    }
    //console.log("done sleeping", workers.size);
}

async function main() {
    if (process.platform !== "win32") {
        throw new Error("Only Windows is supported at the moment!");
    }
    if (!fs.existsSync("analysis_data")) {
        fs.mkdirSync("analysis_data");
    }
    if (!fs.existsSync("datadirs")) {
        fs.mkdirSync("datadirs");
    }
    const games = fs.readdirSync("./replay_data");
    let i = games.length - 1;
    while (i >= 0) {
        await slotFree();
        let gameFilename = games[i];
        workers.add(gameFilename);
        ((num) => {
            analyzeGame(gameFilename).then(result => {
                console.log(num, result, gameFilename);
                workers.delete(gameFilename);
            }).catch(e => {
                console.log(num, "had errors!!!!");
            });
        })(i);
        i--;
    }
}

main().then(() => {

}).catch(e => {
    console.error(e);
});