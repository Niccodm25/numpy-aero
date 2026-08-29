import { md } from "./md.js";
import * as R from "./runner.js";
import * as S from "./storage.js";
import * as L from "./scheduler.js";
import * as P from "./percorso.js";

const app = document.getElementById("app");
const barra = document.getElementById("stato");

let indice = null;
const cache = {};
let dati = S.load();
let stati = dati.esercizi;
let modoRipasso = false;

const stato = (id) => (stati[id] ||= L.newState(id));
const salva = () => S.save(dati);

async function modulo(id) {
  if (cache[id]) return cache[id];
  const meta = indice.moduli.find((m) => m.id === id);
  if (!meta) throw new Error("Modulo sconosciuto: " + id);
  // no-cache = rivalida sempre con ETag. GitHub Pages manda max-age=600, e senza
  // questo un modulo nuovo non comparirebbe per dieci minuti.
  const r = await fetch("content/" + meta.file, { cache: "no-cache" });
  if (!r.ok) throw new Error("Contenuto non trovato: " + meta.file);
  const m = await r.json();

  // Due formati. I moduli nuovi raggruppano gli esercizi per comando in
  // "raccolte"; i vecchi hanno una lista piatta. Qui si normalizza a raccolte,
  // e si tiene anche la lista piatta perche' le viste la usano per cercare per id.
  if (!m.raccolte) {
    m.raccolte = [{ id: m.id + "-tutti", comando: m.titolo, titolo: "Esercizi", esercizi: m.esercizi || [] }];
  }
  m.esercizi = m.raccolte.flatMap((r) => r.esercizi);
  m.cantiere = meta.cantiere || m.cantiere;
  return (cache[id] = m);
}

// ---------- avvio ----------

(async function init() {
  indice = await (await fetch("content/index.json", { cache: "no-cache" })).json();
  R.boot((m) => (barra.textContent = m || ""))
    .then((v) => {
      barra.textContent = "NumPy " + v + " pronto";
      setTimeout(() => (barra.textContent = ""), 2500);
    })
    .catch((e) => (barra.textContent = "Python non caricato: " + e.message));
  addEventListener("hashchange", route);
  route();
  // Cachea Pyodide: dalla seconda apertura l'app parte senza riscaricare 12 MB.
  registraSw();
})();

async function route() {
  const p = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  try {
    if (p[0] === "m") return await vistaModulo(p[1]);
    if (p[0] === "r") return await vistaRaccolta(p[1], p[2]);
    if (p[0] === "p") return await vistaPercorso(p[1]);
    if (p[0] === "l") return await vistaLezione(p[1], p[2]);
    if (p[0] === "e") return await vistaEsercizio(p[1], p[2]);
    if (p[0] === "ripasso") return await vistaRipasso();
    modoRipasso = false;
    return await home();
  } catch (e) {
    app.innerHTML = `<div class="esito ko">${e.message}</div><p><a href="#/">Torna alla home</a></p>`;
  }
}

// ---------- service worker ----------
// Lo stato e' visibile in home: su un telefono non c'e' una console da leggere,
// e senza questo l'unico sintomo di un fallimento e' "non va offline".

let swInfo = "controllo in corso…";

function mostraSw() {
  const el = document.querySelector("#sw");
  if (el) el.textContent = "Uso offline: " + swInfo;
}

async function registraSw() {
  if (!navigator.serviceWorker) {
    swInfo = "non supportato da questo browser";
    return mostraSw();
  }
  try {
    await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;
    swInfo = navigator.serviceWorker.controller
      ? "attivo, Pyodide in cache"
      : "installato — ricarica la pagina per attivarlo";
  } catch (e) {
    swInfo = "non attivo — " + e.message;
  }
  mostraSw();
}

// ---------- viste ----------

async function home() {
  const coda = L.reviewQueue(stati);

  const riga = async (m) => {
    if (!m.disponibile)
      return `<div class="card muto">${m.titolo} <span class="pill">in arrivo</span></div>`;
    const mod = await modulo(m.id);
    const pr = L.progress(stati, mod.esercizi.map((e) => e.id));
    const etichetta = m.cantiere ? "fasi completate" : "esercizi completati";
    return `<a class="card" href="#/m/${m.id}">
      <strong>${m.titolo}</strong>
      <div class="muto">${pr.done} / ${pr.tot} ${etichetta}</div>
      <div class="barra"><i style="width:${Math.round(pr.pct * 100)}%"></i></div>
    </a>`;
  };

  const righe = await Promise.all(indice.moduli.filter((m) => !m.cantiere).map(riga));
  const cantieri = await Promise.all(indice.moduli.filter((m) => m.cantiere).map(riga));

  app.innerHTML = `
    <h1>${indice.titolo}</h1>
    <p class="muto">Python e NumPy girano nel tuo browser. Niente da installare.</p>
    ${
      coda.length
        ? `<a class="card" href="#/ripasso" style="border-color:var(--acc)">
             <strong>Ripassa ${coda.length} ${coda.length === 1 ? "esercizio" : "esercizi"}</strong>
             <div class="muto">Prima i più deboli. Un esercizio è chiuso solo dopo ${L.MASTERED} risposte corrette senza aiuti.</div>
           </a>`
        : ""
    }
    <h2>Moduli</h2>
    ${righe.join("")}
    ${cantieri.length
      ? `<h2>Cantieri</h2>
         <p class="muto">Progetti aperti, da fare quando i moduli sono solidi.
         Non entrano nella coda di ripasso.</p>
         ${cantieri.join("")}`
      : ""}
    <h2>Progressi</h2>
    <p class="muto">Salvati in questo browser. Esportali per spostarli sul telefono.</p>
    <p class="muto" id="sw"></p>
    <div class="riga">
      <button id="exp">Esporta</button>
      <button id="imp">Importa</button>
      <input type="file" id="file" accept="application/json" hidden>
    </div>`;

  mostraSw();
  app.querySelector("#exp").onclick = () => S.esporta(dati);
  app.querySelector("#imp").onclick = () => app.querySelector("#file").click();
  app.querySelector("#file").onchange = (ev) => {
    const f = ev.target.files[0];
    if (f)
      S.importa(f)
        .then((d) => { dati = d; stati = dati.esercizi; salva(); route(); })
        .catch((e) => alert(e.message));
  };
}

async function vistaModulo(id) {
  modoRipasso = false;
  const m = await modulo(id);
  const lez = m.lezioni
    .map((l, i) => `<a class="card" href="#/l/${id}/${l.id}"><strong>${i + 1}. ${l.titolo}</strong></a>`)
    .join("");
  const racc = m.raccolte
    .map((r) => {
      const pr = L.progress(stati, r.esercizi.map((e) => e.id));
      return `<a class="card" href="#/r/${id}/${r.id}">
        <strong><code>${r.comando}</code></strong>
        <div class="muto">${r.esercizi.length} esercizi · ${pr.done} fatti</div>
        <div class="barra"><i style="width:${Math.round(pr.pct * 100)}%"></i></div>
      </a>`;
    })
    .join("");

  app.innerHTML = `
    <div class="nav"><a href="#/">‹ Moduli</a></div>
    <h1>${m.titolo}</h1>
    <p>${m.perche}</p>
    <h2>Lezioni</h2>${lez}
    <h2>Esercizi</h2>
    <p class="muto">Una raccolta per comando: aprine una per allenarti su quel comando soltanto.</p>
    ${racc}
    <h2>Percorso di apprendimento</h2>
    <p class="muto">Un esercizio per comando a rotazione, finché non li sai tutti.</p>
    ${cartaPercorso(id, m)}`;
}

function cartaPercorso(id, m) {
  const p = dati.percorsi[id];
  const argomenti = m.raccolte.map((r) => r.id);
  const valido = p && (p.argomenti || []).join("|") === argomenti.join("|");
  if (!valido)
    return `<a class="card" href="#/p/${id}" style="border-color:var(--acc)">
      <strong>Inizia il percorso</strong>
      <div class="muto">${argomenti.length} comandi · ${argomenti.length * 2} esercizi se non sbagli nulla</div>
    </a>`;
  const pct = P.percentuale(p);
  return `<a class="card" href="#/p/${id}" style="border-color:var(--acc)">
    <strong>${p.completo ? "Percorso completato" : "Riprendi il percorso"}</strong>
    <div class="muto">${pct}% · ciclo ${p.ciclo} · ${p.fatti} esercizi fatti</div>
    <div class="barra"><i style="width:${pct}%"></i></div>
  </a>`;
}

// ---------- percorso di apprendimento ----------

/**
 * Sceglie l'esercizio da servire per uno slot del percorso: dalla raccolta del
 * comando, del tipo richiesto, preferendo quelli mai usati in questo percorso e
 * poi i meno recenti. Con abbastanza esercizi per comando, lo stesso non torna
 * quasi mai a distanza ravvicinata.
 */
function scegliEsercizio(m, slot, p) {
  const r = m.raccolte.find((x) => x.id === slot.arg);
  let cand = r.esercizi;
  if (slot.tipo === "write") {
    const scrittura = cand.filter((e) => e.tipo !== "predict");
    if (scrittura.length) cand = scrittura;
  }
  const usati = (p.usati ||= {});
  const minimo = Math.min(...cand.map((e) => usati[e.id] ?? -1));
  const pool = cand.filter((e) => (usati[e.id] ?? -1) === minimo);
  return pool[Math.floor(Math.random() * pool.length)];
}

async function vistaPercorso(mid) {
  modoRipasso = false;
  const m = await modulo(mid);
  const argomenti = m.raccolte.map((r) => r.id);
  let p = dati.percorsi[mid];

  // Se le raccolte del modulo sono cambiate, un percorso vecchio non e' piu
  // interpretabile: meglio ricominciarlo che servire slot inesistenti.
  if (p && (p.argomenti || []).join("|") !== argomenti.join("|")) p = null;

  const avvia = () => {
    dati.percorsi[mid] = P.nuovo(argomenti);
    salva();
    vistaPercorso(mid);
  };

  if (!p) {
    app.innerHTML = `
      <div class="nav"><a href="#/m/${mid}">‹ ${m.titolo}</a></div>
      <h1>Percorso di apprendimento</h1>
      <p>Un esercizio per comando, a rotazione. Se sbagli, quel comando torna con
      un esercizio in piu alla fine del ciclo successivo. Il percorso si chiude con
      due cicli puliti di fila, il secondo tutto di scrittura.</p>
      <p class="muto">${argomenti.length} comandi in questo modulo:
      ${m.raccolte.map((r) => `<code>${r.comando}</code>`).join(" ")}</p>
      <p class="muto">Percorso perfetto: ${argomenti.length * 2} esercizi. Ogni errore lo allunga.</p>
      <div class="riga"><button class="primario" id="via">Inizia il percorso</button></div>`;
    app.querySelector("#via").onclick = avvia;
    return;
  }

  const pct = P.percentuale(p);
  const testata = `
    <div class="nav">
      <a href="#/m/${mid}">‹ ${m.titolo}</a>
      <span class="muto">ciclo ${p.ciclo}${p.chiusura ? " · chiusura" : ""}
        <button id="azzera" class="minuscolo">azzera</button></span>
    </div>
    <div class="barra grande"><i style="width:${pct}%"></i></div>
    <p class="muto" id="stato-percorso">${pct}% · ${p.fatti} di ${P.proiezione(p)} esercizi previsti</p>`;

  if (p.completo) {
    app.innerHTML = `
      ${testata}
      <h1>Percorso completato</h1>
      <p>Due cicli puliti di fila, il secondo tutto di scrittura. Hai fatto
      <strong>${p.fatti}</strong> esercizi su un minimo teorico di ${argomenti.length * 2}.</p>
      <div class="riga"><button id="via">Ricomincia</button>
      <a class="btn" href="#/m/${mid}">Torna al modulo</a></div>`;
    app.querySelector("#via").onclick = avvia;
    return;
  }

  const slot = P.prossimo(p);
  const r = m.raccolte.find((x) => x.id === slot.arg);
  const es = scegliEsercizio(m, slot, p);

  const avanti = (azioni) => {
    const b = document.createElement("button");
    b.className = "primario";
    b.textContent = "Avanti ›";
    b.onclick = () => vistaPercorso(mid);
    azioni.appendChild(b);
  };

  // montaEsercizio riscrive tutta la pagina, quindi il pulsante di azzeramento
  // va ricollegato dopo ogni render.
  const collegaAzzera = () => {
    const b = app.querySelector("#azzera");
    if (!b) return;
    b.onclick = () => {
      if (!confirm("Azzerare il percorso e ricominciare dal primo ciclo?")) return;
      delete dati.percorsi[mid];
      salva();
      vistaPercorso(mid);
    };
  };

  // L'intestazione e' costruita prima della risposta: senza questo aggiornamento
  // resterebbe indietro di un esercizio, e non vedresti mai la barra scendere
  // proprio nel momento in cui sbagli.
  const aggiornaTestata = () => {
    const nuovaPct = P.percentuale(p);
    const barra = app.querySelector(".barra.grande > i");
    const riga = app.querySelector("#stato-percorso");
    if (barra) barra.style.width = nuovaPct + "%";
    if (riga) {
      const delta = nuovaPct - pct;
      const segno = delta < 0 ? ` (${delta.toFixed(1)})` : "";
      riga.textContent = `${nuovaPct}%${segno} · ${p.fatti} di ${P.proiezione(p)} esercizi previsti`;
      riga.classList.toggle("giu", delta < 0);
    }
  };

  montaEsercizio({
    mid,
    m,
    es,
    unTentativo: true,
    testata:
      testata +
      `<p class="muto">Comando in prova: <code>${r.comando}</code>${
        slot.tipo === "write" ? " · esercizio di scrittura" : ""
      }</p>`,
    dopoCorretto: (azioni) => {
      P.rispondi(p, true);
      p.usati[es.id] = p.fatti;
      salva();
      aggiornaTestata();
      avanti(azioni);
    },
    dopoSbagliato: (azioni) => {
      P.rispondi(p, false);
      p.usati[es.id] = p.fatti;
      salva();
      aggiornaTestata();
      const nota = document.createElement("p");
      nota.className = "muto";
      nota.textContent = `${r.comando} tornera con un esercizio in piu alla fine del prossimo ciclo.`;
      azioni.parentElement.insertBefore(nota, azioni);
      avanti(azioni);
    },
  });

  collegaAzzera();
}

async function vistaRaccolta(mid, rid) {
  const m = await modulo(mid);
  const r = m.raccolte.find((x) => x.id === rid);
  if (!r) throw new Error("Raccolta sconosciuta: " + rid);

  const es = r.esercizi
    .map((e, i) => {
      const s = stato(e.id);
      return `<a class="card" href="#/e/${mid}/${e.id}">
        <span class="pill ${classePill(s)}">${etichetta(s)}</span>
        <strong> ${i + 1}.</strong> ${primaRiga(e.testo)}
      </a>`;
    })
    .join("");

  app.innerHTML = `
    <div class="nav"><a href="#/m/${mid}">‹ ${m.titolo}</a></div>
    <h1><code>${r.comando}</code></h1>
    <p class="muto">${r.titolo}</p>
    ${es}`;
}

async function vistaLezione(mid, lid) {
  const m = await modulo(mid);
  const i = m.lezioni.findIndex((l) => l.id === lid);
  const l = m.lezioni[i];
  const dopo = m.lezioni[i + 1]
    ? `<a class="btn" href="#/l/${mid}/${m.lezioni[i + 1].id}">Lezione successiva ›</a>`
    : `<a class="btn" href="#/e/${mid}/${m.esercizi[0].id}">Vai agli esercizi ›</a>`;

  app.innerHTML = `
    <div class="nav"><a href="#/m/${mid}">‹ ${m.titolo}</a><span class="muto">${i + 1}/${m.lezioni.length}</span></div>
    <h1>${l.titolo}</h1>
    ${md(l.md)}
    ${l.demo ? `<h3>Provalo</h3><pre><code id="demo">${escapeHtml(l.demo)}</code></pre>
      <div class="riga"><button id="run">Esegui</button></div><div id="out"></div>` : ""}
    <p class="riga" style="margin-top:2rem">${dopo}</p>`;

  const run = app.querySelector("#run");
  if (run)
    run.onclick = async () => {
      run.disabled = true;
      run.textContent = "Eseguo…";
      const r = await R.run(l.demo);
      app.querySelector("#out").innerHTML =
        `<div class="esito ${r.ok ? "" : "ko"}"><pre><code>${escapeHtml(r.out || r.err || "(nessun output)")}</code></pre></div>`;
      run.disabled = false;
      run.textContent = "Esegui di nuovo";
    };
}

async function vistaRipasso() {
  modoRipasso = true;
  const p = L.pickNext(stati);
  if (!p) {
    app.innerHTML = `<div class="nav"><a href="#/">‹ Moduli</a></div>
      <h1>Niente da ripassare</h1><p>Tutto quello che hai provato è padroneggiato.</p>`;
    return;
  }
  location.hash = `#/e/${p.id.slice(0, 3)}/${p.id}`;
}

async function vistaEsercizio(mid, eid) {
  const m = await modulo(mid);
  const es = m.esercizi.find((e) => e.id === eid);
  if (!es) throw new Error("Esercizio sconosciuto: " + eid);
  const s = stato(eid);

  montaEsercizio({
    mid,
    m,
    es,
    testata: `<div class="nav">
        <a href="#/m/${mid}">‹ ${m.titolo}</a>
        <span class="pill ${classePill(s)}">${etichetta(s)}</span>
      </div>`,
    conSoluzione: true,
    dopoCorretto: (azioni) => azioni.appendChild(bottoneAvanti(m, mid, es)),
  });
}

/**
 * Corpo di un esercizio: testo, zona di risposta, suggerimenti, verifica.
 * Condiviso fra esercizio libero e percorso, che differiscono solo in cosa
 * succede dopo la risposta.
 *
 * unTentativo: nel percorso la risposta conta una volta sola, e uno sbaglio
 * mostra subito la soluzione invece di lasciar riprovare.
 * conSoluzione: negli esercizi liberi la soluzione si puo aprire quando vuoi,
 * senza dover prima sbagliare.
 */
function montaEsercizio({
  mid, m, es, testata,
  unTentativo = false, conSoluzione = false,
  dopoCorretto, dopoSbagliato,
}) {
  const eid = es.id;
  let hint = 0;
  let chiuso = false;

  app.innerHTML = `
    ${testata}
    <div>${md(es.testo)}</div>
    <div id="zona"></div>
    <div id="esito"></div>
    <div class="riga" id="azioni"></div>`;

  const zona = app.querySelector("#zona");
  const esito = app.querySelector("#esito");
  const azioni = app.querySelector("#azioni");

  if (es.tipo === "predict") {
    zona.innerHTML = es.opzioni
      .map((o, i) => `<label class="card riga"><input type="radio" name="op" value="${i}"> <code>${escapeHtml(o)}</code></label>`)
      .join("");
  } else {
    zona.innerHTML = `
      ${es.setup ? `<p class="muto">Dati forniti, gia caricati:</p><pre><code>${escapeHtml(es.setup)}</code></pre>` : ""}
      <textarea id="ed" spellcheck="false" autocapitalize="off" autocorrect="off" autocomplete="off">${escapeHtml(es.starter || "")}</textarea>
      <div class="simboli">${SIMBOLI.map((x) => `<button data-s="${escapeHtml(x)}">${escapeHtml(x.trim() || "tab")}</button>`).join("")}</div>`;
    const ed = zona.querySelector("#ed");
    zona.querySelectorAll(".simboli button").forEach((b) => {
      b.onclick = () => inserisci(ed, b.dataset.s);
    });
  }

  azioni.innerHTML = `<button class="primario" id="ver">Verifica</button>
    ${es.hint?.length ? `<button id="hint">Suggerimento</button>` : ""}
    ${conSoluzione && es.soluzione ? `<button id="sol">Soluzione</button>` : ""}`;

  const btnHint = azioni.querySelector("#hint");
  if (btnHint)
    btnHint.onclick = () => {
      if (hint >= es.hint.length) return;
      esito.insertAdjacentHTML("beforebegin", `<div class="card muto">${md(es.hint[hint])}</div>`);
      hint++;
      if (hint >= es.hint.length) btnHint.disabled = true;
    };

  const btnSol = azioni.querySelector("#sol");
  if (btnSol)
    btnSol.onclick = () => {
      btnSol.disabled = true;
      // Aprire la soluzione conta come essersi fatti aiutare: l'esercizio
      // non viene dato per saputo solo perche' hai ricopiato la risposta.
      hint = Math.max(hint, 1);
      esito.insertAdjacentHTML(
        "beforebegin",
        `<div class="card"><p class="muto">Soluzione</p>
         <pre><code>${escapeHtml(es.soluzione)}</code></pre>
         ${md(es.spiegazione || "")}</div>`
      );
    };

  azioni.querySelector("#ver").onclick = async () => {
    if (chiuso) return;
    const btn = azioni.querySelector("#ver");
    btn.disabled = true;

    let ok, dettaglio = "";
    if (es.tipo === "predict") {
      const sel = zona.querySelector("input[name=op]:checked");
      if (!sel) { btn.disabled = false; return; }
      ok = es.opzioni[+sel.value] === es.risposta;
    } else {
      btn.textContent = "Eseguo…";
      const codice = (es.setup ? es.setup + "\n" : "") + zona.querySelector("#ed").value;
      const r = await R.run(codice, es.test);
      ok = r.ok;
      if (r.out) dettaglio += `<pre><code>${escapeHtml(r.out)}</code></pre>`;
      if (r.err) dettaglio += `<pre><code>${escapeHtml(r.err)}</code></pre>`;
      btn.textContent = "Verifica";
    }

    // Rileggi lo stato: puoi verificare piu volte nella stessa schermata,
    // e ogni tentativo deve partire da quello aggiornato, non dallo snapshot del render.
    stati[eid] = L.grade(stato(eid), ok, hint);
    if (m.cantiere) stati[eid].fuoriRipasso = true;
    salva();

    esito.innerHTML = ok
      ? `<div class="esito ok"><strong>Corretto.</strong>${hint ? " (con suggerimento: torna in coda di ripasso)" : ""}
         ${dettaglio}</div>${md(es.spiegazione || "")}`
      : `<div class="esito ko"><strong>Non ancora.</strong>${
          unTentativo ? "" : " Questo esercizio torna in fondo alla coda."
        }${dettaglio}</div>`;

    if (ok) {
      chiuso = true;
      azioni.innerHTML = "";
      dopoCorretto?.(azioni);
      return;
    }

    if (unTentativo) {
      // Nel percorso non si riprova: la risposta e' gia stata registrata, quindi
      // tanto vale mostrare subito soluzione e spiegazione.
      chiuso = true;
      esito.insertAdjacentHTML(
        "beforeend",
        `<pre><code>${escapeHtml(es.soluzione || "")}</code></pre>${md(es.spiegazione || "")}`
      );
      azioni.innerHTML = "";
      dopoSbagliato?.(azioni);
      return;
    }

    btn.disabled = false;
    if (!es.soluzione || hint < (es.hint?.length || 0)) return;
    const sol = document.createElement("button");
    sol.textContent = "Mostra la soluzione";
    sol.onclick = () => {
      sol.remove();
      esito.insertAdjacentHTML("beforeend",
        `<pre><code>${escapeHtml(es.soluzione)}</code></pre>${md(es.spiegazione || "")}`);
    };
    azioni.appendChild(sol);
  };
}

function bottoneAvanti(m, mid, es) {
  const b = document.createElement("button");
  b.className = "primario";
  if (modoRipasso) {
    const p = L.pickNext(stati, es.id);
    b.textContent = p ? "Prossimo ripasso ›" : "Ripasso finito ›";
    b.onclick = () => (location.hash = p ? `#/e/${p.id.slice(0, 3)}/${p.id}` : "#/");
  } else {
    const i = m.esercizi.findIndex((x) => x.id === es.id);
    const next = m.esercizi[i + 1];
    b.textContent = next ? "Esercizio successivo ›" : "Fine modulo ›";
    b.onclick = () => (location.hash = next ? `#/e/${mid}/${next.id}` : `#/m/${mid}`);
  }
  return b;
}

// ---------- utilità ----------

const SIMBOLI = ["[", "]", "(", ")", ":", ",", "=", "*", "@", "np.", ".shape", "    "];

function inserisci(ta, testo) {
  const i = ta.selectionStart, j = ta.selectionEnd;
  ta.value = ta.value.slice(0, i) + testo + ta.value.slice(j);
  ta.selectionStart = ta.selectionEnd = i + testo.length;
  ta.focus();
}

// Nella lista degli esercizi si dice solo a che punto sei, non quanto hai
// sbagliato: contare gli errori davanti a chi studia non aiuta nessuno.
const etichetta = (s) => (s.fatto ? "fatto" : s.tentativi === 0 ? "nuovo" : "aperto");
const classePill = (s) => (s.fatto ? "ok" : s.tentativi ? "warn" : "");

const escapeHtml = (s = "") =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const primaRiga = (t = "") =>
  escapeHtml(t.split("\n")[0].replace(/\*\*/g, "").replace(/`/g, "").slice(0, 80));
