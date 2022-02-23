import { BigNumber, ethers, providers, Wallet } from "ethers";
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import tubbiesABIs from './abis/TubbiesABI.json';
import 'dotenv/config';

export enum FlashbotsBundleResolution {
    BundleIncluded,
    BlockPassedWithoutInclusion,
    AccountNonceTooHigh
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const GWEI = BigNumber.from(10).pow(9)
const PRIORITY_FEE = GWEI.mul(3)
const maxFeeForBlocksInTheFuture = 10;
const maxFeeWillingToPay = BigNumber.from(150000000000);

const saleStartTimeTimestamp = 1645634753000;
const contractAddress = "0xCa7cA7BcC765F77339bE2d648BA53ce9c8a262bD";

async function sendBundle(flashbotsProvider, wallet, tx, targetBlock) {
    // Send transaction to target the specified block
    const bundleSubmission = await flashbotsProvider.sendBundle([ {
        signer: wallet,
        transaction: tx
    }], targetBlock);

    console.log('bundle submitted, waiting')
    if ('error' in bundleSubmission) {
        throw new Error(bundleSubmission.error.message)
    }

    const waitResponse = await bundleSubmission.wait()
    console.log(`Wait Response: ${FlashbotsBundleResolution[waitResponse]}`)

    // If included, exit
    if (waitResponse === FlashbotsBundleResolution.BundleIncluded || waitResponse === FlashbotsBundleResolution.AccountNonceTooHigh) {
        console.log("Bundle included or account nonce too high");
        process.exit(0)
    } 
}

async function main() {
    const provider = new providers.InfuraProvider(Number(process.env.CHAIN_ID), process.env.INFURA_API_KEY);
    const wallet = new Wallet(process.env.PRIVATE_KEY as string, provider);
    const flashbotsProvider = await FlashbotsBundleProvider.create(provider, wallet);
    
    // Sleep until sale starts
    const currentTimestamp = new Date().getTime();
    const timeToWait = saleStartTimeTimestamp - currentTimestamp;
    console.log(`Time to wait ${(timeToWait / (1000 * 60 * 60)).toFixed(1)} hours or ${(timeToWait / (1000 * 60)).toFixed(1)} minutes`);
    await delay(timeToWait)
    
    // If the timestamp is passed, the next block will be accepted
    const latestBlock = await provider.getBlockNumber();
    const block = await provider.getBlock(latestBlock);
    var maxBaseFeeInFutureBlock = FlashbotsBundleProvider.getMaxBaseFeeInFutureBlock(BigNumber.from(block.baseFeePerGas), maxFeeForBlocksInTheFuture);

    // This is useless, you can just use maxFeeWillingToPay since the gas will be refunded
    if (maxBaseFeeInFutureBlock > maxFeeWillingToPay) {
        maxBaseFeeInFutureBlock = maxFeeWillingToPay;
    }

    const tx = {
        to: contractAddress,
        chainId: Number(process.env.CHAIN_ID),
        data: "0xf8b4d9810000000000000000000000000000000000000000000000000000000000000005",
        type: 2,
        value: ethers.utils.parseEther("0.5"),
        gasLimit: 150000,
        maxFeePerGas: PRIORITY_FEE.add(maxBaseFeeInFutureBlock),
        maxPriorityFeePerGas: PRIORITY_FEE
    };

    sendBundle(flashbotsProvider, wallet, tx, latestBlock + 1);

    let contract = new ethers.Contract(contractAddress, tubbiesABIs, provider);
    
    // tx might not be included or the block wasnt mined by an MEV miner
    provider.on('block', async (blockNumber) => {
        var currentSupply = await contract.totalSupply();

        if (currentSupply >= BigNumber.from(19995)) {
            console.log("Mission failed, we'll get them next time.")
            process.exit(0)
        }
        console.log(`Current supply ${currentSupply.toString()}. Re-trying on block ${blockNumber}`);
        // Re-try to following blocks 
        sendBundle(flashbotsProvider, wallet, tx, blockNumber + 1);
    });
}

main();