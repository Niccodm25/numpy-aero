/**
 * Traguardi: cosa sei in grado di fare, man mano che i moduli si chiudono.
 *
 * Servono a decidere dove fermarsi. Un modulo dice cosa impari, un traguardo
 * dice a cosa serve — ed e' l'unica cosa che permette a chi arriva di capire
 * quanto in profondita' vuole andare.
 *
 * Le tendine stanno sul bordo destro e aprono un popup. Su schermo stretto
 * resta una sola linguetta, che apre l'elenco: dodici linguette verticali su
 * un telefono coprirebbero il testo.
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
    d.innerHTML = `<div class="pop-corpo"></div>
      <div class="riga"><button class="chiudi">Chiudi</button></div>`;
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
  return d;
}

function dettaglio(t, v, indice) {
  const righe = v.parti
    .map(({ id, pr }) => {
      const nome = `${id} — ${nomeModulo(id, indice)}`;
      if (!pr) return `<li class="muto">${nome} <span class="pill">in arrivo</span></li>`;
      const cl = pr.pct >= SOGLIA ? "ok" : pr.done ? "warn" : "";
      return `<li>${nome} <span class="pill ${cl}">${pr.done}/${pr.tot}</span></li>`;
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

function carta(t, v) {
  // I moduli non ancora scritti si dicono qui: un traguardo fermo perche' il
  // modulo non esiste e' una cosa diversa da uno fermo perche' non l'hai fatto.
  const n = v.mancanti.length;
  const manca = n ? ` <span class="pill">${n} ${n === 1 ? "modulo" : "moduli"} in arrivo</span>` : "";
  return `<button class="card traguardo" data-id="${t.id}">
    <strong>${t.titolo}</strong> <span class="pill ${CLASSE[v.stato]}">${t.livello}</span>${manca}
    <div class="muto">${t.sottotitolo}</div>
    <div class="barra"><i style="width:${Math.round(v.pct * 100)}%"></i></div>
  </button>`;
}

function elencoHtml(dati, valutati) {
  const gruppi = [...new Set(dati.traguardi.map((t) => t.gruppo || "Traguardi"))];
  const sezioni = gruppi
    .map((g) => {
      const carte = dati.traguardi
        .filter((t) => (t.gruppo || "Traguardi") === g)
        .map((t) => carta(t, valutati.get(t.id)))
        .join("");
      return `<h3>${g}</h3>${carte}`;
    })
    .join("");
  return `<h2>${dati.titolo}</h2>
    <p class="muto">${dati.sottotitolo}</p>
    ${sezioni}`;
}

/**
 * Monta la striscia di linguette. Va richiamata a ogni render: l'app riscrive
 * #app da capo, ma la striscia vive fuori e va solo aggiornata.
 *
 * @param {object} indice          content/index.json gia' caricato
 * @param {object} stati           stato per esercizio
 * @param {(id:string)=>Promise}   caricaModulo  per contare gli esercizi
 */
export async function montaTendine(indice, stati, caricaModulo) {
  let dati;
  try {
    dati = await carica();
  } catch {
    return; // senza traguardi l'app funziona lo stesso
  }

  const visibili = dati.traguardi;

  // I moduli servono solo per contare gli esercizi: quelli non ancora scritti
  // restano null, ed e' cosi' che un traguardo sa di essere fuori portata.
  const idsRichiesti = [...new Set(dati.traguardi.flatMap((t) => t.richiede))];
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

  const valutati = new Map(dati.traguardi.map((t) => [t.id, valuta(t, avanzamenti)]));

  const apri = (id) => {
    const t = dati.traguardi.find((x) => x.id === id);
    const d = mostra(dettaglio(t, valutati.get(id), indice));
    d.querySelector(".indietro-traguardi").onclick = () => apriElenco();
  };
  const apriElenco = () => {
    const d = mostra(elencoHtml(dati, valutati));
    d.querySelectorAll(".traguardo").forEach((b) => (b.onclick = () => apri(b.dataset.id)));
  };

  // Sul bordo ci stanno cinque linguette leggibili, non dodici: si mostrano
  // quelle a cui sei piu' vicino - prima quelle avviate, poi le raggiunte -
  // e l'elenco completo resta dietro la linguetta "Traguardi".
  const ordine = { avviato: 0, raggiunto: 1, chiuso: 2 };
  const inEvidenza = [...visibili]
    .sort((a, b) => ordine[valutati.get(a.id).stato] - ordine[valutati.get(b.id).stato])
    .slice(0, 5);

  document.getElementById("tendine")?.remove();
  const strip = document.createElement("div");
  strip.id = "tendine";
  strip.innerHTML =
    `<button class="tendina tutte">Traguardi</button>` +
    inEvidenza
      .map((t) => {
        const v = valutati.get(t.id);
        return `<button class="tendina ${CLASSE[v.stato]}" data-id="${t.id}" title="${t.titolo}: ${t.sottotitolo}">${t.etichetta || t.titolo}</button>`;
      })
      .join("");
  document.body.appendChild(strip);
  strip.querySelector(".tutte").onclick = apriElenco;
  strip.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => apri(b.dataset.id)));
}

/** Via la striscia: dentro un esercizio darebbe fastidio e basta. */
export function togliTendine() {
  document.getElementById("tendine")?.remove();
}
