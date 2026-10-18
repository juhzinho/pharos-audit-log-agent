import { decodeFunctionResult, encodeFunctionData, getAddress, parseAbi } from "viem";
import { callJson } from "./mcp.js";
import { FAROSWAP_V3, PACIFIC, tokenByAddress } from "./tokens.js";

const NPM = FAROSWAP_V3.npm;
const FACTORY = FAROSWAP_V3.factory;
const MAX_NFTS = 24;

const npmAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function positions(uint256 tokenId) view returns (uint96, address, address, address, uint24, int24, int24, uint128, uint256, uint256, uint128, uint128)",
]);
const factoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)",
]);
const poolAbi = parseAbi([
  "function slot0() view returns (uint160, int24, uint16, uint16, uint16, uint8, bool)",
]);

async function ethCall(client, to, data, block) {
  const { result } = await callJson(client, "eth_call", { transaction: { to, data }, block });
  return result && result !== "0x" ? result : null;
}

function sqrtFromTick(tick) {
  return Math.sqrt(Math.pow(1.0001, tick));
}

function pairAmounts(liquidity, sqrtPriceX96, tickLower, tickUpper, dec0, dec1) {
  if (liquidity === 0n || !sqrtPriceX96) return { amount0: 0, amount1: 0 };
  const Q96 = Number(2n ** 96n);
  const sqrtP = Number(sqrtPriceX96) / Q96;
  const sqrtA = sqrtFromTick(tickLower);
  const sqrtB = sqrtFromTick(tickUpper);
  const L = Number(liquidity);
  let raw0 = 0;
  let raw1 = 0;
  if (sqrtP <= sqrtA) raw0 = L * (1 / sqrtA - 1 / sqrtB);
  else if (sqrtP >= sqrtB) raw1 = L * (sqrtB - sqrtA);
  else {
    raw0 = L * (1 / sqrtP - 1 / sqrtB);
    raw1 = L * (sqrtP - sqrtA);
  }
  return { amount0: raw0 / 10 ** dec0, amount1: raw1 / 10 ** dec1 };
}

function labelToken(address) {
  const t = tokenByAddress(address);
  if (t) return t;
  return { symbol: address.slice(0, 8), address: getAddress(address), decimals: 18, protocol: "unknown" };
}

async function poolSlot(client, token0, token1, fee, block, cache) {
  const key = `${token0}:${token1}:${fee}`;
  if (cache.has(key)) return cache.get(key);
  let pool = null;
  const wpros = PACIFIC.WPROS.address.toLowerCase();
  const usdc = PACIFIC.USDC.address.toLowerCase();
  if (
    fee === 100 &&
    token0.toLowerCase() === wpros &&
    token1.toLowerCase() === usdc
  ) {
    pool = FAROSWAP_V3.poolWprosUsdc100;
  } else {
    const data = encodeFunctionData({ abi: factoryAbi, functionName: "getPool", args: [token0, token1, fee] });
    const raw = await ethCall(client, FACTORY, data, block);
    if (raw) {
      const found = decodeFunctionResult({ abi: factoryAbi, functionName: "getPool", data: raw });
      if (found && found !== "0x0000000000000000000000000000000000000000") pool = found;
    }
  }
  let slot = null;
  if (pool) {
    const data = encodeFunctionData({ abi: poolAbi, functionName: "slot0" });
    const raw = await ethCall(client, pool, data, block);
    if (raw) slot = decodeFunctionResult({ abi: poolAbi, functionName: "slot0", data: raw });
  }
  const sqrtPriceX96 = slot == null ? 0n : (Array.isArray(slot) ? slot[0] : slot[0]);
  const tick = slot == null ? null : Number(Array.isArray(slot) ? slot[1] : slot[1]);
  const value = { pool, slot, sqrtPriceX96, tick };
  cache.set(key, value);
  return value;
}

/**
 * Uniswap-V3-style NFT positions on FaroSwap NPM. Read-only.
 * Token amounts from slot0 + range math are approximate; liquidity and tokensOwed are on-chain.
 */
export async function readFaroSwapPositions(client, owner, block) {
  const balData = encodeFunctionData({ abi: npmAbi, functionName: "balanceOf", args: [owner] });
  let balance = 0n;
  try {
    const raw = await ethCall(client, NPM, balData, block);
    if (raw) balance = decodeFunctionResult({ abi: npmAbi, functionName: "balanceOf", data: raw });
  } catch {
    return { nfts: 0, truncated: false, positions: [], npm: NPM, block, method: "balanceOf" };
  }
  const nfts = Number(balance);
  if (!nfts) return { nfts: 0, truncated: false, positions: [], npm: NPM, block, method: "balanceOf" };

  const take = Math.min(nfts, MAX_NFTS);
  const ids = (await Promise.all(Array.from({ length: take }, async (_, i) => {
    try {
      const data = encodeFunctionData({ abi: npmAbi, functionName: "tokenOfOwnerByIndex", args: [owner, BigInt(i)] });
      const raw = await ethCall(client, NPM, data, block);
      if (!raw) return null;
      return decodeFunctionResult({ abi: npmAbi, functionName: "tokenOfOwnerByIndex", data: raw });
    } catch {
      return null;
    }
  }))).filter((id) => id != null);

  const cache = new Map();
  const positions = (await Promise.all(ids.map(async (tokenId) => {
    try {
      const data = encodeFunctionData({ abi: npmAbi, functionName: "positions", args: [tokenId] });
      const raw = await ethCall(client, NPM, data, block);
      if (!raw) return null;
      const pos = decodeFunctionResult({ abi: npmAbi, functionName: "positions", data: raw });
      const at = (i) => (Array.isArray(pos) ? pos[i] : pos[i]);
      const token0 = getAddress(at(2));
      const token1 = getAddress(at(3));
      const fee = Number(at(4));
      const tickLower = Number(at(5));
      const tickUpper = Number(at(6));
      const liquidity = at(7);
      const tokensOwed0 = at(10);
      const tokensOwed1 = at(11);
      const t0 = labelToken(token0);
      const t1 = labelToken(token1);
      const { pool, sqrtPriceX96, tick } = await poolSlot(client, token0, token1, fee, block, cache);
      const { amount0, amount1 } = pairAmounts(liquidity, sqrtPriceX96, tickLower, tickUpper, t0.decimals, t1.decimals);
      const inRange = liquidity > 0n && tick != null && tick >= tickLower && tick < tickUpper;
      return {
        tokenId: tokenId.toString(),
        token0,
        token1,
        symbol0: t0.symbol,
        symbol1: t1.symbol,
        decimals0: t0.decimals,
        decimals1: t1.decimals,
        fee,
        tickLower,
        tickUpper,
        tick,
        inRange,
        liquidity: liquidity.toString(),
        tokensOwed0: tokensOwed0.toString(),
        tokensOwed1: tokensOwed1.toString(),
        amount0,
        amount1,
        pool,
        npm: NPM,
        block,
        method: "positions",
      };
    } catch {
      return null;
    }
  }))).filter(Boolean);

  return {
    nfts,
    truncated: nfts > MAX_NFTS,
    positions,
    npm: NPM,
    block,
    method: "tokenOfOwnerByIndex",
  };
}
