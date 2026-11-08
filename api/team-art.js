// Foto do time para o card grande (TheSportsDB): fanart do time ou recorte de jogadores do elenco.
// A CDN da Vercel guarda a resposta por 7 dias, então cada time é buscado uma vez por semana.
const API = "https://www.thesportsdb.com/api/v1/json/123/";
const SPORTS = new Set(["Soccer", "Basketball"]);

const get = async (path) => {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
};
const findTeam = async (name, sport) =>
  ((await get(`searchteams.php?t=${encodeURIComponent(name)}`)).teams || []).find((t) => t.strSport === sport);

module.exports = async (req, res) => {
  const name = String(req.query.t || "").trim().slice(0, 60);
  const sport = String(req.query.s || "");
  if (!name || !SPORTS.has(sport)) return res.status(400).json({ u: [] });
  try {
    const plain = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/)
      .filter((w) => !/^(\d+\.?|[A-Z]{2,3})$/.test(w)).join(" ");
    const team = (await findTeam(name, sport)) || (plain && plain !== name ? await findTeam(plain, sport) : null);
    let u = [];
    if (team) {
      u = [1, 2, 3, 4].map((i) => team["strFanart" + i]).filter(Boolean).map((x) => x + "/medium");
      if (!u.length) {
        const players = (await get(`lookup_all_players.php?id=${team.idTeam}`)).player || [];
        u = players.filter((p) => p.strCutout && !/manager|coach/i.test(p.strPosition || ""))
          .map((p) => "p:" + p.strCutout + "/medium");
      }
    }
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400");
    res.status(200).json({ u });
  } catch {
    res.setHeader("Cache-Control", "public, s-maxage=600");
    res.status(502).json({ u: [] });
  }
};
