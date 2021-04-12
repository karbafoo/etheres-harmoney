import { Provider, TransactionRequest, TransactionResponse } from '@ethersproject/abstract-provider';
import { Signer, TypedDataDomain, TypedDataField, TypedDataSigner } from '@ethersproject/abstract-signer';
import { Bytes } from '@ethersproject/bytes';
import { Network, Networkish } from '@ethersproject/networks';
import { Deferrable } from '@ethersproject/properties';
import { AccessList } from '@ethersproject/transactions';
import { ConnectionInfo } from '@ethersproject/web';
import { BaseProvider } from '..';
import { Event } from '../base-provider';
export declare class HarmonyRpcSigner extends Signer implements TypedDataSigner {
    readonly provider: HarmonyRpcProvider;
    _index: number;
    _address: string;
    constructor(constructorGuard: any, provider: HarmonyRpcProvider, addressOrIndex?: string | number);
    connect(provider: Provider): HarmonyRpcSigner;
    connectUnchecked(): HarmonyRpcSigner;
    getAddress(): Promise<string>;
    sendUncheckedTransaction(transaction: Deferrable<TransactionRequest>): Promise<string>;
    signTransaction(transaction: Deferrable<TransactionRequest>): Promise<string>;
    sendTransaction(transaction: Deferrable<TransactionRequest>): Promise<TransactionResponse>;
    signMessage(message: Bytes | string): Promise<string>;
    _signTypedData(domain: TypedDataDomain, types: Record<string, Array<TypedDataField>>, value: Record<string, any>): Promise<string>;
    unlock(password: string): Promise<boolean>;
}
declare class UncheckedHarmonyRpcSigner extends HarmonyRpcSigner {
    sendTransaction(transaction: Deferrable<TransactionRequest>): Promise<TransactionResponse>;
}
export declare class HarmonyRpcProvider extends BaseProvider {
    readonly connection: ConnectionInfo;
    _pendingFilter: Promise<number>;
    _nextId: number;
    constructor(url?: ConnectionInfo | string, network?: Networkish);
    static defaultUrl(): string;
    detectNetwork(): Promise<Network>;
    getSigner(addressOrIndex?: string | number): HarmonyRpcSigner;
    getUncheckedSigner(addressOrIndex?: string | number): UncheckedHarmonyRpcSigner;
    listAccounts(): Promise<Array<string>>;
    send(method: string, params: Array<any>): Promise<any>;
    prepareRequest(method: string, params: any): [string, Array<any>];
    perform(method: string, params: any): Promise<any>;
    _startEvent(event: Event): void;
    _startPending(): void;
    _stopEvent(event: Event): void;
    static hexlifyTransaction(transaction: TransactionRequest, allowExtra?: {
        [key: string]: boolean;
    }): {
        [key: string]: string | AccessList;
    };
}
export {};
//# sourceMappingURL=harmony-provider.d.ts.map