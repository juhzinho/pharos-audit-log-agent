import { getAddress, isAddress } from "viem";
import { tokenBalance } from "./audit.js";
import { toAssets } from "./vaults.js";

export const PROSPER_API = "https://api.pros-per.xyz/api/v1/vaults?pageNumber=1&pageSize=100";
export const PROSPER_FACTORY = getAddress("0xEfdbb0eA7647B0e21AEf7A3b7a5D6A632c3116C8");
export const PROSPER_DEPOSIT = getAddress("0xbbDDb34955ed0DD8059188aA57422f29babCe6ec");

function addr(value) {
  if (!value || !isAddress(value)) return null;
  return getAddress(value);
}

/** Live catalog from Prosper's own API (Pacific 1672). No marketing APY. */
export async function listProsperVaults() {
  const res = await fetch(PROSPER_API, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`Prosper API ${res.status}`);
  const body = await res.json();
  const list = body?.data?.list;
  if (!Array.isArray(list)) throw new Error("Prosper API shape changed");
  return list.flatMap((row) => {
    const share = addr(row.share);
    const pToken = addr(row.pToken);
    const convert = addr(row.r25Vault);
    if (!share) return [];
    return [{
      id: `prosper-${share.slice(2, 10).toLowerCase()}`,
      protocol: "prosper",
      symbol: String(row.vaultSymbol || "SHARE").slice(0, 24),
      pSymbol: String(row.pVaultSymbol || "pVAULT").slice(0, 24),
      en: `Prosper ${row.vaultName || row.vaultSymbol}`,
      pt: `Prosper ${row.vaultName || row.vaultSymbol}`,
      share,
      pToken,
      convert,
      decimals: Number(row.shareDecimals) || 18,
      asset: "USDC",
      assetDecimals: 6,
    }];
  });
}

export async function readProsperPositions(client, owner, block, catalog, { pTokens = false } = {}) {
  const rows = await Promise.all((catalog || []).map(async (v) => {
    try {
      const shares = await tokenBalance(client, v.share, owner, block);
      const pBal = pTokens && v.pToken ? await tokenBalance(client, v.pToken, owner, block) : 0n;
      const assets = v.convert && shares > 0n ? await toAssets(client, v.convert, shares, block) : 0n;
      const shareRow = {
        id: v.id,
        protocol: "prosper",
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
      if (!pTokens || !v.pToken) return [shareRow];
      return [shareRow, {
        id: `${v.id}-ptoken`,
        protocol: "prosper",
        kind: "ptoken",
        symbol: v.pSymbol,
        labelEn: `Prosper ${v.pSymbol} (market token, not vault NAV)`,
        labelPt: `Prosper ${v.pSymbol} (token de mercado, não é NAV do vault)`,
        asset: "PROS",
        share: v.pToken,
        convert: null,
        decimals: 18,
        assetDecimals: 18,
        shares: pBal.toString(),
        assets: "0",
        block,
        method: "balanceOf",
      }];
    } catch {
      return [{
        id: v.id,
        protocol: "prosper",
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
      }];
    }
  }));
  return rows.flat();
}
