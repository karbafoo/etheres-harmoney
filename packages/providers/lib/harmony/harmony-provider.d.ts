import { Network, Networkish } from '@ethersproject/networks';
import { ConnectionInfo } from '@ethersproject/web';
import { JsonRpcProvider } from '../json-rpc-provider';
export declare class HarmonyRpcProvider extends JsonRpcProvider {
    constructor(url?: ConnectionInfo | string, network?: Networkish);
    static defaultUrl(): string;
    prepareRequest(method: string, params: any): [string, Array<any>];
    static getUrl(network?: Network, apiKey?: string): ConnectionInfo;
}
//# sourceMappingURL=harmony-provider.d.ts.map