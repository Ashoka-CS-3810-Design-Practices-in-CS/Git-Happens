# Smart Scheduler

DPCS Project 4 — team Git happens (Megha Mudakkayil, Yashita Mishra).

## Run the app
Double-click `index.html`. No server or install needed.

## Run the tests
Needs Node 18 or newer. From the project folder:

    npm test

## Structure
One folder per layer. Files are plain scripts loaded in order by `index.html`;
each attaches its functions to `window.SS` in the browser and uses
`module.exports` in Node tests. See `CONTRACTS.md` for the shared data shapes.

(Full README to be written at the end of the project.)
