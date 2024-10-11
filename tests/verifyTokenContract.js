const getTopHolders = require('./getTopHolders'); // Assuming the file is in the same directory

const tokenAddress = '0xa54c1441D9218A44CABf09A6C05Efe745107ec8A'; // Replace with the actual token address

getTopHolders(tokenAddress)
  .then(holders => {
    console.log('Top holders:', holders);
  })
  .catch(error => {
    console.error('Error fetching top holders:', error);
  });


// 0xa54c1441D9218A44CABf09A6C05Efe745107ec8A
