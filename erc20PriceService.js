const uniswapV2RouterAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const uniswapV2RouterABI = [
  // specific ABI items you needed `getAmountsOut`
  {
    "constant": true,
    "inputs": [
      { "name": "amountIn", "type": "uint256" },
      { "name": "path", "type": "address[]" }
    ],
    "name": "getAmountsOut",
    "outputs": [
      { "name": "amounts", "type": "uint256[]" }
    ],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  }
];

const tokenABI = [
  // Only the function needed to get decimals
  {
    "constant": true,
    "inputs": [],
    "name": "decimals",
    "outputs": [
      { "name": "", "type": "uint8" }
    ],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  }
];

// Create contract instances
const uniswapRouter = new web3.eth.Contract(uniswapV2RouterABI, uniswapV2RouterAddress);

cache = {}


async function getTokenPriceInETH(contractAddress, amount) {
    try {
        const tokenContract = new web3.eth.Contract(tokenABI, contractAddress);

        // decimals of the contract
        const decimals = await tokenContract.methods.decimals().call();

        // Check cache for the price of 1 token
        if (!cache[contractAddress]) {
            const amountInWei = BigInt(10) ** BigInt(decimals); // 1 whole token in wei
            const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
            const path = [contractAddress, WETH];
        
            const amountsOut = await uniswapRouter.methods.getAmountsOut(amountInWei, path).call();
            const pricePerTokenInETH = web3.utils.fromWei(amountsOut[1].toString(), 'ether');
        
            // Save the price of 1 token in the cache
            cache[contractAddress] = pricePerTokenInETH;
        }
    
        // Calculate the price for the given amount using the cached price
        const pricePerTokenInETH = cache[contractAddress];
        const amountInFloat = parseFloat(amount);
        const totalPriceInETH = amountInFloat * parseFloat(pricePerTokenInETH);
    
        return totalPriceInETH.toString();
    } catch (e) {
        cache[contractAddress] = 0;
        console.error("Error fetching token price:", typeof e, e);
        return "0";
    }
}
