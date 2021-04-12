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
        return _this;
        // this._nextId = 42;
    }
    HarmonyRpcProvider.defaultUrl = function () {
        return HARMONY_ENDPOINTS_1.localnet[0];
    };
    HarmonyRpcProvider.prototype.prepareRequest = function (method, params) {
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
                var hexlifyTransaction = properties_1.getStatic(this.constructor, "hexlifyTransaction");
                return ["hmyv2_call", [hexlifyTransaction(params.transaction, { from: true }), params.blockTag]];
            }
            case "estimateGas": {
                var hexlifyTransaction = properties_1.getStatic(this.constructor, "hexlifyTransaction");
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