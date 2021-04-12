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

            case "sendRawTransaction":
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
        const result = await this.perform("getLastCrossLinks",params);
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getLastCrossLinks",
                params, result, error
            });
        }
    }

    async getLeader(): Promise<string> {
        const params = {};
        const result = await this.perform("getLeader",params);
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getLeader",
                params, result, error
            });
        }
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
        const result = await this.perform("getShardingStructure",params);
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getShardingStructure",
                params, result, error
            });
        }
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
        const result = await this.perform("getValidators",params);
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getValidators",
                params, result, error
            });
        }
    }

    async getValidatorKeys(epochNumber: number): Promise<string[]> {
        const params = await resolveProperties({
            epochNumber: epochNumber,
        });
        const result = await this.perform("getValidatorKeys",params);
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getValidatorKeys",
                params, result, error
            });
        }
    }

    //Node
    async getCurrentBadBlocks(): Promise<string[]> {
        const params = {};
        const result = await this.perform("getCurrentBadBlocks",params);
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getCurrentBadBlocks",
                params, result, error
            });
        }
    }

    async getNodeMetadata(): Promise<NodeMetadata> {
        const params = {};
        const result = await this.perform("getNodeMetadata",params);
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getNodeMetadata",
                params, result, error
            });
        }
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
        const result = await this.perform("getPeerCount",params);
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getPeerCount",
                params, result, error
            });
        }
    }

    //Blocks
    async getBlocks(startingBlock: number, endingBlock: number, extra: {withSingers: boolean;fullTx: boolean; inclStaking: boolean;}): Promise<Block[]> {
        await this.getNetwork();
        const params = await resolveProperties({
            startingBlock: startingBlock,
            endingBlock: endingBlock,
            extra: extra,
        });

        const result = await this.perform("getBlocks", params);
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getBlocks",
                params, result, error
            });
        }
    }

    async getBlockByNumber(blockNumber: number, extra: {withSingers: boolean;fullTx: boolean; inclStaking: boolean;}): Promise<Block> {
        await this.getNetwork();
        const params = await resolveProperties({
            blockNumber: blockNumber,
            extra: extra,
        });

        const result = await this.perform("getBlockByNumber", params);
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getBlockByNumber",
                params, result, error
            });
        }
    }

    async getBlockByHash(blockHash: string, extra: {withSingers: boolean;fullTx: boolean; inclStaking: boolean;}): Promise<Block> {
        await this.getNetwork();
        const params = await resolveProperties({
            blockHash: blockHash,
            extra: extra,
        });

        const result = await this.perform("getBlockByHash", params);
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getBlockByHash",
                params, result, error
            });
        }
    }


    async getBlockSigners(startingBlock: number, endingBlock: number, extra: {withSingers: boolean;fullTx: boolean; inclStaking: boolean;}): Promise<string[]> {
        await this.getNetwork();
        const params = await resolveProperties({
            startingBlock: startingBlock,
            endingBlock: endingBlock,
            extra: extra,
        });

        const result = await this.perform("getBlockSigners", params);
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getBlockSigners",
                params, result, error
            });
        }
    }

    async getBlockSignersKeys(blockNumber: number): Promise<string[]> {
        await this.getNetwork();
        const params = await resolveProperties({
            blockNumber: blockNumber,
        });

        const result = await this.perform("getBlockSignersKeys", params);
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getBlockSignersKeys",
                params, result, error
            });
        }
    }

    async getBlockTransactionCountByNumber(blockNumber: number): Promise<number> {
        await this.getNetwork();
        const params = await resolveProperties({
            blockNumber: blockNumber,
        });

        const result = await this.perform("getBlockTransactionCountByNumber", params);
        try {
            return result;
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
            return result;
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

        const result = await this.perform("getHeaderByNumber", params);
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getHeaderByNumber",
                params, result, error
            });
        }
    }

    async getLatestChainHeaders(blockNumber: number): Promise<ChainHeader> {
        await this.getNetwork();
        const params = {};

        const result = await this.perform("getLatestChainHeaders", params);
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getLatestChainHeaders",
                params, result, error
            });
        }
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

        const result = await this.perform("getStakingTransactionsHistory", params);

        try {
            return result.staking_transactions;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getStakingTransactionsHistory",
                params, result, error
            });
        }
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

        const result = await this.perform("getTransactionsHistory", params);

        try {
            return result.staking_transactions;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getTransactionsHistory",
                params, result, error
            });
        }
    }

    ///////////// END /////////
    //Staking
    //Delegation
    async getDelegationsByDelegator(delegator: string | Promise<string>): Promise<Delegation[]> {
        await this.getNetwork();
        const params = await resolveProperties({
            delegator: this._getAddress(delegator),
        });

        const result = await this.perform("getDelegationsByDelegator", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getDelegationsByDelegator",
                params, result, error
            });
        }
    }

    async getDelegationsByDelegatorByBlockNumber(delegator: string | Promise<string>, blockNumber: number): Promise<Delegation[]> {
        await this.getNetwork();
        const params = await resolveProperties({
            delegator: this._getAddress(delegator),
            blockNumber: blockNumber
        });

        const result = await this.perform("getDelegationsByDelegatorByBlockNumber", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getDelegationsByDelegatorByBlockNumber",
                params, result, error
            });
        }
    }

    async getDelegationsByValidator(validator: string | Promise<string>): Promise<Delegation[]> {
        await this.getNetwork();
        const params = await resolveProperties({
            validator: this._getAddress(validator),
        });

        const result = await this.perform("getDelegationsByValidator", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getDelegationsByValidator",
                params, result, error
            });
        }
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

        const result = await this.perform("getAllValidatorAddresses", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getAllValidatorAddresses",
                params, result, error
            });
        }
    }

    async getAllValidatorInformation(pageIndex: number): Promise<ValidatorInformation[]> {
        await this.getNetwork();
        const params = {
            pageIndex: pageIndex
        };

        const result = await this.perform("getAllValidatorInformation", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getAllValidatorInformation",
                params, result, error
            });
        }
    }

    async getAllValidatorInformationByBlockNumber(pageIndex: number, blockNumber: number): Promise<ValidatorInformation[]> {
        await this.getNetwork();
        const params = {
            pageIndex: pageIndex,
            blockNumber: blockNumber,
        };

        const result = await this.perform("getAllValidatorInformationByBlockNumber", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getAllValidatorInformationByBlockNumber",
                params, result, error
            });
        }
    }

    async getElectedValidatorAddresses(): Promise<string[]> {
        await this.getNetwork();
        const params = {};

        const result = await this.perform("getElectedValidatorAddresses", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getElectedValidatorAddresses",
                params, result, error
            });
        }
    }

    async getValidatorInformation(validator: string): Promise<ValidatorInformation> {
        await this.getNetwork();
        const params = await resolveProperties({
            validator: this._getAddress(validator),
        });

        const result = await this.perform("getValidatorInformation", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getValidatorInformation",
                params, result, error
            });
        }
    }

    //Network
    async getCurrentUtilityMetrics(): Promise<UtilityMetric> {
        await this.getNetwork();
        const params = {};

        const result = await this.perform("getCurrentUtilityMetrics", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getCurrentUtilityMetrics",
                params, result, error
            });
        }
    }

    async getMedianRawStakeSnapshot(): Promise<RawStaleSnapshot> {
        await this.getNetwork();
        const params = {};

        const result = await this.perform("getMedianRawStakeSnapshot", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getMedianRawStakeSnapshot",
                params, result, error
            });
        }
    }

    async getStakingNetworkInfo(): Promise<StakingNetworkInfo> {
        await this.getNetwork();
        const params = {};

        const result = await this.perform("getStakingNetworkInfo", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getStakingNetworkInfo",
                params, result, error
            });
        }
    }

    async getSuperCommittees(): Promise<SuperCommittee> {
        await this.getNetwork();
        const params = {};

        const result = await this.perform("getSuperCommittees", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getSuperCommittees",
                params, result, error
            });
        }
    }

    //Transaction
    //Cross Shard
    async getCXReceiptByHash(cxHash: string): Promise<CXReceipt> {
        await this.getNetwork();
        const params = await resolveProperties({
            cxHash: cxHash,
        });

        const result = await this.perform("getCXReceiptByHash", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getCXReceiptByHash",
                params, result, error
            });
        }
    }

    async getPendingCXReceipts(): Promise<PendingCXReceipt[]> {
        await this.getNetwork();
        const params = {};

        const result = await this.perform("getPendingCXReceipts", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getPendingCXReceipts",
                params, result, error
            });
        }
    }

    async resendCx(cxReceiptHash: string): Promise<boolean> {
        await this.getNetwork();
        const params = {
            cxReceiptHash: cxReceiptHash
        };

        const result = await this.perform("resendCx", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "resendCx",
                params, result, error
            });
        }
    }

    //Transaction Pool
    async getPoolStats(): Promise<PoolStat> {
        await this.getNetwork();
        const params = {};

        const result = await this.perform("getPoolStats", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getPoolStats",
                params, result, error
            });
        }
    }

    async getPendingStakingTransaction(): Promise<StakingTransaction[]> {
        await this.getNetwork();
        const params = {};

        const result = await this.perform("getPendingStakingTransaction", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getPendingStakingTransaction",
                params, result, error
            });
        }
    }

    async getPendingTransactions(): Promise<Transaction[]> {
        await this.getNetwork();
        const params = {};

        const result = await this.perform("getPendingTransactions", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getPendingTransactions",
                params, result, error
            });
        }
    }

    //Staking
    async getCurrentStakingErrorSink(): Promise<StakingError[]> {
        await this.getNetwork();
        const params = {};

        const result = await this.perform("getCurrentStakingErrorSink", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getCurrentStakingErrorSink",
                params, result, error
            });
        }
    }

    async getStakingTransactionByBlockNumberAndIndex(blockNumber: number, stakingTransactionIndex: number): Promise<StakingTransaction> {
        await this.getNetwork();
        const params = {
            blockNumber: blockNumber,
            stakingTransactionIndex: stakingTransactionIndex,
        };

        const result = await this.perform("getStakingTransactionByBlockNumberAndIndex", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getStakingTransactionByBlockNumberAndIndex",
                params, result, error
            });
        }
    }

    async getStakingTransactionByBlockHashAndIndex(blockHash: string, stakingTransactionIndex: number): Promise<StakingTransaction> {
        await this.getNetwork();
        const params = {
            blockHash: blockHash,
            stakingTransactionIndex: stakingTransactionIndex,
        };

        const result = await this.perform("getStakingTransactionByBlockHashAndIndex", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getStakingTransactionByBlockHashAndIndex",
                params, result, error
            });
        }
    }

    async getStakingTransactionByHash(blockHash: string): Promise<StakingTransaction> {
        await this.getNetwork();
        const params = {
            blockHash: blockHash,
        };

        const result = await this.perform("getStakingTransactionByHash", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getStakingTransactionByHash",
                params, result, error
            });
        }
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

        const result = await this.perform("getCurrentTransactionErrorSink", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getCurrentTransactionErrorSink",
                params, result, error
            });
        }
    }

    async getTransactionByBlockNumberAndIndex(blockNumber: number, transactionIndex: number): Promise<Transaction> {
        await this.getNetwork();
        const params = {
            blockNumber: blockNumber,
            transactionIndex: transactionIndex,
        };

        const result = await this.perform("getTransactionByBlockNumberAndIndex", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getTransactionByBlockNumberAndIndex",
                params, result, error
            });
        }
    }

    async getTransactionByBlockHashAndIndex(blockHash: string, transactionIndex: number): Promise<Transaction> {
        await this.getNetwork();
        const params = {
            blockHash: blockHash,
            transactionIndex: transactionIndex,
        };

        const result = await this.perform("getTransactionByBlockHashAndIndex", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getTransactionByBlockHashAndIndex",
                params, result, error
            });
        }
    }

    async getTransactionByHash(blockHash: string): Promise<Transaction> {
        await this.getNetwork();
        const params = {
            blockHash: blockHash,
        };

        const result = await this.perform("getTransactionByHash", params); 
        try {
            return result;
        } catch (error) {
            return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                method: "getTransactionByHash",
                params, result, error
            });
        }
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
