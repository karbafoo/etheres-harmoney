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
Object.defineProperty(exports, "__esModule", { value: true });
exports.HarmonyRpcProvider = void 0;
var logger_1 = require("@ethersproject/logger");
var properties_1 = require("@ethersproject/properties");
var formatter_1 = require("../formatter");
var json_rpc_provider_1 = require("../json-rpc-provider");
var _version_1 = require("../_version");
var HARMONY_ENDPOINTS_1 = require("./HARMONY_ENDPOINTS");
var logger = new logger_1.Logger(_version_1.version);
function getLowerCase(value) {
    if (value) {
        return value.toLowerCase();
    }
    return value;
}
var HarmonyRpcProvider = /** @class */ (function (_super) {
    __extends(HarmonyRpcProvider, _super);
    function HarmonyRpcProvider(url, network) {
        var _newTarget = this.constructor;
        var _this = this;
        logger.checkNew(_newTarget, HarmonyRpcProvider);
        _this = _super.call(this, url, network) || this; //TODO
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
    HarmonyRpcProvider.defaultUrl = function () {
        return HARMONY_ENDPOINTS_1.localnet[0];
    };
    HarmonyRpcProvider.prototype.prepareRequest = function (method, params) {
        switch (method) {
            case "getBlockNumber":
                return ["eth_blockNumber", []];
            case "getGasPrice":
                return ["eth_gasPrice", []];
            case "getBalance":
                return ["eth_getBalance", [getLowerCase(params.address), params.blockTag]];
            case "getTransactionCount":
                return ["eth_getTransactionCount", [getLowerCase(params.address), params.blockTag]];
            case "getCode":
                return ["eth_getCode", [getLowerCase(params.address), params.blockTag]];
            case "getStorageAt":
                return ["eth_getStorageAt", [getLowerCase(params.address), params.position, params.blockTag]];
            case "sendTransaction":
                return ["eth_sendRawTransaction", [params.signedTransaction]];
            case "getBlock":
                if (params.blockTag) {
                    return ["eth_getBlockByNumber", [params.blockTag, !!params.includeTransactions]];
                }
                else if (params.blockHash) {
                    return ["eth_getBlockByHash", [params.blockHash, !!params.includeTransactions]];
                }
                return null;
            case "getTransaction":
                return ["eth_getTransactionByHash", [params.transactionHash]];
            case "getTransactionReceipt":
                return ["eth_getTransactionReceipt", [params.transactionHash]];
            case "call": {
                var hexlifyTransaction = properties_1.getStatic(this.constructor, "hexlifyTransaction");
                return ["eth_call", [hexlifyTransaction(params.transaction, { from: true }), params.blockTag]];
            }
            case "estimateGas": {
                var hexlifyTransaction = properties_1.getStatic(this.constructor, "hexlifyTransaction");
                return ["eth_estimateGas", [hexlifyTransaction(params.transaction, { from: true })]];
            }
            case "getLogs":
                if (params.filter && params.filter.address != null) {
                    params.filter.address = getLowerCase(params.filter.address);
                }
                return ["eth_getLogs", [params.filter]];
            default:
                break;
        }
        return null;
    };
    HarmonyRpcProvider.getUrl = function (network, apiKey) {
        if (network === void 0) { network = null; }
        if (apiKey === void 0) { apiKey = ''; }
        return {
            url: 'https://' + HARMONY_ENDPOINTS_1.testnet[0] + "/",
            throttleCallback: function (attempt, url) {
                if (!apiKey) {
                    formatter_1.showThrottleMessage();
                }
                return Promise.resolve(true);
            }
        };
    };
    return HarmonyRpcProvider;
}(json_rpc_provider_1.JsonRpcProvider));
exports.HarmonyRpcProvider = HarmonyRpcProvider;
//# sourceMappingURL=harmony-provider.js.map