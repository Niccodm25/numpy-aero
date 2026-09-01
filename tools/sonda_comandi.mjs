// Sonda i comandi simulati: cerca quelli che accettano un argomento sbagliato
// senza accorgersene.
//
//     node tools/sonda_comandi.mjs           # solo il riassunto
//     node tools/sonda_comandi.mjs --tutto   # ogni caso, uno per riga
//
// Due prove, su ogni esercizio di terminale gia' presente nel contenuto:
//
//   1. MUTAZIONE. Ogni argomento della soluzione viene sostituito con un valore
//      assurdo. Se l'uscita non cambia e la verifica passa lo stesso, quel
//      comando non sta leggendo quell'argomento: l'esercizio insegna una bugia.
//   2. OPZIONE IGNOTA. A ogni comando si aggiunge `-Zq`. Un comando vero
//      protesta; se qui risponde come se niente fosse, il simulatore sta
//      dicendo che le opzioni sbagliate vanno bene.
//
// ponytail: il cablaggio dei moduli e' copiato da test_shell.mjs invece che
// estratto in comune. Quel file e' la rete di sicurezza del motore e non si
// tocca per un tool di sola lettura; se serve un terzo copia-incolla, allora
// vale la pena estrarlo.

import { readFileSync } from "node:fs";
import { creaShell, eseguiTutto, dividi, verifica, POSIX } from "../js/shell.js";
import { AMBIENTI, AMBIENTI_CONDA, statoAmbienti } from "../js/ambienti.js";
import { comandiPowerShell } from "../js/powershell.js";
import { PROCESSI, PROCESSI_PS, statoProcessi } from "../js/processi.js";
import { SISTEMA, statoSistema } from "../js/sistema.js";
import { UTENTI, statoUtenti } from "../js/utenti.js";
import { TESTO } from "../js/testo.js";
import { RETE, statoRete } from "../js/rete.js";
import { REMOTO, statoRemoto } from "../js/remoto.js";
import { SERVIZI, statoServizi } from "../js/servizi.js";
import { HARDWARE, statoHardware } from "../js/hardware.js";
import { PRESTAZIONI, statoPrestazioni } from "../js/prestazioni.js";
import { DISCHI, statoDischi } from "../js/dischi.js";
import { CONTAINER, statoContainer } from "../js/container.js";
import { SICUREZZA, statoSicurezza } from "../js/sicurezza.js";
import { AUTOMAZIONE, statoAutomazione } from "../js/automazione.js";

const TUTTO = process.argv.includes("--tutto");
// --caso l17-df-3: mostra base e mutazione fianco a fianco, per capire perche'
const CASO = (process.argv.find((a) => a.startsWith("--caso=")) || "").slice(7);
// --uscita=ID: la trascrizione della soluzione giusta e quella della soluzione
// tutta rovinata, per scegliere una verifica che sappia distinguerle.
const USCITA = (process.argv.find((a) => a.startsWith("--uscita=")) || "").slice(9);
const CAPO = String.fromCharCode(10);

/** Prepara la shell dell'esercizio, con gli stessi moduli che monta l'app. */
function bancoDi(es) {
  let comandi =
    es.shell === "powershell"
      ? comandiPowerShell()
      : es.shell === "conda"
        ? AMBIENTI_CONDA
        : es.interpreti
          ? AMBIENTI
          : undefined;
  if (es.processi)
    comandi = {
      ...(comandi ?? POSIX),
      ...(es.shell === "powershell" ? PROCESSI_PS : PROCESSI),
    };
  if (es.sistema)
    comandi = {
      ...(comandi ?? POSIX),
      ...SISTEMA,
    };
  if (es.utenti)
    comandi = {
      ...(comandi ?? POSIX),
      ...UTENTI,
    };
  if (es.testoAvanzato)
    comandi = { ...(comandi ?? POSIX), ...TESTO };
  if (es.rete)
    comandi = { ...(comandi ?? POSIX), ...RETE };
  if (es.remoto)
    comandi = { ...(comandi ?? POSIX), ...REMOTO };
  if (es.servizi)
    comandi = { ...(comandi ?? POSIX), ...SERVIZI };
  if (es.hardware)
    comandi = { ...(comandi ?? POSIX), ...HARDWARE };
  if (es.prestazioni) comandi = { ...(comandi ?? POSIX), ...PRESTAZIONI };
  if (es.storage) comandi = { ...(comandi ?? POSIX), ...DISCHI };
  if (es.container) comandi = { ...(comandi ?? POSIX), ...CONTAINER };
  if (es.sicurezza) comandi = { ...(comandi ?? POSIX), ...SICUREZZA };
  if (es.automazione) comandi = { ...(comandi ?? POSIX), ...AUTOMAZIONE };
  const sh = creaShell(es.filesystem || {}, { cwd: es.cwd, env: es.env, comandi });
  if (es.interpreti) statoAmbienti(sh, es.interpreti);
  if (es.processi) statoProcessi(sh, es.processi === true ? undefined : es.processi);
  if (es.sistema) statoSistema(sh, es.sistema === true ? undefined : es.sistema);
  if (es.utenti) statoUtenti(sh, es.utenti === true ? undefined : es.utenti);
  if (es.rete) statoRete(sh, es.rete === true ? undefined : es.rete);
  if (es.remoto) statoRemoto(sh, es.remoto === true ? undefined : es.remoto);
  if (es.servizi) statoServizi(sh, es.servizi === true ? undefined : es.servizi);
  if (es.hardware) statoHardware(sh, es.hardware === true ? undefined : es.hardware);
  if (es.prestazioni) statoPrestazioni(sh, es.prestazioni === true ? undefined : es.prestazioni);
  if (es.storage) statoDischi(sh, es.storage === true ? undefined : es.storage);
  if (es.container) statoContainer(sh, es.container === true ? undefined : es.container);
  if (es.sicurezza) statoSicurezza(sh, es.sicurezza === true ? undefined : es.sicurezza);
  if (es.automazione) statoAutomazione(sh);
  return sh;
}

/** Uscita di tutte le righe, piu' l'esito della verifica. */
function prova(es, testo) {
  const sh = bancoDi(es);
  let t;
  try {
    t = eseguiTutto(sh, testo);
  } catch (e) {
    return { crash: String((e && e.message) || e), uscita: "", ok: false };
  }
  const perRiga = t.map((r) => (r.out ?? "") + (r.errore ?? ""));
  const uscita = perRiga.join(CAPO);
  try {
    return { crash: null, uscita, perRiga, ok: verifica(sh, es.verifica, t).ok };
  } catch (e) {
    return { crash: String((e && e.message) || e), uscita, perRiga, ok: false };
  }
}

/**
 * Un valore assurdo dello stesso tipo di quello che sostituisce: un numero
 * resta un numero, un percorso resta un percorso. Cambiare tipo farebbe
 * fallire il comando per il motivo sbagliato.
 */
function assurdo(tok) {
  if (tok.startsWith("-")) return null; // le opzioni non si mutano
  if (/^[0-9]+$/.test(tok)) return String(Number(tok) + 7);
  if (tok.startsWith("/")) return "/zibaldone/qui";
  if (tok.includes("=")) return tok.replace(/=.*$/, "=zibaldone");
  return "zibaldone";
}

const indice = JSON.parse(readFileSync(new URL("../content/index.json", import.meta.url)));
const bugie = [];
const deboli = new Map(); // esercizi che passano con la soluzione tutta rovinata
const cieche = [];
const crash = [];
let provati = 0;

for (const meta of indice.moduli) {
  if (!meta.disponibile) continue;
  const mod = JSON.parse(readFileSync(new URL("../content/" + meta.file, import.meta.url)));
  for (const g of mod.raccolte || [{ esercizi: mod.esercizi || [] }]) {
    for (const es of g.esercizi) {
      if (es.tipo !== "terminale" || !es.soluzione) continue;
      const base = prova(es, es.soluzione);
      if (base.crash) {
        crash.push([es.id, "(soluzione)", base.crash]);
        continue;
      }
      const righe = es.soluzione.split(CAPO);

      // Soluzione rovinata da cima a fondo: ogni argomento di ogni riga
      // sostituito. Se la verifica passa lo stesso, non sta controllando
      // niente — l'esercizio si supera senza risolverlo.
      const tutteRovinate = righe.map((riga) => {
        const parole = dividi(riga).parole;
        return parole
          .map((p, k) => (k === 0 ? p : (assurdo(p) ?? p)))
          .join(" ");
      });
      // Se non c'era niente da rovinare (`pwd`, `df -h`) non si conclude niente.
      const testoRovinato = tutteRovinate.join(CAPO);
      if (testoRovinato !== righe.map((r) => dividi(r).parole.join(" ")).join(CAPO)) {
        const rovinata = prova(es, testoRovinato);
        if (USCITA && es.id === USCITA) {
          console.log("giusta:  " + JSON.stringify(base.uscita));
          console.log("rovinata: " + JSON.stringify(rovinata.uscita));
          console.log("verifica: " + JSON.stringify(es.verifica));
        }
        if (!rovinata.crash && rovinata.ok) deboli.set(es.id, tutteRovinate.join(" ; "));
      }

      for (let i = 0; i < righe.length; i++) {
        const parole = dividi(righe[i]).parole;
        if (!parole.length) continue;
        const comando = parole[0];

        // 1. mutazione degli argomenti
        for (let k = 1; k < parole.length; k++) {
          const nuovo = assurdo(parole[k]);
          if (nuovo === null || nuovo === parole[k]) continue;
          const mutate = parole.slice();
          mutate[k] = nuovo;
          const alt = righe.slice();
          alt[i] = mutate.join(" ");
          provati++;
          const r = prova(es, alt.join(CAPO));
          if (CASO && es.id === CASO) {
            console.log("  " + alt[i] + "   [" + parole[k] + " -> " + nuovo + "]");
            console.log("      base:   " + JSON.stringify(base.uscita).slice(0, 160));
            console.log("      mutata: " + JSON.stringify(r.uscita).slice(0, 160) + "  verifica=" + r.ok);
          }
          if (r.crash) crash.push([es.id, alt[i], r.crash]);
          // Si guarda la riga mutata, non la trascrizione: se quella riga
          // gia' falliva per conto suo, l'argomento non c'entra niente.
          else if (
            r.uscita === base.uscita &&
            r.ok &&
            (base.perRiga[i] ?? "") === (r.perRiga[i] ?? "") &&
            !/^[a-z.-]+: /.test(base.perRiga[i] ?? "")
          ) {
            bugie.push([es.id, comando, parole[k], nuovo, righe[i]]);
          }
        }

        // 2. opzione ignota
        provati++;
        const conIgnota = righe.slice();
        conIgnota[i] = (comando + " -Zq " + parole.slice(1).join(" ")).trim();
        const r2 = prova(es, conIgnota.join(CAPO));
        if (r2.crash) crash.push([es.id, conIgnota[i], r2.crash]);
        else if (!/-Zq|opzione|invalid|sconosciut|unrecognized|illegal/i.test(r2.uscita)) {
          cieche.push([es.id, comando, righe[i]]);
        }
      }
    }
  }
}

const perComando = (lista) => {
  const m = new Map();
  for (const r of lista) m.set(r[1], (m.get(r[1]) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};

console.log(provati + " mutazioni provate");
console.log(CAPO + "ARGOMENTO IGNORATO — stessa risposta con un valore assurdo (" + bugie.length + ")");
for (const [c, n] of perComando(bugie)) console.log("  " + c.padEnd(16) + n);
console.log(CAPO + "OPZIONE IGNOTA ACCETTATA — `-Zq` non provoca nessuna protesta (" + cieche.length + ")");
for (const [c, n] of perComando(cieche)) console.log("  " + c.padEnd(16) + n);
console.log(CAPO + "VERIFICA VACUA — passa anche con la soluzione tutta rovinata (" + deboli.size + ")");
for (const [id, prima] of [...deboli].slice(0, TUTTO ? 1e9 : 40)) {
  console.log("  " + id.padEnd(12) + prima);
}

if (crash.length) {
  console.log(CAPO + "CRASH (" + crash.length + ")");
  for (const [id, riga, msg] of crash.slice(0, 40)) console.log("  " + id + "  " + riga + "  -> " + msg);
}
if (TUTTO) {
  console.log(CAPO + "--- dettaglio: argomento ignorato ---");
  for (const [id, , vecchio, nuovo, riga] of bugie) {
    console.log("  " + id + "  " + riga + "   [" + vecchio + " -> " + nuovo + "]");
  }
  console.log(CAPO + "--- dettaglio: opzione ignota accettata ---");
  for (const [id, , riga] of cieche) console.log("  " + id + "  " + riga);
}
