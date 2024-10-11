require('dotenv').config();
const axios = require('axios');
const etherscanApiKey = process.env.ETHERSCAN_API_KEY;

// Function to get the top holders of a given token
const getTopHolders = async (tokenAddress) => {
    try {
        const url = `https://api.etherscan.io/api?module=account&action=tokentx&contractaddress=${tokenAddress}&page=1&offset=1000&sort=desc&apikey=${etherscanApiKey}`;
        const response = await axios.get(url);
        const transactions = response.data.result;

        // Object to store balances of each holder as BigInt
        const holderBalances = {};

        // Iterate over each transaction to calculate balances
        transactions.forEach(tx => {
            const toAddress = tx.to.toLowerCase();
            const value = BigInt(tx.value); // Convert the value to BigInt

            // Add the value to the balance of the 'to' address
            if (holderBalances[toAddress]) {
                holderBalances[toAddress] += value;
            } else {
                holderBalances[toAddress] = value;
            }
        });

        // Convert the balances object to an array for sorting
        const holders = Object.keys(holderBalances).map(address => ({
            address,
            balance: holderBalances[address] // Keep balance as BigInt
        }));

        // Sort the holders based on balance (BigInt comparison)
        holders.sort((a, b) => {
            if (a.balance > b.balance) return -1;
            if (a.balance < b.balance) return 1;
            return 0;
        });

        return holders;
    } catch (error) {
        console.error(`Failed to fetch top holders for token ${tokenAddress}:`, error);
        return [];
    }
};

// Export the function for use in other files
module.exports = getTopHolders;
