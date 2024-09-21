// Download BAR replays!
// Stores API data in the 'replay_data' folder
// To refresh, just delete `data.json`

const fs = require('fs');
const stream = require('node:stream');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function download(game) {
    let filename = `./replay_data/${game.id}.json`;
    let data;
    if (!fs.existsSync(filename)) {
        data = await fetch(`https://api.bar-rts.com/replays/${game.id}`).then(data => data.json());
        fs.writeFileSync(filename, JSON.stringify(data, null, 2));
    } else {
        data = JSON.parse(fs.readFileSync(filename).toString());
    }
    //console.log(data);
    
    let replayfilename = `./demos/${data.fileName}`;
    if (!fs.existsSync(replayfilename)) {
        const file = fs.createWriteStream(replayfilename);
        const f = await fetch(`https://storage.uk.cloud.ovh.net/v1/AUTH_10286efc0d334efd917d476d7183232e/BAR/demos/${data.fileName}`).then(response => {
            return new Promise((resolve, reject) => {
                try {
                    const r = stream.Readable.fromWeb(response.body);
                    r.pipe(file);
                    r.on('end', () => {
                        resolve();
                    });
                } catch (e) {
                    reject(e);
                }
            })
        });
        file.end();
        return true;
    } else {
        return false;
    }
}

async function main() {
    if (!fs.existsSync("replay_data")) {
        fs.mkdirSync("replay_data");
    }
    if (!fs.existsSync("demos")) {
        fs.mkdirSync("demos");
    }
    let data;
    if (!fs.existsSync("./data.json")) {
        data = await fetch("https://api.bar-rts.com/replays?page=1&limit=10&preset=duel&hasBots=false&endedNormally=true&durationRangeMins=3&durationRangeMins=120").then(data => data.json());
        fs.writeFileSync('./data.json', JSON.stringify(data, null, 2));
    } else {
        data = JSON.parse(fs.readFileSync("./data.json").toString());
    }
    //console.log(data.data.length);

    let i = data.data.length - 1;
    while (i >= 0) {
        let downloaded = await download(data.data[i]);
        if (downloaded) {
            await sleep(5000);
            console.log(i);
        }
        i--;
    }
}

main().then(() => {

}).catch(e => {
    console.error(e);
});