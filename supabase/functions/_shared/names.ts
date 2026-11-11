// casa nomes de times entre fontes diferentes (API-Football, 365Scores, ESPN...): palavras com 3+ letras, sem acento e sem termos genéricos
const STOP = new Set(["fc", "cf", "sc", "ac", "cd", "ad", "sk", "fk", "if", "bk", "afc", "ud", "rc", "club", "clube", "de", "the",
  "city", "united", "town", "real", "sporting", "athletic", "atletico", "esporte", "futebol", "calcio", "sport"]);
export const tokens = (s: string) => new Set(s.replace(/ø/g, "o").replace(/ı/g, "i").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t)));
export const hits = (a: Set<string>, b: Set<string>) => [...a].filter((t) => b.has(t)).length;
