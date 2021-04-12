
type ValidatorInformation = {
    //TODO
}

type RawStaleSnapshot ={
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