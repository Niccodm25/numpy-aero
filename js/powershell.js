// Cmdlet di PowerShell sopra lo stesso filesystem virtuale.
//
// La differenza da bash non e' la sintassi, e' cosa scorre nella pipeline:
// qui passano **oggetti** con dei campi, non righe di testo. Get-ChildItem non
// stampa un elenco, restituisce degli oggetti con Name, Length e Mode; e
// Where-Object filtra su quei campi senza dover ritagliare colonne.
//
// Il motore lo permette perche' un comando puo' restituire un array di oggetti
// invece di una stringa: la formattazione in tabella avviene solo alla fine,
// quando il valore deve andare a schermo.

import * as V from "./vfs.js";

// I percorsi si scrivono con la barra rovesciata, ma il filesystem sotto e' uno
// solo: si converte in ingresso e non se ne parla piu'. Anche PowerShell vero
// accetta entrambe le barre.
const perc = (p) => (p === undefined ? undefined : String(p).replace(/\\/g, "/"));

/** Gli argomenti nominati di un cmdlet: -Path x -Recurse -Name y */
function param(args) {
  const nominati = {};
  const posizionali = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("-")) { posizionali.push(a); continue; }
    const nome = a.slice(1);
    const prossimo = args[i + 1];
    if (prossimo === undefined || prossimo.startsWith("-")) nominati[nome] = true;
    else { nominati[nome] = prossimo; i++; }
  }
  return { nominati, posizionali };
}

/** Il valore di un parametro, cercandolo fra i nominati e poi per posizione. */
const arg = (p, nome, i = 0) => p.nominati[nome] ?? p.posizionali[i];

const righeDi = (t) => (t === "" ? [] : String(t).replace(/\n$/, "").split("\n"));

/** Cosa e' arrivato nella pipeline, sempre come array. */
function inPipe(sh) {
  const v = sh.stdin;
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return righeDi(v);
  return [v];
}

function elencoOggetti(sh, percorso, ricorsivo) {
  const abs = V.normalizza(sh.fs, perc(percorso) ?? ".");
  if (!sh.fs.nodi.has(abs)) throw new V.ErroreFs(`${percorso}: percorso non esistente`);
  const percorsi = ricorsivo
    ? V.sottoalbero(sh.fs, abs).filter((p) => p !== abs)
    : V.elenca(sh.fs, abs).map((n) => abs + (abs === "/" ? "" : "/") + n);
  return percorsi.map((p) => {
    const dir = V.eDir(sh.fs, p);
    return {
      Mode: dir ? "d----" : "-a---",
      Length: dir ? "" : V.leggi(sh.fs, p).length,
      Name: V.foglia(p),
      FullName: p,
    };
  });
}

const CONFRONTI = {
  eq: (a, b) => String(a) === String(b),
  ne: (a, b) => String(a) !== String(b),
  gt: (a, b) => Number(a) > Number(b),
  ge: (a, b) => Number(a) >= Number(b),
  lt: (a, b) => Number(a) < Number(b),
  le: (a, b) => Number(a) <= Number(b),
  like: (a, b) => new RegExp("^" + String(b).split("*").map(fuggi).join(".*") + "$", "i").test(String(a)),
  match: (a, b) => new RegExp(String(b), "i").test(String(a)),
};

const fuggi = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const POWERSHELL = {
  "Get-Location": (sh) => sh.fs.cwd,

  "Set-Location"(sh, args) {
    const p = param(args);
    const dove = perc(arg(p, "Path")) ?? V.HOME;
    const abs = V.normalizza(sh.fs, dove);
    if (!sh.fs.nodi.has(abs)) throw new V.ErroreFs(`${dove}: percorso non esistente`);
    if (!V.eDir(sh.fs, abs)) throw new V.ErroreFs(`${dove}: non e' un contenitore`);
    sh.fs.cwd = abs;
    return "";
  },

  "Get-ChildItem"(sh, args) {
    const p = param(args);
    const dove = arg(p, "Path");
    // Env: non e' una cartella: e' un "drive" che espone le variabili
    // d'ambiente con gli stessi cmdlet dei file. E' una delle idee piu' strane
    // di PowerShell e una delle piu' utili.
    if (/^env:/i.test(String(dove ?? "")))
      return Object.entries(sh.env).map(([Name, Value]) => ({ Name, Value }));
    return elencoOggetti(sh, dove, Boolean(p.nominati.Recurse));
  },

  "Get-Content"(sh, args) {
    const p = param(args);
    const file = perc(arg(p, "Path"));
    if (!file) throw new V.ErroreFs("manca il percorso");
    // Get-Content restituisce **un array di righe**, non una stringa unica:
    // e' il motivo per cui (Get-Content f).Count conta le righe.
    return righeDi(V.leggi(sh.fs, file));
  },

  "Set-Content"(sh, args) {
    const p = param(args);
    const file = perc(arg(p, "Path"));
    const valore = arg(p, "Value", 1) ?? "";
    if (!file) throw new V.ErroreFs("manca il percorso");
    V.scrivi(sh.fs, file, valore.endsWith("\n") ? valore : valore + "\n");
    return "";
  },

  "Add-Content"(sh, args) {
    const p = param(args);
    const file = perc(arg(p, "Path"));
    const valore = arg(p, "Value", 1) ?? "";
    if (!file) throw new V.ErroreFs("manca il percorso");
    V.aggiungi(sh.fs, file, valore.endsWith("\n") ? valore : valore + "\n");
    return "";
  },

  "New-Item"(sh, args) {
    const p = param(args);
    const percorso = perc(arg(p, "Path"));
    if (!percorso) throw new V.ErroreFs("manca il percorso");
    const tipo = p.nominati.ItemType ?? p.nominati.Type ?? "File";
    if (String(tipo).toLowerCase() === "directory") V.creaDir(sh.fs, percorso, true);
    else if (!V.esiste(sh.fs, percorso)) V.scrivi(sh.fs, percorso, "");
    return "";
  },

  "Remove-Item"(sh, args) {
    const p = param(args);
    const percorso = perc(arg(p, "Path"));
    if (!percorso) throw new V.ErroreFs("manca il percorso");
    if (!V.esiste(sh.fs, percorso)) {
      if (p.nominati.Force) return "";
      throw new V.ErroreFs(`${percorso}: percorso non esistente`);
    }
    V.rimuovi(sh.fs, percorso, Boolean(p.nominati.Recurse));
    return "";
  },

  "Copy-Item"(sh, args) {
    const p = param(args);
    const da = perc(arg(p, "Path"));
    const a = perc(arg(p, "Destination", 1));
    if (!da || !a) throw new V.ErroreFs("servono origine e destinazione");
    V.copia(sh.fs, da, a, Boolean(p.nominati.Recurse));
    return "";
  },

  "Move-Item"(sh, args) {
    const p = param(args);
    const da = perc(arg(p, "Path"));
    const a = perc(arg(p, "Destination", 1));
    if (!da || !a) throw new V.ErroreFs("servono origine e destinazione");
    V.sposta(sh.fs, da, a);
    return "";
  },

  /**
   * Where-Object nella forma semplificata: -Proprieta -operatore valore.
   * E' la sintassi introdotta in PowerShell 3, quella che si scrive davvero;
   * il blocco con $_ esiste ancora ed e' un'altra cosa da imparare.
   */
  "Where-Object"(sh, args) {
    const dati = inPipe(sh);
    if (dati === null) throw new V.ErroreFs("Where-Object lavora su quello che arriva dalla pipeline");
    const [proprieta, operatore, valore] = [args[0], (args[1] || "-eq").replace(/^-/, ""), args[2]];
    const test = CONFRONTI[operatore];
    if (!test) throw new V.ErroreFs(`operatore sconosciuto: -${operatore}`);
    return dati.filter((o) => test(typeof o === "object" ? o[proprieta] : o, valore));
  },

  "Select-Object"(sh, args) {
    const p = param(args);
    let dati = inPipe(sh);
    if (dati === null) throw new V.ErroreFs("Select-Object lavora su quello che arriva dalla pipeline");
    if (p.nominati.First) dati = dati.slice(0, Number(p.nominati.First));
    if (p.nominati.Last) dati = dati.slice(-Number(p.nominati.Last));
    // "Select-Object Name, Length" arriva qui come due parole distinte, perche'
    // la virgola e' attaccata alla prima: si rimettono insieme prima di dividere.
    const proprieta = p.nominati.Property ?? (p.posizionali.length ? p.posizionali.join(",") : null);
    if (!proprieta) return dati;
    const nomi = String(proprieta).split(",").map((s) => s.trim()).filter(Boolean);
    return dati.map((o) =>
      Object.fromEntries(nomi.map((n) => [n, typeof o === "object" ? o[n] : o]))
    );
  },

  "Sort-Object"(sh, args) {
    const p = param(args);
    const dati = inPipe(sh);
    if (dati === null) throw new V.ErroreFs("Sort-Object lavora su quello che arriva dalla pipeline");
    const proprieta = p.nominati.Property ?? p.posizionali[0];
    const chiave = (o) => (proprieta && typeof o === "object" ? o[proprieta] : o);
    const ordinati = dati.slice().sort((a, b) => {
      const [x, y] = [chiave(a), chiave(b)];
      // I numeri si confrontano come numeri: e' il vantaggio della pipeline a
      // oggetti, dove sort non deve indovinare il tipo leggendo del testo.
      if (typeof x === "number" && typeof y === "number") return x - y;
      return String(x).localeCompare(String(y));
    });
    if (p.nominati.Descending) ordinati.reverse();
    return ordinati;
  },

  "Measure-Object"(sh, args) {
    const p = param(args);
    const dati = inPipe(sh);
    if (dati === null) throw new V.ErroreFs("Measure-Object lavora su quello che arriva dalla pipeline");
    const proprieta = p.nominati.Property ?? p.posizionali[0];
    const risultato = { Count: dati.length };
    if (proprieta) {
      const numeri = dati
        .map((o) => Number(typeof o === "object" ? o[proprieta] : o))
        .filter((n) => !Number.isNaN(n));
      if (p.nominati.Sum) risultato.Sum = numeri.reduce((a, b) => a + b, 0);
      if (p.nominati.Average)
        risultato.Average = numeri.length ? numeri.reduce((a, b) => a + b, 0) / numeri.length : 0;
      if (p.nominati.Maximum) risultato.Maximum = Math.max(...numeri);
      if (p.nominati.Minimum) risultato.Minimum = Math.min(...numeri);
    }
    return [risultato];
  },

  "Select-String"(sh, args) {
    const p = param(args);
    const motivo = String(arg(p, "Pattern") ?? "");
    const file = perc(arg(p, "Path", 1));
    if (!motivo) throw new V.ErroreFs("manca il motivo da cercare");
    const re = new RegExp(fuggi(motivo), "i"); // Select-String ignora le maiuscole
    if (file) {
      return righeDi(V.leggi(sh.fs, file))
        .map((riga, i) => ({ Filename: V.foglia(V.normalizza(sh.fs, file)), LineNumber: i + 1, Line: riga }))
        .filter((o) => re.test(o.Line));
    }
    const dati = inPipe(sh);
    if (dati === null) throw new V.ErroreFs("serve un percorso o un ingresso dalla pipeline");
    return dati.filter((o) => re.test(typeof o === "object" ? JSON.stringify(o) : String(o)));
  },

  /**
   * Import-Csv legge un CSV e restituisce **oggetti**, con i nomi di colonna
   * come campi. E' il punto in cui la pipeline a oggetti si guadagna il posto:
   * da qui in poi si filtra e si ordina per nome di colonna, senza ritagliare.
   */
  "Import-Csv"(sh, args) {
    const p = param(args);
    const file = perc(arg(p, "Path"));
    if (!file) throw new V.ErroreFs("manca il percorso");
    const sep = p.nominati.Delimiter ?? ",";
    const righe = righeDi(V.leggi(sh.fs, file));
    if (!righe.length) return [];
    const intestazione = righe[0].split(sep).map((s) => s.trim());
    return righe.slice(1).map((r) => {
      const valori = r.split(sep).map((s) => s.trim());
      // I valori restano stringhe, come in PowerShell vero: e' la ragione per cui
      // un confronto numerico su una colonna importata da CSV va convertito.
      return Object.fromEntries(intestazione.map((c, i) => [c, valori[i] ?? ""]));
    });
  },

  "Export-Csv"(sh, args) {
    const p = param(args);
    const file = perc(arg(p, "Path"));
    if (!file) throw new V.ErroreFs("manca il percorso");
    const dati = inPipe(sh);
    if (!dati || !dati.length) throw new V.ErroreFs("non c'e' niente da esportare");
    const colonne = [...new Set(dati.flatMap((o) => (typeof o === "object" ? Object.keys(o) : [])))];
    const righe = [
      colonne.join(","),
      ...dati.map((o) => colonne.map((c) => o[c] ?? "").join(",")),
    ];
    V.scrivi(sh.fs, file, righe.join("\n") + "\n");
    return "";
  },

  "ConvertTo-Json"(sh, args) {
    const dati = inPipe(sh);
    if (dati === null) throw new V.ErroreFs("ConvertTo-Json lavora su quello che arriva dalla pipeline");
    // Un oggetto solo non diventa un array di uno: e' il comportamento di
    // PowerShell, e la ragione per cui a volte il JSON prodotto sorprende.
    return JSON.stringify(dati.length === 1 ? dati[0] : dati, null, 2);
  },

  "ConvertFrom-Json"(sh, args) {
    const dati = inPipe(sh);
    if (dati === null) throw new V.ErroreFs("serve del testo dalla pipeline");
    const testo = Array.isArray(dati) ? dati.join("\n") : String(dati);
    try {
      const oggetto = JSON.parse(testo);
      return Array.isArray(oggetto) ? oggetto : [oggetto];
    } catch {
      throw new V.ErroreFs("il testo non e' JSON valido");
    }
  },

  "Get-Command"(sh, args) {
    const p = param(args);
    const nome = arg(p, "Name");
    if (!nome) throw new V.ErroreFs("manca il nome del comando");
    for (const dir of (sh.env.PATH || "").split(":")) {
      if (dir && V.esiste(sh.fs, dir + "/" + nome)) return dir + "/" + nome;
    }
    return "";
  },

  "Write-Output": (sh, args) => args.join(" "),

  /**
   * I servizi: processi che il sistema avvia da solo e sorveglia. Su Windows
   * sono la cosa che su Linux fa systemd, e il motivo per cui esiste un cmdlet
   * dedicato invece di Get-Process — un servizio fermo non ha un processo.
   */
  "Get-Service"(sh, args) {
    const p = param(args);
    const nome = arg(p, "Name");
    const servizi = sh.servizi ?? SERVIZI_BASE;
    return servizi
      .filter((s) => !nome || s.Name.toLowerCase() === String(nome).toLowerCase())
      .map((s) => ({ Status: s.Status, Name: s.Name, DisplayName: s.DisplayName }));
  },

  "Start-Service": (sh, args) => cambiaServizio(sh, args, "Running"),
  "Stop-Service": (sh, args) => cambiaServizio(sh, args, "Stopped"),

  /**
   * Le variabili d'ambiente sono un "drive" come il disco: si leggono e si
   * scrivono con i cmdlet dei file, sotto Env:. E' una delle idee piu' strane
   * di PowerShell e una delle piu' utili — registro, certificati e variabili si
   * esplorano tutti con gli stessi quattro comandi.
   */
  "Get-Item"(sh, args) {
    const p = param(args);
    const dove = String(perc(arg(p, "Path")) ?? "");
    const m = dove.match(/^env:\/?(.+)$/i);
    if (m) return [{ Name: m[1], Value: sh.env[m[1]] ?? "" }];
    const abs = V.normalizza(sh.fs, dove);
    const nodo = sh.fs.nodi.get(abs);
    if (!nodo) throw new V.ErroreFs(`${dove}: percorso non esistente`);
    return [{ Mode: nodo.tipo === "dir" ? "d----" : "-a---", Name: V.foglia(abs), FullName: abs }];
  },

  "Set-Item"(sh, args) {
    const p = param(args);
    const dove = String(perc(arg(p, "Path")) ?? "");
    const m = dove.match(/^env:\/?(.+)$/i);
    if (!m) throw new V.ErroreFs("qui Set-Item vale solo per Env:");
    sh.env[m[1]] = String(arg(p, "Value", 1) ?? "");
    return "";
  },
};

const SERVIZI_BASE = [
  { Status: "Running", Name: "Spooler", DisplayName: "Coda di stampa" },
  { Status: "Running", Name: "W32Time", DisplayName: "Ora di Windows" },
  { Status: "Stopped", Name: "WSearch", DisplayName: "Ricerca di Windows" },
];

function cambiaServizio(sh, args, stato) {
  const p = param(args);
  const nome = arg(p, "Name");
  if (!nome) throw new V.ErroreFs("manca il nome del servizio");
  sh.servizi = (sh.servizi ?? SERVIZI_BASE).map((s) =>
    s.Name.toLowerCase() === String(nome).toLowerCase() ? { ...s, Status: stato } : s
  );
  if (!sh.servizi.some((s) => s.Name.toLowerCase() === String(nome).toLowerCase()))
    throw new V.ErroreFs(`servizio non trovato: ${nome}`);
  return "";
}

/**
 * Gli alias di PowerShell. Esistono perche' chi arriva da bash trovi i comandi
 * che conosce, e sono la ragione per cui `ls` funziona anche su Windows — ma
 * `ls -l` no, perche' l'alias punta a un cmdlet che quell'opzione non ce l'ha.
 */
export const ALIAS_PS = {
  gl: "Get-Location", pwd: "Get-Location",
  sl: "Set-Location", cd: "Set-Location", chdir: "Set-Location",
  gci: "Get-ChildItem", ls: "Get-ChildItem", dir: "Get-ChildItem",
  gc: "Get-Content", cat: "Get-Content", type: "Get-Content",
  sc: "Set-Content", ac: "Add-Content",
  ni: "New-Item",
  ri: "Remove-Item", rm: "Remove-Item", del: "Remove-Item", erase: "Remove-Item",
  cpi: "Copy-Item", cp: "Copy-Item", copy: "Copy-Item",
  mi: "Move-Item", mv: "Move-Item", move: "Move-Item",
  where: "Where-Object", "?": "Where-Object",
  select: "Select-Object",
  sort: "Sort-Object",
  measure: "Measure-Object",
  sls: "Select-String",
  gcm: "Get-Command",
  echo: "Write-Output", write: "Write-Output",
  ipcsv: "Import-Csv", epcsv: "Export-Csv",
  gsv: "Get-Service",
  gps: "Get-Process", ps: "Get-Process",
  spps: "Stop-Process", kill: "Stop-Process",
};

/** Il dizionario completo: cmdlet piu' alias, pronto per creaShell. */
export function comandiPowerShell(extra = {}) {
  const comandi = { ...POWERSHELL, ...extra };
  // Un alias che punta a un cmdlet non presente non va registrato: meglio
  // "comando non trovato" che una funzione indefinita al primo uso.
  for (const [alias, vero] of Object.entries(ALIAS_PS))
    if (comandi[vero]) comandi[alias] = comandi[vero];
  return comandi;
}
