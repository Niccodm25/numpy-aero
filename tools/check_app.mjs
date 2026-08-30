// Integrita' dell'app: gli import si risolvono, il service worker li cachea
// tutti, e i moduli chiave esportano ancora quello che l'app chiama.
//
// Esiste per un guasto vero: js/storage.js (progressi) e' stato sovrascritto da
// un simulatore di dischi, S.load() e' sparito e l'app e' diventata una pagina
// bianca. I test del contenuto non potevano accorgersene: nessuno di loro carica
// l'app.
//
//     node tools/check_app.mjs

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const radice = resolve(import.meta.dirname, "..");
const leggi = (p) => readFileSync(join(radice, p), "utf8");

let problemi = 0;
const guasto = (m) => {
  console.log("  " + m);
  problemi++;
};

// 1. Ogni import relativo punta a un file che esiste.
const moduli = ["js/app.js", "js/sw-nessuno"].slice(0, 1);
const visti = new Set();
const coda = [...moduli];
while (coda.length) {
  const f = coda.pop();
  if (visti.has(f) || !existsSync(join(radice, f))) {
    if (!existsSync(join(radice, f))) guasto(`${f}: importato ma non esiste`);
    continue;
  }
  visti.add(f);
  for (const [, rel] of leggi(f).matchAll(/from\s+"(\.[^"]+)"/g)) {
    coda.push(join(dirname(f), rel).replace(/\\/g, "/"));
  }
}

// 2. Il service worker precachea tutto quello che l'app importa: quello che
//    manca funziona online e lascia la pagina bianca offline.
const sw = leggi("sw.js");
const precache = new Set([...sw.matchAll(/"(js\/[^"]+|content\/[^"]+)"/g)].map((m) => m[1]));
for (const f of visti) if (!precache.has(f)) guasto(`${f}: importato dall'app ma non nel PRECACHE di sw.js`);

// 3. I moduli che l'app usa per cose non visibili subito esportano ancora
//    quello che serve. Una pagina bianca vale piu' di un test rosso.
const attese = {
  "js/storage.js": ["load", "save", "esporta", "importa"],
  "js/scheduler.js": ["grade", "progress", "reviewQueue"],
  "js/traguardi.js": ["montaTendine", "togliTendine"],
  "js/shell.js": ["creaShell", "esegui", "verifica"],
};
for (const [file, nomi] of Object.entries(attese)) {
  if (!existsSync(join(radice, file))) {
    guasto(`${file}: manca`);
    continue;
  }
  const testo = leggi(file);
  for (const n of nomi)
    if (!new RegExp(`export\\s+(async\\s+)?(function|const|let)\\s+${n}\\b`).test(testo))
      guasto(`${file}: non esporta piu' ${n}()`);
}

// 4. Ogni modulo dichiarato disponibile nell'indice ha il suo file.
const indice = JSON.parse(leggi("content/index.json"));
for (const m of indice.moduli) {
  if (!m.disponibile) continue;
  if (!m.file || !existsSync(join(radice, "content", m.file)))
    guasto(`indice: ${m.id} e' disponibile ma ${m.file || "(nessun file)"} non esiste`);
}
const idsIndice = new Set(indice.moduli.map((m) => m.id));
for (const r of indice.rami || [])
  for (const id of r.moduli)
    if (!idsIndice.has(id)) guasto(`ramo ${r.id}: elenca ${id}, che non e' nei moduli`);

// 5. I traguardi puntano a moduli che esistono nell'indice.
if (existsSync(join(radice, "content/traguardi.json"))) {
  const tr = JSON.parse(leggi("content/traguardi.json"));
  const rami = new Set((indice.rami || []).map((r) => r.id));
  for (const t of tr.traguardi) {
    if (!rami.has(t.ramo)) guasto(`traguardo ${t.id}: ramo sconosciuto "${t.ramo}"`);
    for (const id of t.richiede)
      if (!idsIndice.has(id)) guasto(`traguardo ${t.id}: richiede ${id}, che non e' nell'indice`);
  }
}

console.log(problemi ? `${problemi} problemi` : `app integra: ${visti.size} moduli, tutti nel precache`);
process.exit(problemi ? 1 : 0);
