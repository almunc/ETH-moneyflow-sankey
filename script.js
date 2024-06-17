const ALCHEMY_KEY = "put your Alchemy key here";

const excludedAddresses = {
    "0xd37bbe5744d730a1d98d8dc97c42f0ca46ad7146": "Thorswap Router (Bridge)",
    "0x1111111254eeb25477b68fb85ed929f73a960582": "1 inch v5 Router (Dex Agg.)",
    "0x1111111254fb6c44bac0bed2854e76f90643097d": "1 inch v4 Router (Dex Agg.)",
    "0x00000047bb99ea4d791bb749d970de71ee0b1a34": "Transitswap v5 Router (Dex Agg.)",
    "0x92e929d8b2c8430bcaf4cd87654789578bb2b786": "SWIFT Swap1.1 (Bridge)",
    "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD": "Uniswap: Universal Router (Dex)"
};

const MAX_PARALLEL_REQUESTS = 1;
var MAX_RECURSION_DEPTH = 4;
window.skipContracts = true;
window.maxOutflows = 25;
window.alreadyProcessedAddresses = new Set();
window.isDrawn = false;
window.nodes = {};
window.links = {};
window.suspectAddress = '';


class RequestQueue {
    constructor(maxParallelRequests) {
        this.maxParallelRequests = maxParallelRequests;
        this.queue = [];
        this.runningRequests = 0;
        this.isPaused = false;
    }

    addToQueue(fn) {
        this.queue.push(fn);
        this.checkQueue();
    }

    checkQueue() {
        if (this.isPaused) return; // Check pause flag
        if (this.runningRequests < this.maxParallelRequests && this.queue.length) {
            this.runningRequests++;
            const fn = this.queue.shift();
            fn().then(() => {
                this.runningRequests--;
                if(!this.isPaused)
                    this.checkQueue();
            });
        }
    }
}

window.requestQueue = new RequestQueue(MAX_PARALLEL_REQUESTS);


async function fetchWithRetry(url, options, retries = 2, delay = 1000) {
    try {
        const response = await fetch(url, options);
        if (response.status === 429 && retries > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
            return fetchWithRetry(url, options, retries - 1, delay);
        } else if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response;
    } catch (error) {
        if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
            return fetchWithRetry(url, options, retries - 1, delay);
        } else {
            console.error('Error fetching transfers:', error);
            throw error;
        }
    }
}


function getTransfersOfAddress(address) {
    const opts = {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            "id": 1,
            "jsonrpc": "2.0",
            "method": "alchemy_getAssetTransfers",
            "params": [{
                "fromBlock": "0x0",
                "toBlock": "latest",
                "fromAddress": address,
                "withMetadata": false,
                "excludeZeroValue": true,
                "maxCount": "0x3e8",
                "category": ["external", "internal", "erc20"]
            }]
        })
    };
    return fetchWithRetry(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`, opts);
}


async function processData(data, depth) {
    if (data.result) {
        const tos = new Set();
        for (const tx of data.result.transfers) {
            if (tx.from && tx.to) {
                if (tos.size > window.maxOutflows && !tos.has(tx.to)) continue;
                
                tos.add(tx.to);

                if (tx.asset !== "ETH") {
                    tx.value = await getTokenPriceInETH(tx.rawContract.address, tx.value);
                }
                
                await createNode(tx.from, tx.to, tx.value);

                if (depth >= MAX_RECURSION_DEPTH) {
                    continue;
                }

                if (!window.alreadyProcessedAddresses.has(tx.to) && (!window.skipContracts || !(await isContract(tx.to)))) {
                    window.alreadyProcessedAddresses.add(tx.to);
                    window.requestQueue.addToQueue(() =>
                        getTransfersOfAddress(tx.to)
                            .then(response => response.json())
                            .then(data => processData(data, depth + 1))
                    );
                }
            }
        }
    }

    const nodeCount = Object.keys(window.nodes).length;
    const drawInterval = 250 * Math.sqrt(nodeCount);
    if (Date.now() - window.lastDrawTime >= drawInterval) {
        window.lastDrawTime = Date.now();
        drawSankey();
    }

    if (depth === 1 && window.requestQueue.runningRequests === 0 && window.requestQueue.queue.length === 0) {
        if (!window.isDrawn) {
            window.isDrawn = true;
            drawSankey();
        }
    }
}


async function createNode(from, to, value) {
    // Mark as contract if necessary
    from = `${(await isContract(from)) ? "[c] " : ""}${from}`;
    to = `${(await isContract(to)) ? "[c] " : ""}${to}`;

    // Initialize nodes if not present
    if (!window.nodes[from]) window.nodes[from] = { id: from, value: 0, isSource: from === window.suspectAddress };
    if (!window.nodes[to]) window.nodes[to] = { id: to, value: 0, isSource: false };

    // Update node values by adding the new value
    window.nodes[from].value += parseFloat(value);
    window.nodes[to].value += parseFloat(value);

    // Generate a unique link identifier
    const linkId = `${from}-${to}`;
    // Initialize link if not present and add the new value
    if (!window.links[linkId]) {
        window.links[linkId] = { source: window.nodes[from], target: window.nodes[to], value: 0 };
    }
    window.links[linkId].value += parseFloat(value);
}


function drawSankey() {
    const nodeData = Object.values(window.nodes).sort((a, b) => b.isSource - a.isSource);
    const linkData = Object.values(window.links);

    const nodeIndices = nodeData.reduce((acc, node, index) => {
        acc[node.id] = index;
        return acc;
    }, {});

    const data = [{
        type: "sankey",
        node: {
            label: nodeData.map(node => node.id),
            value: nodeData.map(node => node.value),
        },
        link: {
            source: linkData.map(link => nodeIndices[link.source.id]),
            target: linkData.map(link => nodeIndices[link.target.id]),
            value: linkData.map(link => link.value),
        },
        orientation: "h"
    }];

    const resolution = nodeData.length > 200 ? 6000 : nodeData.length > 100 ? 4000 : nodeData.length > 30 ? 2000 : 1000;
    const layout = {
        title: `Forensic Transaction Analysis of ${window.suspectAddress}`,
        font: { size: 12 },
        height: resolution,
        width: resolution,
    };

    Plotly.react('myDiv', data, layout);
}


function start(e) {
    e.preventDefault();

    window.alreadyProcessedAddresses.clear();
    window.isDrawn = false;
    window.nodes = {};
    window.links = {};
    window.lastDrawTime = Date.now();
    window.requestQueue = new RequestQueue(MAX_PARALLEL_REQUESTS);
    pauseBtn.textContent = "Pause";

    const form = e.target.elements;
    window.suspectAddress = form.suspectAddress.value;
    MAX_RECURSION_DEPTH = form.maxDepth.value;
    window.maxOutflows = form.maxOutflows.value;
    window.skipContracts = form.skipContracts.value === "on";

    window.requestQueue.addToQueue(() =>
        getTransfersOfAddress(window.suspectAddress)
            .then(response => response.json())
            .then(data => {
                window.alreadyProcessedAddresses.add(window.suspectAddress);
                processData(data, 1);
            })
    );
}


function pause() {
    if(window.requestQueue.isPaused) {
        window.requestQueue.isPaused = false;
        pauseBtn.textContent = "Pause";
        window.requestQueue.checkQueue(); // Resume processing the queue
    }

    window.requestQueue.isPaused = true;
    pauseBtn.textContent = "Resume";
}


document.getElementById('form').addEventListener('submit', start);
const pauseBtn = document.getElementById('pauseBtn');
pauseBtn.addEventListener('click', pause);
