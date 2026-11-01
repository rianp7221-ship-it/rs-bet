// =====================================================
//  mines.js — jogos de cassino: Mines e Dados
//  O resultado é sorteado NO SERVIDOR (schema.sql). O navegador só mostra.
// =====================================================
(() => {
  // jogos ligados e RTP definidos no Admin → Cassino
  const lobby = sb.rpc("casino_lobby").then((r) => r.data || null, () => null);
  lobby.then((l) => {
    if (!l) return;
    const on = new Set(l.map((g) => g.id));
    [["mines", "mines-card"], ["dice", "dice"], ["leao", "leao"]].forEach(([id, el]) =>
      RS.$$(`#${el}, [data-game="${el}"]`).forEach((n) => { n.style.display = on.has(id) ? "" : "none"; }));
    if (!l.length) RS.$(".casino-grid")?.insertAdjacentHTML("beforebegin", `<p class="muted" style="margin:12px 0">O cassino está temporariamente indisponível.</p>`);
  });

  // ---------------- MINES ----------------
  const grid = RS.$("#mines-grid");
  if (grid) {
    let game = null; // { id, stake, mines }
    let mult = 1;
    const btn = RS.$("#mines-action");
    const info = RS.$("#mines-info");

    function build() {
      grid.innerHTML = Array.from({ length: 25 }, (_, i) => `<button class="cell" data-i="${i}" ${game ? "" : "disabled"}></button>`).join("");
    }
    function setInfo() {
      info.innerHTML = game
        ? `Multiplicador <b>${mult.toFixed(2)}x</b> · Retirar <b>${RS.money(game.stake * mult)}</b>`
        : `Escolha o valor e a quantidade de minas.`;
      btn.textContent = game ? "Retirar" : "Jogar";
      btn.classList.toggle("btn-cash", !!game);
      RS.$("#mines-stake").disabled = RS.$("#mines-count").disabled = !!game;
    }
    function showBombs(bombs, hit) {
      RS.$$(".cell", grid).forEach((c) => {
        const i = Number(c.dataset.i);
        if (bombs.includes(i)) c.classList.add("bomb", ...(i === hit ? ["hit"] : []));
        else if (!c.classList.contains("gem")) c.classList.add("dim");
        c.disabled = true;
      });
    }

    btn.onclick = async () => {
      if (!(await RS.user())) { location.href = "login.html"; return; }
      btn.disabled = true;
      try {
        if (!game) {
          game = await RS.rpc("mines_start", { p_stake: Number(RS.$("#mines-stake").value), p_mines: Number(RS.$("#mines-count").value) });
          mult = 1; build(); RS.refreshBalance();
        } else {
          const r = await RS.rpc("mines_cashout", { p_game: game.id });
          showBombs(r.bombs);
          RS.toast(`Você ganhou ${RS.money(r.payout)}!`, "ok");
          game = null; RS.refreshBalance();
        }
      } catch (e) { RS.toast(e.message, "error"); }
      btn.disabled = false; setInfo();
    };

    grid.addEventListener("click", async (e) => {
      const c = e.target.closest(".cell");
      if (!c || !game || c.disabled) return;
      c.disabled = true;
      try {
        const i = Number(c.dataset.i);
        const r = await RS.rpc("mines_reveal", { p_game: game.id, p_cell: i });
        if (r.bomb) {
          showBombs(r.bombs, i);
          RS.toast("Boom! Você perdeu.", "error");
          game = null;
        } else if (r.cashout) {
          c.classList.add("gem"); showBombs(r.bombs);
          RS.toast(`Tabuleiro limpo! ${RS.money(r.payout)}`, "ok");
          game = null; RS.refreshBalance();
        } else {
          c.classList.add("gem");
          mult = Number(r.multiplier);
        }
      } catch (err) { RS.toast(err.message, "error"); c.disabled = false; }
      setInfo();
    });

    // retoma partida em andamento (ex.: recarregou a página)
    (async () => {
      const u = await RS.user();
      if (u) {
        const { data } = await sb.from("casino_games").select("id,stake,mines,revealed,multiplier")
          .eq("user_id", u.id).eq("game", "mines").eq("status", "active").maybeSingle();
        if (data) {
          game = { id: data.id, stake: Number(data.stake), mines: data.mines };
          mult = Number(data.multiplier);
          build();
          data.revealed.forEach((i) => { const c = grid.children[i]; c.classList.add("gem"); c.disabled = true; });
          RS.$("#mines-stake").value = data.stake; RS.$("#mines-count").value = data.mines;
          setInfo(); return;
        }
      }
      build(); setInfo();
    })();
  }

  // ---------------- DADOS ----------------
  const dice = RS.$("#dice");
  if (dice) {
    const range = RS.$("#dice-target");
    let over = true, rtp = 97;
    const upd = () => {
      const t = Number(range.value);
      const chance = over ? 100 - t : t;
      RS.$("#dice-label").textContent = `${over ? "Acima de" : "Abaixo de"} ${t}`;
      RS.$("#dice-chance").textContent = chance + "%";
      RS.$("#dice-mult").textContent = (rtp / chance).toFixed(2) + "x";
    };
    range.oninput = upd;
    RS.$("#dice-side").onclick = () => { over = !over; upd(); };
    RS.$("#dice-roll").onclick = async (e) => {
      if (!(await RS.user())) { location.href = "login.html"; return; }
      e.target.disabled = true;
      try {
        const r = await RS.rpc("dice_roll", { p_stake: Number(RS.$("#dice-stake").value), p_target: Number(range.value), p_over: over });
        const out = RS.$("#dice-result");
        out.textContent = Number(r.roll).toFixed(2);
        out.className = "dice-result " + (r.win ? "win" : "lose");
        RS.toast(r.win ? `Ganhou ${RS.money(r.payout)}!` : "Não foi dessa vez.", r.win ? "ok" : "error");
        RS.refreshBalance();
      } catch (err) { RS.toast(err.message, "error"); }
      e.target.disabled = false;
    };
    upd();
    lobby.then((l) => {
      const g = l?.find((x) => x.id === "dice");
      if (g) { rtp = Number(g.rtp); RS.$("#dice-stake").min = g.min; RS.$("#dice-stake").max = g.max; upd(); }
    });
  }
})();
