import { md } from "./md.js";
import * as R from "./runner.js";
import * as S from "./storage.js";
import * as L from "./scheduler.js";

const app = document.getElementById("app");
const barra = document.getElementById("stato");

let indice = null;
const cache = {};
let stati = S.load();
let modoRipasso = false;

const stato = (id) => (stati[id] ||= L.newState(id));
const salva = () => S.save(stati);

async function modulo(id) {
  if (cache[id]) return cache[id];
  const meta = indice.moduli.find((m) => m.id === id);
  if (!meta) throw new Error("Modulo sconosciuto: " + id);
  const r = await fetch("content/" + meta.file);
  if (!r.ok) throw new Error("Contenuto non trovato: " + meta.file);
  return (cache[id] = await r.json());
}

// ---------- avvio ----------

(async function init() {
  indice = await (await fetch("content/index.json")).json();
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
  const righe = await Promise.all(
    indice.moduli.map(async (m) => {
      if (!m.disponibile)
        return `<div class="card muto">${m.titolo} <span class="pill">in arrivo</span></div>`;
      const mod = await modulo(m.id);
      const pr = L.progress(stati, mod.esercizi.map((e) => e.id));
      return `<a class="card" href="#/m/${m.id}">
        <strong>${m.titolo}</strong>
        <div class="muto">${pr.done} / ${pr.tot} esercizi padroneggiati</div>
        <div class="barra"><i style="width:${Math.round(pr.pct * 100)}%"></i></div>
      </a>`;
    })
  );

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
    <h2>Progressi</h2>
    <p class="muto">Salvati in questo browser. Esportali per spostarli sul telefono.</p>
    <p class="muto" id="sw"></p>
    <div class="riga">
      <button id="exp">Esporta</button>
      <button id="imp">Importa</button>
      <input type="file" id="file" accept="application/json" hidden>
    </div>`;

  mostraSw();
  app.querySelector("#exp").onclick = () => S.esporta(stati);
  app.querySelector("#imp").onclick = () => app.querySelector("#file").click();
  app.querySelector("#file").onchange = (ev) => {
    const f = ev.target.files[0];
    if (f) S.importa(f).then((d) => { stati = d; salva(); route(); }).catch((e) => alert(e.message));
  };
}

async function vistaModulo(id) {
  modoRipasso = false;
  const m = await modulo(id);
  const lez = m.lezioni
    .map((l, i) => `<a class="card" href="#/l/${id}/${l.id}"><strong>${i + 1}. ${l.titolo}</strong></a>`)
    .join("");
  const es = m.esercizi
    .map((e, i) => {
      const s = stato(e.id);
      return `<a class="card" href="#/e/${id}/${e.id}">
        <span class="pill ${L.isMastered(s) ? "ok" : s.errori ? "warn" : ""}">${etichetta(s)}</span>
        <strong> ${i + 1}.</strong> ${primaRiga(e.testo)}
      </a>`;
    })
    .join("");

  app.innerHTML = `
    <div class="nav"><a href="#/">‹ Moduli</a></div>
    <h1>${m.titolo}</h1>
    <p>${m.perche}</p>
    <p class="muto">${m.funzioni.map((f) => `<code>${f}</code>`).join(" ")}</p>
    <h2>Lezioni</h2>${lez}
    <h2>Esercizi</h2>${es}`;
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
  let hint = 0;
  let chiuso = false;

  app.innerHTML = `
    <div class="nav">
      <a href="#/m/${mid}">‹ ${m.titolo}</a>
      <span class="pill ${L.isMastered(s) ? "ok" : ""}">${etichetta(s)}</span>
    </div>
    ${L.isLeech(s) && !L.isMastered(s)
      ? `<div class="esito ko">Hai sbagliato questo esercizio ${s.errori} volte.
         Il problema è il concetto, non l'esercizio: <a href="#/m/${mid}">rileggi le lezioni del modulo</a> prima di riprovare.</div>`
      : ""}
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
    ${es.hint?.length ? `<button id="hint">Suggerimento</button>` : ""}`;

  const btnHint = azioni.querySelector("#hint");
  if (btnHint)
    btnHint.onclick = () => {
      if (hint >= es.hint.length) return;
      esito.insertAdjacentHTML("beforebegin", `<div class="card muto">${md(es.hint[hint])}</div>`);
      hint++;
      if (hint >= es.hint.length) btnHint.disabled = true;
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
    salva();

    esito.innerHTML = ok
      ? `<div class="esito ok"><strong>Corretto.</strong>${hint ? " (con suggerimento: torna in coda di ripasso)" : ""}
         ${dettaglio}</div>${md(es.spiegazione || "")}`
      : `<div class="esito ko"><strong>Non ancora.</strong> Questo esercizio torna in fondo alla coda.${dettaglio}</div>`;

    if (ok) {
      chiuso = true;
      azioni.innerHTML = "";
      azioni.appendChild(bottoneAvanti(m, mid, es));
    } else {
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
    }
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

const etichetta = (s) =>
  L.isMastered(s) ? "fatto" : s.tentativi === 0 ? "nuovo" : `box ${s.box}/${L.MASTERED}`;

const escapeHtml = (s = "") =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const primaRiga = (t = "") =>
  escapeHtml(t.split("\n")[0].replace(/\*\*/g, "").slice(0, 80));
