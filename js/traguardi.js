/**
 * Traguardi: cosa sei in grado di fare, man mano che i moduli si chiudono.
 *
 * Servono a decidere dove fermarsi. Un modulo dice cosa impari, un traguardo
 * dice a cosa serve — ed e' l'unica cosa che permette a chi arriva di capire
 * quanto in profondita' vuole andare.
 *
 * Un solo pulsante flottante apre un pannello con il prossimo traguardo e
 * l'elenco completo. Su telefono resta leggibile e non copre il contenuto
 * come farebbero diverse linguette verticali.
 */
import * as L from "./scheduler.js";
import { md } from "./md.js";

let elenco = null;

async function carica() {
  if (elenco) return elenco;
  const r = await fetch("content/traguardi.json", { cache: "no-cache" });
  if (!r.ok) throw new Error("traguardi non trovati");
  elenco = await r.json();
  return elenco;
}

const SOGLIA = 0.8; // un traguardo non pretende il 100%: pretende che il modulo sia solido

/**
 * Stato di un traguardo, dai moduli che richiede.
 * @param {object} t traguardo
 * @param {Map<string, {done, tot, pct} | null>} avanzamenti  null = modulo non ancora scritto
 */
function valuta(t, avanzamenti) {
  const parti = t.richiede.map((id) => ({ id, pr: avanzamenti.get(id) ?? null }));
  const mancanti = parti.filter((p) => p.pr === null).map((p) => p.id);
  const fatti = parti.filter((p) => p.pr && p.pr.pct >= SOGLIA).length;
  const iniziati = parti.filter((p) => p.pr && p.pr.done > 0).length;
  const pct = parti.length ? fatti / parti.length : 0;
  const stato = fatti === parti.length ? "raggiunto" : iniziati ? "avviato" : "chiuso";
  return { parti, mancanti, fatti, pct, stato };
}

const CLASSE = { raggiunto: "ok", avviato: "warn", chiuso: "" };

/** Il popup e' uno solo e viene riusato: due dialog aperti insieme non servono. */
function dialogo() {
  let d = document.getElementById("pop-traguardi");
  if (!d) {
    d = document.createElement("dialog");
    d.id = "pop-traguardi";
    d.setAttribute("aria-label", "Traguardi");
    d.innerHTML = `<div class="pop-corpo"></div>
      <div class="pop-piede"><button class="chiudi">Chiudi</button></div>`;
    document.body.appendChild(d);
    d.addEventListener("click", (e) => {
      if (e.target === d || e.target.classList.contains("chiudi")) d.close();
    });
  }
  return d;
}

function nomeModulo(id, indice) {
  const m = (indice.moduli || []).find((x) => x.id === id);
  return m ? m.titolo : id;
}

function mostra(html) {
  const d = dialogo();
  d.querySelector(".pop-corpo").innerHTML = html;
  if (!d.open) d.showModal();
  d.querySelector(".pop-corpo").scrollTop = 0;
  const titolo = d.querySelector("h2");
  if (titolo) {
    titolo.tabIndex = -1;
    titolo.focus({ preventScroll: true });
  }
  return d;
}

function collegaModuli(d) {
  d.querySelectorAll("[data-modulo]").forEach((b) => {
    b.onclick = () => {
      d.close();
      location.hash = `#/m/${b.dataset.modulo}`;
    };
  });
}

function dettaglio(t, v, indice) {
  const righe = v.parti
    .map(({ id, pr }) => {
      const nome = `${id} — ${nomeModulo(id, indice)}`;
      const meta = (indice.moduli || []).find((m) => m.id === id);
      const etichetta = meta?.disponibile
        ? `<button class="modulo-traguardo" data-modulo="${id}">${nome}</button>`
        : `<span>${nome}</span>`;
      if (!pr) return `<li class="muto">${etichetta} <span class="pill">in arrivo</span></li>`;
      const cl = pr.pct >= SOGLIA ? "ok" : pr.done ? "warn" : "";
      return `<li>${etichetta} <span class="pill ${cl}">${pr.done}/${pr.tot}</span></li>`;
    })
    .join("");

  const intestazione =
    v.stato === "raggiunto"
      ? `<span class="pill ok">raggiunto</span>`
      : v.stato === "avviato"
        ? `<span class="pill warn">${v.fatti} moduli su ${v.parti.length}</span>`
        : v.mancanti.length
          ? `<span class="pill">richiede moduli in arrivo</span>`
          : `<span class="pill">non iniziato</span>`;

  return `
    <button class="minuscolo indietro-traguardi">‹ Tutti i traguardi</button>
    <h2>${t.titolo}</h2>
    <p class="muto">${t.livello} · ${t.sottotitolo}</p>
    <p>${intestazione}</p>
    <div class="barra grande"><i style="width:${Math.round(v.pct * 100)}%"></i></div>
    <h3>Cosa sei in grado di fare</h3>
    <ul>${t.puoi.map((x) => `<li>${x}</li>`).join("")}</ul>
    ${md(t.md || "")}
    <h3>Moduli che servono</h3>
    <ul class="lista-moduli">${righe}</ul>`;
}

function etichettaStato(v) {
  if (v.stato === "raggiunto") return "Raggiunto";
  if (v.stato === "avviato") return `In corso · ${v.fatti}/${v.parti.length} solidi`;
  if (v.mancanti.length) return `${v.mancanti.length} in arrivo`;
  return "Da iniziare";
}

function carta(t, v) {
  // I moduli non ancora scritti si dicono qui: un traguardo fermo perche' il
  // modulo non esiste e' una cosa diversa da uno fermo perche' non l'hai fatto.
  return `<button class="card traguardo" data-id="${t.id}">
    <div><strong>${t.titolo}</strong> <span class="pill">${t.livello}</span></div>
    <div class="muto">${t.sottotitolo}</div>
    <div class="stato-traguardo"><span class="pill ${CLASSE[v.stato]}">${etichettaStato(v)}</span></div>
    <div class="barra"><i style="width:${Math.round(v.pct * 100)}%"></i></div>
  </button>`;
}

function elencoHtml(dati, valutati) {
  const traguardi = dati.traguardi;
  const raggiunti = traguardi.filter((t) => valutati.get(t.id).stato === "raggiunto").length;
  const avviati = traguardi.filter((t) => valutati.get(t.id).stato === "avviato").length;
  const inArrivo = traguardi.filter((t) => valutati.get(t.id).mancanti.length).length;
  const prossimo =
    traguardi.find((t) => {
      const v = valutati.get(t.id);
      return v.stato !== "raggiunto" && !v.mancanti.length;
    }) || traguardi.find((t) => valutati.get(t.id).stato !== "raggiunto");
  const gruppi = [...new Set(dati.traguardi.map((t) => t.gruppo || "Traguardi"))];
  const sezioni = gruppi
    .map((g) => {
      const carte = traguardi
        .filter((t) => (t.gruppo || "Traguardi") === g)
        .map((t) => carta(t, valutati.get(t.id)))
        .join("");
      return `<section class="gruppo-traguardi"><h3>${g}</h3>${carte}</section>`;
    })
    .join("");
  const passo = prossimo
    ? `<button class="prossimo-traguardo" data-id="${prossimo.id}">
        <span class="sopracciglio">Prossimo passo</span>
        <strong>${prossimo.titolo}</strong>
        <span>${prossimo.sottotitolo}</span>
      </button>`
    : `<p class="completo">Hai raggiunto tutti i traguardi disponibili in questo ramo.</p>`;
  return `<h2>${dati.titolo}</h2>
    <p class="muto">${dati.sottotitolo}</p>
    <div class="riepilogo-traguardi">
      <span class="pill ok">${raggiunti} raggiunti</span>
      <span class="pill warn">${avviati} in corso</span>
      <span class="pill">${inArrivo} con moduli in arrivo</span>
    </div>
    ${passo}
    ${sezioni}`;
}

/**
 * Monta la striscia di linguette. Va richiamata a ogni render: l'app riscrive
 * #app da capo, ma la striscia vive fuori e va solo aggiornata.
 *
 * @param {object} indice          content/index.json gia' caricato
 * @param {object} stati           stato per esercizio
 * @param {(id:string)=>Promise}   caricaModulo  per contare gli esercizi
 * @param {string} ramo  id del ramo: si mostrano solo i suoi traguardi
 */
export async function montaTendine(indice, stati, caricaModulo, ramo) {
  let dati;
  try {
    dati = await carica();
  } catch {
    return; // senza traguardi l'app funziona lo stesso
  }

  // Il ramo e' dichiarato dal traguardo, non dedotto dai moduli che richiede:
  // "scrivere uno strumento" tocca anche l05, ma resta un traguardo di Python.
  // L'ordine, invece, viene dall'indice del ramo: un traguardo arriva dopo il
  // suo ultimo prerequisito e non dipende dall'ordine in cui e' stato scritto
  // nel JSON. Cosi' la roadmap, le card dei moduli e i traguardi restano allineati.
  const moduliRamo = (indice.rami || []).find((r) => r.id === ramo)?.moduli || [];
  const posizioneModulo = new Map(moduliRamo.map((id, n) => [id, n]));
  const passo = (t) => {
    const posizioni = t.richiede.map((id) => posizioneModulo.get(id)).filter(Number.isInteger);
    return posizioni.length ? Math.max(...posizioni) : Number.MAX_SAFE_INTEGER;
  };
  const visibili = dati.traguardi
    .map((t, sorgente) => ({ t, sorgente, passo: passo(t) }))
    .filter(({ t }) => t.ramo === ramo)
    .sort((a, b) => a.passo - b.passo || a.sorgente - b.sorgente)
    .map(({ t }) => t);
  if (!visibili.length) {
    document.getElementById("tendine")?.remove();
    return;
  }

  // I moduli servono solo per contare gli esercizi: quelli non ancora scritti
  // restano null, ed e' cosi' che un traguardo sa di essere fuori portata.
  const idsRichiesti = [...new Set(visibili.flatMap((t) => t.richiede))];
  const avanzamenti = new Map();
  await Promise.all(
    idsRichiesti.map(async (id) => {
      const meta = (indice.moduli || []).find((m) => m.id === id);
      if (!meta || !meta.disponibile) return avanzamenti.set(id, null);
      try {
        const mod = await caricaModulo(id);
        avanzamenti.set(id, L.progress(stati, mod.esercizi.map((e) => e.id)));
      } catch {
        avanzamenti.set(id, null);
      }
    })
  );

  const valutati = new Map(visibili.map((t) => [t.id, valuta(t, avanzamenti)]));

  const apri = (id) => {
    const t = visibili.find((x) => x.id === id);
    const d = mostra(dettaglio(t, valutati.get(id), indice));
    collegaModuli(d);
    d.querySelector(".indietro-traguardi").onclick = () => apriElenco();
  };
  const apriElenco = () => {
    const d = mostra(elencoHtml({ ...dati, traguardi: visibili }, valutati));
    d.querySelectorAll(".traguardo, .prossimo-traguardo").forEach((b) => (b.onclick = () => apri(b.dataset.id)));
  };

  document.getElementById("tendine")?.remove();
  const raggiunti = visibili.filter((t) => valutati.get(t.id).stato === "raggiunto").length;
  const avviati = visibili.filter((t) => valutati.get(t.id).stato === "avviato").length;
  const strip = document.createElement("div");
  strip.id = "tendine";
  strip.innerHTML = `<button class="tendina tutte" aria-haspopup="dialog" aria-label="Apri i traguardi: ${raggiunti} raggiunti su ${visibili.length}">
    <span class="tendina-titolo">Traguardi</span>
    <span class="tendina-contatore">${raggiunti}/${visibili.length}</span>
    ${avviati ? `<span class="tendina-avviso">${avviati} in corso</span>` : ""}
  </button>`;
  document.body.appendChild(strip);
  strip.querySelector(".tutte").onclick = apriElenco;
}

/** Via la striscia: dentro un esercizio darebbe fastidio e basta. */
export function togliTendine() {
  document.getElementById("tendine")?.remove();
}
