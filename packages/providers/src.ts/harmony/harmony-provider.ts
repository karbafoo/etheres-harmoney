"use strinct";

import { BlockTag, Provider, TransactionRequest, TransactionResponse } from '@ethersproject/abstract-provider';
import { Signer, TypedDataDomain, TypedDataField, TypedDataSigner } from '@ethersproject/abstract-signer';
import { BigNumber } from '@ethersproject/bignumber';
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
import {testnet,localnet} from './HARMONY_ENDPOINTS';

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

        return this.provider.send(requestPrefix+"ccounts", []).then((accounts) => {
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

            return this.provider.send(requestPrefix + "sendTransaction", [ hexTx ]).then((hash) => {
                return hash;
            }, (error) => {
                return checkError("sendTransaction", error, hexTx);
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
        console.log('this.connetion', this.connection)
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
            case "getBlockNumberOld":
                return [ "eth_blockNumber", [] ];
            case "getBlockNumber":
                return [ requestPrefix + "blockNumber", [] ];
     

            case "getGasPrice":
                return [ requestPrefix + "gasPrice", [] ];

            case "getBalance":
                return [ requestPrefix + "getBalance", [ getLowerCase(params.address) ] ];

            case "getTransactionCount":
                return [ requestPrefix + "getTransactionCount", [ getLowerCase(params.address), params.blockTag ] ];

            case "getCode":
                return [ requestPrefix + "getCode", [ getLowerCase(params.address), params.blockTag ] ];

            case "getStorageAt":
                return [ requestPrefix + "getStorageAt", [ getLowerCase(params.address), params.position, params.blockTag ] ];

            case "sendTransaction":
                return [ requestPrefix + "sendRawTransaction", [ params.signedTransaction ] ]

            case "getBlock":
                if (params.blockTag) {
                    return [ requestPrefix + "getBlockByNumber", [ params.blockTag, !!params.includeTransactions ] ];
                } else if (params.blockHash) {
                    return [ requestPrefix + "getBlockByHash", [ params.blockHash, !!params.includeTransactions ] ];
                }
                return null;

            case "getTransaction":
                return [ requestPrefix + "getTransactionByHash", [ params.transactionHash ] ];

            case "getTransactionReceipt":
                return [ requestPrefix + "getTransactionReceipt", [ params.transactionHash ] ];

            case "call": {
                const hexlifyTransaction = getStatic<(t: TransactionRequest, a?: { [key: string]: boolean }) => { [key: string]: string }>(this.constructor, "hexlifyTransaction");
                return [ requestPrefix + "call", [ hexlifyTransaction(params.transaction, { from: true }), params.blockTag ] ];
            }

            case "estimateGas": {
                const hexlifyTransaction = getStatic<(t: TransactionRequest, a?: { [key: string]: boolean }) => { [key: string]: string }>(this.constructor, "hexlifyTransaction");
                return [ requestPrefix + "estimateGas", [ hexlifyTransaction(params.transaction, { from: true }) ] ];
            }

            case "getLogs":
                if (params.filter && params.filter.address != null) {
                    params.filter.address = getLowerCase(params.filter.address);
                }
                return [ requestPrefix + "getLogs", [ params.filter ] ];

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


    async getBalance(addressOrName: string | Promise<string>, blockTag?: BlockTag | Promise<BlockTag>): Promise<BigNumber> {
        await this.getNetwork();
        const params = await resolveProperties({
            address: this._getAddress(addressOrName),
            blockTag: this._getBlockTag(blockTag)
        });

        const result: string = await this.perform("getBalance", params);
        console.log('getbalance',result);
        try {
            return BigNumber.from(result);
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getBalance",
                params, result, error
            });
        }
    }
}
