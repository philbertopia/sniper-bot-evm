// 

const fs = require("fs");
const { WebSocketProvider, Contract, Wallet } = require('ethers');
const { ethers } = require('ethers');
const { parseEther } = require('ethers'); // Correct import for Ethers.js v6

const axios = require("axios");
require("dotenv").config();
const blockchain = require("./blockchain.json");

// const provider = new WebSocketProvider(process.env.LOCAL_RPC_URL_WS);
const provider = new WebSocketProvider(process.env.MAINNET_RPC_URL_WS);
const wallet = Wallet.fromPhrase(process.env.MNEMONIC, provider);
const factory = new Contract(
    blockchain.factoryAddress,
    blockchain.factoryAbi,
    provider
);

const router = new Contract(
    blockchain.routerAddress,
    blockchain.routerAbi,
    wallet
);

const SNIPE_LIST_FILE = "snipeList.csv";
const TOKEN_LIST_FILE = "tokenList.csv";

const TELEGRAM_API_URL = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const sendTelegramNotification = async (message) => {
    try {
        await axios.post(TELEGRAM_API_URL, {
            chat_id: CHAT_ID,
            text: message,
        });
        console.log("Notification sent to Telegram");
    } catch (error) {
        console.error("Error sending notification to Telegram:", error);
    }
};

const init = () => {
    // Event listener for new liquidity pool
    factory.on("PairCreated", (token0, token1, pairAddress) => {
        console.log(`
            New pair detected
            =================
            pairAddress: ${pairAddress}
            token0: ${token0}
            token1: ${token1}    
        `);

        // Save this info in a file
        if(token0 !== blockchain.WETHAddress && token1 !== blockchain.WETHAddress) return;
        const t0 = token0 === blockchain.WETHAddress ? token0 : token1;
        const t1 = token1 === blockchain.WETHAddress ? token1 : token0;
        fs.appendFileSync(SNIPE_LIST_FILE, `${pairAddress},${t0},${t1}\n`);

        // Send Notification
        // Send email to yourself API
        // Send the info to a googlesheet
        // Telegram
        // Discord

        // Send notification to Telegram
        const message = `New pair detected: ${pairAddress}\nToken0: ${t0}\nToken1: ${t1}`;
        sendTelegramNotification(message);
    });
};

// Sniping mechanism
const snipe = async() => {
    console.log("Snipe loop...");

    // Read and process the snipeList file
    let snipeList = fs.readFileSync(SNIPE_LIST_FILE);

    // Convert file contents to string and split by line
    snipeList = snipeList
        .toString()
        .split("\n")
        .filter(snipe => snipe !== ""); // Ensure no empty entries

    if(snipeList.length === 0) return; // If no tokens, exit

    for(const snipe of snipeList) {
        const [pairAddress, wethAddress, tokenAddress] = snipe.split(",");
        console.log(`Trying to snipe ${tokenAddress} on ${pairAddress}`);

        const tokenContract = new Contract(
            tokenAddress, 
            blockchain.erc20Abi, 
            wallet
        );

        const pair = new Contract(
            pairAddress,
            blockchain.pairAbi,
            wallet
        );
        

        ////////////
        // CHECKS //
        ////////////

        // Check for liquidity, If there is NO liquidity
        // const totalSupply = await pair.totalSupply();  // LP *(Liquidity Provider)
        // if(totalSupply === 0n) {
        //     console.log("Pool is empty, snipe is cancelled");
        //     continue;
        // }
        const reserves = await pair.getReserves();
        const wethReserves = reserves[0];  // Assuming WETH is token0

        if (wethReserves < parseEther("1")) {
            console.log("Rug pull alert: Low liquidity in the pool");
            return;
            // continue;
        }

        //Liquidity Pool Setup, Check if liquidity is sufficient
        // const liquidityPool = new Contract(pairAddress, blockchain.pairAbi, wallet);
        // const reserves = await liquidityPool.getReserves();
        // const wethReserves = reserves[0];  // Assuming WETH is token0

        // if (wethReserves < ethers.utils.parseEther("1")) {  // Ensure liquidity is sufficient (e.g., 1 ETH minimum)
        //     console.log("Rug pull alert: Low liquidity in the pool");
        //     return;
        // }


        // Token Ownership Distribution, check to see that any one wallet doesn't have more than 10% of the total supply
        // const tokenContract = new Contract(tokenAddress, blockchain.erc20Abi, wallet);
        const totalSupply = await tokenContract.totalSupply();
        const topHolders = await getTopHolders(tokenAddress); // You may need an API or custom method for this

        let isRugPull = false;
        for (const holder of topHolders) {
            const holderBalance = await tokenContract.balanceOf(holder.address);
            if (holderBalance > totalSupply * 0.1) {  // Check if any holder has more than 10% of the supply
                console.log(`Rug pull alert: Address ${holder.address} holds ${holderBalance} tokens`);
                isRugPull = true;
                break;
            }
        }

        if (isRugPull) continue;

        // Check for Blacklist
        const blacklistedMethods = ['addToBlacklist', 'removeLiquidity', 'lockLiquidity']; // Add other suspicious functions
        const contractMethods = Object.keys(tokenContract.functions);

        for (const method of blacklistedMethods) {
            if (contractMethods.includes(method)) {
                console.log(`Rug pull alert: Token has a suspicious function ${method}`);
                return;
            }
        }

        // Ownership Renounced Check
        const owner = await tokenContract.owner(); // Ensure the contract has the `owner()` function

        if (owner !== '0x0000000000000000000000000000000000000000') {
            console.log("Rug pull alert: Ownership has not been renounced");
            continue;
        }


        // Liquidity Lock Verification???
        // API from a third-party service to check if liquidity is locked for the pair???
        // No free API options available
        // Putting It Together in Your Bot
        // For a free solution, you can combine the following:
        // Etherscan/BscScan API: Query contract logs to identify liquidity lock transactions or check for ownership renouncement.
        // Token Sniffer: Scrape Token Sniffer for quick analysis of tokens and any potential red flags (like no liquidity lock).
        // Uniswap Subgraph: Use The Graph’s free subgraph to get liquidity pool data and infer whether liquidity remains locked/stable.
        // Scraping: Use Puppeteer or similar tools to scrape platforms like Mudra Locker, Team Finance, or PooCoin to verify liquidity locks.
        // Query the sourceCode of contracts using an API like Etherscan to identify hidden methods.


        // Check for High Transaction Fees
        const feePercent = await tokenContract.transactionFee(); // Example function
        if (feePercent > 5) { // If the token has more than 5% fee
            console.log("Rug pull alert: High transaction fee");
            return;
        }

        // Token Minting or Burning
        // Ensure the contract doesn't have unchecked minting or burning functionality that could affect supply dynamics
        const mintable = contractMethods.includes("mint");
        const burnable = contractMethods.includes("burn");

        if (mintable || burnable) {
            console.log("Rug pull alert: Token has mint/burn functions");
            return;
        }

        // If all checks pass, proceed with sniping...
        const tokenIn = wethAddress;
        const tokenOut = tokenAddress;

        // We buy 0.1 ETH of new token
        const amountIn = parseEther("0.1");
        const amounts = await router.getAmountsOut(amountIn, [tokenIn, tokenOut]);
        // Define price tolerance
        const amountOutMin = amounts[1] - amounts[1] * 5n / 100n;
        console.log(`
            Buying new token
            ================
            tokenIn: ${amountIn.toString()} ${tokenIn} (WETH)
            tokenOut: ${amountOut.toString()} ${tokenOut}
        `);
        const tx = router.swapExactTokensForTokens(
            amountIn,
            amountOutMin,
            [tokenIn, tokenOut],
            blockchain.recipient,
            Date.now() + 1000 * + 60 * 10 //10minutes from now
        );
        const receipt = await tx.wait();
        console.log(`Transaction receipt: ${receipt}`);

        // 1:42:51
        // const tx = router.swapExactTokensForTokens(
        //     amountIn,
        //     amountOutMin,
        //     [tokenIn, tokenOut],
        //     blockchain.recipient,
        //     Date.now() + 1000 * + 60 * 10 //10minutes from now
        // );

        // How to calculate the price token was purchased at
        // const balanceWethBefore //weth = new Contract() balanceOf()
        // const balanceWethAfter
        // const balanceTokenAfter
        // const price = balanceTokenAfter / (balanceWethBefore - balanceWethAfter)

        if(receipt.status === "1") {
            //1. add it to list of token bought
            fs.appendFileSync(TOKEN_LIST_FILE, `${receipt.blockNumber},${wethAddress},${tokenAddress},${amountOutMin / amountIn}\n`);

            //2. remove from snipelist
            let snipeList = fs.readFileSync(SNIPE_LIST_FILE).toString().split("\n");

            // Filter out the current pair from the list
            snipeList = snipeList.filter(snipe => {
                const [pairAddr, , ] = snipe.split(",");
                return pairAddr !== pairAddress;  // Keep all except the current pair
            });
        }
    }
};

// Define your stop-loss and take-profit percentages
const STOP_LOSS_PERCENTAGE = 10; // Stop loss at 10%
const TAKE_PROFIT_PERCENTAGE = 20; // Take profit at 20%

const managePosition = async () => {
    console.log("Managing positions...");

    //1. Stop loss
    // Read the token list to get current positions
    const tokenList = fs.readFileSync(TOKEN_LIST_FILE, 'utf-8').split("\n").filter(token => token !== "");

    for (const token of tokenList) {
        const [blockNumber, wethAddress, tokenAddress, purchasePrice] = token.split(",");

        const pair = new Contract(
            blockchain.factoryAddress,  // Assuming factoryAddress holds the pair contract address
            blockchain.pairAbi,
            wallet
        );

        // Get current token balance of the wallet
        const tokenContract = new Contract(
            tokenAddress, 
            blockchain.erc20Abi, 
            wallet
        );

        const balance = await tokenContract.balanceOf(wallet.address);

        if (balance.gt(0)) {  // Check if you have a balance greater than 0
            // Fetch current price of the token (you might need to implement this part)
            const amountsOut = await router.getAmountsOut(
                balance, 
                [tokenAddress, blockchain.WETHAddress]
            );
            const currentPrice = amountsOut[1].toNumber() / balance.toNumber(); // Current price per token

            // Calculate stop-loss price
            const stopLossPrice = purchasePrice * (1 - STOP_LOSS_PERCENTAGE / 100);
            // Calculate take-profit price
            const takeProfitPrice = purchasePrice * (1 + TAKE_PROFIT_PERCENTAGE / 100);

            console.log(`Current Price: ${currentPrice}, Stop Loss Price: ${stopLossPrice}, Take Profit Price: ${takeProfitPrice}`);

            // Check if current price is below the stop-loss price
            if (currentPrice < stopLossPrice) {
                console.log(`Executing stop-loss for ${tokenAddress}`);

                // Send Telegram notification
                await sendTelegramNotification(`Stop-loss triggered for ${tokenAddress}!\nCurrent Price: ${currentPrice}\nStop Loss Price: ${stopLossPrice}`);

                // Execute the sell order
                const amountOutMin = 0; // Set to 0 or define a minimum price tolerance
                const tx = await router.swapExactTokensForTokens(
                    balance,
                    amountOutMin,
                    [tokenAddress, blockchain.WETHAddress],
                    blockchain.recipient,
                    Date.now() + 1000 * 60 * 10 // 10 minutes from now
                );

                const receipt = await tx.wait();
                if (receipt.status === "1") {
                    console.log(`Stop-loss executed for ${tokenAddress}. Transaction: ${receipt.transactionHash}`);
                    // Telegram Notification stop loss executed
                    await sendTelegramNotification(`Stop-loss executed for ${tokenAddress}. Transaction Hash: ${receipt.transactionHash}`);
                    // Remove the token from the list after selling
                } else {
                    console.log(`Stop-loss transaction failed for ${tokenAddress}`);
                    await sendTelegramNotification(`Stop-loss transaction failed for ${tokenAddress}.`);
                }
            }

            // Take Profit
            // Check if current price is above the take-profit price
            if (currentPrice > takeProfitPrice) {
                console.log(`Executing take profit for ${tokenAddress}`);

                // Send Telegram notification
                await sendTelegramNotification(`Take profit triggered for ${tokenAddress}!\nCurrent Price: ${currentPrice}\nTake Profit Price: ${takeProfitPrice}`);

                // Execute the sell order
                const amountOutMin = 0; // Set to 0 or define a minimum price tolerance
                const tx = await router.swapExactTokensForTokens(
                    balance,
                    amountOutMin,
                    [tokenAddress, blockchain.WETHAddress],
                    blockchain.recipient,
                    Date.now() + 1000 * 60 * 10 // 10 minutes from now
                );

                const receipt = await tx.wait();
                if (receipt.status === "1") {
                    console.log(`Take profit executed for ${tokenAddress}. Transaction: ${receipt.transactionHash}`);
                    // Telegram Notification take profit executed
                    await sendTelegramNotification(`Take profit executed for ${tokenAddress}. Transaction Hash: ${receipt.transactionHash}`);
                    // Remove the token from the list after selling
                } else {
                    console.log(`Take profit transaction failed for ${tokenAddress}`);
                    // Telegram Notification take profit failed
                    await sendTelegramNotification(`Take profit transaction failed for ${tokenAddress}.`);
                }
            }
        }
    }
}


const timeout = ms => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

const main = async () => {
    console.log("Trading bot listening for new pairs on Uniswap v2...");
    init();
    while(true) {
        console.log("Heartbeat...")
        await snipe();
        await managePosition();
        await timeout(3000);
    }
}

main();
