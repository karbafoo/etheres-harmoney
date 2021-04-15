"use strinct";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { Signer } from '@ethersproject/abstract-signer';
import { BigNumber } from '@ethersproject/bignumber';
import { hexlify, hexValue, isHexString } from '@ethersproject/bytes';
import { _TypedDataEncoder } from '@ethersproject/hash';
import { Logger } from '@ethersproject/logger';
import { checkProperties, deepCopy, defineReadOnly, getStatic, resolveProperties, shallowCopy } from '@ethersproject/properties';
import { toUtf8Bytes } from '@ethersproject/strings';
import { accessListify } from '@ethersproject/transactions';
import { fetchJson, poll } from '@ethersproject/web';
import { BaseProvider } from '..';
import { version } from '../_version';
import { testnet, localnet } from './harmony-rcp-api';
const logger = new Logger(version);
const errorGas = ["call", "estimateGas"];
const requestPrefix = "hmyv2_";
function checkError(method, error, params) {
    // Undo the "convenience" some nodes are attempting to prevent backwards
    // incompatibility; maybe for v6 consider forwarding reverts as errors
    if (method === "call" && error.code === Logger.errors.SERVER_ERROR) {
        const e = error.error;
        if (e && e.message.match("reverted") && isHexString(e.data)) {
            return e.data;
        }
    }
    let message = error.message;
    if (error.code === Logger.errors.SERVER_ERROR && error.error && typeof (error.error.message) === "string") {
        message = error.error.message;
    }
    else if (typeof (error.body) === "string") {
        message = error.body;
    }
    else if (typeof (error.responseText) === "string") {
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
function timer(timeout) {
    return new Promise(function (resolve) {
        setTimeout(resolve, timeout);
    });
}
function getResult(payload) {
    if (payload.error) {
        // @TODO: not any
        const error = new Error(payload.error.message);
        error.code = payload.error.code;
        error.data = payload.error.data;
        throw error;
    }
    return payload.result;
}
function getLowerCase(value) {
    if (value) {
        return value.toLowerCase();
    }
    return value;
}
const _constructorGuard = {};
export class HarmonyRpcSigner extends Signer {
    constructor(constructorGuard, provider, addressOrIndex) {
        logger.checkNew(new.target, HarmonyRpcSigner);
        super();
        if (constructorGuard !== _constructorGuard) {
            throw new Error("do not call the HarmonyRpcSigner constructor directly; use provider.getSigner");
        }
        defineReadOnly(this, "provider", provider);
        if (addressOrIndex == null) {
            addressOrIndex = 0;
        }
        if (typeof (addressOrIndex) === "string") {
            defineReadOnly(this, "_address", this.provider.formatter.address(addressOrIndex));
            defineReadOnly(this, "_index", null);
        }
        else if (typeof (addressOrIndex) === "number") {
            defineReadOnly(this, "_index", addressOrIndex);
            defineReadOnly(this, "_address", null);
        }
        else {
            logger.throwArgumentError("invalid address or index", "addressOrIndex", addressOrIndex);
        }
    }
    connect(provider) {
        return logger.throwError("cannot alter JSON-RPC Signer connection", Logger.errors.UNSUPPORTED_OPERATION, {
            operation: "connect"
        });
    }
    connectUnchecked() {
        return new UncheckedHarmonyRpcSigner(_constructorGuard, this.provider, this._address || this._index);
    }
    getAddress() {
        if (this._address) {
            return Promise.resolve(this._address);
        }
        return this.provider.send(requestPrefix + "accounts", []).then((accounts) => {
            if (accounts.length <= this._index) {
                logger.throwError("unknown account #" + this._index, Logger.errors.UNSUPPORTED_OPERATION, {
                    operation: "getAddress"
                });
            }
            return this.provider.formatter.address(accounts[this._index]);
        });
    }
    sendUncheckedTransaction(transaction) {
        transaction = shallowCopy(transaction);
        const fromAddress = this.getAddress().then((address) => {
            if (address) {
                address = address.toLowerCase();
            }
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
            }
            else {
                tx.from = sender;
            }
            const hexTx = this.provider.constructor.hexlifyTransaction(tx, { from: true });
            return this.provider.send(requestPrefix + "sendRawTransaction", [hexTx]).then((hash) => {
                return hash;
            }, (error) => {
                return checkError("sendRawTransaction", error, hexTx);
            });
        });
    }
    signTransaction(transaction) {
        return logger.throwError("signing transactions is unsupported", Logger.errors.UNSUPPORTED_OPERATION, {
            operation: "signTransaction"
        });
    }
    sendTransaction(transaction) {
        return this.sendUncheckedTransaction(transaction).then((hash) => {
            return poll(() => {
                return this.provider.getTransaction(hash).then((tx) => {
                    if (tx === null) {
                        return undefined;
                    }
                    return this.provider._wrapTransaction(tx, hash);
                });
            }, { onceBlock: this.provider }).catch((error) => {
                error.transactionHash = hash;
                throw error;
            });
        });
    }
    signMessage(message) {
        return __awaiter(this, void 0, void 0, function* () {
            const data = ((typeof (message) === "string") ? toUtf8Bytes(message) : message);
            const address = yield this.getAddress();
            // https://github.com/ethereum/wiki/wiki/JSON-RPC#eth_sign
            return yield this.provider.send(requestPrefix + "sign", [address.toLowerCase(), hexlify(data)]);
        });
    }
    _signTypedData(domain, types, value) {
        return __awaiter(this, void 0, void 0, function* () {
            // Populate any ENS names (in-place)
            const populated = yield _TypedDataEncoder.resolveNames(domain, types, value, (name) => {
                return this.provider.resolveName(name);
            });
            const address = yield this.getAddress();
            return yield this.provider.send(requestPrefix + "signTypedData_v4", [
                address.toLowerCase(),
                JSON.stringify(_TypedDataEncoder.getPayload(populated.domain, types, populated.value))
            ]);
        });
    }
    unlock(password) {
        return __awaiter(this, void 0, void 0, function* () {
            const provider = this.provider;
            const address = yield this.getAddress();
            return provider.send("personal_unlockAccount", [address.toLowerCase(), password, null]);
        });
    }
}
class UncheckedHarmonyRpcSigner extends HarmonyRpcSigner {
    sendTransaction(transaction) {
        return this.sendUncheckedTransaction(transaction).then((hash) => {
            return {
                hash: hash,
                nonce: null,
                gasLimit: null,
                gasPrice: null,
                data: null,
                value: null,
                chainId: null,
                confirmations: 0,
                from: null,
                wait: (confirmations) => { return this.provider.waitForTransaction(hash, confirmations); }
            };
        });
    }
}
const allowedTransactionKeys = {
    chainId: true, data: true, gasLimit: true, gasPrice: true, nonce: true, to: true, value: true,
    type: true, accessList: true
};
export class HarmonyRpcProvider extends BaseProvider {
    constructor(url, network) {
        logger.checkNew(new.target, HarmonyRpcProvider);
        let networkOrReady = network;
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
        this._nextId = 42;
    }
    getURL(u) {
        return 'https://' + u + '/';
    }
    static defaultUrl() {
        return localnet[0];
    }
    detectNetwork() {
        return __awaiter(this, void 0, void 0, function* () {
            yield timer(0);
            let chainId = null;
            try {
                chainId = yield this.send("eth_chainId", []);
            }
            catch (error) {
                try {
                    chainId = yield this.send("net_version", []);
                }
                catch (error) {
                    console.log('net_version error', error);
                }
            }
            console.log(chainId, 'chainId');
            if (chainId != null) {
                const getNetwork = getStatic(this.constructor, "getNetwork");
                try {
                    return getNetwork(BigNumber.from(chainId).toNumber());
                }
                catch (error) {
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
        });
    }
    _getAddress(addressOrName) {
        return __awaiter(this, void 0, void 0, function* () {
            const address = yield this.resolveName(addressOrName);
            if (address == null) {
                logger.throwError("ENS name not configured", Logger.errors.UNSUPPORTED_OPERATION, {
                    operation: `resolveName(${JSON.stringify(addressOrName)})`
                });
            }
            return address;
        });
    }
    resolveName(name) {
        return __awaiter(this, void 0, void 0, function* () {
            name = yield name;
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
        });
    }
    getSigner(addressOrIndex) {
        return new HarmonyRpcSigner(_constructorGuard, this, addressOrIndex);
    }
    getUncheckedSigner(addressOrIndex) {
        return this.getSigner(addressOrIndex).connectUnchecked();
    }
    listAccounts() {
        return this.send(requestPrefix + "accounts", []).then((accounts) => {
            return accounts.map((a) => this.formatter.address(a));
        });
    }
    send(method, params) {
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
    prepareRequest(method, params) {
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
                return ["eth_getLogs", [params.filter]];
            default:
                break;
        }
        switch (method) {
            case "call": {
                const hexlifyTransaction = getStatic(this.constructor, "hexlifyTransaction");
                return [requestPrefix + "call", [hexlifyTransaction(params.transaction, { from: true }), params.blockTag]];
            }
            case "estimateGas": {
                const hexlifyTransaction = getStatic(this.constructor, "hexlifyTransaction");
                return [requestPrefix + "estimateGas", [hexlifyTransaction(params.transaction, { from: true }), params.blockTag]];
            }
            case "getCode": {
                return [requestPrefix + "getCode", [getLowerCase(params.address), params.blockTag]];
            }
            case "getStorageAt":
                return [requestPrefix + "getStorageAt", [getLowerCase(params.address), params.position, params.blockTag]];
            ///
            case "getDelegationsByDelegator": {
                return [requestPrefix + "getDelegationsByDelegator", [getLowerCase(params.delegator)]];
            }
            case "getDelegationsByDelegatorByBlockNumber": {
                return [requestPrefix + "getDelegationsByDelegatorByBlockNumber", [getLowerCase(params.delegator), params.blockNumber]];
            }
            case "getDelegationsByValidator": {
                return [requestPrefix + "getDelegationsByValidator", [getLowerCase(params.validator)]];
            }
            ///
            case "getAllValidatorAddresses": {
                return [requestPrefix + "getAllValidatorAddresses", []];
            }
            case "getAllValidatorInformation": {
                return [requestPrefix + "getAllValidatorInformation", [params.pageIndex]];
            }
            case "getAllValidatorInformationByBlockNumber": {
                return [requestPrefix + "getAllValidatorInformationByBlockNumber", [params.pageIndex, params.blockNumber]];
            }
            case "getElectedValidatorAddresses": {
                return [requestPrefix + "getElectedValidatorAddresses", []];
            }
            case "getValidatorInformation": {
                return [requestPrefix + "getValidatorInformation", [getLowerCase(params.validator)]];
            }
            ///
            case "getCurrentUtilityMetrics": {
                return [requestPrefix + "getCurrentUtilityMetrics", []];
            }
            case "getMedianRawStakeSnapshot": {
                return [requestPrefix + "getMedianRawStakeSnapshot", []];
            }
            case "getStakingNetworkInfo": {
                return [requestPrefix + "getStakingNetworkInfo", []];
            }
            case "getSuperCommittees": {
                return [requestPrefix + "getSuperCommittees", []];
            }
            ///
            case "getCXReceiptByHash": {
                return [requestPrefix + "getCXReceiptByHash", [getLowerCase(params.cxHash)]];
            }
            case "getPendingCXReceipts": {
                return [requestPrefix + "getPendingCXReceipts", []];
            }
            case "resendCx": {
                return [requestPrefix + "resendCx", [getLowerCase(params.cxHash)]];
            }
            ///
            case "getPoolStats": {
                return [requestPrefix + "getPoolStats", []];
            }
            case "getPendingStakingTransaction": {
                return [requestPrefix + "pendingStakingTransaction", []];
            }
            case "getPendingTransactions": {
                return [requestPrefix + "pendingTransactions", []];
            }
            ///
            case "getCurrentStakingErrorSink": {
                return [requestPrefix + "getCurrentStakingErrorSink", []];
            }
            case "getStakingTransactionByBlockNumberAndIndex": {
                return [requestPrefix + "getStakingTransactionByBlockNumberAndIndex", [params.blockNumber, params.stakingTransactionIndex]];
            }
            case "getStakingTransactionByBlockHashAndIndex": {
                return [requestPrefix + "getStakingTransactionByBlockHashAndIndex", [getLowerCase(params.blockHash), params.stakingTransactionIndex]];
            }
            case "getStakingTransactionByHash": {
                return [requestPrefix + "getStakingTransactionByHash", [getLowerCase(params.txHash)]];
            }
            case "sendRawStakingTransaction": {
                return [requestPrefix + "sendRawStakingTransaction", [params.signedTransaction]];
            }
            ///
            case "getCurrentTransactionErrorSink": {
                return [requestPrefix + "getCurrentTransactionErrorSink", []];
            }
            case "getTransactionByBlockNumberAndIndex": {
                return [requestPrefix + "getTransactionByBlockNumberAndIndex", [params.blockNumber, params.transactionIndex]];
            }
            case "getTransactionByBlockHashAndIndex": {
                return [requestPrefix + "getTransactionByBlockHashAndIndex", [getLowerCase(params.blockHash), params.transactionIndex]];
            }
            case "getTransactionByHash": {
                return [requestPrefix + "getTransactionByHash", [getLowerCase(params.txHash)]];
            }
            case "getTransactionReceipt":
                return [requestPrefix + "getTransactionReceipt", [params.transactionHash]];
            case "sendRawTransaction": {
                return [requestPrefix + "sendRawTransaction", [params.signedTransaction]];
            }
            //
            ///
            case "getBlockNumber": {
                return [requestPrefix + "blockNumber", []];
            }
            case "getCirculatingSupply": {
                return [requestPrefix + "getCirculatingSupply", []];
            }
            case "getEpoch": {
                return [requestPrefix + "getEpoch", []];
            }
            case "getLastCrossLinks": {
                return [requestPrefix + "getLastCrossLinks", []];
            }
            case "getLeader": {
                return [requestPrefix + "getLeader", []];
            }
            case "getGasPrice": {
                return [requestPrefix + "gasPrice", []];
            }
            case "getShardingStructure": {
                return [requestPrefix + "getShardingStructure", []];
            }
            case "getTotalSupply": {
                return [requestPrefix + "getTotalSupply", []];
            }
            case "getValidators": {
                return [requestPrefix + "getValidators", [params.epochNumber]];
            }
            case "getValidatorKeys": {
                return [requestPrefix + "getValidatorKeys", [params.epochNumber]];
            }
            ///
            case "getCurrentBadBlocks": {
                return [requestPrefix + "getCurrentBadBlocks", []];
            }
            case "getNodeMetadata": {
                return [requestPrefix + "getNodeMetadata", []];
            }
            case "getProtocolVersion": {
                return [requestPrefix + "protocolVersion", []];
            }
            case "getPeerCount": {
                return [requestPrefix + "peerCount", []];
            }
            ///
            case "getBlocks": {
                return [requestPrefix + "getBlocks", [params.startingBlock, params.endingBlock, params.extra]];
            }
            case "getBlockByNumber": {
                return [requestPrefix + "getBlockByNumber", [params.blockNumber, params.extra]];
            }
            case "getBlockByHash": {
                return [requestPrefix + "getBlockByHash", [getLowerCase(params.blockHash), params.extra]];
            }
            case "getBlockSigners": {
                return [requestPrefix + "getBlockSigners", [params.startingBlock, params.endingBlock, params.extra]];
            }
            case "getBlockSignersKeys": {
                return [requestPrefix + "getBlockSignersKeys", [params.blockNumber]];
            }
            case "getBlockTransactionCountByNumber": {
                return [requestPrefix + "getBlockTransactionCountByNumber", [params.blockNumber]];
            }
            case "getBlockTransactionCountByHash": {
                return [requestPrefix + "getBlockTransactionCountByHash", [getLowerCase(params.blockHash)]];
            }
            case "getHeaderByNumber": {
                return [requestPrefix + "getHeaderByNumber", [params.blockNumber]];
            }
            case "getLatestChainHeaders": {
                return [requestPrefix + "getLatestChainHeaders", []];
            }
            case "getLatestHeaders": {
                return [requestPrefix + "latestHeader", []];
            }
            //
            case "getBalance":
                return [requestPrefix + "getBalance", [getLowerCase(params.address)]];
            case "getBalanceByBlockNumber":
                return [requestPrefix + "getBalanceByBlockNumber", [getLowerCase(params.address), params.blockTag]];
            case "getStakingTransactionsCount":
                return [requestPrefix + "getStakingTransactionsCount", [getLowerCase(params.address), params.transactionType]];
            case "getStakingTransactionsHistory":
                return [requestPrefix + "getStakingTransactionsHistory", [{
                            address: getLowerCase(params.address),
                            pageIndex: params.pageIndex,
                            pageSize: params.pageSize,
                            fullTx: params.fullTx,
                            txType: params.txType,
                            order: params.order,
                        }]];
            case "getTransactionsCount":
                return [requestPrefix + "getTransactionsCount", [getLowerCase(params.address), params.transactionType]];
            case "getTransactionsHistory":
                return [requestPrefix + "getTransactionsHistory", [{
                            address: getLowerCase(params.address),
                            pageIndex: params.pageIndex,
                            pageSize: params.pageSize,
                            fullTx: params.fullTx,
                            txType: params.txType,
                            order: params.order,
                        }]];
            ///
            case "xxxxxx": {
                return [requestPrefix + "xxxxxx", []];
            }
            default:
                break;
        }
        return null;
    }
    perform(method, params) {
        return __awaiter(this, void 0, void 0, function* () {
            const args = this.prepareRequest(method, params);
            if (args == null) {
                logger.throwError(method + " not implemented", Logger.errors.NOT_IMPLEMENTED, { operation: method });
            }
            try {
                return yield this.send(args[0], args[1]);
            }
            catch (error) {
                return checkError(method, error, params);
            }
        });
    }
    _startEvent(event) {
        if (event.tag === "pending") {
            this._startPending();
        }
        super._startEvent(event);
    }
    _startPending() {
        if (this._pendingFilter != null) {
            return;
        }
        const self = this;
        const pendingFilter = this.send(requestPrefix + "newPendingTransactionFilter", []);
        this._pendingFilter = pendingFilter;
        pendingFilter.then(function (filterId) {
            function poll() {
                self.send(requestPrefix + "getFilterChanges", [filterId]).then(function (hashes) {
                    if (self._pendingFilter != pendingFilter) {
                        return null;
                    }
                    let seq = Promise.resolve();
                    hashes.forEach(function (hash) {
                        // @TODO: This should be garbage collected at some point... How? When?
                        self._emitted["t:" + hash.toLowerCase()] = "pending";
                        seq = seq.then(function () {
                            return self.getTransaction(hash).then(function (tx) {
                                self.emit("pending", tx);
                                return null;
                            });
                        });
                    });
                    return seq.then(function () {
                        return timer(1000);
                    });
                }).then(function () {
                    if (self._pendingFilter != pendingFilter) {
                        self.send(requestPrefix + "uninstallFilter", [filterId]);
                        return;
                    }
                    setTimeout(function () { poll(); }, 0);
                    return null;
                }).catch((error) => { });
            }
            poll();
            return filterId;
        }).catch((error) => { });
    }
    _stopEvent(event) {
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
    static hexlifyTransaction(transaction, allowExtra) {
        // Check only allowed properties are given
        const allowed = shallowCopy(allowedTransactionKeys);
        if (allowExtra) {
            for (const key in allowExtra) {
                if (allowExtra[key]) {
                    allowed[key] = true;
                }
            }
        }
        checkProperties(transaction, allowed);
        const result = {};
        // Some nodes (INFURA ropsten; INFURA mainnet is fine) do not like leading zeros.
        ["gasLimit", "gasPrice", "type", "nonce", "value"].forEach(function (key) {
            if (transaction[key] == null) {
                return;
            }
            const value = hexValue(transaction[key]);
            if (key === "gasLimit") {
                key = "gas";
            }
            result[key] = value;
        });
        ["from", "to", "data"].forEach(function (key) {
            if (transaction[key] == null) {
                return;
            }
            result[key] = hexlify(transaction[key]);
        });
        if (transaction.accessList) {
            result["accessList"] = accessListify(transaction.accessList);
        }
        return result;
    }
    // Smart Contract
    //ALERT HARMONY <TransactionRequest>
    call(transaction, blockTag) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = yield resolveProperties({
                transaction: this._getTransactionRequest(transaction),
                blockTag: this._getBlockTag(blockTag)
            });
            const result = yield this.perform("call", params);
            try {
                return hexlify(result);
            }
            catch (error) {
                return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                    method: "call",
                    params, result, error
                });
            }
        });
    }
    estimateGas(transaction) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = yield resolveProperties({
                transaction: this._getTransactionRequest(transaction)
            });
            const result = yield this.perform("estimateGas", params);
            try {
                return BigNumber.from(result);
            }
            catch (error) {
                return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                    method: "estimateGas",
                    params, result, error
                });
            }
        });
    }
    getCode(addressOrName, blockTag) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = yield resolveProperties({
                address: this._getAddress(addressOrName),
                blockTag: this._getBlockTag(blockTag)
            });
            const result = yield this.perform("getCode", params);
            try {
                return hexlify(result);
            }
            catch (error) {
                return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                    method: "getCode",
                    params, result, error
                });
            }
        });
    }
    getStorageAt(addressOrName, position, blockTag) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = yield resolveProperties({
                address: this._getAddress(addressOrName),
                position: Promise.resolve(position).then((p) => hexValue(p)),
                blockTag: this._getBlockTag(blockTag)
            });
            const result = yield this.perform("getStorageAt", params);
            try {
                return hexlify(result);
            }
            catch (error) {
                return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                    method: "getStorageAt",
                    params, result, error
                });
            }
        });
    }
    // Blockchain
    //Network
    getBlockNumber() {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {};
            const result = yield this.perform("getBlockNumber", params);
            try {
                return BigNumber.from(result).toNumber();
            }
            catch (error) {
                return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                    method: "getBlockNumber",
                    params, result, error
                });
            }
        });
    }
    getCirculatingSupply() {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {};
            const result = yield this.perform("getCirculatingSupply", params);
            try {
                return BigNumber.from(result).toNumber();
            }
            catch (error) {
                return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                    method: "getCirculatingSupply",
                    params, result, error
                });
            }
        });
    }
    getEpoch() {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {};
            const result = yield this.perform("getEpoch", params);
            try {
                return BigNumber.from(result).toNumber();
            }
            catch (error) {
                return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                    method: "getEpoch",
                    params, result, error
                });
            }
        });
    }
    getLastCrossLinks() {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {};
            return this.perform("getLastCrossLinks", params);
        });
    }
    getLeader() {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {};
            return this.perform("getLeader", params);
        });
    }
    getGasPrice() {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {};
            const result = yield this.perform("getGasPrice", params);
            try {
                return BigNumber.from(result);
            }
            catch (error) {
                return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                    method: "getGasPrice",
                    params, result, error
                });
            }
        });
    }
    getShardingStructure() {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {};
            return this.perform("getShardingStructure", params);
        });
    }
    getTotalSupply() {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {};
            const result = yield this.perform("getTotalSupply", params);
            try {
                return BigNumber.from(result);
            }
            catch (error) {
                return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                    method: "getTotalSupply",
                    params, result, error
                });
            }
        });
    }
    getValidators(epochNumber) {
        return __awaiter(this, void 0, void 0, function* () {
            const params = yield resolveProperties({
                epochNumber: epochNumber,
            });
            return this.perform("getValidators", params);
        });
    }
    getValidatorKeys(epochNumber) {
        return __awaiter(this, void 0, void 0, function* () {
            const params = yield resolveProperties({
                epochNumber: epochNumber,
            });
            return this.perform("getValidatorKeys", params);
        });
    }
    //Node
    getCurrentBadBlocks() {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {};
            return this.perform("getCurrentBadBlocks", params);
        });
    }
    getNodeMetadata() {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {};
            return this.perform("getNodeMetadata", params);
        });
    }
    getProtocolVersion() {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {};
            const result = yield this.perform("getProtocolVersion", params);
            try {
                return BigNumber.from(result).toNumber();
            }
            catch (error) {
                return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                    method: "getProtocolVersion",
                    params, result, error
                });
            }
        });
    }
    getPeerCount() {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {};
            return this.perform("getPeerCount", params);
        });
    }
    //Blocks
    getBlocks(startingBlock, endingBlock, extra) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = yield resolveProperties({
                startingBlock: startingBlock,
                endingBlock: endingBlock,
                extra: extra,
            });
            return this.perform("getBlocks", params);
        });
    }
    getBlockByNumber(blockNumber, extra) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = yield resolveProperties({
                blockNumber: blockNumber,
                extra: extra,
            });
            return this.perform("getBlockByNumber", params);
        });
    }
    getBlockByHash(blockHash, extra) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = yield resolveProperties({
                blockHash: blockHash,
                extra: extra,
            });
            return this.perform("getBlockByHash", params);
        });
    }
    getBlockSigners(startingBlock, endingBlock, extra) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = yield resolveProperties({
                startingBlock: startingBlock,
                endingBlock: endingBlock,
                extra: extra,
            });
            return this.perform("getBlockSigners", params);
        });
    }
    getBlockSignersKeys(blockNumber) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = yield resolveProperties({
                blockNumber: blockNumber,
            });
            return this.perform("getBlockSignersKeys", params);
        });
    }
    getBlockTransactionCountByNumber(blockNumber) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = yield resolveProperties({
                blockNumber: blockNumber,
            });
            const result = this.perform("getBlockTransactionCountByNumber", params);
            try {
                return BigNumber.from(result).toNumber();
            }
            catch (error) {
                return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                    method: "getBlockTransactionCountByNumber",
                    params, result, error
                });
            }
        });
    }
    getBlockTransactionCountByHash(blockHash) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = yield resolveProperties({
                blockHash: blockHash,
            });
            const result = yield this.perform("getBlockTransactionCountByHash", params);
            try {
                return BigNumber.from(result).toNumber();
            }
            catch (error) {
                return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                    method: "getBlockTransactionCountByHash",
                    params, result, error
                });
            }
        });
    }
    getHeaderByNumber(blockNumber) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = yield resolveProperties({
                blockNumber: blockNumber,
            });
            return this.perform("getHeaderByNumber", params);
        });
    }
    getLatestChainHeaders(blockNumber) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = {};
            return this.perform("getLatestChainHeaders", params);
        });
    }
    getLatestHeader(blockNumber) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = {};
            const result = yield this.perform("getLatestHeader", params);
            try {
                return result;
            }
            catch (error) {
                return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                    method: "getLatestHeader",
                    params, result, error
                });
            }
        });
    }
    // Account
    getBalance(addressOrName) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = yield resolveProperties({
                address: this._getAddress(addressOrName)
            });
            const result = yield this.perform("getBalance", params);
            try {
                return BigNumber.from(BigInt(result));
            }
            catch (error) {
                return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                    method: "getBalance",
                    params, result, error
                });
            }
        });
    }
    getBalanceByBlockNumber(addressOrName, blockTag) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = yield resolveProperties({
                address: this._getAddress(addressOrName),
                blockTag: this._getBlockTag(blockTag)
            });
            const result = yield this.perform("getBalanceByBlockNumber", params);
            try {
                return BigNumber.from(BigInt(result));
            }
            catch (error) {
                return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                    method: "getBalanceByBlockNumber",
                    params, result, error
                });
            }
        });
    }
    getStakingTransactionsCount(addressOrName, transactionType) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = yield resolveProperties({
                address: this._getAddress(addressOrName),
                transactionType: transactionType
            });
            const result = yield this.perform("getStakingTransactionsCount", params);
            try {
                return BigNumber.from(BigInt(result)).toNumber();
            }
            catch (error) {
                return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                    method: "getStakingTransactionsCount",
                    params, result, error
                });
            }
        });
    }
    getStakingTransactionsHistory(addressOrName, pageIndex, pageSize, fullTx, txType, order) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = yield resolveProperties({
                address: this._getAddress(addressOrName),
                pageIndex: pageIndex,
                pageSize: pageSize,
                fullTx: fullTx,
                txType: txType,
                order: order,
            });
            return this.perform("getStakingTransactionsHistory", params);
        });
    }
    getTransactionsCount(addressOrName, transactionType) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = yield resolveProperties({
                address: this._getAddress(addressOrName),
                transactionType: transactionType
            });
            const result = yield this.perform("getTransactionsCount", params); //ALERT HARMONY getTransactionsCount
            try {
                return BigNumber.from(BigInt(result)).toNumber();
            }
            catch (error) {
                return logger.throwError("bad result from backend", Logger.errors.SERVER_ERROR, {
                    method: "getTransactionsCount",
                    params, result, error
                });
            }
        });
    }
    getTransactionsHistory(addressOrName, pageIndex, pageSize, fullTx, txType, order) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = yield resolveProperties({
                address: this._getAddress(addressOrName),
                pageIndex: pageIndex,
                pageSize: pageSize,
                fullTx: fullTx,
                txType: txType,
                order: order,
            });
            return this.perform("getTransactionsHistory", params);
        });
    }
    ///////////// END /////////
    //Staking
    //Delegation
    getDelegationsByDelegator(delegator) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = yield resolveProperties({
                delegator: this._getAddress(delegator),
            });
            return this.perform("getDelegationsByDelegator", params);
        });
    }
    getDelegationsByDelegatorByBlockNumber(delegator, blockNumber) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = yield resolveProperties({
                delegator: this._getAddress(delegator),
                blockNumber: blockNumber
            });
            return this.perform("getDelegationsByDelegatorByBlockNumber", params);
        });
    }
    getDelegationsByValidator(validator) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = yield resolveProperties({
                validator: this._getAddress(validator),
            });
            return this.perform("getDelegationsByValidator", params);
        });
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
    getAllValidatorAddresses() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = {};
            return this.perform("getAllValidatorAddresses", params);
        });
    }
    getAllValidatorInformation(pageIndex) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = {
                pageIndex: pageIndex
            };
            return this.perform("getAllValidatorInformation", params);
        });
    }
    getAllValidatorInformationByBlockNumber(pageIndex, blockNumber) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = {
                pageIndex: pageIndex,
                blockNumber: blockNumber,
            };
            return this.perform("getAllValidatorInformationByBlockNumber", params);
        });
    }
    getElectedValidatorAddresses() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = {};
            return this.perform("getElectedValidatorAddresses", params);
        });
    }
    getValidatorInformation(validator) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = yield resolveProperties({
                validator: this._getAddress(validator),
            });
            return this.perform("getValidatorInformation", params);
        });
    }
    //Network
    getCurrentUtilityMetrics() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = {};
            return this.perform("getCurrentUtilityMetrics", params);
        });
    }
    getMedianRawStakeSnapshot() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = {};
            return this.perform("getMedianRawStakeSnapshot", params);
        });
    }
    getStakingNetworkInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = {};
            return this.perform("getStakingNetworkInfo", params);
        });
    }
    getSuperCommittees() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = {};
            return this.perform("getSuperCommittees", params);
        });
    }
    //Transaction
    //Cross Shard
    getCXReceiptByHash(cxHash) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = yield resolveProperties({
                cxHash: cxHash,
            });
            return this.perform("getCXReceiptByHash", params);
        });
    }
    getPendingCXReceipts() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = {};
            return this.perform("getPendingCXReceipts", params);
        });
    }
    resendCx(cxHash) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = {
                cxHash: cxHash
            };
            return this.perform("resendCx", params);
        });
    }
    //Transaction Pool
    getPoolStats() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = {};
            return this.perform("getPoolStats", params);
        });
    }
    getPendingStakingTransaction() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = {};
            return this.perform("getPendingStakingTransaction", params);
        });
    }
    getPendingTransactions() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = {};
            return this.perform("getPendingTransactions", params);
        });
    }
    //Staking
    getCurrentStakingErrorSink() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = {};
            return this.perform("getCurrentStakingErrorSink", params);
        });
    }
    getStakingTransactionByBlockNumberAndIndex(blockNumber, stakingTransactionIndex) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = {
                blockNumber: blockNumber,
                stakingTransactionIndex: stakingTransactionIndex,
            };
            return this.perform("getStakingTransactionByBlockNumberAndIndex", params);
        });
    }
    getStakingTransactionByBlockHashAndIndex(blockHash, stakingTransactionIndex) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = {
                blockHash: blockHash,
                stakingTransactionIndex: stakingTransactionIndex,
            };
            return this.perform("getStakingTransactionByBlockHashAndIndex", params);
        });
    }
    getStakingTransactionByHash(txHash) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = {
                txHash: txHash,
            };
            return this.perform("getStakingTransactionByHash", params);
        });
    }
    sendRawStakingTransaction(signedTransaction) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const hexTx = yield Promise.resolve(signedTransaction).then(t => hexlify(t));
            const tx = this.formatter.transaction(signedTransaction);
            try {
                const hash = yield this.perform("sendRawStakingTransaction", { signedTransaction: hexTx });
                return this._wrapTransaction(tx, hash);
            }
            catch (error) {
                error.transaction = tx;
                error.transactionHash = tx.hash;
                throw error;
            }
        });
    }
    //Transfer
    getCurrentTransactionErrorSink() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = {};
            return this.perform("getCurrentTransactionErrorSink", params);
        });
    }
    getTransactionByBlockNumberAndIndex(blockNumber, transactionIndex) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = {
                blockNumber: blockNumber,
                transactionIndex: transactionIndex,
            };
            return this.perform("getTransactionByBlockNumberAndIndex", params);
        });
    }
    getTransactionByBlockHashAndIndex(blockHash, transactionIndex) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = {
                blockHash: blockHash,
                transactionIndex: transactionIndex,
            };
            return this.perform("getTransactionByBlockHashAndIndex", params);
        });
    }
    getTransactionByHash(txHash) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const params = {
                txHash: txHash,
            };
            return this.perform("getTransactionByHash", params);
        });
    }
    getTransactionReceipt(transactionHash) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            transactionHash = yield transactionHash;
            const params = { transactionHash: this.formatter.hash(transactionHash, true) };
            return poll(() => __awaiter(this, void 0, void 0, function* () {
                const result = yield this.perform("getTransactionReceipt", params);
                if (result == null) {
                    if (this._emitted["t:" + transactionHash] == null) {
                        return null;
                    }
                    return undefined;
                }
                // "geth-etc" returns receipts before they are ready
                if (result.blockHash == null) {
                    return undefined;
                }
                const receipt = this.formatter.receipt(result);
                if (receipt.blockNumber == null) {
                    receipt.confirmations = 0;
                }
                else if (receipt.confirmations == null) {
                    const blockNumber = yield this._getInternalBlockNumber(100 + 2 * this.pollingInterval);
                    // Add the confirmations using the fast block number (pessimistic)
                    let confirmations = (blockNumber - receipt.blockNumber) + 1;
                    if (confirmations <= 0) {
                        confirmations = 1;
                    }
                    receipt.confirmations = confirmations;
                }
                return receipt;
            }), { oncePoll: this });
        });
    }
    sendRawTransaction(signedTransaction) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getNetwork();
            const hexTx = yield Promise.resolve(signedTransaction).then(t => hexlify(t));
            const tx = this.formatter.transaction(signedTransaction);
            try {
                const hash = yield this.perform("sendRawTransaction", { signedTransaction: hexTx });
                return this._wrapTransaction(tx, hash);
            }
            catch (error) {
                error.transaction = tx;
                error.transactionHash = tx.hash;
                throw error;
            }
        });
    }
}
//# sourceMappingURL=harmony-provider.js.map