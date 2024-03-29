"use strinct";

import { Block, BlockTag, Provider, TransactionReceipt, TransactionRequest, TransactionResponse } from '@ethersproject/abstract-provider';
import { Signer, TypedDataDomain, TypedDataField, TypedDataSigner } from '@ethersproject/abstract-signer';
import { BigNumber, BigNumberish } from '@ethersproject/bignumber';
import { Bytes, hexlify, hexValue, isHexString } from '@ethersproject/bytes';
import { _TypedDataEncoder } from '@ethersproject/hash';
import { Logger } from '@ethersproject/logger';
import {Network, Networkish} from '@ethersproject/networks';
import { checkProperties, deepCopy, Deferrable, defineReadOnly, getStatic, resolveProperties, shallowCopy } from '@ethersproject/properties';
import { toUtf8Bytes } from '@ethersproject/strings';
import { AccessList, accessListify } from '@ethersproject/transactions';
import { ConnectionInfo, fetchJson, poll } from '@ethersproject/web';
import { BaseProvider } from '..';
import { Event } from '../base-provider';
import { version } from '../_version';
import {testnet,localnet} from './harmony-rcp-api';

const logger = new Logger(version);


const errorGas = [ "call", "estimateGas" ];
const requestPrefix = "hmyv2_";

function checkError(method: string, error: any, params: any): any {
    // Undo the "convenience" some nodes are attempting to prevent backwards
    // incompatibility; maybe for v6 consider forwarding reverts as errors
    if (method === "call" && error.code === Logger.errors.SERVER_ERROR) {
        const e = error.error;
        if (e && e.message.match("reverted") && isHexString(e.data)) {
            return e.data;
        }
    }

    let message = error.message;
    if (error.code === Logger.errors.SERVER_ERROR && error.error && typeof(error.error.message) === "string") {
        message = error.error.message;
    } else if (typeof(error.body) === "string") {
        message = error.body;
    } else if (typeof(error.responseText) === "string") {
        message = error.responseText;
    }
    message = (message || "").toLowerCase();

    const transaction = params.transaction || params.signedTransaction;

    // "insufficient funds for gas * price + value + cost(data)"
    if (message.match(/insufficient funds/)) {
        logger.throwError("insufficient funds for intrinsic transaction cost", Logger.errors.INSUFFICIENT_FUNDS, {
            error, method, transaction
        });
    }

    // "nonce too low"
    if (message.match(/nonce too low/)) {
        logger.throwError("nonce has already been used", Logger.errors.NONCE_EXPIRED, {
            error, method, transaction
        });
    }

    // "replacement transaction underpriced"
    if (message.match(/replacement transaction underpriced/)) {
        logger.throwError("replacement fee too low", Logger.errors.REPLACEMENT_UNDERPRICED, {
            error, method, transaction
        });
    }

    if (errorGas.indexOf(method) >= 0 && message.match(/gas required exceeds allowance|always failing transaction|execution reverted/)) {
        logger.throwError("cannot estimate gas; transaction may fail or may require manual gas limit", Logger.errors.UNPREDICTABLE_GAS_LIMIT, {
            error, method, transaction
        });
    }

    throw error;
}

function timer(timeout: number): Promise<any> {
    return new Promise(function(resolve) {
        setTimeout(resolve, timeout);
    });
}

function getResult(payload: { error?: { code?: number, data?: any, message?: string }, result?: any }): any {
    if (payload.error) {
        // @TODO: not any
        const error: any = new Error(payload.error.message);
        error.code = payload.error.code;
        error.data = payload.error.data;
        throw error;
    }

    return payload.result;
}

function getLowerCase(value: string): string {
    if (value) { return value.toLowerCase(); }
    return value;
}

const _constructorGuard = {};

export class HarmonyRpcSigner extends Signer implements TypedDataSigner {
    readonly provider: HarmonyRpcProvider;
    _index: number;
    _address: string;

    constructor(constructorGuard: any, provider: HarmonyRpcProvider, addressOrIndex?: string | number) {
        logger.checkNew(new.target, HarmonyRpcSigner);

        super();

        if (constructorGuard !== _constructorGuard) {
            throw new Error("do not call the HarmonyRpcSigner constructor directly; use provider.getSigner");
        }

        defineReadOnly(this, "provider", provider);

        if (addressOrIndex == null) { addressOrIndex = 0; }

        if (typeof(addressOrIndex) === "string") {
            defineReadOnly(this, "_address", this.provider.formatter.address(addressOrIndex));
            defineReadOnly(this, "_index", null);

        } else if (typeof(addressOrIndex) === "number") {
            defineReadOnly(this, "_index", addressOrIndex);
            defineReadOnly(this, "_address", null);

        } else {
            logger.throwArgumentError("invalid address or index", "addressOrIndex", addressOrIndex);
        }
    }

    connect(provider: Provider): HarmonyRpcSigner {
        return logger.throwError("cannot alter JSON-RPC Signer connection", Logger.errors.UNSUPPORTED_OPERATION, {
            operation: "connect"
        });
    }

    connectUnchecked(): HarmonyRpcSigner {
        return new UncheckedHarmonyRpcSigner(_constructorGuard, this.provider, this._address || this._index);
    }

    getAddress(): Promise<string> {
        if (this._address) {
            return Promise.resolve(this._address);
        }

        return this.provider.send(requestPrefix + "accounts", []).then((accounts) => {
            if (accounts.length <= this._index) {
                logger.throwError("unknown account #" + this._index, Logger.errors.UNSUPPORTED_OPERATION, {
                    operation: "getAddress"
                });
            }
            return this.provider.formatter.address(accounts[this._index])
        });
    }

    sendUncheckedTransaction(transaction: Deferrable<TransactionRequest>): Promise<string> {
        transaction = shallowCopy(transaction);

        const fromAddress = this.getAddress().then((address) => {
            if (address) { address = address.toLowerCase(); }
            return address;
        });

 
        if (transaction.gasLimit == null) {
            const estimate = shallowCopy(transaction);
            estimate.from = fromAddress;
            transaction.gasLimit = this.provider.estimateGas(estimate);
        }

        return resolveProperties({
            tx: resolveProperties(transaction),
            sender: fromAddress
        }).then(({ tx, sender }) => {
            if (tx.from != null) {
                if (tx.from.toLowerCase() !== sender) {
                    logger.throwArgumentError("from address mismatch", "transaction", transaction);
                }
            } else {
                tx.from = sender;
            }

            const hexTx = (<any>this.provider.constructor).hexlifyTransaction(tx, { from: true });

            return this.provider.send(requestPrefix + "sendRawTransaction", [ hexTx ]).then((hash) => {
                return hash;
            }, (error) => {
                return checkError("sendRawTransaction", error, hexTx);
            });
        });
    }

    signTransaction(transaction: Deferrable<TransactionRequest>): Promise<string> {
        return logger.throwError("signing transactions is unsupported", Logger.errors.UNSUPPORTED_OPERATION, {
            operation: "signTransaction"
        });
    }

    sendTransaction(transaction: Deferrable<TransactionRequest>): Promise<TransactionResponse> {
        return this.sendUncheckedTransaction(transaction).then((hash) => {
            return poll(() => {
                return this.provider.getTransaction(hash).then((tx: TransactionResponse) => {
                    if (tx === null) { return undefined; }
                    return this.provider._wrapTransaction(tx, hash);
                });
            }, { onceBlock: this.provider }).catch((error: Error) => {
                (<any>error).transactionHash = hash;
                throw error;
            });
        });
    }

    async signMessage(message: Bytes | string): Promise<string> {
        const data = ((typeof(message) === "string") ? toUtf8Bytes(message): message);
        const address = await this.getAddress();

        // https://github.com/ethereum/wiki/wiki/JSON-RPC#eth_sign
        return await this.provider.send(requestPrefix + "sign", [ address.toLowerCase(), hexlify(data) ]);
    }

    async _signTypedData(domain: TypedDataDomain, types: Record<string, Array<TypedDataField>>, value: Record<string, any>): Promise<string> {
        // Populate any ENS names (in-place)
        const populated = await _TypedDataEncoder.resolveNames(domain, types, value, (name: string) => {
            return this.provider.resolveName(name);
        });

        const address = await this.getAddress();

        return await this.provider.send(requestPrefix + "signTypedData_v4", [
            address.toLowerCase(),
            JSON.stringify(_TypedDataEncoder.getPayload(populated.domain, types, populated.value))
        ]);
    }

    async unlock(password: string): Promise<boolean> {
        const provider = this.provider;

        const address = await this.getAddress();

        return provider.send("personal_unlockAccount", [ address.toLowerCase(), password, null ]);
    }
}

class UncheckedHarmonyRpcSigner extends HarmonyRpcSigner {
    sendTransaction(transaction: Deferrable<TransactionRequest>): Promise<TransactionResponse> {
        return this.sendUncheckedTransaction(transaction).then((hash) => {
            return <TransactionResponse>{
                hash: hash,
                nonce: null,
                gasLimit: null,
                gasPrice: null,
                data: null,
                value: null,
                chainId: null,
                confirmations: 0,
                from: null,
                wait: (confirmations?: number) => { return this.provider.waitForTransaction(hash, confirmations); }
            };
        });
    }
}

const allowedTransactionKeys: { [ key: string ]: boolean } = {
    chainId: true, data: true, gasLimit: true, gasPrice:true, nonce: true, to: true, value: true,
    type: true, accessList: true
}
export class HarmonyRpcProvider extends BaseProvider {
    readonly connection: ConnectionInfo;

    _pendingFilter: Promise<number>;
    _nextId: number;

    constructor(url?: ConnectionInfo | string, network?: Networkish) {
        logger.checkNew(new.target, HarmonyRpcProvider);

        let networkOrReady: Networkish | Promise<Network> = network;

        // The network is unknown, query the JSON-RPC for it
        if (networkOrReady == null) {
            networkOrReady = new Promise((resolve, reject) => {
                setTimeout(() => {
                    this.detectNetwork().then((network) => {
                        resolve(network);
                    }, (error) => {
                        reject(error);
                    });
                }, 0);
            });
        }

        super(networkOrReady);

        url = url ? url : this.getURL(testnet[0]);
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

    getURL(u: string): string{
        return 'https://' + u + '/';
    }
    static defaultUrl(): string {
        return localnet[0];
    }

    async detectNetwork(): Promise<Network> {
        await timer(0);

        let chainId = null;
        try {
            chainId = await this.send("eth_chainId", [ ]);
        } catch (error) {
            try {
                chainId = await this.send("net_version", [ ]);
            } catch (error) { console.log('net_version error', error)}
        }
        console.log(chainId, 'chainId');
        if (chainId != null) {

            const getNetwork = getStatic<(network: Networkish) => Network>(this.constructor, "getNetwork");
            try {
                return getNetwork(BigNumber.from(chainId).toNumber());
            } catch (error) {
                return logger.throwError("could not detect network", Logger.errors.NETWORK_ERROR, {
                    chainId: chainId,
                    event: "invalidNetwork",
                    serverError: error
                });
            }
        }

        return logger.throwError("could not detect network", Logger.errors.NETWORK_ERROR, {
            event: "noNetwork"
        });
    }

    async _getAddress(addressOrName: string | Promise<string>): Promise<string> {
        const address = await this.resolveName(addressOrName);
        if (address == null) {
            logger.throwError("ENS name not configured", Logger.errors.UNSUPPORTED_OPERATION, {
                operation: `resolveName(${ JSON.stringify(addressOrName) })`
            });
        }
        return address;
    }

    async resolveName(name: string | Promise<string>): Promise<string> {
        name = await name;
        return name;
        // // If it is already an address, nothing to resolve
        // try {
        //     return Promise.resolve(this.formatter.address(name));
        // } catch (error) {
        //     // If is is a hexstring, the address is bad (See #694)
        //     if (isHexString(name)) { throw error; }
        // }

        // if (typeof(name) !== "string") {
        //     logger.throwArgumentError("invalid ENS name", "name", name);
        // }
        // console.log('resolveName', name);
        // // Get the addr from the resovler
        // const resolver = await this.getResolver(name);
        // if (!resolver) { return null; }

        // return await resolver.getAddress();
    }

    getSigner(addressOrIndex?: string | number): HarmonyRpcSigner {
        return new HarmonyRpcSigner(_constructorGuard, this, addressOrIndex);
    }

    getUncheckedSigner(addressOrIndex?: string | number): UncheckedHarmonyRpcSigner {
        return this.getSigner(addressOrIndex).connectUnchecked();
    }

    listAccounts(): Promise<Array<string>> {
        return this.send(requestPrefix + "accounts", []).then((accounts: Array<string>) => {
            return accounts.map((a) => this.formatter.address(a));
        });
    }

    send(method: string, params: Array<any>): Promise<any> {
        const request = {
            method: method,
            params: params,
            id: (this._nextId++),
            jsonrpc: "2.0"
        };

        this.emit("debug", {
            action: "request",
            request: deepCopy(request),
            provider: this
        });
  
        return fetchJson(this.connection, JSON.stringify(request), getResult).then((result) => {
            this.emit("debug", {
                action: "response",
                request: request,
                response: result,
                provider: this
            });

            return result;

        }, (error) => {
            this.emit("debug", {
                action: "response",
                error: error,
                request: request,
                provider: this
            });

            throw error;
        });
    }

    prepareRequest(method: string, params: any): [ string, Array<any> ] {
        switch (method) {
            // case "getBlockNumber":
            //     return [ requestPrefix + "blockNumber", [] ];
     

            // case "getGasPrice":
            //     return [ requestPrefix + "gasPrice", [] ];

            // case "getBalance":
            //     return [ requestPrefix + "getBalance", [ getLowerCase(params.address) ] ];

            // case "getTransactionCount":
            //     return [ requestPrefix + "getTransactionCount", [ getLowerCase(params.address), params.blockTag ] ];

            // case "getCode":
            //     return [ requestPrefix + "getCode", [ getLowerCase(params.address), params.blockTag ] ];

            // case "getStorageAt":
            //     return [ requestPrefix + "getStorageAt", [ getLowerCase(params.address), params.position, params.blockTag ] ];

            // case "sendRawTransaction":
            //     return [ requestPrefix + "sendRawTransaction", [ params.signedTransaction ] ]

            // case "getBlock":
            //     if (params.blockTag) {
            //         return [ requestPrefix + "getBlockByNumber", [ params.blockTag, !!params.includeTransactions ] ];
            //     } else if (params.blockHash) {
            //         return [ requestPrefix + "getBlockByHash", [ params.blockHash, !!params.includeTransactions ] ];
            //     }
            //     return null;

            // case "getTransaction":
            //     return [ requestPrefix + "getTransactionByHash", [ params.transactionHash ] ];

            // case "getTransactionReceipt":
            //     return [ requestPrefix + "getTransactionReceipt", [ params.transactionHash ] ];

            // case "call": {
            //     const hexlifyTransaction = getStatic<(t: TransactionRequest, a?: { [key: string]: boolean }) => { [key: string]: string }>(this.constructor, "hexlifyTransaction");
            //     return [ requestPrefix + "call", [ hexlifyTransaction(params.transaction, { from: true }), params.blockTag ] ];
            // }

            // case "estimateGas": {
            //     const hexlifyTransaction = getStatic<(t: TransactionRequest, a?: { [key: string]: boolean }) => { [key: string]: string }>(this.constructor, "hexlifyTransaction");
            //     return [ requestPrefix + "estimateGas", [ hexlifyTransaction(params.transaction, { from: true }) ] ];
            // }

            case "getLogs":
                if (params.filter && params.filter.address != null) {
                    params.filter.address = getLowerCase(params.filter.address);
                }
                return ["eth_getLogs", [ params.filter ] ];

            default:
                break;
        }

        switch (method) {
            case "call": {
                const hexlifyTransaction = getStatic<(t: TransactionRequest, a?: { [key: string]: boolean }) => { [key: string]: string }>(this.constructor, "hexlifyTransaction");
                return [ requestPrefix + "call", [ hexlifyTransaction(params.transaction, { from: true }), params.blockTag ] ];
            }
            case "estimateGas": {
                const hexlifyTransaction = getStatic<(t: TransactionRequest, a?: { [key: string]: boolean }) => { [key: string]: string }>(this.constructor, "hexlifyTransaction");
                return [ requestPrefix + "estimateGas", [ hexlifyTransaction(params.transaction, { from: true }), params.blockTag ] ];
            }   

            case "getCode": {
                return [ requestPrefix + "getCode",  [ getLowerCase(params.address), params.blockTag]];
            }

            case "getStorageAt":
                return [ requestPrefix + "getStorageAt", [ getLowerCase(params.address), params.position, params.blockTag ] ];
            
            ///
            case "getDelegationsByDelegator": {
                return [ requestPrefix + "getDelegationsByDelegator",  [ getLowerCase(params.delegator)]];
            }   
            
            case "getDelegationsByDelegatorByBlockNumber": {
                return [ requestPrefix + "getDelegationsByDelegatorByBlockNumber",  [ getLowerCase(params.delegator), params.blockNumber]];
            }     

            case "getDelegationsByValidator": {
                return [ requestPrefix + "getDelegationsByValidator",  [ getLowerCase(params.validator) ]];
            }   
            
            ///
            case "getAllValidatorAddresses": {
                return [ requestPrefix + "getAllValidatorAddresses",  []];
            }    
            
            case "getAllValidatorInformation": {
                return [ requestPrefix + "getAllValidatorInformation",  [ params.pageIndex ]];
            }   

            case "getAllValidatorInformationByBlockNumber": {
                return [ requestPrefix + "getAllValidatorInformationByBlockNumber",  [ params.pageIndex , params.blockNumber]];
            }  
            
            case "getElectedValidatorAddresses": {
                return [ requestPrefix + "getElectedValidatorAddresses",  []];
            }   

            case "getValidatorInformation": {
                return [ requestPrefix + "getValidatorInformation",  [ getLowerCase(params.validator) ]];
            }   

            ///
            case "getCurrentUtilityMetrics": {
                return [ requestPrefix + "getCurrentUtilityMetrics",  []];
            }  

            case "getMedianRawStakeSnapshot": {
                return [ requestPrefix + "getMedianRawStakeSnapshot",  []];
            }  

            case "getStakingNetworkInfo": {
                return [ requestPrefix + "getStakingNetworkInfo",  []];
            }  

            case "getSuperCommittees": {
                return [ requestPrefix + "getSuperCommittees",  []];
            }

            ///
            case "getCXReceiptByHash": {
                return [ requestPrefix + "getCXReceiptByHash",  [ getLowerCase(params.cxHash) ]];
            }

            case "getPendingCXReceipts": {
                return [ requestPrefix + "getPendingCXReceipts",  []];
            }

            case "resendCx": {
                return [ requestPrefix + "resendCx",  [ getLowerCase(params.cxHash) ]];
            }

            ///
            case "getPoolStats": {
                return [ requestPrefix + "getPoolStats",  []];
            }

            case "getPendingStakingTransaction": {
                return [ requestPrefix + "pendingStakingTransaction",  []];
            }

            case "getPendingTransactions": {
                return [ requestPrefix + "pendingTransactions",  []];
            }

            ///
            case "getCurrentStakingErrorSink": {
                return [ requestPrefix + "getCurrentStakingErrorSink",  []];
            }

            case "getStakingTransactionByBlockNumberAndIndex": {
                return [ requestPrefix + "getStakingTransactionByBlockNumberAndIndex",  [ params.blockNumber, params.stakingTransactionIndex]];
            }

            case "getStakingTransactionByBlockHashAndIndex": {
                return [ requestPrefix + "getStakingTransactionByBlockHashAndIndex",  [ getLowerCase(params.blockHash), params.stakingTransactionIndex]];
            }

            case "getStakingTransactionByHash": {
                return [ requestPrefix + "getStakingTransactionByHash",  [ getLowerCase(params.txHash) ]];
            }

            case "sendRawStakingTransaction": {
                return [ requestPrefix + "sendRawStakingTransaction",  [ params.signedTransaction ]];
            }

            ///
            case "getCurrentTransactionErrorSink": {
                return [ requestPrefix + "getCurrentTransactionErrorSink",  []];
            }

            case "getTransactionByBlockNumberAndIndex": {
                return [ requestPrefix + "getTransactionByBlockNumberAndIndex",  [ params.blockNumber, params.transactionIndex ]];
            }

            case "getTransactionByBlockHashAndIndex": {
                return [ requestPrefix + "getTransactionByBlockHashAndIndex",  [ getLowerCase(params.blockHash), params.transactionIndex ]];
            }

            case "getTransactionByHash": {
                return [ requestPrefix + "getTransactionByHash",  [ getLowerCase(params.txHash) ]];
            }

            case "getTransactionReceipt":
                return [ requestPrefix + "getTransactionReceipt", [ params.transactionHash ] ];

            case "sendRawTransaction": {
                return [ requestPrefix + "sendRawTransaction",  [ params.signedTransaction ]];
            }

            //
            ///
            case "getBlockNumber": {
                return [ requestPrefix + "blockNumber",  []];
            }

            case "getCirculatingSupply": {
                return [ requestPrefix + "getCirculatingSupply",  []];
            }

            case "getEpoch": {
                return [ requestPrefix + "getEpoch",  []];
            }

            case "getLastCrossLinks": {
                return [ requestPrefix + "getLastCrossLinks",  []];
            }

            case "getLeader": {
                return [ requestPrefix + "getLeader",  []];
            }

            case "getGasPrice": {
                return [ requestPrefix + "gasPrice",  []];
            }

            case "getShardingStructure": {
                return [ requestPrefix + "getShardingStructure",  []];
            }

            case "getTotalSupply": {
                return [ requestPrefix + "getTotalSupply",  []];
            }

            case "getValidators": {
                return [ requestPrefix + "getValidators",  [ params.epochNumber ]];
            }

            case "getValidatorKeys": {
                return [ requestPrefix + "getValidatorKeys",  [ params.epochNumber ]];
            }

            ///
            case "getCurrentBadBlocks": {
                return [ requestPrefix + "getCurrentBadBlocks",  []];
            }

            case "getNodeMetadata": {
                return [ requestPrefix + "getNodeMetadata",  []];
            }

            case "getProtocolVersion": {
                return [ requestPrefix + "protocolVersion",  []];
            }

            case "getPeerCount": {
                return [ requestPrefix + "peerCount",  []];
            }

            ///
            case "getBlocks": {
                return [ requestPrefix + "getBlocks",  [ params.startingBlock, params.endingBlock, params.extra ]];
            }

            case "getBlockByNumber": {
                return [ requestPrefix + "getBlockByNumber",  [ params.blockNumber, params.extra ]];
            }
            
            case "getBlockByHash": {
                return [ requestPrefix + "getBlockByHash",  [ getLowerCase(params.blockHash), params.extra]];
            }

            case "getBlockSigners": {
                return [ requestPrefix + "getBlockSigners",  [ params.startingBlock, params.endingBlock, params.extra ]];
            }

            case "getBlockSignersKeys": {
                return [ requestPrefix + "getBlockSignersKeys",  [ params.blockNumber ]];
            }

            case "getBlockTransactionCountByNumber": {
                return [ requestPrefix + "getBlockTransactionCountByNumber",  [ params.blockNumber ]];
            }


            case "getBlockTransactionCountByHash": {
                return [ requestPrefix + "getBlockTransactionCountByHash",  [ getLowerCase(params.blockHash) ]];
            }

            case "getHeaderByNumber": {
                return [ requestPrefix + "getHeaderByNumber",  [ params.blockNumber ]];
            }

            case "getLatestChainHeaders": {
                return [ requestPrefix + "getLatestChainHeaders",  []];
            }

            case "getLatestHeaders": {
                return [ requestPrefix + "latestHeader",  []];
            }

            //
            case "getBalance":
                return [ requestPrefix + "getBalance", [ getLowerCase(params.address) ] ];

            case "getBalanceByBlockNumber":
                return [ requestPrefix + "getBalanceByBlockNumber", [ getLowerCase(params.address), params.blockTag ] ];

            case "getStakingTransactionsCount":
                return [ requestPrefix + "getStakingTransactionsCount", [ getLowerCase(params.address), params.transactionType ] ];
     
            case "getStakingTransactionsHistory":
                return [ requestPrefix + "getStakingTransactionsHistory", [ {
                    address: getLowerCase(params.address),
                    pageIndex: params.pageIndex,
                    pageSize: params.pageSize,
                    fullTx: params.fullTx,
                    txType: params.txType,
                    order: params.order,
                } ] ];

            case "getTransactionsCount":
                return [ requestPrefix + "getTransactionsCount", [ getLowerCase(params.address), params.transactionType ] ];
        
            case "getTransactionsHistory":
                return [ requestPrefix + "getTransactionsHistory", [ {
                    address: getLowerCase(params.address),
                    pageIndex: params.pageIndex,
                    pageSize: params.pageSize,
                    fullTx: params.fullTx,
                    txType: params.txType,
                    order: params.order,
                } ] ];
            ///
            case "xxxxxx": {
                return [ requestPrefix + "xxxxxx",  []];
            }
            default:
                break;
        }

        return null;
    }


    async perform(method: string, params: any): Promise<any> {
        const args = this.prepareRequest(method,  params);

        if (args == null) {
            logger.throwError(method + " not implemented", Logger.errors.NOT_IMPLEMENTED, { operation: method });
        }
        try {
            return await this.send(args[0], args[1])
        } catch (error) {
            return checkError(method, error, params);
        }
    }

    _startEvent(event: Event): void {
        if (event.tag === "pending") { this._startPending(); }
        super._startEvent(event);
    }

    _startPending(): void {
        if (this._pendingFilter != null) { return; }
        const self = this;

        const pendingFilter: Promise<number> = this.send(requestPrefix + "newPendingTransactionFilter", []);
        this._pendingFilter = pendingFilter;

        pendingFilter.then(function(filterId) {
            function poll() {
                self.send(requestPrefix + "getFilterChanges", [ filterId ]).then(function(hashes: Array<string>) {
                    if (self._pendingFilter != pendingFilter) { return null; }

                    let seq = Promise.resolve();
                    hashes.forEach(function(hash) {
                        // @TODO: This should be garbage collected at some point... How? When?
                        self._emitted["t:" + hash.toLowerCase()] = "pending";
                        seq = seq.then(function() {
                            return self.getTransaction(hash).then(function(tx) {
                                self.emit("pending", tx);
                                return null;
                            });
                        });
                    });

                    return seq.then(function() {
                        return timer(1000);
                    });
                }).then(function() {
                    if (self._pendingFilter != pendingFilter) {
                        self.send(requestPrefix + "uninstallFilter", [ filterId ]);
                        return;
                    }
                    setTimeout(function() { poll(); }, 0);

                    return null;
                }).catch((error: Error) => { });
            }
            poll();

            return filterId;
        }).catch((error: Error) => { });
    }

    _stopEvent(event: Event): void {
        if (event.tag === "pending" && this.listenerCount("pending") === 0) {
            this._pendingFilter = null;
        }
        super._stopEvent(event);
    }


    // Convert an ethers.js transaction into a JSON-RPC transaction
    //  - gasLimit => gas
    //  - All values hexlified
    //  - All numeric values zero-striped
    //  - All addresses are lowercased
    // NOTE: This allows a TransactionRequest, but all values should be resolved
    //       before this is called
    // @TODO: This will likely be removed in future versions and prepareRequest
    //        will be the preferred method for this.
    static hexlifyTransaction(transaction: TransactionRequest, allowExtra?: { [key: string]: boolean }): { [key: string]: string | AccessList } {
        // Check only allowed properties are given
        const allowed = shallowCopy(allowedTransactionKeys);
        if (allowExtra) {
            for (const key in allowExtra) {
                if (allowExtra[key]) { allowed[key] = true; }
            }
        }

        checkProperties(transaction, allowed);

        const result: { [key: string]: string | AccessList } = {};

        // Some nodes (INFURA ropsten; INFURA mainnet is fine) do not like leading zeros.
        ["gasLimit", "gasPrice", "type", "nonce", "value"].forEach(function(key) {
            if ((<any>transaction)[key] == null) { return; }
            const value = hexValue((<any>transaction)[key]);
            if (key === "gasLimit") { key = "gas"; }
            result[key] = value;
        });

        ["from", "to", "data"].forEach(function(key) {
            if ((<any>transaction)[key] == null) { return; }
            result[key] = hexlify((<any>transaction)[key]);
        });

        if ((<any>transaction).accessList) {
            result["accessList"] = accessListify((<any>transaction).accessList);
        }

        return result;
    }




    // Smart Contract

    //ALERT HARMONY <TransactionRequest>
    async call(transaction: Deferrable<TransactionRequest>, blockTag?: BlockTag | Promise<BlockTag>): Promise<string> {
        await this.getNetwork();
        const params = await resolveProperties({
            transaction: this._getTransactionRequest(transaction),
            blockTag: this._getBlockTag(blockTag)
        });

        const result = await this.perform("call", params);
        try {
            return hexlify(result);
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "call",
                params, result, error
            });
        }
    }

    async estimateGas(transaction: Deferrable<TransactionRequest>): Promise<BigNumber> {
        await this.getNetwork();
        const params = await resolveProperties({
            transaction: this._getTransactionRequest(transaction)
        });

        const result = await this.perform("estimateGas", params);
        try {
            return BigNumber.from(result);
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "estimateGas",
                params, result, error
            });
        }
    }

    async getCode(addressOrName: string | Promise<string>, blockTag?: BlockTag | Promise<BlockTag>): Promise<string> {
        await this.getNetwork();
        const params = await resolveProperties({
            address: this._getAddress(addressOrName),
            blockTag: this._getBlockTag(blockTag)
        });

        const result = await this.perform("getCode", params);
        try {
            return hexlify(result);
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getCode",
                params, result, error
            });
        }
    }

    async getStorageAt(addressOrName: string | Promise<string>, position: BigNumberish | Promise<BigNumberish>, blockTag?: BlockTag | Promise<BlockTag>): Promise<string> {
        await this.getNetwork();
        const params = await resolveProperties({
            address: this._getAddress(addressOrName),
            position: Promise.resolve(position).then((p) => hexValue(p)),
            blockTag: this._getBlockTag(blockTag)
        });
        const result = await this.perform("getStorageAt", params);
        try {
            return hexlify(result);
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getStorageAt",
                params, result, error
            });
        }
    }

    // Blockchain
    //Network
    async getBlockNumber(): Promise<number> {
        const params = {};
        const result = await this.perform("getBlockNumber",params);
        try {
            return BigNumber.from(result).toNumber();
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getBlockNumber",
                params, result, error
            });
        }
    }

    async getCirculatingSupply(): Promise<number> {
        const params = {};
        const result = await this.perform("getCirculatingSupply",params);
        try {
            return BigNumber.from(result).toNumber();
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getCirculatingSupply",
                params, result, error
            });
        }
    }

    async getEpoch(): Promise<number> {
        const params = {};
        const result = await this.perform("getEpoch",params);
        try {
            return BigNumber.from(result).toNumber();
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getEpoch",
                params, result, error
            });
        }
    }

    async getLastCrossLinks(): Promise<CrossLink[]> {
        const params = {};
        return this.perform("getLastCrossLinks",params);

    }

    async getLeader(): Promise<string> {
        const params = {};
        return this.perform("getLeader",params);
    }

    async getGasPrice(): Promise<BigNumber> {
        const params = {};
        const result = await this.perform("getGasPrice",params);
        try {
            return BigNumber.from(result);
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getGasPrice",
                params, result, error
            });
        }
    }

    async getShardingStructure(): Promise<ShardingStructure[]> {
        const params = {};
        return this.perform("getShardingStructure",params);
    }

    async getTotalSupply(): Promise<BigNumber> {
        const params = {};
        const result = await this.perform("getTotalSupply",params);
        try {
            return BigNumber.from(result);
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getTotalSupply",
                params, result, error
            });
        }
    }

    async getValidators(epochNumber: number): Promise<ValidatorsObject> {
        const params = await resolveProperties({
            epochNumber: epochNumber,
        });
        return this.perform("getValidators",params);
    }

    async getValidatorKeys(epochNumber: number): Promise<string[]> {
        const params = await resolveProperties({
            epochNumber: epochNumber,
        });
        return this.perform("getValidatorKeys",params);
    }

    //Node
    async getCurrentBadBlocks(): Promise<string[]> {
        const params = {};
        return this.perform("getCurrentBadBlocks",params);
    }

    async getNodeMetadata(): Promise<NodeMetadata> {
        const params = {};
        return this.perform("getNodeMetadata",params);
    }

    async getProtocolVersion(): Promise<number> {
        const params = {};
        const result = await this.perform("getProtocolVersion",params);
        try {
            return BigNumber.from(result).toNumber();
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getProtocolVersion",
                params, result, error
            });
        }
    }

    async getPeerCount(): Promise<string> {
        const params = {};
        return this.perform("getPeerCount",params);
    }

    //Blocks
    async getBlocks(startingBlock: number, endingBlock: number, extra: {withSingers: boolean;fullTx: boolean; inclStaking: boolean;}): Promise<Block[]> {
        await this.getNetwork();
        const params = await resolveProperties({
            startingBlock: startingBlock,
            endingBlock: endingBlock,
            extra: extra,
        });

        return this.perform("getBlocks", params);
    }

    async getBlockByNumber(blockNumber: number, extra: {withSingers: boolean;fullTx: boolean; inclStaking: boolean;}): Promise<Block> {
        await this.getNetwork();
        const params = await resolveProperties({
            blockNumber: blockNumber,
            extra: extra,
        });

        return this.perform("getBlockByNumber", params);
    }

    async getBlockByHash(blockHash: string, extra: {withSingers: boolean;fullTx: boolean; inclStaking: boolean;}): Promise<Block> {
        await this.getNetwork();
        const params = await resolveProperties({
            blockHash: blockHash,
            extra: extra,
        });

        return this.perform("getBlockByHash", params);
    }


    async getBlockSigners(startingBlock: number, endingBlock: number, extra: {withSingers: boolean;fullTx: boolean; inclStaking: boolean;}): Promise<string[]> {
        await this.getNetwork();
        const params = await resolveProperties({
            startingBlock: startingBlock,
            endingBlock: endingBlock,
            extra: extra,
        });

        return this.perform("getBlockSigners", params);
    }

    async getBlockSignersKeys(blockNumber: number): Promise<string[]> {
        await this.getNetwork();
        const params = await resolveProperties({
            blockNumber: blockNumber,
        });

        return this.perform("getBlockSignersKeys", params);
    }

    async getBlockTransactionCountByNumber(blockNumber: number): Promise<number> {
        await this.getNetwork();
        const params = await resolveProperties({
            blockNumber: blockNumber,
        });

        const result = this.perform("getBlockTransactionCountByNumber", params);
        try {
            return BigNumber.from(result).toNumber();
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getBlockTransactionCountByNumber",
                params, result, error
            });
        }
    }

    async getBlockTransactionCountByHash(blockHash: string): Promise<number> {
        await this.getNetwork();
        const params = await resolveProperties({
            blockHash: blockHash,
        });

        const result = await this.perform("getBlockTransactionCountByHash", params);
        try {
            return BigNumber.from(result).toNumber();
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getBlockTransactionCountByHash",
                params, result, error
            });
        }
    }

    async getHeaderByNumber(blockNumber: number): Promise<BlockHeader> {
        await this.getNetwork();
        const params = await resolveProperties({
            blockNumber: blockNumber,
        });

        return this.perform("getHeaderByNumber", params);
    }

    async getLatestChainHeaders(blockNumber: number): Promise<ChainHeader> {
        await this.getNetwork();
        const params = {};

        return this.perform("getLatestChainHeaders", params);
    }

    async getLatestHeader(blockNumber: number): Promise<BlockHeader> {
        await this.getNetwork();
        const params = {};

        const result = await this.perform("getLatestHeader", params);
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getLatestHeader",
                params, result, error
            });
        }
    }


    // Account

    async getBalance(addressOrName: string | Promise<string>): Promise<BigNumber> {
        await this.getNetwork();
        const params = await resolveProperties({
            address: this._getAddress(addressOrName)
        });

        const result = await this.perform("getBalance", params);

        try {
            return BigNumber.from(BigInt(result));
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getBalance",
                params, result, error
            });
        }
    }

    async getBalanceByBlockNumber(addressOrName: string | Promise<string>, blockTag?: BlockTag | Promise<BlockTag>): Promise<BigNumber> {
        await this.getNetwork();
        const params = await resolveProperties({
            address: this._getAddress(addressOrName),
            blockTag: this._getBlockTag(blockTag)
        });

        const result = await this.perform("getBalanceByBlockNumber", params);

        try {
            return BigNumber.from(BigInt(result));
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getBalanceByBlockNumber",
                params, result, error
            });
        }
    }

    async getStakingTransactionsCount(addressOrName: string | Promise<string>, transactionType?: TransactionType): Promise<number> {
        await this.getNetwork();
        const params = await resolveProperties({
            address: this._getAddress(addressOrName),
            transactionType: transactionType
        });

        const result = await this.perform("getStakingTransactionsCount", params);

        try {
            return BigNumber.from(BigInt(result)).toNumber();
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getStakingTransactionsCount",
                params, result, error
            });
        }
    }

    async getStakingTransactionsHistory(
        addressOrName: string | Promise<string>, 
        pageIndex?: number,
        pageSize?: number,
        fullTx?: boolean,
        txType?: TransactionType,
        order?: OrderType,
        ): Promise<StakingTransaction[] | string[]> {
        await this.getNetwork();
        const params = await resolveProperties({
            address: this._getAddress(addressOrName),
            pageIndex: pageIndex,
            pageSize: pageSize,
            fullTx: fullTx,
            txType: txType,
            order: order,
        });

        return this.perform("getStakingTransactionsHistory", params);
    }

    async getTransactionsCount(addressOrName: string | Promise<string>, transactionType?: TransactionType): Promise<number> {
        await this.getNetwork();
        const params = await resolveProperties({
            address: this._getAddress(addressOrName),
            transactionType: transactionType
        });

        const result = await this.perform("getTransactionsCount", params); //ALERT HARMONY getTransactionsCount
        try {
            return BigNumber.from(BigInt(result)).toNumber();
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getTransactionsCount",
                params, result, error
            });
        }
    }

    async getTransactionsHistory(
        addressOrName: string | Promise<string>, 
        pageIndex?: number,
        pageSize?: number,
        fullTx?: boolean,
        txType?: TransactionType,
        order?: OrderType,
        ): Promise<Transaction[] | string[]> {
        await this.getNetwork();
        const params = await resolveProperties({
            address: this._getAddress(addressOrName),
            pageIndex: pageIndex,
            pageSize: pageSize,
            fullTx: fullTx,
            txType: txType,
            order: order,
        });

        return this.perform("getTransactionsHistory", params);
    }

    ///////////// END /////////
    //Staking
    //Delegation
    async getDelegationsByDelegator(delegator: string | Promise<string>): Promise<Delegation[]> {
        await this.getNetwork();
        const params = await resolveProperties({
            delegator: this._getAddress(delegator),
        });

        return this.perform("getDelegationsByDelegator", params); 
    }

    async getDelegationsByDelegatorByBlockNumber(delegator: string | Promise<string>, blockNumber: number): Promise<Delegation[]> {
        await this.getNetwork();
        const params = await resolveProperties({
            delegator: this._getAddress(delegator),
            blockNumber: blockNumber
        });

        return this.perform("getDelegationsByDelegatorByBlockNumber", params);
    }

    async getDelegationsByValidator(validator: string | Promise<string>): Promise<Delegation[]> {
        await this.getNetwork();
        const params = await resolveProperties({
            validator: this._getAddress(validator),
        });

        return this.perform("getDelegationsByValidator", params); 
    }

    // async getDelegationsByValidatorByBlockNumber(validator: string | Promise<string>, blockNumber: number): Promise<Delegation[]> {
    //     await this.getNetwork();
    //     const params = await resolveProperties({
    //         validator: this._getAddress(validator),
    //         blockNumber: blockNumber
    //     });

    //     const result = await this.perform("getDelegationsByValidatorByBlockNumber", params); 
    //     try {
    //         return result;
    //     } catch (error) {
    //         return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
    //             method: "getDelegationsByValidatorByBlockNumber",
    //             params, result, error
    //         });
    //     }
    // }

    // Validator
    async getAllValidatorAddresses(): Promise<string[]> {
        await this.getNetwork();
        const params = {};

        return this.perform("getAllValidatorAddresses", params); 
    }

    async getAllValidatorInformation(pageIndex: number): Promise<ValidatorInformation[]> {
        await this.getNetwork();
        const params = {
            pageIndex: pageIndex
        };

        return this.perform("getAllValidatorInformation", params); 
    }

    async getAllValidatorInformationByBlockNumber(pageIndex: number, blockNumber: number): Promise<ValidatorInformation[]> {
        await this.getNetwork();
        const params = {
            pageIndex: pageIndex,
            blockNumber: blockNumber,
        };

        return this.perform("getAllValidatorInformationByBlockNumber", params); 
    }

    async getElectedValidatorAddresses(): Promise<string[]> {
        await this.getNetwork();
        const params = {};

        return this.perform("getElectedValidatorAddresses", params); 
    }

    async getValidatorInformation(validator: string): Promise<ValidatorInformation> {
        await this.getNetwork();
        const params = await resolveProperties({
            validator: this._getAddress(validator),
        });

        return this.perform("getValidatorInformation", params); 
    }

    //Network
    async getCurrentUtilityMetrics(): Promise<UtilityMetric> {
        await this.getNetwork();
        const params = {};

        return this.perform("getCurrentUtilityMetrics", params); 
    }

    async getMedianRawStakeSnapshot(): Promise<RawStaleSnapshot> {
        await this.getNetwork();
        const params = {};

        return this.perform("getMedianRawStakeSnapshot", params); 
    }

    async getStakingNetworkInfo(): Promise<StakingNetworkInfo> {
        await this.getNetwork();
        const params = {};

        return this.perform("getStakingNetworkInfo", params); 
    }

    async getSuperCommittees(): Promise<SuperCommittee> {
        await this.getNetwork();
        const params = {};

        return this.perform("getSuperCommittees", params); 
    }

    //Transaction
    //Cross Shard
    async getCXReceiptByHash(cxHash: string): Promise<CXReceipt> {
        await this.getNetwork();
        const params = await resolveProperties({
            cxHash: cxHash,
        });

        return this.perform("getCXReceiptByHash", params); 
    }

    async getPendingCXReceipts(): Promise<PendingCXReceipt[]> {
        await this.getNetwork();
        const params = {};

        return this.perform("getPendingCXReceipts", params); 
    }

    async resendCx(cxHash: string): Promise<boolean> {
        await this.getNetwork();
        const params = {
            cxHash: cxHash
        };

        return this.perform("resendCx", params); 
    }

    //Transaction Pool
    async getPoolStats(): Promise<PoolStat> {
        await this.getNetwork();
        const params = {};

        return this.perform("getPoolStats", params); 
    }

    async getPendingStakingTransaction(): Promise<StakingTransaction[]> {
        await this.getNetwork();
        const params = {};

        return this.perform("getPendingStakingTransaction", params); 
    }

    async getPendingTransactions(): Promise<Transaction[]> {
        await this.getNetwork();
        const params = {};

        return this.perform("getPendingTransactions", params); 
    }

    //Staking
    async getCurrentStakingErrorSink(): Promise<StakingError[]> {
        await this.getNetwork();
        const params = {};

        return this.perform("getCurrentStakingErrorSink", params); 
    }

    async getStakingTransactionByBlockNumberAndIndex(blockNumber: number, stakingTransactionIndex: number): Promise<StakingTransaction> {
        await this.getNetwork();
        const params = {
            blockNumber: blockNumber,
            stakingTransactionIndex: stakingTransactionIndex,
        };

        return this.perform("getStakingTransactionByBlockNumberAndIndex", params);
    }

    async getStakingTransactionByBlockHashAndIndex(blockHash: string, stakingTransactionIndex: number): Promise<StakingTransaction> {
        await this.getNetwork();
        const params = {
            blockHash: blockHash,
            stakingTransactionIndex: stakingTransactionIndex,
        };

        return this.perform("getStakingTransactionByBlockHashAndIndex", params); 
    }

    async getStakingTransactionByHash(txHash: string): Promise<StakingTransaction> {
        await this.getNetwork();
        const params = {
            txHash: txHash,
        };

        return this.perform("getStakingTransactionByHash", params); 
    }

    async sendRawStakingTransaction(signedTransaction: string | Promise<string>): Promise<TransactionResponse> {
        await this.getNetwork();
        const hexTx = await Promise.resolve(signedTransaction).then(t => hexlify(t));
        const tx = this.formatter.transaction(signedTransaction);
        try {
            const hash = await this.perform("sendRawStakingTransaction", { signedTransaction: hexTx });
            return this._wrapTransaction(tx, hash);
        } catch (error) {
            (<any>error).transaction = tx;
            (<any>error).transactionHash = tx.hash;
            throw error;
        }
    }

    //Transfer
    async getCurrentTransactionErrorSink(): Promise<TransactionError[]> {
        await this.getNetwork();
        const params = {};

        return this.perform("getCurrentTransactionErrorSink", params); 
    }

    async getTransactionByBlockNumberAndIndex(blockNumber: number, transactionIndex: number): Promise<Transaction> {
        await this.getNetwork();
        const params = {
            blockNumber: blockNumber,
            transactionIndex: transactionIndex,
        };

        return this.perform("getTransactionByBlockNumberAndIndex", params); 
    }

    async getTransactionByBlockHashAndIndex(blockHash: string, transactionIndex: number): Promise<Transaction> {
        await this.getNetwork();
        const params = {
            blockHash: blockHash,
            transactionIndex: transactionIndex,
        };

        return this.perform("getTransactionByBlockHashAndIndex", params); 
    }

    async getTransactionByHash(txHash: string): Promise<Transaction> {
        await this.getNetwork();
        const params = {
            txHash: txHash,
        };

        return this.perform("getTransactionByHash", params); 
    }

    async getTransactionReceipt(transactionHash: string | Promise<string>): Promise<TransactionReceipt> {
        await this.getNetwork();

        transactionHash = await transactionHash;

        const params = { transactionHash: this.formatter.hash(transactionHash, true) };

        return poll(async () => {
            const result = await this.perform("getTransactionReceipt", params);

            if (result == null) {
                if (this._emitted["t:" + transactionHash] == null) {
                    return null;
                }
                return undefined;
            }

            // "geth-etc" returns receipts before they are ready
            if (result.blockHash == null) { return undefined; }

            const receipt = this.formatter.receipt(result);

            if (receipt.blockNumber == null) {
                receipt.confirmations = 0;

            } else if (receipt.confirmations == null) {
                const blockNumber = await this._getInternalBlockNumber(100 + 2 * this.pollingInterval);

                // Add the confirmations using the fast block number (pessimistic)
                let confirmations = (blockNumber - receipt.blockNumber) + 1;
                if (confirmations <= 0) { confirmations = 1; }
                receipt.confirmations = confirmations;
            }

            return receipt;
        }, { oncePoll: this });
    }

    async sendRawTransaction(signedTransaction: string | Promise<string>): Promise<TransactionResponse> {
        await this.getNetwork();
        const hexTx = await Promise.resolve(signedTransaction).then(t => hexlify(t));
        const tx = this.formatter.transaction(signedTransaction);
        try {
            const hash = await this.perform("sendRawTransaction", { signedTransaction: hexTx });
            return this._wrapTransaction(tx, hash);
        } catch (error) {
            (<any>error).transaction = tx;
            (<any>error).transactionHash = tx.hash;
            throw error;
        }
    }
}



type ValidatorInformation = {
    //TODO
}

type RawStaleSnapshot= {
    //TODO
}
type SuperCommittee = {
    //TODO
}

type TransactionType = "SENT" | "RECEIVED" | "ALL";
type OrderType = "ASC" | "DESC" ;
type StakingTransaction = {
    blockHash: string | null;
    blockNumber: number | null;
    from: string;
    timestamp: number;
    gasPrice: number;
    gas: number;
    hash: string;
    nonce: number;
    transactionIndex: number | null;
    type: string;
    msg: any;
    v?: number;
}
type Transaction = {
    blockHash: string | null;
    blockNumber: number | null;
    from: string;
    timestamp: number;
    gasPrice: number;
    gas: number;
    hash: string;
    input: string;
    nonce: number;
    to: string;
    transactionIndex: number | null;
    value: number;
    shardID: number;
    toShardID: number;
    v?: number;
}
type CrossLink = {
    hash: string;
    'block-number': number; //ALERT HARMONY
    'view-id': number;
    signature: string;
    'signature-bitmap': string;
    'shard-id': number;
    'epoch-number': number;
}
type ShardingStructure = {
    current: boolean;
    http: string;
    shardID: number;
    ws: string;
}
type Validator = {
    address: string;
    balance: number;
}
type ValidatorsObject = {
    shardID: number;
    validators: Validator[];
}

type TransactionError = {
    'tx-hash-id': string;
    'time-at-rejection': number;
    'error-message': string;
}
type StakingError = {
    'tx-hash-id': string;
    'directive-kind': string;
    'time-at-rejection': number;
    'error-message': string;
}
type PoolStat = {
    'executable-count': string;
    'non-executable-count': string;
}
type PendingCXReceipt = {
    receipts: CXReceipt[];
    merkleProof: any; //TODO
    header: any; //TODO
    commitSig: string;
    commitBitmap: string;
}
type CXReceipt = {
    blockHash: string;
    blockNumber: number;
    hash: string;
    from: string;
    to: string;
    shardID: number;
    toShardID: number;
    value: number;
}
type StakingNetworkInfo = {
    'total-supply': string;
    'circulating-supply': string;
    'epoch-last-block': number;
    'total-staking': number;
    'median-raw-stake': string;
}
type UtilityMetric = {
    AccumulatorSnapshop: number;
    CurrentStakedPercentage: string;
    Deviation: string;
    Adjustment: string;
}
type Delegation = {
    validator_address: string;
    delegator_address: string;
    amount: number;
    reward: number;
    Undelegations: any[];
}

type BlockHeader = {
    blockHash: string;
    blockNumber: number;
    shardID: number;
    leader: string;
    viewID: number;
    epoch: number;
    timestamp: string;
    unixtime: number;
    lastCommitSig: string;
    lastCommitBitmap: string;
}
type BeaconChainHeader = {
    'shard-id': number;
    'block-header-hash': string;
    'block-number': number;
    'view-id': number;
    epoch: number;
}
type ShardChainHeader = {
    'shard-id': number;
    'block-header-hash': string;
    'block-number': number;
    'view-id': number;
    epoch: number;
}
type ChainHeader = {
    'beacon-chain-header': BeaconChainHeader;
    'shard-chain-header': ShardChainHeader;
}
type NodeMetadata = {
    blskey: string[];
    version: string;
    network: string;
    'chain-config': ChainConfig;
    'is-leader': boolean;
    'shard-id': number;
    'current-epoch': number;
    'block-per-epoch': number;
    role: string;
    'dns-zone': string;
    'is-archival': boolean;
    'node-unix-start-time': number;
    'p2p-connectivity': P2PConnectivity;
}

type ChainConfig = {
    'chain-id': number;
    'cross-tx-epoch': number;
    'cross-link-epoch': number;
    'staking-epoch': number;
    'prestaking-epoch': number;
    'quick-unlock-epoch': number;
    'eip155-epoch': number;
    's3-epoch': number;
    'receipt-log-epoch': number;
}

type P2PConnectivity = {
    'total-known-peers': number;
    connected: number;
    'not-connected': number;
}