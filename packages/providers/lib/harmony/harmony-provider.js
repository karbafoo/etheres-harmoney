"use strinct";
"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HarmonyRpcProvider = exports.HarmonyRpcSigner = void 0;
var abstract_signer_1 = require("@ethersproject/abstract-signer");
var bignumber_1 = require("@ethersproject/bignumber");
var bytes_1 = require("@ethersproject/bytes");
var hash_1 = require("@ethersproject/hash");
var logger_1 = require("@ethersproject/logger");
var properties_1 = require("@ethersproject/properties");
var strings_1 = require("@ethersproject/strings");
var transactions_1 = require("@ethersproject/transactions");
var web_1 = require("@ethersproject/web");
var __1 = require("..");
var _version_1 = require("../_version");
var HARMONY_ENDPOINTS_1 = require("./HARMONY_ENDPOINTS");
var logger = new logger_1.Logger(_version_1.version);
var errorGas = ["call", "estimateGas"];
var requestPrefix = "hmyv2_";
function checkError(method, error, params) {
    // Undo the "convenience" some nodes are attempting to prevent backwards
    // incompatibility; maybe for v6 consider forwarding reverts as errors
    if (method === "call" && error.code === logger_1.Logger.errors.SERVER_ERROR) {
        var e = error.error;
        if (e && e.message.match("reverted") && bytes_1.isHexString(e.data)) {
            return e.data;
        }
    }
    var message = error.message;
    if (error.code === logger_1.Logger.errors.SERVER_ERROR && error.error && typeof (error.error.message) === "string") {
        message = error.error.message;
    }
    else if (typeof (error.body) === "string") {
        message = error.body;
    }
    else if (typeof (error.responseText) === "string") {
        message = error.responseText;
    }
    message = (message || "").toLowerCase();
    var transaction = params.transaction || params.signedTransaction;
    // "insufficient funds for gas * price + value + cost(data)"
    if (message.match(/insufficient funds/)) {
        logger.throwError("insufficient funds for intrinsic transaction cost", logger_1.Logger.errors.INSUFFICIENT_FUNDS, {
            error: error, method: method, transaction: transaction
        });
    }
    // "nonce too low"
    if (message.match(/nonce too low/)) {
        logger.throwError("nonce has already been used", logger_1.Logger.errors.NONCE_EXPIRED, {
            error: error, method: method, transaction: transaction
        });
    }
    // "replacement transaction underpriced"
    if (message.match(/replacement transaction underpriced/)) {
        logger.throwError("replacement fee too low", logger_1.Logger.errors.REPLACEMENT_UNDERPRICED, {
            error: error, method: method, transaction: transaction
        });
    }
    if (errorGas.indexOf(method) >= 0 && message.match(/gas required exceeds allowance|always failing transaction|execution reverted/)) {
        logger.throwError("cannot estimate gas; transaction may fail or may require manual gas limit", logger_1.Logger.errors.UNPREDICTABLE_GAS_LIMIT, {
            error: error, method: method, transaction: transaction
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
        var error = new Error(payload.error.message);
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
var _constructorGuard = {};
var HarmonyRpcSigner = /** @class */ (function (_super) {
    __extends(HarmonyRpcSigner, _super);
    function HarmonyRpcSigner(constructorGuard, provider, addressOrIndex) {
        var _newTarget = this.constructor;
        var _this = this;
        logger.checkNew(_newTarget, HarmonyRpcSigner);
        _this = _super.call(this) || this;
        if (constructorGuard !== _constructorGuard) {
            throw new Error("do not call the HarmonyRpcSigner constructor directly; use provider.getSigner");
        }
        properties_1.defineReadOnly(_this, "provider", provider);
        if (addressOrIndex == null) {
            addressOrIndex = 0;
        }
        if (typeof (addressOrIndex) === "string") {
            properties_1.defineReadOnly(_this, "_address", _this.provider.formatter.address(addressOrIndex));
            properties_1.defineReadOnly(_this, "_index", null);
        }
        else if (typeof (addressOrIndex) === "number") {
            properties_1.defineReadOnly(_this, "_index", addressOrIndex);
            properties_1.defineReadOnly(_this, "_address", null);
        }
        else {
            logger.throwArgumentError("invalid address or index", "addressOrIndex", addressOrIndex);
        }
        return _this;
    }
    HarmonyRpcSigner.prototype.connect = function (provider) {
        return logger.throwError("cannot alter JSON-RPC Signer connection", logger_1.Logger.errors.UNSUPPORTED_OPERATION, {
            operation: "connect"
        });
    };
    HarmonyRpcSigner.prototype.connectUnchecked = function () {
        return new UncheckedHarmonyRpcSigner(_constructorGuard, this.provider, this._address || this._index);
    };
    HarmonyRpcSigner.prototype.getAddress = function () {
        var _this = this;
        if (this._address) {
            return Promise.resolve(this._address);
        }
        return this.provider.send(requestPrefix + "ccounts", []).then(function (accounts) {
            if (accounts.length <= _this._index) {
                logger.throwError("unknown account #" + _this._index, logger_1.Logger.errors.UNSUPPORTED_OPERATION, {
                    operation: "getAddress"
                });
            }
            return _this.provider.formatter.address(accounts[_this._index]);
        });
    };
    HarmonyRpcSigner.prototype.sendUncheckedTransaction = function (transaction) {
        var _this = this;
        transaction = properties_1.shallowCopy(transaction);
        var fromAddress = this.getAddress().then(function (address) {
            if (address) {
                address = address.toLowerCase();
            }
            return address;
        });
        if (transaction.gasLimit == null) {
            var estimate = properties_1.shallowCopy(transaction);
            estimate.from = fromAddress;
            transaction.gasLimit = this.provider.estimateGas(estimate);
        }
        return properties_1.resolveProperties({
            tx: properties_1.resolveProperties(transaction),
            sender: fromAddress
        }).then(function (_a) {
            var tx = _a.tx, sender = _a.sender;
            if (tx.from != null) {
                if (tx.from.toLowerCase() !== sender) {
                    logger.throwArgumentError("from address mismatch", "transaction", transaction);
                }
            }
            else {
                tx.from = sender;
            }
            var hexTx = _this.provider.constructor.hexlifyTransaction(tx, { from: true });
            return _this.provider.send(requestPrefix + "sendTransaction", [hexTx]).then(function (hash) {
                return hash;
            }, function (error) {
                return checkError("sendTransaction", error, hexTx);
            });
        });
    };
    HarmonyRpcSigner.prototype.signTransaction = function (transaction) {
        return logger.throwError("signing transactions is unsupported", logger_1.Logger.errors.UNSUPPORTED_OPERATION, {
            operation: "signTransaction"
        });
    };
    HarmonyRpcSigner.prototype.sendTransaction = function (transaction) {
        var _this = this;
        return this.sendUncheckedTransaction(transaction).then(function (hash) {
            return web_1.poll(function () {
                return _this.provider.getTransaction(hash).then(function (tx) {
                    if (tx === null) {
                        return undefined;
                    }
                    return _this.provider._wrapTransaction(tx, hash);
                });
            }, { onceBlock: _this.provider }).catch(function (error) {
                error.transactionHash = hash;
                throw error;
            });
        });
    };
    HarmonyRpcSigner.prototype.signMessage = function (message) {
        return __awaiter(this, void 0, void 0, function () {
            var data, address;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        data = ((typeof (message) === "string") ? strings_1.toUtf8Bytes(message) : message);
                        return [4 /*yield*/, this.getAddress()];
                    case 1:
                        address = _a.sent();
                        return [4 /*yield*/, this.provider.send(requestPrefix + "sign", [address.toLowerCase(), bytes_1.hexlify(data)])];
                    case 2: 
                    // https://github.com/ethereum/wiki/wiki/JSON-RPC#eth_sign
                    return [2 /*return*/, _a.sent()];
                }
            });
        });
    };
    HarmonyRpcSigner.prototype._signTypedData = function (domain, types, value) {
        return __awaiter(this, void 0, void 0, function () {
            var populated, address;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, hash_1._TypedDataEncoder.resolveNames(domain, types, value, function (name) {
                            return _this.provider.resolveName(name);
                        })];
                    case 1:
                        populated = _a.sent();
                        return [4 /*yield*/, this.getAddress()];
                    case 2:
                        address = _a.sent();
                        return [4 /*yield*/, this.provider.send(requestPrefix + "signTypedData_v4", [
                                address.toLowerCase(),
                                JSON.stringify(hash_1._TypedDataEncoder.getPayload(populated.domain, types, populated.value))
                            ])];
                    case 3: return [2 /*return*/, _a.sent()];
                }
            });
        });
    };
    HarmonyRpcSigner.prototype.unlock = function (password) {
        return __awaiter(this, void 0, void 0, function () {
            var provider, address;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        provider = this.provider;
                        return [4 /*yield*/, this.getAddress()];
                    case 1:
                        address = _a.sent();
                        return [2 /*return*/, provider.send("personal_unlockAccount", [address.toLowerCase(), password, null])];
                }
            });
        });
    };
    return HarmonyRpcSigner;
}(abstract_signer_1.Signer));
exports.HarmonyRpcSigner = HarmonyRpcSigner;
var UncheckedHarmonyRpcSigner = /** @class */ (function (_super) {
    __extends(UncheckedHarmonyRpcSigner, _super);
    function UncheckedHarmonyRpcSigner() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    UncheckedHarmonyRpcSigner.prototype.sendTransaction = function (transaction) {
        var _this = this;
        return this.sendUncheckedTransaction(transaction).then(function (hash) {
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
                wait: function (confirmations) { return _this.provider.waitForTransaction(hash, confirmations); }
            };
        });
    };
    return UncheckedHarmonyRpcSigner;
}(HarmonyRpcSigner));
var allowedTransactionKeys = {
    chainId: true, data: true, gasLimit: true, gasPrice: true, nonce: true, to: true, value: true,
    type: true, accessList: true
};
var HarmonyRpcProvider = /** @class */ (function (_super) {
    __extends(HarmonyRpcProvider, _super);
    function HarmonyRpcProvider(url, network) {
        var _newTarget = this.constructor;
        var _this = this;
        logger.checkNew(_newTarget, HarmonyRpcProvider);
        var networkOrReady = network;
        // The network is unknown, query the JSON-RPC for it
        if (networkOrReady == null) {
            networkOrReady = new Promise(function (resolve, reject) {
                setTimeout(function () {
                    _this.detectNetwork().then(function (network) {
                        resolve(network);
                    }, function (error) {
                        reject(error);
                    });
                }, 0);
            });
        }
        _this = _super.call(this, networkOrReady) || this;
        url = url ? url : _this.getURL(HARMONY_ENDPOINTS_1.testnet[0]);
        // Default URL
        if (!url) {
            url = properties_1.getStatic(_this.constructor, "defaultUrl")();
        }
        if (typeof (url) === "string") {
            properties_1.defineReadOnly(_this, "connection", Object.freeze({
                url: url
            }));
        }
        else {
            properties_1.defineReadOnly(_this, "connection", Object.freeze(properties_1.shallowCopy(url)));
        }
        _this._nextId = 42;
        return _this;
    }
    HarmonyRpcProvider.prototype.getURL = function (u) {
        return 'https://' + u + '/';
    };
    HarmonyRpcProvider.defaultUrl = function () {
        return HARMONY_ENDPOINTS_1.localnet[0];
    };
    HarmonyRpcProvider.prototype.detectNetwork = function () {
        return __awaiter(this, void 0, void 0, function () {
            var chainId, error_1, error_2, getNetwork;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, timer(0)];
                    case 1:
                        _a.sent();
                        chainId = null;
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 4, , 9]);
                        return [4 /*yield*/, this.send("eth_chainId", [])];
                    case 3:
                        chainId = _a.sent();
                        return [3 /*break*/, 9];
                    case 4:
                        error_1 = _a.sent();
                        _a.label = 5;
                    case 5:
                        _a.trys.push([5, 7, , 8]);
                        return [4 /*yield*/, this.send("net_version", [])];
                    case 6:
                        chainId = _a.sent();
                        return [3 /*break*/, 8];
                    case 7:
                        error_2 = _a.sent();
                        console.log('net_version error', error_2);
                        return [3 /*break*/, 8];
                    case 8: return [3 /*break*/, 9];
                    case 9:
                        console.log(chainId, 'chainId');
                        if (chainId != null) {
                            getNetwork = properties_1.getStatic(this.constructor, "getNetwork");
                            try {
                                return [2 /*return*/, getNetwork(bignumber_1.BigNumber.from(chainId).toNumber())];
                            }
                            catch (error) {
                                return [2 /*return*/, logger.throwError("could not detect network", logger_1.Logger.errors.NETWORK_ERROR, {
                                        chainId: chainId,
                                        event: "invalidNetwork",
                                        serverError: error
                                    })];
                            }
                        }
                        return [2 /*return*/, logger.throwError("could not detect network", logger_1.Logger.errors.NETWORK_ERROR, {
                                event: "noNetwork"
                            })];
                }
            });
        });
    };
    HarmonyRpcProvider.prototype._getAddress = function (addressOrName) {
        return __awaiter(this, void 0, void 0, function () {
            var address;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.resolveName(addressOrName)];
                    case 1:
                        address = _a.sent();
                        if (address == null) {
                            logger.throwError("ENS name not configured", logger_1.Logger.errors.UNSUPPORTED_OPERATION, {
                                operation: "resolveName(" + JSON.stringify(addressOrName) + ")"
                            });
                        }
                        return [2 /*return*/, address];
                }
            });
        });
    };
    HarmonyRpcProvider.prototype.resolveName = function (name) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, name];
                    case 1:
                        name = _a.sent();
                        return [2 /*return*/, name];
                }
            });
        });
    };
    HarmonyRpcProvider.prototype.getSigner = function (addressOrIndex) {
        return new HarmonyRpcSigner(_constructorGuard, this, addressOrIndex);
    };
    HarmonyRpcProvider.prototype.getUncheckedSigner = function (addressOrIndex) {
        return this.getSigner(addressOrIndex).connectUnchecked();
    };
    HarmonyRpcProvider.prototype.listAccounts = function () {
        var _this = this;
        return this.send(requestPrefix + "accounts", []).then(function (accounts) {
            return accounts.map(function (a) { return _this.formatter.address(a); });
        });
    };
    HarmonyRpcProvider.prototype.send = function (method, params) {
        var _this = this;
        var request = {
            method: method,
            params: params,
            id: (this._nextId++),
            jsonrpc: "2.0"
        };
        this.emit("debug", {
            action: "request",
            request: properties_1.deepCopy(request),
            provider: this
        });
        console.log('this.connetion', this.connection);
        return web_1.fetchJson(this.connection, JSON.stringify(request), getResult).then(function (result) {
            _this.emit("debug", {
                action: "response",
                request: request,
                response: result,
                provider: _this
            });
            return result;
        }, function (error) {
            _this.emit("debug", {
                action: "response",
                error: error,
                request: request,
                provider: _this
            });
            throw error;
        });
    };
    HarmonyRpcProvider.prototype.prepareRequest = function (method, params) {
        switch (method) {
            case "getBlockNumberOld":
                return ["eth_blockNumber", []];
            case "getBlockNumber":
                return [requestPrefix + "blockNumber", []];
            case "getGasPrice":
                return [requestPrefix + "gasPrice", []];
            case "getBalance":
                return [requestPrefix + "getBalance", [getLowerCase(params.address)]];
            case "getTransactionCount":
                return [requestPrefix + "getTransactionCount", [getLowerCase(params.address), params.blockTag]];
            case "getCode":
                return [requestPrefix + "getCode", [getLowerCase(params.address), params.blockTag]];
            case "getStorageAt":
                return [requestPrefix + "getStorageAt", [getLowerCase(params.address), params.position, params.blockTag]];
            case "sendTransaction":
                return [requestPrefix + "sendRawTransaction", [params.signedTransaction]];
            case "getBlock":
                if (params.blockTag) {
                    return [requestPrefix + "getBlockByNumber", [params.blockTag, !!params.includeTransactions]];
                }
                else if (params.blockHash) {
                    return [requestPrefix + "getBlockByHash", [params.blockHash, !!params.includeTransactions]];
                }
                return null;
            case "getTransaction":
                return [requestPrefix + "getTransactionByHash", [params.transactionHash]];
            case "getTransactionReceipt":
                return [requestPrefix + "getTransactionReceipt", [params.transactionHash]];
            case "call": {
                var hexlifyTransaction = properties_1.getStatic(this.constructor, "hexlifyTransaction");
                return [requestPrefix + "call", [hexlifyTransaction(params.transaction, { from: true }), params.blockTag]];
            }
            case "estimateGas": {
                var hexlifyTransaction = properties_1.getStatic(this.constructor, "hexlifyTransaction");
                return [requestPrefix + "estimateGas", [hexlifyTransaction(params.transaction, { from: true })]];
            }
            case "getLogs":
                if (params.filter && params.filter.address != null) {
                    params.filter.address = getLowerCase(params.filter.address);
                }
                return [requestPrefix + "getLogs", [params.filter]];
            default:
                break;
        }
        return null;
    };
    HarmonyRpcProvider.prototype.perform = function (method, params) {
        return __awaiter(this, void 0, void 0, function () {
            var args, error_3;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        args = this.prepareRequest(method, params);
                        if (args == null) {
                            logger.throwError(method + " not implemented", logger_1.Logger.errors.NOT_IMPLEMENTED, { operation: method });
                        }
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, this.send(args[0], args[1])];
                    case 2: return [2 /*return*/, _a.sent()];
                    case 3:
                        error_3 = _a.sent();
                        return [2 /*return*/, checkError(method, error_3, params)];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    HarmonyRpcProvider.prototype._startEvent = function (event) {
        if (event.tag === "pending") {
            this._startPending();
        }
        _super.prototype._startEvent.call(this, event);
    };
    HarmonyRpcProvider.prototype._startPending = function () {
        if (this._pendingFilter != null) {
            return;
        }
        var self = this;
        var pendingFilter = this.send(requestPrefix + "newPendingTransactionFilter", []);
        this._pendingFilter = pendingFilter;
        pendingFilter.then(function (filterId) {
            function poll() {
                self.send(requestPrefix + "getFilterChanges", [filterId]).then(function (hashes) {
                    if (self._pendingFilter != pendingFilter) {
                        return null;
                    }
                    var seq = Promise.resolve();
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
                }).catch(function (error) { });
            }
            poll();
            return filterId;
        }).catch(function (error) { });
    };
    HarmonyRpcProvider.prototype._stopEvent = function (event) {
        if (event.tag === "pending" && this.listenerCount("pending") === 0) {
            this._pendingFilter = null;
        }
        _super.prototype._stopEvent.call(this, event);
    };
    // Convert an ethers.js transaction into a JSON-RPC transaction
    //  - gasLimit => gas
    //  - All values hexlified
    //  - All numeric values zero-striped
    //  - All addresses are lowercased
    // NOTE: This allows a TransactionRequest, but all values should be resolved
    //       before this is called
    // @TODO: This will likely be removed in future versions and prepareRequest
    //        will be the preferred method for this.
    HarmonyRpcProvider.hexlifyTransaction = function (transaction, allowExtra) {
        // Check only allowed properties are given
        var allowed = properties_1.shallowCopy(allowedTransactionKeys);
        if (allowExtra) {
            for (var key in allowExtra) {
                if (allowExtra[key]) {
                    allowed[key] = true;
                }
            }
        }
        properties_1.checkProperties(transaction, allowed);
        var result = {};
        // Some nodes (INFURA ropsten; INFURA mainnet is fine) do not like leading zeros.
        ["gasLimit", "gasPrice", "type", "nonce", "value"].forEach(function (key) {
            if (transaction[key] == null) {
                return;
            }
            var value = bytes_1.hexValue(transaction[key]);
            if (key === "gasLimit") {
                key = "gas";
            }
            result[key] = value;
        });
        ["from", "to", "data"].forEach(function (key) {
            if (transaction[key] == null) {
                return;
            }
            result[key] = bytes_1.hexlify(transaction[key]);
        });
        if (transaction.accessList) {
            result["accessList"] = transactions_1.accessListify(transaction.accessList);
        }
        return result;
    };
    return HarmonyRpcProvider;
}(__1.BaseProvider));
exports.HarmonyRpcProvider = HarmonyRpcProvider;
//# sourceMappingURL=harmony-provider.js.map