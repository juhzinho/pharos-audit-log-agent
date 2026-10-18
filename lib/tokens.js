import { getAddress } from "viem";

/** Official Pacific Mainnet tokens: https://docs.pharos.xyz/getting-started/token-registry */
export const PACIFIC = {
  USDC: { symbol: "USDC", address: getAddress("0xc879c018db60520f4355c26ed1a6d572cdac1815"), decimals: 6, protocol: "Circle USDC" },
  USDCe: { symbol: "USDCe", address: getAddress("0x7126C3FeF4e6a680eeE09Fb039B2236F638384B0"), decimals: 6, protocol: "Bridged USDC" },
  WPROS: { symbol: "WPROS", address: getAddress("0x52c48d4213107b20bc583832b0d951fb9ca8f0b0"), decimals: 18, protocol: "WPROS wrap" },
  LINK: { symbol: "LINK", address: getAddress("0x51e2A24742Db77604B881d6781Ee16B5b8fcBE29"), decimals: 18, protocol: "Chainlink" },
  WETH: { symbol: "WETH", address: getAddress("0x1f4b7011Ee3d53969bb67F59428a9ec0477856E9"), decimals: 18, protocol: "Wrapped ETH" },
};

export const TOKEN_LIST = Object.values(PACIFIC);

export const KNOWN_ADDRESSES = {
  [PACIFIC.USDC.address.toLowerCase()]: { pt: "USDC oficial (Circle)", en: "official USDC (Circle)" },
  [PACIFIC.USDCe.address.toLowerCase()]: { pt: "USDC bridged (USDCe)", en: "bridged USDC (USDCe)" },
  [PACIFIC.WPROS.address.toLowerCase()]: { pt: "Wrapped PROS (WPROS)", en: "Wrapped PROS (WPROS)" },
  [PACIFIC.LINK.address.toLowerCase()]: { pt: "LINK (Chainlink)", en: "LINK (Chainlink)" },
  [PACIFIC.WETH.address.toLowerCase()]: { pt: "WETH oficial", en: "official WETH" },
  "0x0000000000000000000000000000000000000000": { pt: "endereço zero", en: "zero address" },
  "0x000000000000000000000000000000000000dead": { pt: "endereço de queima", en: "burn address" },
  "0xa5ca5fbe34e444f366b373170541ec6902b0f75c": { pt: "Faroswap", en: "Faroswap" },
  "0xff70f4a1d11995621854f3692acf286d8acd04b2": { pt: "Jumper (LI.FI)", en: "Jumper (LI.FI)" },
  "0x36c800d4472fbb888d034aa74778f481aee01fec": { pt: "Jumper (LI.FI)", en: "Jumper (LI.FI)" },
  "0x28b5a0e9c621a5badaa536219b3a228c8168cf5d": { pt: "CCTP TokenMessenger", en: "CCTP TokenMessenger" },
  "0xfd78ee919681417d192449715b2594ab58f5d002": { pt: "CCTP TokenMinter", en: "CCTP TokenMinter" },
};

const FAROSWAP = "0xa5ca5fbe34e444f366b373170541ec6902b0f75c";
const JUMPER = new Set([
  "0xff70f4a1d11995621854f3692acf286d8acd04b2",
  "0x36c800d4472fbb888d034aa74778f481aee01fec",
]);
const CCTP_A = "0x28b5a0e9c621a5badaa536219b3a228c8168cf5d";
const CCTP_B = "0xfd78ee919681417d192449715b2594ab58f5d002";

export function venueTag(address) {
  const k = String(address || "").toLowerCase();
  if (k === FAROSWAP) return "faroswap";
  if (JUMPER.has(k)) return "jumper";
  if (k === CCTP_A || k === CCTP_B) return "cctp";
  if (k === PACIFIC.WPROS.address.toLowerCase()) return "wrap";
  return null;
}

export const DEMO_WALLET = "0x912c9aDe24D44d8922f0866D8Dcb079f1363f647";

export function tokenByAddress(address) {
  if (!address) return null;
  const key = address.toLowerCase();
  return TOKEN_LIST.find((t) => t.address.toLowerCase() === key) ?? null;
}
