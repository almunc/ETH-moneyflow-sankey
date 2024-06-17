const web3 = new Web3(new Web3.providers.HttpProvider("https://ethereum-rpc.publicnode.com"));
// const web3 = new Web3(new Web3.providers.HttpProvider("https://eth.llamarpc.com"));  // an alternative RPC if needed - find more at https://chainlist.org/chain/1

var addressCache = {};

function isContract(address) {
    if (!address.startsWith("0x")) {
        return true;
    }

    if (address in addressCache) {
        return addressCache[address];
    }
    else {
        let p = web3.eth.getCode(address)
            .then(code => {
                let isContractAddress = code !== '0x';
                addressCache[address] = Promise.resolve(isContractAddress);
                return isContractAddress;
            })
            .catch(err => {
                console.error(err);
                // Remove failed promise from cache
                delete addressCache[address];
            });

        // already chache the promise instead of the final result
        addressCache[address] = p;
        return p;
    }
}
