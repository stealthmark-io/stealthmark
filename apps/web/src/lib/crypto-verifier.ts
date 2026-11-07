import { FIX_PACK } from '@/lib/offer';

export type SupportedCryptoNetwork = 'ethereum' | 'btc' | 'solana' | 'polygon' | 'bsc' | 'base' | 'tron';

export interface CryptoVerificationResult {
  valid: boolean;
  network: SupportedCryptoNetwork;
  txHash: string;
  senderAddress?: string;
  recipientAddress: string;
  tokenSymbol: string;
  amountUsd: number;
  creditsGranted: number;
  packName: string;
  error?: string;
}

export const OFFICIAL_CRYPTO_WALLETS = {
  evm: '0xc8dc4ecb93c4c665Fad07E1261F5f7D60e3C6E0F',
  btc: 'bc1qvaz9ly5x5re3lmm70gtn6du86djant8mkj64x5',
  solana: '49sNhYNVSFxBuMPh5S2EC6Wkyay7mBWEPVv7pcyHJDxu',
  tron: 'TYgGahN7wK9NtUVFZaXCwZqktaYmkuNxD8',
} as const;

// Ethereum Mainnet Contracts (Chain ID 1)
const ETH_USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const ETH_USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';

// Base Mainnet Contracts (Chain ID 8453)
const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const BASE_USDT = '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2';

// Polygon POS Contracts
const POLYGON_USDT = '0xc2132d05d31c914a87c6611c10748aeb04b58e8f';
const POLYGON_USDC = '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359';
const POLYGON_USDC_E = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174';

// BSC Contracts
const BSC_USDT = '0x55d398326f99059ff775485246999027b3197955';
const BSC_USDC = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';

// Solana Mainnet USDC & USDT Mints
const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOLANA_USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

// Tron Contract (TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t -> 41a614f803b6fd780986a42c78ec9c7f77e6ded13c)
const TRON_USDT_HEX = '41a614f803b6fd780986a42c78ec9c7f77e6ded13c';
const TRON_USDT_HEX_20 = 'a614f803b6fd780986a42c78ec9c7f77e6ded13c';
const TRON_WALLET_HEX = '41f916cf613ecf65390ff217cc15afa764563cad75';

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TRANSFER_TOPIC_NO_0X = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const ETH_RPCS = [
  'https://ethereum-rpc.publicnode.com',
  'https://1rpc.io/eth',
  'https://eth.drpc.org',
];

const BASE_RPCS = [
  'https://mainnet.base.org',
  'https://base-rpc.publicnode.com',
  'https://1rpc.io/base',
];

const POLYGON_RPCS = [
  'https://polygon-bor-rpc.publicnode.com',
  'https://1rpc.io/matic',
  'https://polygon.drpc.org',
];

const BSC_RPCS = [
  'https://bsc-dataseed.binance.org',
  'https://bsc-rpc.publicnode.com',
  'https://1rpc.io/bnb',
  'https://bsc.drpc.org',
];

const SOLANA_RPCS = [
  'https://api.mainnet-beta.solana.com',
  'https://solana-rpc.publicnode.com',
];

const TRON_ENDPOINTS = [
  'https://api.trongrid.io',
  'https://api.tronstack.io',
];

function extractEvmAddress(topic: string): string {
  if (!topic || topic.length < 42) return '';
  return `0x${topic.slice(-40)}`.toLowerCase();
}

// The $0.99 Fix Pack is the Polar starter product, so a crypto payment grants the same 15,000 credits.
function resolveCreditsFromAmount(usd: number): { credits: number; packName: string } {
  if (usd >= FIX_PACK.starterPriceUsd) return { credits: 15_000, packName: FIX_PACK.label };
  return { credits: 0, packName: 'Insufficient' };
}

interface RpcReceiptLog {
  address: string;
  topics: string[];
  data: string;
}

interface RpcReceipt {
  status: string;
  from?: string;
  to?: string;
  logs: RpcReceiptLog[];
}

interface RpcTx {
  from?: string;
  to?: string;
  value?: string;
}

async function fetchEvmReceipt(rpcs: string[], txHash: string): Promise<RpcReceipt | null> {
  for (const rpc of rpcs) {
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getTransactionReceipt',
          params: [txHash],
        }),
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.result) return data.result as RpcReceipt;
    } catch {
      // try next rpc
    }
  }
  return null;
}

async function fetchEvmTx(rpcs: string[], txHash: string): Promise<RpcTx | null> {
  for (const rpc of rpcs) {
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getTransactionByHash',
          params: [txHash],
        }),
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.result) return data.result as RpcTx;
    } catch {
      // try next rpc
    }
  }
  return null;
}

export async function verifyEvmPayment(
  network: 'ethereum' | 'base' | 'polygon' | 'bsc',
  txHash: string
): Promise<CryptoVerificationResult> {
  const normalizedHash = txHash.trim();
  const rpcs =
    network === 'ethereum'
      ? ETH_RPCS
      : network === 'base'
      ? BASE_RPCS
      : network === 'polygon'
      ? POLYGON_RPCS
      : BSC_RPCS;
  const targetWallet = OFFICIAL_CRYPTO_WALLETS.evm.toLowerCase();

  const receipt = await fetchEvmReceipt(rpcs, normalizedHash);
  if (!receipt) {
    return {
      valid: false,
      network,
      txHash: normalizedHash,
      recipientAddress: targetWallet,
      tokenSymbol: 'UNKNOWN',
      amountUsd: 0,
      creditsGranted: 0,
      packName: '',
      error: 'Transaction receipt not found or pending confirmation. Wait 15s and retry.',
    };
  }

  if (receipt.status !== '0x1') {
    return {
      valid: false,
      network,
      txHash: normalizedHash,
      recipientAddress: targetWallet,
      tokenSymbol: 'UNKNOWN',
      amountUsd: 0,
      creditsGranted: 0,
      packName: '',
      error: 'Transaction failed on-chain (status != 0x1).',
    };
  }

  const allowedTokens: Record<string, { symbol: string; decimals: number }> =
    network === 'ethereum'
      ? {
          [ETH_USDC]: { symbol: 'USDC', decimals: 6 },
          [ETH_USDT]: { symbol: 'USDT', decimals: 6 },
        }
      : network === 'base'
      ? {
          [BASE_USDC]: { symbol: 'USDC', decimals: 6 },
          [BASE_USDT]: { symbol: 'USDT', decimals: 6 },
        }
      : network === 'polygon'
      ? {
          [POLYGON_USDT]: { symbol: 'USDT', decimals: 6 },
          [POLYGON_USDC]: { symbol: 'USDC', decimals: 6 },
          [POLYGON_USDC_E]: { symbol: 'USDC.e', decimals: 6 },
        }
      : {
          [BSC_USDT]: { symbol: 'USDT', decimals: 18 },
          [BSC_USDC]: { symbol: 'USDC', decimals: 18 },
        };

  for (const log of receipt.logs || []) {
    const contractAddr = (log.address || '').toLowerCase();
    const tokenMeta = allowedTokens[contractAddr];
    if (!tokenMeta) continue;
    if (!log.topics || log.topics.length < 3) continue;
    if (log.topics[0].toLowerCase() !== TRANSFER_TOPIC) continue;

    const fromAddr = extractEvmAddress(log.topics[1]);
    const toAddr = extractEvmAddress(log.topics[2]);
    if (toAddr !== targetWallet) continue;

    const rawAmount = BigInt(log.data || '0x0');
    const divisor = BigInt(10) ** BigInt(tokenMeta.decimals);
    const amountUsd = Number(rawAmount) / Number(divisor);
    const { credits, packName } = resolveCreditsFromAmount(amountUsd);

    if (credits <= 0) {
      return {
        valid: false,
        network,
        txHash: normalizedHash,
        senderAddress: fromAddr,
        recipientAddress: toAddr,
        tokenSymbol: tokenMeta.symbol,
        amountUsd,
        creditsGranted: 0,
        packName,
        error: `Transfer amount ($${amountUsd.toFixed(2)}) is below the ${FIX_PACK.starterPriceLabel} USD minimum for the Fix Pack.`,
      };
    }

    return {
      valid: true,
      network,
      txHash: normalizedHash,
      senderAddress: fromAddr,
      recipientAddress: toAddr,
      tokenSymbol: tokenMeta.symbol,
      amountUsd,
      creditsGranted: credits,
      packName,
    };
  }

  // Also check native ETH / BNB / POL transfer to targetWallet
  const tx = await fetchEvmTx(rpcs, normalizedHash);
  if (tx && (tx.to || '').toLowerCase() === targetWallet && tx.value && tx.value !== '0x0') {
    const wei = BigInt(tx.value);
    const nativeAmount = Number(wei) / 1e18;
    const approxPrice = network === 'ethereum' || network === 'base' ? 2800 : network === 'bsc' ? 600 : 0.45;
    const amountUsd = nativeAmount * approxPrice;
    const { credits, packName } = resolveCreditsFromAmount(amountUsd);
    const nativeSymbol = network === 'bsc' ? 'BNB' : network === 'polygon' ? 'POL' : 'ETH';
    if (credits > 0) {
      return {
        valid: true,
        network,
        txHash: normalizedHash,
        senderAddress: tx.from,
        recipientAddress: targetWallet,
        tokenSymbol: nativeSymbol,
        amountUsd,
        creditsGranted: credits,
        packName,
      };
    }
  }

  return {
    valid: false,
    network,
    txHash: normalizedHash,
    recipientAddress: targetWallet,
    tokenSymbol: 'UNKNOWN',
    amountUsd: 0,
    creditsGranted: 0,
    packName: '',
    error: `No matching USDC/USDT or native transfer to ${OFFICIAL_CRYPTO_WALLETS.evm} found in transaction.`,
  };
}

export async function verifyBtcPayment(txHash: string): Promise<CryptoVerificationResult> {
  const normalizedHash = txHash.trim();
  const targetWallet = OFFICIAL_CRYPTO_WALLETS.btc;
  const endpoints = [
    `https://mempool.space/api/tx/${encodeURIComponent(normalizedHash)}`,
    `https://blockstream.info/api/tx/${encodeURIComponent(normalizedHash)}`,
  ];
  // A transaction still in the mempool can be replaced or dropped, so only a mined one pays.
  let unconfirmed = false;

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.status?.confirmed !== true) {
        unconfirmed = true;
        continue;
      }
      const vouts = Array.isArray(data?.vout) ? data.vout : [];
      let satsToTarget = 0;
      for (const out of vouts) {
        if (out?.scriptpubkey_address === targetWallet && typeof out?.value === 'number') {
          satsToTarget += out.value;
        }
      }
      if (satsToTarget > 0) {
        const btcAmount = satsToTarget / 1e8;
        const amountUsd = btcAmount * 90000; // Conservative BTC USD reference
        const { credits, packName } = resolveCreditsFromAmount(amountUsd);
        if (credits > 0) {
          return {
            valid: true,
            network: 'btc',
            txHash: normalizedHash,
            recipientAddress: targetWallet,
            tokenSymbol: 'BTC',
            amountUsd,
            creditsGranted: credits,
            packName,
          };
        }
        return {
          valid: false,
          network: 'btc',
          txHash: normalizedHash,
          recipientAddress: targetWallet,
          tokenSymbol: 'BTC',
          amountUsd,
          creditsGranted: 0,
          packName,
          error: `BTC transfer ($${amountUsd.toFixed(2)}) is below minimum (${FIX_PACK.starterPriceLabel} USD).`,
        };
      }
    } catch {
      // try next endpoint
    }
  }

  return {
    valid: false,
    network: 'btc',
    txHash: normalizedHash,
    recipientAddress: targetWallet,
    tokenSymbol: 'BTC',
    amountUsd: 0,
    creditsGranted: 0,
    packName: '',
    error: unconfirmed
      ? `BTC transaction ${normalizedHash} is not confirmed yet; retry once it is mined.`
      : `No BTC output to ${targetWallet} found in transaction ${normalizedHash}.`,
  };
}

export async function verifySolanaPayment(txHash: string): Promise<CryptoVerificationResult> {
  const normalizedHash = txHash.trim();
  const targetWallet = OFFICIAL_CRYPTO_WALLETS.solana;

  for (const rpc of SOLANA_RPCS) {
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [normalizedHash, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
        }),
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const result = data?.result;
      if (!result || result?.meta?.err) continue;

      // 1. Check SPL USDC/USDT token balance delta for targetWallet
      const preTokens = result?.meta?.preTokenBalances || [];
      const postTokens = result?.meta?.postTokenBalances || [];
      for (const post of postTokens) {
        if (post?.owner === targetWallet && (post?.mint === SOLANA_USDC_MINT || post?.mint === SOLANA_USDT_MINT)) {
          const pre = preTokens.find((p: { accountIndex?: number }) => p.accountIndex === post.accountIndex);
          const preAmt = Number(pre?.uiTokenAmount?.uiAmount || 0);
          const postAmt = Number(post?.uiTokenAmount?.uiAmount || 0);
          const deltaUsd = postAmt - preAmt;
          if (deltaUsd > 0) {
            const { credits, packName } = resolveCreditsFromAmount(deltaUsd);
            if (credits > 0) {
              return {
                valid: true,
                network: 'solana',
                txHash: normalizedHash,
                recipientAddress: targetWallet,
                tokenSymbol: post.mint === SOLANA_USDC_MINT ? 'USDC' : 'USDT',
                amountUsd: deltaUsd,
                creditsGranted: credits,
                packName,
              };
            }
          }
        }
      }

      // 2. Check native SOL balance delta for targetWallet
      const keys = result?.transaction?.message?.accountKeys || [];
      const idx = keys.findIndex((k: { pubkey?: string } | string) =>
        typeof k === 'string' ? k === targetWallet : k?.pubkey === targetWallet
      );
      if (idx >= 0) {
        const preLamports = Number(result?.meta?.preBalances?.[idx] || 0);
        const postLamports = Number(result?.meta?.postBalances?.[idx] || 0);
        const deltaSol = (postLamports - preLamports) / 1e9;
        if (deltaSol > 0) {
          const amountUsd = deltaSol * 180; // SOL USD reference
          const { credits, packName } = resolveCreditsFromAmount(amountUsd);
          if (credits > 0) {
            return {
              valid: true,
              network: 'solana',
              txHash: normalizedHash,
              recipientAddress: targetWallet,
              tokenSymbol: 'SOL',
              amountUsd,
              creditsGranted: credits,
              packName,
            };
          }
        }
      }
    } catch {
      // try next rpc
    }
  }

  return {
    valid: false,
    network: 'solana',
    txHash: normalizedHash,
    recipientAddress: targetWallet,
    tokenSymbol: 'SOL/USDC',
    amountUsd: 0,
    creditsGranted: 0,
    packName: '',
    error: `No SOL or USDC/USDT transfer to ${targetWallet} found in signature.`,
  };
}

export async function verifyTronPayment(txHash: string): Promise<CryptoVerificationResult> {
  const normalizedHash = txHash.trim().replace(/^0x/i, '');

  for (const endpoint of TRON_ENDPOINTS) {
    try {
      const infoRes = await fetch(`${endpoint}/wallet/gettransactioninfobyid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: normalizedHash }),
        signal: AbortSignal.timeout(6500),
      });
      if (!infoRes.ok) continue;
      const info = await infoRes.json();
      // TronGrid answers {} for an unknown id; only the info of this exact transaction counts.
      if (typeof info?.id !== 'string' || info.id.toLowerCase() !== normalizedHash.toLowerCase()) continue;

      const receiptResult = info?.receipt?.result;
      if (receiptResult !== 'SUCCESS') {
        return {
          valid: false,
          network: 'tron',
          txHash: normalizedHash,
          recipientAddress: OFFICIAL_CRYPTO_WALLETS.tron,
          tokenSymbol: 'USDT',
          amountUsd: 0,
          creditsGranted: 0,
          packName: '',
          error: `Tron transaction status is ${receiptResult || 'UNCONFIRMED'}.`,
        };
      }

      const logs = Array.isArray(info.log) ? info.log : [];
      for (const log of logs) {
        const contractHex = (log.address || '').toLowerCase();
        if (
          contractHex !== TRON_USDT_HEX &&
          contractHex !== TRON_USDT_HEX_20 &&
          !contractHex.endsWith(TRON_USDT_HEX_20)
        ) {
          continue;
        }
        const topics = Array.isArray(log.topics) ? log.topics : [];
        if (topics.length < 3) continue;
        if (topics[0].toLowerCase() !== TRANSFER_TOPIC_NO_0X) continue;

        const toHex20 = topics[2].slice(-40).toLowerCase();
        const targetHex20 = TRON_WALLET_HEX.slice(-40).toLowerCase();
        if (toHex20 !== targetHex20) continue;

        const rawAmount = BigInt(`0x${log.data || '0'}`);
        const amountUsd = Number(rawAmount) / 1_000_000;
        const { credits, packName } = resolveCreditsFromAmount(amountUsd);

        if (credits <= 0) {
          return {
            valid: false,
            network: 'tron',
            txHash: normalizedHash,
            recipientAddress: OFFICIAL_CRYPTO_WALLETS.tron,
            tokenSymbol: 'USDT-TRC20',
            amountUsd,
            creditsGranted: 0,
            packName,
            error: `TRC-20 USDT amount ($${amountUsd.toFixed(2)}) is below minimum (${FIX_PACK.starterPriceLabel} USD).`,
          };
        }

        return {
          valid: true,
          network: 'tron',
          txHash: normalizedHash,
          recipientAddress: OFFICIAL_CRYPTO_WALLETS.tron,
          tokenSymbol: 'USDT-TRC20',
          amountUsd,
          creditsGranted: credits,
          packName,
        };
      }
    } catch {
      // try next endpoint
    }
  }

  return {
    valid: false,
    network: 'tron',
    txHash: normalizedHash,
    recipientAddress: OFFICIAL_CRYPTO_WALLETS.tron,
    tokenSymbol: 'USDT-TRC20',
    amountUsd: 0,
    creditsGranted: 0,
    packName: '',
    error: `No TRC-20 USDT transfer to ${OFFICIAL_CRYPTO_WALLETS.tron} found.`,
  };
}

/**
 * Returns the form of a transaction hash stored in credit_orders.tx_hash, or null when the hash
 * is malformed for its network. EVM hashes become 0x plus lowercase hex and Tron and BTC lowercase
 * hex, as crypto/claim stores them, so the unique index on lower(tx_hash) stops a replay across routes.
 */
export function canonicalTxHash(network: SupportedCryptoNetwork, raw: string): string | null {
  const hash = raw.trim();
  if (network === 'solana') return /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(hash) ? hash : null;
  const hex = hash.replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  return network === 'tron' || network === 'btc' ? hex : `0x${hex}`;
}

export async function verifyCryptoPayment(
  network: SupportedCryptoNetwork,
  txHash: string
): Promise<CryptoVerificationResult> {
  if (network === 'tron') return verifyTronPayment(txHash);
  if (network === 'btc') return verifyBtcPayment(txHash);
  if (network === 'solana') return verifySolanaPayment(txHash);
  return verifyEvmPayment(network, txHash);
}
