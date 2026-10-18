import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import { callJson } from "./mcp.js";
import { tokenBalance } from "./audit.js";
import { PROTOCOL_VAULTS } from "./tokens.js";

const viewAbi = parseAbi([
  "function convertToAssets(uint256 shares) view returns (uint256)",
]);

async function ethCall(client, to, data, block) {
  const { result } = await callJson(client, "eth_call", { transaction: { to, data }, block });
  return result && result !== "0x" ? result : null;
}

export async function toAssets(client, vault, shares, block) {
  if (shares === 0n) return 0n;
  try {
    const data = encodeFunctionData({ abi: viewAbi, functionName: "convertToAssets", args: [shares] });
    const raw = await ethCall(client, vault, data, block);
    if (!raw) return 0n;
    return decodeFunctionResult({ abi: viewAbi, functionName: "convertToAssets", data: raw });
  } catch {
    return 0n;
  }
}

/** Read-only ERC-20 / ERC-4626 vault shares. No marketing APY. */
export async function readVaultPositions(client, owner, block, extras = [], protocol = null) {
  const list = [...PROTOCOL_VAULTS.filter((v) => !protocol || v.protocol === protocol), ...extras];
  return Promise.all(list.map(async (v) => {
    try {
      const shares = await tokenBalance(client, v.share, owner, block);
      const assets = v.convert && shares > 0n ? await toAssets(client, v.convert, shares, block) : 0n;
      return {
        id: v.id,
        protocol: v.protocol,
        kind: "vault",
        symbol: v.symbol,
        labelEn: v.en,
        labelPt: v.pt,
        asset: v.asset,
        share: v.share,
        convert: v.convert,
        decimals: v.decimals,
        assetDecimals: v.assetDecimals,
        shares: shares.toString(),
        assets: assets.toString(),
        block,
        method: shares > 0n && assets > 0n ? "convertToAssets" : "balanceOf",
      };
    } catch {
      return {
        id: v.id,
        protocol: v.protocol,
        kind: "vault",
        symbol: v.symbol,
        labelEn: v.en,
        labelPt: v.pt,
        asset: v.asset,
        share: v.share,
        convert: v.convert,
        decimals: v.decimals,
        assetDecimals: v.assetDecimals,
        shares: "0",
        assets: "0",
        block,
        method: "balanceOf",
        error: true,
      };
    }
  }));
}
