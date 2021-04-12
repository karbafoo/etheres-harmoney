"use strinct";
import { Logger } from '@ethersproject/logger';
import { defineReadOnly, getStatic, shallowCopy } from '@ethersproject/properties';
import { showThrottleMessage } from '../formatter';
import { JsonRpcProvider } from '../json-rpc-provider';
import { version } from '../_version';
import { testnet, localnet } from './HARMONY_ENDPOINTS';
const logger = new Logger(version);
function getLowerCase(value) {
    if (value) {
        return value.toLowerCase();
    }
    return value;
}
export class HarmonyRpcProvider extends JsonRpcProvider {
    constructor(url, network) {
        logger.checkNew(new.target, HarmonyRpcProvider);
        super(url, network); //TODO
        // Default URL
        if (!url) {
            url = getStatic(this.constructor, "defaultUrl")();
        }
        if (typeof (url) === "string") {
            defineReadOnly(this, "connection", Object.freeze({
                url: url
            }));
        }
        else {
            defineReadOnly(this, "connection", Object.freeze(shallowCopy(url)));
        }
        // this._nextId = 42;
    }
    static defaultUrl() {
        return localnet[0];
    }
    prepareRequest(method, params) {
        switch (method) {
            case "getBlockNumberOld":
                return ["eth_blockNumber", []];
            case "getBlockNumber":
                return ["hmyv2_blockNumber", []];
            case "getGasPrice":
                return ["hmyv2_gasPrice", []];
            case "getBalance":
                return ["hmyv2_getBalance", [getLowerCase(params.address), params.blockTag]];
            case "getTransactionCount":
                return ["hmyv2_getTransactionCount", [getLowerCase(params.address), params.blockTag]];
            case "getCode":
                return ["hmyv2_getCode", [getLowerCase(params.address), params.blockTag]];
            case "getStorageAt":
                return ["hmyv2_getStorageAt", [getLowerCase(params.address), params.position, params.blockTag]];
            case "sendTransaction":
                return ["hmyv2_sendRawTransaction", [params.signedTransaction]];
            case "getBlock":
                if (params.blockTag) {
                    return ["hmyv2_getBlockByNumber", [params.blockTag, !!params.includeTransactions]];
                }
                else if (params.blockHash) {
                    return ["hmyv2_getBlockByHash", [params.blockHash, !!params.includeTransactions]];
                }
                return null;
            case "getTransaction":
                return ["hmyv2_getTransactionByHash", [params.transactionHash]];
            case "getTransactionReceipt":
                return ["hmyv2_getTransactionReceipt", [params.transactionHash]];
            case "call": {
                const hexlifyTransaction = getStatic(this.constructor, "hexlifyTransaction");
                return ["hmyv2_call", [hexlifyTransaction(params.transaction, { from: true }), params.blockTag]];
            }
            case "estimateGas": {
                const hexlifyTransaction = getStatic(this.constructor, "hexlifyTransaction");
                return ["hmyv2_estimateGas", [hexlifyTransaction(params.transaction, { from: true })]];
            }
            case "getLogs":
                if (params.filter && params.filter.address != null) {
                    params.filter.address = getLowerCase(params.filter.address);
                }
                return ["hmyv2_getLogs", [params.filter]];
            default:
                break;
        }
        return null;
    }
    static getUrl(network = null, apiKey = '') {
        return {
            url: 'https://' + testnet[0] + "/",
            throttleCallback: (attempt, url) => {
                if (!apiKey) {
                    showThrottleMessage();
                }
                return Promise.resolve(true);
            }
        };
    }
}
//# sourceMappingURL=harmony-provider.js.map