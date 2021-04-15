import { Block, BlockTag, Provider, TransactionReceipt, TransactionRequest, TransactionResponse } from '@ethersproject/abstract-provider';
import { Signer, TypedDataDomain, TypedDataField, TypedDataSigner } from '@ethersproject/abstract-signer';
import { BigNumber, BigNumberish } from '@ethersproject/bignumber';
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
    getURL(u: string): string;
    static defaultUrl(): string;
    detectNetwork(): Promise<Network>;
    _getAddress(addressOrName: string | Promise<string>): Promise<string>;
    resolveName(name: string | Promise<string>): Promise<string>;
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
    call(transaction: Deferrable<TransactionRequest>, blockTag?: BlockTag | Promise<BlockTag>): Promise<string>;
    estimateGas(transaction: Deferrable<TransactionRequest>): Promise<BigNumber>;
    getCode(addressOrName: string | Promise<string>, blockTag?: BlockTag | Promise<BlockTag>): Promise<string>;
    getStorageAt(addressOrName: string | Promise<string>, position: BigNumberish | Promise<BigNumberish>, blockTag?: BlockTag | Promise<BlockTag>): Promise<string>;
    getBlockNumber(): Promise<number>;
    getCirculatingSupply(): Promise<number>;
    getEpoch(): Promise<number>;
    getLastCrossLinks(): Promise<CrossLink[]>;
    getLeader(): Promise<string>;
    getGasPrice(): Promise<BigNumber>;
    getShardingStructure(): Promise<ShardingStructure[]>;
    getTotalSupply(): Promise<BigNumber>;
    getValidators(epochNumber: number): Promise<ValidatorsObject>;
    getValidatorKeys(epochNumber: number): Promise<string[]>;
    getCurrentBadBlocks(): Promise<string[]>;
    getNodeMetadata(): Promise<NodeMetadata>;
    getProtocolVersion(): Promise<number>;
    getPeerCount(): Promise<string>;
    getBlocks(startingBlock: number, endingBlock: number, extra: {
        withSingers: boolean;
        fullTx: boolean;
        inclStaking: boolean;
    }): Promise<Block[]>;
    getBlockByNumber(blockNumber: number, extra: {
        withSingers: boolean;
        fullTx: boolean;
        inclStaking: boolean;
    }): Promise<Block>;
    getBlockByHash(blockHash: string, extra: {
        withSingers: boolean;
        fullTx: boolean;
        inclStaking: boolean;
    }): Promise<Block>;
    getBlockSigners(startingBlock: number, endingBlock: number, extra: {
        withSingers: boolean;
        fullTx: boolean;
        inclStaking: boolean;
    }): Promise<string[]>;
    getBlockSignersKeys(blockNumber: number): Promise<string[]>;
    getBlockTransactionCountByNumber(blockNumber: number): Promise<number>;
    getBlockTransactionCountByHash(blockHash: string): Promise<number>;
    getHeaderByNumber(blockNumber: number): Promise<BlockHeader>;
    getLatestChainHeaders(blockNumber: number): Promise<ChainHeader>;
    getLatestHeader(blockNumber: number): Promise<BlockHeader>;
    getBalance(addressOrName: string | Promise<string>): Promise<BigNumber>;
    getBalanceByBlockNumber(addressOrName: string | Promise<string>, blockTag?: BlockTag | Promise<BlockTag>): Promise<BigNumber>;
    getStakingTransactionsCount(addressOrName: string | Promise<string>, transactionType?: TransactionType): Promise<number>;
    getStakingTransactionsHistory(addressOrName: string | Promise<string>, pageIndex?: number, pageSize?: number, fullTx?: boolean, txType?: TransactionType, order?: OrderType): Promise<StakingTransaction[] | string[]>;
    getTransactionsCount(addressOrName: string | Promise<string>, transactionType?: TransactionType): Promise<number>;
    getTransactionsHistory(addressOrName: string | Promise<string>, pageIndex?: number, pageSize?: number, fullTx?: boolean, txType?: TransactionType, order?: OrderType): Promise<Transaction[] | string[]>;
    getDelegationsByDelegator(delegator: string | Promise<string>): Promise<Delegation[]>;
    getDelegationsByDelegatorByBlockNumber(delegator: string | Promise<string>, blockNumber: number): Promise<Delegation[]>;
    getDelegationsByValidator(validator: string | Promise<string>): Promise<Delegation[]>;
    getAllValidatorAddresses(): Promise<string[]>;
    getAllValidatorInformation(pageIndex: number): Promise<ValidatorInformation[]>;
    getAllValidatorInformationByBlockNumber(pageIndex: number, blockNumber: number): Promise<ValidatorInformation[]>;
    getElectedValidatorAddresses(): Promise<string[]>;
    getValidatorInformation(validator: string): Promise<ValidatorInformation>;
    getCurrentUtilityMetrics(): Promise<UtilityMetric>;
    getMedianRawStakeSnapshot(): Promise<RawStaleSnapshot>;
    getStakingNetworkInfo(): Promise<StakingNetworkInfo>;
    getSuperCommittees(): Promise<SuperCommittee>;
    getCXReceiptByHash(cxHash: string): Promise<CXReceipt>;
    getPendingCXReceipts(): Promise<PendingCXReceipt[]>;
    resendCx(cxHash: string): Promise<boolean>;
    getPoolStats(): Promise<PoolStat>;
    getPendingStakingTransaction(): Promise<StakingTransaction[]>;
    getPendingTransactions(): Promise<Transaction[]>;
    getCurrentStakingErrorSink(): Promise<StakingError[]>;
    getStakingTransactionByBlockNumberAndIndex(blockNumber: number, stakingTransactionIndex: number): Promise<StakingTransaction>;
    getStakingTransactionByBlockHashAndIndex(blockHash: string, stakingTransactionIndex: number): Promise<StakingTransaction>;
    getStakingTransactionByHash(txHash: string): Promise<StakingTransaction>;
    sendRawStakingTransaction(signedTransaction: string | Promise<string>): Promise<TransactionResponse>;
    getCurrentTransactionErrorSink(): Promise<TransactionError[]>;
    getTransactionByBlockNumberAndIndex(blockNumber: number, transactionIndex: number): Promise<Transaction>;
    getTransactionByBlockHashAndIndex(blockHash: string, transactionIndex: number): Promise<Transaction>;
    getTransactionByHash(txHash: string): Promise<Transaction>;
    getTransactionReceipt(transactionHash: string | Promise<string>): Promise<TransactionReceipt>;
    sendRawTransaction(signedTransaction: string | Promise<string>): Promise<TransactionResponse>;
}
declare type ValidatorInformation = {};
declare type RawStaleSnapshot = {};
declare type SuperCommittee = {};
declare type TransactionType = "SENT" | "RECEIVED" | "ALL";
declare type OrderType = "ASC" | "DESC";
declare type StakingTransaction = {
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
};
declare type Transaction = {
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
};
declare type CrossLink = {
    hash: string;
    'block-number': number;
    'view-id': number;
    signature: string;
    'signature-bitmap': string;
    'shard-id': number;
    'epoch-number': number;
};
declare type ShardingStructure = {
    current: boolean;
    http: string;
    shardID: number;
    ws: string;
};
declare type Validator = {
    address: string;
    balance: number;
};
declare type ValidatorsObject = {
    shardID: number;
    validators: Validator[];
};
declare type TransactionError = {
    'tx-hash-id': string;
    'time-at-rejection': number;
    'error-message': string;
};
declare type StakingError = {
    'tx-hash-id': string;
    'directive-kind': string;
    'time-at-rejection': number;
    'error-message': string;
};
declare type PoolStat = {
    'executable-count': string;
    'non-executable-count': string;
};
declare type PendingCXReceipt = {
    receipts: CXReceipt[];
    merkleProof: any;
    header: any;
    commitSig: string;
    commitBitmap: string;
};
declare type CXReceipt = {
    blockHash: string;
    blockNumber: number;
    hash: string;
    from: string;
    to: string;
    shardID: number;
    toShardID: number;
    value: number;
};
declare type StakingNetworkInfo = {
    'total-supply': string;
    'circulating-supply': string;
    'epoch-last-block': number;
    'total-staking': number;
    'median-raw-stake': string;
};
declare type UtilityMetric = {
    AccumulatorSnapshop: number;
    CurrentStakedPercentage: string;
    Deviation: string;
    Adjustment: string;
};
declare type Delegation = {
    validator_address: string;
    delegator_address: string;
    amount: number;
    reward: number;
    Undelegations: any[];
};
declare type BlockHeader = {
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
};
declare type BeaconChainHeader = {
    'shard-id': number;
    'block-header-hash': string;
    'block-number': number;
    'view-id': number;
    epoch: number;
};
declare type ShardChainHeader = {
    'shard-id': number;
    'block-header-hash': string;
    'block-number': number;
    'view-id': number;
    epoch: number;
};
declare type ChainHeader = {
    'beacon-chain-header': BeaconChainHeader;
    'shard-chain-header': ShardChainHeader;
};
declare type NodeMetadata = {
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
};
declare type ChainConfig = {
    'chain-id': number;
    'cross-tx-epoch': number;
    'cross-link-epoch': number;
    'staking-epoch': number;
    'prestaking-epoch': number;
    'quick-unlock-epoch': number;
    'eip155-epoch': number;
    's3-epoch': number;
    'receipt-log-epoch': number;
};
declare type P2PConnectivity = {
    'total-known-peers': number;
    connected: number;
    'not-connected': number;
};
export {};
//# sourceMappingURL=harmony-provider.d.ts.map