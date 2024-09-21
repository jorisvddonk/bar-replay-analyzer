# BAR replay analyzer

Tools for analyzing [Beyond All Reason](https://www.beyondallreason.info/) replays. Currently only works on Windows, but with a bit of tweaking of the scripts you should be able to make it work on Linux.

Because replays only contain command lists and chat logs, the entire game will have to be simulated to be able to extract useful statistics from a replay. Thankfully, BAR by default ships with a headless version of the engine, `spring-headless`, which can be used for exactly such a purpose!

## NOTE

The tool currently expects an analysis widget to be installed in your Beyond All Reason installation, which should create a .csv file, `stats.csv` at the end and then close the game (via `Spring.Quit()`). No such widget is automatically installed nor currently available in this repository; you're expected to create one and add it yourself!

## Getting started

First, download some replays:

`node download_replays.js`

If you want to download more replays later, simply remove the `data.json` file and re-run the downloader.

Then, make sure you set the `BAR_PATH` environment variable to the `data` folder of your Beyond All Reason installation. You can find this by clicking 'Open install directory' in the BAR launcher.

You're now ready to analyze replays!

`node analyze_replays.js`

The analysis tool should download game versions and maps automatically. You need to set up engine versions manually yourself at the moment. Game versions that were downloaded are kept track of in `versions.json`, so if you change your game path, make sure you remove this file!
