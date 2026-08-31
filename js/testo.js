// Trasformare il testo: colonne, sostituzioni, campi, liste.
//
// Non e' awk, non e' sed: e' il sottoinsieme che si usa davvero su log e CSV, e
// il confine e' dichiarato — quando un esercizio chiede piu' di questo, la
// lezione dice di passare a Python. Un simulatore che accetta qualunque
// programma awk e ne esegue meta' insegnerebbe una bugia.
//
// Coperto: cut -d -f, tr (anche -d), tee (anche -a), sed s/// e /x/d anche con
// -i, awk con -F, i campi $1..$9, NF, NR, una condizione sola, e la somma con
// END. xargs con -n1 e -I{}.

import * as V from "./vfs.js";

const righe = (s) => (s === "" ? [] : String(s).replace(/\n$/, "").split("\n"));

function ingresso(sh, file) {
  if (file) return V.leggi(sh.fs, file);
  if (sh.stdin === null || sh.stdin === undefined)
    throw new V.ErroreFs("manca il file o una pipe in ingresso");
  return typeof sh.stdin === "string" ? sh.stdin : String(sh.stdin);
}

/** Il valore di un'opzione, sia staccato (-d ,) sia attaccato (-d,): sulla riga
 *  di comando vera si scrivono tutte e due, e chi impara le trova entrambe. */
function valoreOpzione(args, lettera) {
  const i = args.findIndex((a) => a === `-${lettera}` || a.startsWith(`-${lettera}`));
  if (i < 0) return { valore: null, usati: [] };
  if (args[i] === `-${lettera}`) return { valore: args[i + 1], usati: [i, i + 1] };
  return { valore: args[i].slice(2), usati: [i] };
}

function resto(args, ...usati) {
  const fuori = new Set(usati.flat());
  return args.filter((a, i) => !fuori.has(i) && !a.startsWith("-"));
}

/** "2", "1,3" e "2-4" sono tutte forme di -f. */
function campiDa(spec) {
  const out = [];
  for (const pezzo of String(spec).split(",")) {
    const [da, a] = pezzo.split("-").map(Number);
    if (Number.isNaN(da)) throw new V.ErroreFs("usa -f con numeri di campo, da 1 in poi");
    for (let n = da; n <= (a || da); n++) out.push(n);
  }
  return out;
}

export const TESTO = {
  cut(sh, args) {
    const d = valoreOpzione(args, "d");
    const f = valoreOpzione(args, "f");
    if (!f.valore) throw new V.ErroreFs("serve -f con il numero del campo");
    const sep = d.valore ?? "\t";
    const campi = campiDa(f.valore);
    const file = resto(args, d.usati, f.usati).at(-1);
    return righe(ingresso(sh, file))
      .map((r) => campi.map((n) => r.split(sep)[n - 1] ?? "").join(sep))
      .join("\n");
  },

  tr(sh, args) {
    const puliti = args.filter((a) => !a.startsWith("-"));
    const espandi = (x) =>
      x === "a-z" ? "abcdefghijklmnopqrstuvwxyz"
        : x === "A-Z" ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
          : x === "0-9" ? "0123456789"
            : x;
    const testo = ingresso(sh);
    if (args.includes("-d")) {
      const via = espandi(puliti[0] ?? "");
      return testo.split("").filter((c) => !via.includes(c)).join("");
    }
    if (puliti.length < 2) throw new V.ErroreFs("servono i due insiemi di caratteri");
    const [da, a] = puliti.map(espandi);
    return testo
      .split("")
      .map((c) => {
        const i = da.indexOf(c);
        return i < 0 ? c : a[i] ?? a.at(-1);
      })
      .join("");
  },

  // tee scrive E lascia passare: serve quando vuoi guardare quello che stai
  // salvando, o salvare a meta' di una pipeline.
  tee(sh, args) {
    const file = args.filter((a) => !a.startsWith("-"))[0];
    if (!file) throw new V.ErroreFs("manca il file");
    const testo = ingresso(sh);
    const conACapo = testo.endsWith("\n") || testo === "" ? testo : testo + "\n";
    if (args.includes("-a")) V.aggiungi(sh.fs, file, conACapo);
    else V.scrivi(sh.fs, file, conACapo);
    return testo;
  },

  /**
   * sed: sostituzione s/vecchio/nuovo/[g] e cancellazione /motivo/d.
   * Con -i riscrive il file invece di stampare — ed e' il momento in cui una
   * distrazione diventa un file rovinato, quindi l'esercizio ci passa sopra.
   */
  sed(sh, args) {
    const inPosto = args.includes("-i");
    const puliti = args.filter((a) => !a.startsWith("-"));
    const spec = puliti[0];
    const file = puliti[1];
    if (!spec) throw new V.ErroreFs("manca il programma, per esempio s/vecchio/nuovo/");

    const sostituzione = spec.match(/^s(.)(.*?)\1(.*?)\1(g?)$/);
    const cancella = spec.match(/^\/(.*)\/d$/);
    if (!sostituzione && !cancella)
      throw new V.ErroreFs("qui sono supportate solo s/vecchio/nuovo/[g] e /motivo/d");

    const dentro = righe(ingresso(sh, file));
    const fuori = cancella
      ? dentro.filter((r) => !r.includes(cancella[1]))
      : dentro.map((r) =>
          sostituzione[4]
            ? r.split(sostituzione[2]).join(sostituzione[3])
            : r.replace(sostituzione[2], sostituzione[3])
        );

    const testo = fuori.join("\n");
    if (inPosto) {
      if (!file) throw new V.ErroreFs("-i vuole un file, non una pipe");
      V.scrivi(sh.fs, file, testo + "\n");
      return "";
    }
    return testo;
  },

  /**
   * awk ridotto all'osso ma vero: separatore, campi, NR, NF, una condizione, e
   * la somma con END. Sono le quattro cose per cui lo si usa davvero su un CSV.
   */
  awk(sh, args) {
    const F = valoreOpzione(args, "F");
    const puliti = resto(args, F.usati);
    const programma = puliti[0];
    const file = puliti[1];
    if (!programma) throw new V.ErroreFs("manca il programma fra apici");
    const sep = F.valore ?? null;

    const campi = (r) => (sep ? r.split(sep) : r.trim().split(/\s+/));
    const valore = (nome, r, n) => {
      if (nome === "NR") return n;
      if (nome === "NF") return campi(r).length;
      if (nome.startsWith("$")) {
        const i = Number(nome.slice(1));
        return i === 0 ? r : campi(r)[i - 1] ?? "";
      }
      return nome.replace(/^["']|["']$/g, "");
    };

    // somma: '{s += $2} END {print s}'
    const somma = programma.match(/^\{\s*\w+\s*\+=\s*\$(\d+)\s*\}\s*END\s*\{\s*print\s+\w+\s*\}$/);
    if (somma) {
      const n = Number(somma[1]);
      let tot = 0;
      for (const r of righe(ingresso(sh, file))) {
        const v = parseFloat(campi(r)[n - 1]);
        if (!Number.isNaN(v)) tot += v;
      }
      return String(Number.isInteger(tot) ? tot : Number(tot.toFixed(6)));
    }

    // [condizione] {print ...}
    const m = programma.match(/^\s*(.*?)\s*\{\s*print\s+(.*?)\s*\}\s*$/);
    if (!m) throw new V.ErroreFs("qui sono supportati {print ...}, una condizione, e la somma con END");
    const [, condizione, stampa] = m;

    const passa = (r, n) => {
      if (!condizione) return true;
      const regex = condizione.match(/^\/(.*)\/$/);
      if (regex) return new RegExp(regex[1]).test(r);
      const cmp = condizione.match(/^(\S+)\s*(==|!=|>=|<=|>|<)\s*(\S+)$/);
      if (!cmp) throw new V.ErroreFs(`condizione non supportata: ${condizione}`);
      const a = valore(cmp[1], r, n);
      const b = valore(cmp[3], r, n);
      const numerico = !Number.isNaN(parseFloat(a)) && !Number.isNaN(parseFloat(b));
      const x = numerico ? parseFloat(a) : String(a);
      const y = numerico ? parseFloat(b) : String(b);
      switch (cmp[2]) {
        case "==": return x === y;
        case "!=": return x !== y;
        case ">": return x > y;
        case "<": return x < y;
        case ">=": return x >= y;
        default: return x <= y;
      }
    };

    return righe(ingresso(sh, file))
      .map((r, i) => [r, i + 1])
      .filter(([r, n]) => passa(r, n))
      .map(([r, n]) => stampa.split(/\s*,\s*/).map((c) => valore(c, r, n)).join(" "))
      .join("\n");
  },

  /**
   * xargs: la lista in ingresso diventa argomenti di un comando.
   * -n1 lo lancia una volta per elemento, -I{} decide dove va l'elemento —
   * senza, finisce sempre in fondo, e su `mv` e' il modo di rovinare tutto.
   */
  xargs(sh, args) {
    const I = valoreOpzione(args, "I");
    const unoAllaVolta = args.includes("-n1") || args.includes("-n");
    const puliti = resto(args, I.usati).filter((a) => a !== "1");
    const comando = puliti[0];
    if (!comando) throw new V.ErroreFs("manca il comando da eseguire");
    if (!sh.comandi[comando]) throw new V.ErroreFs(`${comando}: comando non trovato`);

    const valori = ingresso(sh).trim().split(/\s+/).filter(Boolean);
    if (!valori.length) return "";
    const argomentiFissi = puliti.slice(1);

    const lancia = (elementi) => {
      const finali = I.valore
        ? argomentiFissi.map((a) => (a === I.valore ? elementi[0] : a))
        : [...argomentiFissi, ...elementi];
      return sh.comandi[comando](sh, finali) ?? "";
    };

    const uscite = unoAllaVolta || I.valore
      ? valori.map((v) => lancia([v]))
      : [lancia(valori)];
    return uscite.filter((u) => u !== "").join("\n");
  },
};
