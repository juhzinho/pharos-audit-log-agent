/** Port ecosystem catalog: https://api.pharosnetwork.xyz/omni_port/ecosystem
 *  Harbor cards: https://api.pharosnetwork.xyz/omni_port/harbor/summary
 *  Position dapps get an on-chain read. The rest stay unread on purpose.
 */
export const ECOSYSTEM = [
  { id: "faroswap", name: "Faroswap", tags: ["DEX"], url: "https://faroswap.xyz", role: "read" },
  { id: "circle", name: "Circle", tags: ["Stable Coin"], url: "https://www.circle.com/", role: "read", noteEn: "Official USDC on Pacific is already in the wallet token list.", notePt: "O USDC oficial da Pacific já está na lista de tokens da carteira." },
  { id: "r25", name: "R25", tags: ["RWA"], url: "https://www.r25.xyz/", role: "read", alias: "harbor" },
  { id: "harbor", name: "Harbor", tags: ["RWA"], url: "https://port.pharos.xyz/harbor", role: "read" },
  { id: "prosper", name: "Prosper", tags: ["RWA", "Launchpad"], url: "https://app.pros-per.xyz/", role: "read" },
  { id: "morpho", name: "Morpho", tags: ["Lending"], url: "https://morpho.org/", role: "read" },
  { id: "faroo", name: "Faroo", tags: ["Lending"], url: "https://app.faroo.xyz/", role: "read" },
  { id: "termmax", name: "TermMax", tags: ["Lending"], url: "https://app-v2.termmax.ts.finance/", role: "read" },
  { id: "jumper", name: "Jumper", tags: ["Bridge"], url: "https://jumper.exchange", role: "read" },
  { id: "lifi", name: "LI.FI", tags: ["Bridge"], url: "https://li.fi/", role: "read", alias: "jumper" },
  { id: "asseto", name: "Asseto", tags: ["RWA"], url: "https://asseto.finance/", role: "unread", noteEn: "Asseto is on the Port list. The public site has no Pacific share token I can eth_call.", notePt: "Asseto está no Port. O site público não mostra share token da Pacific para eth_call." },
  { id: "agra", name: "Agra", tags: ["DEX"], url: "https://bonds.agra.gg/", role: "unread", noteEn: "Agra lists wmtUSDC as a Wildcat credit bond. I will not guess a Pacific 0x from a truncated explorer link.", notePt: "Agra lista wmtUSDC como bond Wildcat. Não invento 0x da Pacific a partir de um link truncado." },
  { id: "oku", name: "OKU", tags: ["Lending"], url: "https://oku.trade/", role: "unread", noteEn: "OKU is an aggregator UI over Morpho/Faroswap. I read those protocols directly, not OKU itself.", notePt: "OKU é uma UI agregadora sobre Morpho/Faroswap. Eu leio esses protocolos direto, não a OKU." },
  { id: "newsight", name: "NewSight", tags: ["Prediction Market"], url: "https://newsight.market/", role: "unread", noteEn: "NewSight is a prediction market. No Pacific position token is published for this page to read.", notePt: "NewSight é prediction market. Não há token de posição da Pacific publicado para esta página ler." },
  { id: "grandline", name: "Grandline", tags: ["NFT"], url: "https://app.grandline.world", role: "unread", noteEn: "Grandline is NFT. This portfolio page does not invent an NFT contract to scan.", notePt: "Grandline é NFT. Esta página de portfólio não inventa um contrato NFT para varrer." },
  { id: "pns", name: "PNS", tags: ["DID"], url: "https://pharosname.com", role: "unread", noteEn: "PNS is a name service, not a yield vault.", notePt: "PNS é serviço de nome, não um vault de yield." },
  { id: "zns", name: "ZNS Connect", tags: ["DID"], url: "https://zns.bio/", role: "unread", noteEn: "ZNS Connect is identity / domains, not a wallet position I can value.", notePt: "ZNS Connect é identidade / domínio, não uma posição de carteira que eu valorize." },
  { id: "zona", name: "Zona", tags: ["RWA"], url: "https://www.zona.finance/", role: "unread", noteEn: "Zona's published contracts are Robinhood Chain, not a Pacific vault.", notePt: "Os contratos publicados da Zona são Robinhood Chain, não um vault da Pacific." },
  { id: "ember", name: "Ember", tags: ["Vault"], url: "https://ember.so/earn", role: "unread", noteEn: "Ember pALPHA is documented on Ethereum. I will not use that 0x as a Pacific share.", notePt: "Ember pALPHA está documentado na Ethereum. Não uso esse 0x como share da Pacific." },
  { id: "interport", name: "InterPort", tags: ["Bridge"], url: "https://interport.fi/", role: "unread", noteEn: "InterPort is a bridge. No Pacific allowance target is in this build yet.", notePt: "InterPort é bridge. Ainda não há spender da Pacific neste build." },
  { id: "layerzero", name: "LayerZero", tags: ["Bridge"], url: "https://layerzero.network/", role: "unread", noteEn: "LayerZero is messaging infra, not a wallet vault.", notePt: "LayerZero é infra de mensagens, não um vault da carteira." },
  { id: "bifrost", name: "Bifrost", tags: ["LST"], url: "https://bifrost.io/", role: "unread", noteEn: "Bifrost is Coming Soon on Port. Faroo stPROS is the Pacific LST I can read.", notePt: "Bifrost está Coming Soon no Port. Faroo stPROS é o LST da Pacific que eu leio." },
];

export const HARBOR_CARDS_UNREAD = ["pGAIN", "ETHvp", "BTCvc", "pRNH", "BTCvp", "bfBTC", "GPCI", "pALPHA", "VRPC-Daily", "VRPC-SemiYearly", "tulPRWA"];

export function ecosystemById(id) {
  return ECOSYSTEM.find((p) => p.id === id) || null;
}
