"use strinct";

import { TransactionRequest } from '@ethersproject/abstract-provider';
import { Logger } from '@ethersproject/logger';
import {Network, Networkish} from '@ethersproject/networks';
import { defineReadOnly, getStatic, shallowCopy } from '@ethersproject/properties';
import { ConnectionInfo } from '@ethersproject/web';
import { showThrottleMessage } from '../formatter';
import { JsonRpcProvider } from '../json-rpc-provider';
import { version } from '../_version';
import {testnet,localnet} from './HARMONY_ENDPOINTS';

const logger = new Logger(version);


function getLowerCase(value: string): string {
    if (value) { return value.toLowerCase(); }
    return value;
}

export class HarmonyRpcProvider extends JsonRpcProvider {

    constructor(url? :ConnectionInfo | string, network?: Networkish){
        logger.checkNew(new.target, HarmonyRpcProvider);
        super(url,network); //TODO

        // Default URL
        if (!url) { url = getStatic<() => string>(this.constructor, "defaultUrl")(); }

        if (typeof(url) === "string") {
            defineReadOnly(this, "connection",Object.freeze({
                url: url
            }));
        } else {
            defineReadOnly(this, "connection", Object.freeze(shallowCopy(url)));
        }

        this._nextId = 42;
    }

    static defaultUrl(): string {
        return localnet[0];
    }

    prepareRequest(method: string, params: any): [ string, Array<any> ] {
        switch (method) {
            case "getBlockNumber":
                return [ "eth_blockNumber", [] ];

            case "getGasPrice":
                return [ "eth_gasPrice", [] ];

            case "getBalance":
                return [ "eth_getBalance", [ getLowerCase(params.address), params.blockTag ] ];

            case "getTransactionCount":
                return [ "eth_getTransactionCount", [ getLowerCase(params.address), params.blockTag ] ];

            case "getCode":
                return [ "eth_getCode", [ getLowerCase(params.address), params.blockTag ] ];

            case "getStorageAt":
                return [ "eth_getStorageAt", [ getLowerCase(params.address), params.position, params.blockTag ] ];

            case "sendTransaction":
                return [ "eth_sendRawTransaction", [ params.signedTransaction ] ]

            case "getBlock":
                if (params.blockTag) {
                    return [ "eth_getBlockByNumber", [ params.blockTag, !!params.includeTransactions ] ];
                } else if (params.blockHash) {
                    return [ "eth_getBlockByHash", [ params.blockHash, !!params.includeTransactions ] ];
                }
                return null;

            case "getTransaction":
                return [ "eth_getTransactionByHash", [ params.transactionHash ] ];

            case "getTransactionReceipt":
                return [ "eth_getTransactionReceipt", [ params.transactionHash ] ];

            case "call": {
                const hexlifyTransaction = getStatic<(t: TransactionRequest, a?: { [key: string]: boolean }) => { [key: string]: string }>(this.constructor, "hexlifyTransaction");
                return [ "eth_call", [ hexlifyTransaction(params.transaction, { from: true }), params.blockTag ] ];
            }

            case "estimateGas": {
                const hexlifyTransaction = getStatic<(t: TransactionRequest, a?: { [key: string]: boolean }) => { [key: string]: string }>(this.constructor, "hexlifyTransaction");
                return [ "eth_estimateGas", [ hexlifyTransaction(params.transaction, { from: true }) ] ];
            }

            case "getLogs":
                if (params.filter && params.filter.address != null) {
                    params.filter.address = getLowerCase(params.filter.address);
                }
                return [ "eth_getLogs", [ params.filter ] ];

            default:
                break;
        }

        return null;
    }

    static getUrl(network: Network = null, apiKey: string = ''): ConnectionInfo {
        return {
            url: 'https://' + testnet[0] + "/",
            throttleCallback: (attempt: number, url:string) => {
                if(!apiKey){
                    showThrottleMessage();
                }
                return Promise.resolve(true);
            }
        }
    }
}
