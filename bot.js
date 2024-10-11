// "node bot.js" to start

const fs = require("fs");
const { WebSocketProvider, Contract, Wallet } = require('ethers');
const { ethers } = require('ethers');
const { parseEther } = require('ethers'); // Correct import for Ethers.js v6
const { formatEther } = require('ethers'); // Correct import for Ethers.js v6
const axios = require("axios");
require("dotenv").config();
const blockchain = require("./blockchain.json");

const etherscanApiKey = process.env.ETHERSCAN_API_KEY;

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

        const wethToken = token0 === blockchain.WETHAddress ? token0 : token1;
        const otherToken = token0 === blockchain.WETHAddress ? token1 : token0;
        
        // Log the values before saving
        console.log(`Saving pair: ${pairAddress}, WETH: ${wethToken}, Other: ${otherToken}`);

        // Ensure the other token is not also WETH
        if (otherToken !== blockchain.WETHAddress) {
            fs.appendFileSync(SNIPE_LIST_FILE, `${pairAddress},${wethToken},${otherToken}\n`);
        } else {
            console.log(`Skipping pair ${pairAddress} because both tokens are WETH`);
        }

        // Send Notification
        // Send email to yourself API
        // Send the info to a googlesheet
        // Telegram
        // Discord

        // Send notification to Telegram
        // const message = `New pair detected: ${pairAddress}\n WETH Token: ${wethToken}\n Other Token: ${otherToken}`;
        // sendTelegramNotification(message);
        // console.log(message);
    });
};

// sniping function
async function snipe() {
    console.log("Snipe loop...");

    // Step 1: Read and process the snipe list file
    let snipeList = fs.readFileSync(SNIPE_LIST_FILE, 'utf8')
        .toString()
        .split("\n")
        .filter(snipe => snipe.trim() !== "");

    if (snipeList.length === 0) return;
    // console.log("Snipe list:", snipeList);

    // If there are no tokens in the list, exit the function early.
    if(snipeList.length === 0) return;

    // Step 2: Iterate over each token/pair in the snipe list
    for(const snipe of snipeList) {
        // The snipe entry contains the pair address, WETH address, and token address
        const [pairAddress, wethAddress, tokenAddress] = snipe.split(",");
        console.log(`
            Pair address: ${pairAddress}
            WETH address: ${wethAddress}
            Token address: ${tokenAddress}
            Blockchain WETH Address: ${blockchain.WETHAddress}
        `);

        // Check if the WETH address in the snipe list matches the blockchain WETH address
        if (wethAddress.toLowerCase() !== blockchain.WETHAddress.toLowerCase()) {
            console.log("Error: WETH address in snipe list doesn't match blockchain WETH address");
            continue;
        }

        // Ensure wethAddress and tokenAddress are different
        if (wethAddress.toLowerCase() === tokenAddress.toLowerCase()) {
            console.log("Error: Input and output token addresses are identical");
            return;
        }

        // console.log(`Sniping: Input token (WETH): ${wethAddress}, Output token: ${tokenAddress}`);

        // Determine which token is WETH and which is the token to snipe
        let tokenIn, tokenOut;
        if (wethAddress.toLowerCase() === blockchain.WETHAddress.toLowerCase()) {
            tokenIn = wethAddress;
            tokenOut = tokenAddress;
        } else if (tokenAddress.toLowerCase() === blockchain.WETHAddress.toLowerCase()) {
            tokenIn = tokenAddress;
            tokenOut = wethAddress;
        } else {
            console.log("Skipping: Neither token is WETH. Cannot snipe.");
            continue;
        }

        // console.log(`Sniping: Input token (WETH): ${tokenIn}, Output token: ${tokenOut}`);

        ///////////////////////
        /// RUG PULL CHECKS ///
        ///////////////////////

        // Step 3: Rug pull checks
        // Check for low liquidity and possible ownership issues
        console.log("Checking pair address:", pairAddress);

        // When initializing a pair contract
        const pair = new Contract(
            pairAddress,
            blockchain.pairAbi,
            wallet
        );

        const tokenContract = new Contract(
            tokenAddress, 
            blockchain.erc20Abi, 
            wallet
        );

        try {
            // Liquididy check
            const reserves = await pair.getReserves();
            const token0 = await pair.token0();
            const token1 = await pair.token1();

            let wethReserves, tokenReserves;
            if (token0.toLowerCase() === blockchain.WETHAddress.toLowerCase()) {
                wethReserves = reserves[0];
                tokenReserves = reserves[1];
            } else {
                wethReserves = reserves[1];
                tokenReserves = reserves[0];
            }

            // Convert BigNumber to string before parsing
            const wethReservesEther = parseFloat(formatEther(wethReserves));
            const tokenReservesEther = parseFloat(formatEther(tokenReserves));

            console.log(`WETH Reserves: ${wethReservesEther} WETH`);
            console.log(`Token Reserves: ${tokenReservesEther} Tokens`);

            // Define minimum liquidity thresholds
            const minWethLiquidity = 1; // 1 WETH
            const minTokenLiquidity = 1000; // Adjust based on token decimals

            if (wethReservesEther < minWethLiquidity || tokenReservesEther < minTokenLiquidity) {
                console.log("Warning: Liquidity is below the minimum threshold!");
                continue;
            }

            // Check 2: Top holders check (ownership distribution)
            const totalSupply = await tokenContract.totalSupply();
            const getTopHolders = async (tokenAddress) => {
                try {
                    const url = `https://api.etherscan.io/api?module=account&action=tokentx&contractaddress=${tokenAddress}&page=1&offset=1000&sort=desc&apikey=${etherscanApiKey}`;
                    const response = await axios.get(url);
                    const transactions = response.data.result;

                    const holderBalances = {};

                    transactions.forEach(tx => {
                        const toAddress = tx.to.toLowerCase();
                        const value = BigInt(tx.value);

                        if (holderBalances[toAddress]) {
                            holderBalances[toAddress] += value;
                        } else {
                            holderBalances[toAddress] = value;
                        }
                    });

                    const holders = Object.keys(holderBalances).map(address => ({
                        address,
                        balance: holderBalances[address]
                    }));

                    holders.sort((a, b) => {
                        if (a.balance > b.balance) return -1;
                        if (a.balance < b.balance) return 1;
                        return 0;
                    });

                    console.log("Top holders:", holders);

                    return holders;
                
                } catch (error) {
                    console.error(`Failed to fetch top holders for token ${tokenAddress}:`, error);
                    return [];
                }
            }

            const topHolders = await getTopHolders(tokenAddress); // Placeholder for the actual implementation

            console.log("Top holders:", topHolders);

        } catch (error) {
            console.error("Error during rug pull checks:", error);
            // Add your error handling logic here
        }
    }
};

// // Sniping Function
// async function snipe(pair, inputTokenAddress, outputTokenAddress) {
//     console.log("Snipe loop...");

//     // Step 1: Read and process the snipe list file
//     // This file should contain a list of tokens (pairs) to be sniped, with each token on a new line.
//     let snipeList = fs.readFileSync(SNIPE_LIST_FILE);

//     // Convert the file contents into a string, then split it by line and filter out empty entries.
//     snipeList = snipeList
//         .toString()
//         .split("\n")
//         .filter(snipe => snipe !== ""); // Ensure no empty entries

//     // If there are no tokens in the list, exit the function early.
//     if(snipeList.length === 0) return;

//     // Step 2: Iterate over each token/pair in the snipe list
//     for(const snipe of snipeList) {
//         // The snipe entry contains the pair address, WETH address, and token address
//         const [pairAddress, wethAddress, tokenAddress] = snipe.split(",");
//         console.log(`Pair: ${pairAddress}`);
//         console.log(`WETH Address: ${wethAddress}`);
//         console.log(`Token Address: ${tokenAddress}`);
//         console.log(`Blockchain WETH Address: ${blockchain.WETHAddress}`);

//         if (wethAddress.toLowerCase() !== blockchain.WETHAddress.toLowerCase()) {
//             console.log("Error: WETH address in snipe list doesn't match blockchain WETH address");
//             continue;
//         }

//         // Ensure inputTokenAddress and outputTokenAddress are different ***
//         if (inputTokenAddress.toLowerCase() === outputTokenAddress.toLowerCase()) {
//             console.log("Error: Input and output token addresses are identical");
//             return;
//         }

//         console.log(`Sniping: Input token (WETH): ${inputTokenAddress}, Output token: ${outputTokenAddress}`);

//         // Determine which token is WETH and which is the token to snipe
//         let tokenIn, tokenOut;
//         if (wethAddress.toLowerCase() === blockchain.WETHAddress.toLowerCase()) {
//             tokenIn = wethAddress;
//             tokenOut = tokenAddress;
//         } else if (tokenAddress.toLowerCase() === blockchain.WETHAddress.toLowerCase()) {
//             tokenIn = tokenAddress;
//             tokenOut = wethAddress;
//         } else {
//             console.log("Skipping: Neither token is WETH. Cannot snipe.");
//             continue;
//         }

//         console.log(`Sniping: Input token (WETH): ${tokenIn}, Output token: ${tokenOut}`);

//         // Initialize the token contract
//         const tokenContract = new Contract(
//             tokenAddress, 
//             blockchain.erc20Abi, 
//             wallet
//         );

//         // console.log(" =================> token contact", tokenContract)

//         // Initialize the liquidity pool contract for the pair
//         const pair = new Contract(
//             pairAddress,
//             blockchain.pairAbi,
//             wallet
//         );

//         // console.log("=================> pair", pair)
        
//         /////////////////////
//         // RUG PULL CHECKS //
//         /////////////////////

//         // Step 3: Rug pull checks
//         // Check for low liquidity and possible ownership issues

//         // Check for liquidity, If there is NO liquidity do not buy
//         const reserves = await pair.getReserves();
//         const wethReserves = reserves[0];  // Assuming WETH is token0

//         // If the WETH reserves are lower than 1 ETH, this is likely a rug pull or low liquidity scenario.
//         if (wethReserves < parseEther("1")) {
//             console.log("Rug pull alert: Low liquidity in the pool");
//             continue; // Skip this token and move to the next one
//         }

//         // **Check 2: Top holders check (ownership distribution)**
//         // Fetch the total supply of the token
//         // Token Ownership Distribution (ensure no wallet has >10% of supply)
//         const totalSupply = await tokenContract.totalSupply();

//         // Use a custom method/API to get the list of top token holders (Custom method/API ????)
//         // Function to get the top holders of a given token
//         // const getTopHolders = async (tokenAddress) => {
//         //     try {
//         //     const url = `https://api.etherscan.io/api?module=account&action=tokentx&contractaddress=${tokenAddress}&page=1&offset=1000&sort=desc&apikey=${etherscanApiKey}`;
//         //     const response = await axios.get(url);
//         //     const transactions = response.data.result;

//         //     // Object to store balances of each holder as BigInt
//         //     const holderBalances = {};

//         //     // Iterate over each transaction to calculate balances
//         //     transactions.forEach(tx => {
//         //         const toAddress = tx.to.toLowerCase();
//         //         const value = BigInt(tx.value); // Convert the value to BigInt

//         //         // Add the value to the balance of the 'to' address
//         //         if (holderBalances[toAddress]) {
//         //         holderBalances[toAddress] += value;
//         //         } else {
//         //         holderBalances[toAddress] = value;
//         //         }
//         //     });
        
//         //     // Convert the balances object to an array for sorting
//         //     const holders = Object.keys(holderBalances).map(address => ({
//         //         address,
//         //         balance: holderBalances[address] // Keep balance as BigInt
//         //     }));

//         //     // Sort the holders based on balance (BigInt comparison)
//         //     holders.sort((a, b) => {
//         //         if (a.balance > b.balance) return -1;
//         //         if (a.balance < b.balance) return 1;
//         //         return 0;
//         //     });

//         //     return holders;
//         //     } catch (error) {
//         //     console.error(`Failed to fetch top holders for token ${tokenAddress}:`, error);
//         //     return [];
//         //     }
//         // };

//         // const topHolders = await getTopHolders(tokenAddress); // Placeholder for the actual implementation

//         // let isRugPull = false;

//         // // Check if any top holder has more than 10% of the total supply.
//         // for (const holder of topHolders) {
//         //     const holderBalance = await tokenContract.balanceOf(holder.address);
//         //     if (holderBalance > totalSupply * BigInt(0.1 * 10 ** 18)) {  // Check if any holder has more than 10% of the supply
//         //         console.log(`Rug pull alert: Address ${holder.address} holds ${holderBalance} tokens`);
//         //         isRugPull = true;
//         //         break; // No need to continue checking if we found a suspicious holder
//         //     }
//         // }

//         // // If the check found a rug pull risk, skip this token.
//         // if (isRugPull) {
//         //     continue; // Skip this token and move to the next one
//         // }

//         // **Check 3: Blacklisted methods**
//         // Some tokens include functions to manipulate liquidity or blacklist wallets.
//         // We define a list of suspicious functions to check for.
//         // const blacklistedMethods = ['addToBlacklist', 'removeLiquidity', 'lockLiquidity']; // Add other suspicious functions
        
//         // console.log(tokenContract.functions)

//         // // Get the list of all available functions in the token contract
//         // const contractMethods = Object.keys(tokenContract.functions);
        

//         // // Check if any suspicious method is present in the contract
//         // for (const method of blacklistedMethods) {
//         //     if (contractMethods.includes(method)) {
//         //         console.log(`Rug pull alert: Token has a suspicious function ${method}`);
//         //         continue;  // Skip this token if any blacklisted method is found
//         //     }
//         // }

//         // **Check 4: Ownership renounced check**
//         // In some cases, developers retain control over the token contract, making it risky.
//         // We check if ownership of the contract has been renounced (i.e., set to address 0x000...000).
//         // const owner = await tokenContract.owner(); // Ensure the contract has the `owner()` function

//         // if (owner !== '0x0000000000000000000000000000000000000000') {
//         //     console.log("Rug pull alert: Ownership has not been renounced");
//         //     continue;  // Skip this token and move to the next one
//         // }


//         // Liquidity Lock Verification???
//         // API from a third-party service to check if liquidity is locked for the pair???
//         // No free API options available
//         // Putting It Together in Your Bot
//         // For a free solution, you can combine the following:
//         // Etherscan/BscScan API: Query contract logs to identify liquidity lock transactions or check for ownership renouncement.
//         // Token Sniffer: Scrape Token Sniffer for quick analysis of tokens and any potential red flags (like no liquidity lock).
//         // Uniswap Subgraph: Use The Graph’s free subgraph to get liquidity pool data and infer whether liquidity remains locked/stable.
//         // Scraping: Use Puppeteer or similar tools to scrape platforms like Mudra Locker, Team Finance, or PooCoin to verify liquidity locks.
//         // Query the sourceCode of contracts using an API like Etherscan to identify hidden methods.


//         // **Check 5: High transaction fees check**
//         // Some tokens impose high fees on each transaction, making trading expensive.
//         // We use a custom method to check the transaction fee.
//         // const feePercent = await tokenContract.transactionFee(); // Custom method, implement as needed
//         // if (feePercent > 5) {
//         //     console.log("Rug pull alert: High transaction fee");
//         //     continue;  // Skip this token and move to the next one
//         // }

//         // **Check 6: Minting and burning functions check**
//         // Tokens with unchecked minting or burning functionality can affect supply unpredictably.
//         // const mintable = contractMethods.includes("mint");
//         // const burnable = contractMethods.includes("burn");

//         // if (mintable || burnable) {
//         //     console.log("Rug pull alert: Token has mint/burn functions");
//         //     continue;  // Skip this token and move to the next one
//         // }

//         // Step 4: If all rug pull checks are passed, proceed with the purchase

//         // The tokenIn (we're using WETH to buy the new token) and tokenOut (the new token we're sniping)
//         tokenIn = wethAddress;
//         tokenOut = tokenAddress;

//         // Define how much ETH to use for the snipe (in this case, 0.1 ETH)
//         const amountIn = parseEther("0.1");

//         // Get the expected amount of tokens we will receive for 0.1 ETH (from the liquidity pool)
//         const amounts = await router.getAmountsOut(amountIn, [tokenIn, tokenOut]);

//         // Define price tolerance
//         const amountOutMin = amounts[1] - amounts[1] * 5n / 100n; // Slippage tolerance

//         // Log the transaction details
//         console.log(`
//             Buying new token
//             ================
//             tokenIn: ${amountIn.toString()} ${tokenIn} (WETH)
//             tokenOut: ${amountOut.toString()} ${tokenOut}
//         `);

//         try {
//             // Execute the swap on the router (e.g., Uniswap router contract)
//             const tx = router.swapExactTokensForTokens(
//                 amountIn,
//                 amountOutMin,
//                 [tokenIn, tokenOut],
//                 blockchain.recipient,
//                 Date.now() + 1000 * + 60 * 10 // Transaction deadline (10 minutes)
//             );
//             const receipt = await tx.wait();

//             // Check if the transaction was successful
//             if (receipt.status === 1) {
//                 console.log(`Successfully sniped ${tokenAddress}`);

//                 // Step 5: Log the successful transaction and update the snipe list

//                 // Append the transaction to the token list file
//                 fs.appendFileSync(TOKEN_LIST_FILE, `${receipt.blockNumber},${wethAddress},${tokenAddress},${amountOutMin / amountIn}\n`);

//                 // Remove the sniped token from the snipe list
//                 snipeList = snipeList.filter(snipe => {
//                     const [pairAddr, , ] = snipe.split(",");
//                     return pairAddr !== pairAddress;  // Keep all except the current pair
//                 });

//                 // Write the updated snipe list back to the file
//                 fs.writeFileSync(SNIPE_LIST_FILE, snipeList.join("\n"));
//             }
//         } catch (error) {
//             console.log(`Failed to snipe ${tokenAddress}: ${error.message}`)
//         }
        
//         console.log(`Transaction receipt: ${receipt}`);

//         if(receipt.status === "1") {
//             //1. add it to list of token bought
//             fs.appendFileSync(TOKEN_LIST_FILE, `${receipt.blockNumber},${wethAddress},${tokenAddress},${amountOutMin / amountIn}\n`);

//             //2. remove from snipelist
//             let snipeList = fs.readFileSync(SNIPE_LIST_FILE).toString().split("\n");

//             // Filter out the current pair from the list
//             snipeList = snipeList.filter(snipe => {
//                 const [pairAddr, , ] = snipe.split(",");
//                 return pairAddr !== pairAddress;  // Keep all except the current pair
//             });
//         }
//      }
// };

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
};


const timeout = ms => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

const main = async () => {
    console.log("Trading bot listening for new pairs on Uniswap v2...");
    init();
    while(true) {
        console.log("Sniping...")
        await snipe();
        // await managePosition();
        await timeout(3000);
    }
}

main();
