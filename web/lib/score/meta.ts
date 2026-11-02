// Card numbers + art for our starter set (ptcg ids from data/cards.csv).
export const META: Record<string, { number: string; ptcg: string }> = {
  "base-charizard": { number: "4/102", ptcg: "base1-4" },
  "base-blastoise": { number: "2/102", ptcg: "base1-2" },
  "base-venusaur": { number: "15/102", ptcg: "base1-15" },
  "umbreon-vmax-alt": { number: "215/203", ptcg: "swsh7-215" },
  "gengar-vmax-alt": { number: "271/264", ptcg: "swsh8-271" },
  "giratina-v-alt": { number: "186/196", ptcg: "swsh11-186" },
  "lugia-v-alt": { number: "186/195", ptcg: "swsh12-186" },
  "charizard-ex-151-sir": { number: "199/165", ptcg: "sv3pt5-199" },
  "charizard-ex-obf-sir": { number: "223/197", ptcg: "sv3-223" },
  "pikachu-grey-felt-hat": { number: "SVP 085", ptcg: "svp-85" },
};

export const imageFor = (cardKey: string) => {
  const m = META[cardKey];
  if (!m) return "";
  const i = m.ptcg.lastIndexOf("-");
  return `https://images.pokemontcg.io/${m.ptcg.slice(0, i)}/${m.ptcg.slice(i + 1)}.png`;
};
