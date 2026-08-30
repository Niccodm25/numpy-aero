// Utenti e gruppi del Linux simulato. Non gestisce password reali: insegna le
// relazioni fra account, gruppo primario e gruppi supplementari senza mai
// trattare segreti nel browser.

import * as V from "./vfs.js";

export function statoUtenti(sh, scenario = {}) {
  sh.utenti = {
    root: { uid: 0, gruppo: "root" },
    tu: { uid: 1000, gruppo: "studenti" },
    ...(scenario.utenti || {}),
  };
  sh.gruppi = {
    root: ["root"],
    studenti: ["tu"],
    ...(scenario.gruppi || {}),
  };
  for (const [nome, dati] of Object.entries(sh.utenti)) {
    const gruppo = dati.gruppo ?? nome;
    dati.gruppo = gruppo;
    (sh.gruppi[gruppo] ||= []).push(nome);
  }
  for (const membri of Object.values(sh.gruppi)) {
    const unici = [...new Set(membri)];
    membri.splice(0, membri.length, ...unici);
  }
  sincronizza(sh);
  return sh;
}

function richiediRoot(sh) {
  if ((sh.fs.utente ?? "tu") !== "root") throw new V.ErroreFs("operazione non permessa: serve sudo");
}

function gruppiDi(sh, nome) {
  if (!sh.utenti?.[nome]) throw new V.ErroreFs(`utente non esistente: ${nome}`);
  return Object.entries(sh.gruppi).filter(([, membri]) => membri.includes(nome)).map(([g]) => g).sort();
}

function sincronizza(sh) {
  sh.fs.gruppiUtente = Object.fromEntries(Object.keys(sh.utenti).map((u) => [u, gruppiDi(sh, u)]));
  const prima = sh.fs.utente;
  sh.fs.utente = "root";
  V.creaDir(sh.fs, "/etc", true);
  V.scrivi(sh.fs, "/etc/passwd", Object.entries(sh.utenti)
    .map(([nome, u]) => `${nome}:x:${u.uid ?? 1000}:${u.uid ?? 1000}:${nome}:/home/${nome}:/bin/bash`).join("\n") + "\n");
  V.scrivi(sh.fs, "/etc/group", Object.entries(sh.gruppi)
    .map(([g, membri]) => `${g}:x:${1000 + Object.keys(sh.gruppi).indexOf(g)}:${membri.join(",")}`).join("\n") + "\n");
  for (const p of ["/etc", "/etc/passwd", "/etc/group"]) {
    const n = sh.fs.nodi.get(p);
    n.proprietario = "root";
    n.gruppo = "root";
  }
  sh.fs.utente = prima;
}

export const UTENTI = {
  groups(sh, args) {
    const nome = args[0] ?? (sh.fs.utente ?? "tu");
    return gruppiDi(sh, nome).join(" ");
  },

  id(sh, args) {
    const nome = args[0] ?? (sh.fs.utente ?? "tu");
    const u = sh.utenti?.[nome];
    if (!u) throw new V.ErroreFs(`utente non esistente: ${nome}`);
    const gruppi = gruppiDi(sh, nome);
    return `uid=${u.uid ?? 1000}(${nome}) gid=${u.uid ?? 1000}(${u.gruppo}) groups=${gruppi.map((g) => `${g}`).join(",")}`;
  },

  useradd(sh, args) {
    richiediRoot(sh);
    const conHome = args.includes("-m");
    const nome = args.find((a) => !a.startsWith("-"));
    if (!nome) throw new V.ErroreFs("manca il nome dell'utente");
    if (sh.utenti[nome]) throw new V.ErroreFs(`${nome}: utente gia' esistente`);
    const uid = Math.max(...Object.values(sh.utenti).map((u) => u.uid ?? 1000)) + 1;
    sh.utenti[nome] = { uid, gruppo: nome };
    sh.gruppi[nome] = [nome];
    if (conHome) {
      V.creaDir(sh.fs, `/home/${nome}`, true);
      const n = sh.fs.nodi.get(`/home/${nome}`);
      n.proprietario = nome;
      n.gruppo = nome;
    }
    sincronizza(sh);
    return "";
  },

  passwd(sh, args) {
    const nome = args[0] ?? (sh.fs.utente ?? "tu");
    if (!sh.utenti?.[nome]) throw new V.ErroreFs(`utente non esistente: ${nome}`);
    if ((sh.fs.utente ?? "tu") !== "root" && nome !== (sh.fs.utente ?? "tu"))
      throw new V.ErroreFs("operazione non permessa");
    sh.utenti[nome].passwordImpostata = true;
    return `password aggiornata per ${nome}`;
  },

  usermod(sh, args) {
    richiediRoot(sh);
    const i = args.findIndex((a) => a === "-aG");
    if (i < 0 || !args[i + 1] || !args[i + 2])
      throw new V.ErroreFs("usa usermod -aG gruppo utente");
    const nome = args[i + 2];
    if (!sh.utenti[nome]) throw new V.ErroreFs(`utente non esistente: ${nome}`);
    for (const gruppo of args[i + 1].split(",")) {
      if (!sh.gruppi[gruppo]) throw new V.ErroreFs(`gruppo non esistente: ${gruppo}`);
      if (!sh.gruppi[gruppo].includes(nome)) sh.gruppi[gruppo].push(nome);
    }
    sincronizza(sh);
    return "";
  },
};
