# -*- coding: utf-8 -*-
"""Standard di un modulo: 24 esercizi in 3 raccolte da 8, difficolta' crescente,
esercizi composti, e riuso dei comandi dei moduli precedenti.

Serve perche' un modulo di sei esercizi da un comando l'uno insegna a copiare la
lezione. L'obiettivo dell'app e' formare specialisti giocando: la difficolta'
deve salire lungo il ramo, e ogni modulo deve dare per acquisito quello prima.

    python tools/check_moduli.py            # solo i moduli sotto standard
    python tools/check_moduli.py --tutti    # la tabella intera
"""
import io
import json
import sys

sys.stdout.reconfigure(encoding="utf8")

MINIMO = 24          # esercizi per modulo
PER_RACCOLTA = 8
QUOTA_COMPOSTI = 0.40  # esercizi con piu' di un comando
QUOTA_RIUSO = 0.33     # esercizi che usano comandi dei moduli precedenti

# I cantieri sono progetti a fasi: poche fasi lunghe, regole diverse.
FASI_CANTIERE = 4


def comandi_di(soluzione):
    fuori = set()
    for riga in (soluzione or "").splitlines():
        for pezzo in riga.split("|"):
            parole = pezzo.strip().split()
            if not parole:
                continue
            c = parole[1] if parole[0] == "sudo" and len(parole) > 1 else parole[0]
            if "=" not in c:
                fuori.add(c)
    return fuori


def controlla(mid, titolo, dati, gia_visti):
    problemi = []
    raccolte = dati.get("raccolte") or []
    esercizi = [e for r in raccolte for e in r["esercizi"]] or dati.get("esercizi", [])
    cantiere = bool(dati.get("cantiere"))

    if cantiere:
        if len(esercizi) < FASI_CANTIERE:
            problemi.append(f"solo {len(esercizi)} fasi, il minimo e' {FASI_CANTIERE}")
        return problemi, esercizi

    if len(esercizi) < MINIMO:
        problemi.append(f"{len(esercizi)} esercizi, ne servono {MINIMO}")
    if len(raccolte) < 3:
        problemi.append(f"{len(raccolte)} raccolte, ne servono almeno 3")
    for r in raccolte:
        if len(r["esercizi"]) < PER_RACCOLTA:
            problemi.append(f"la raccolta «{r['comando']}» ha {len(r['esercizi'])} esercizi su {PER_RACCOLTA}")

    composti = [e for e in esercizi
                if len((e.get("soluzione") or "").splitlines()) > 1 or "|" in (e.get("soluzione") or "")]
    if esercizi and len(composti) / len(esercizi) < QUOTA_COMPOSTI:
        problemi.append(f"solo {len(composti)}/{len(esercizi)} esercizi composti, "
                        f"il minimo e' {int(QUOTA_COMPOSTI * 100)}%")

    # Riuso: un esercizio che tocca un comando gia' insegnato altrove.
    if gia_visti:
        riusano = [e for e in esercizi if comandi_di(e.get("soluzione")) & gia_visti]
        if esercizi and len(riusano) / len(esercizi) < QUOTA_RIUSO:
            problemi.append(f"solo {len(riusano)}/{len(esercizi)} esercizi riusano comandi dei moduli "
                            f"precedenti, il minimo e' {int(QUOTA_RIUSO * 100)}%")

    # Ogni raccolta deve finire con uno scenario: gli ultimi due esercizi
    # combinano piu' comandi invece di ripetere quello nuovo da solo.
    for r in raccolte:
        coda = r["esercizi"][-2:]
        if coda and not any(len(comandi_di(e.get("soluzione"))) > 1 for e in coda):
            problemi.append(f"la raccolta «{r['comando']}» non finisce con uno scenario composto")

    senza_stato = [e["id"] for e in esercizi
                   if e["tipo"] == "terminale" and set(e.get("verifica", {})) <= {"usa"}]
    if senza_stato:
        problemi.append(f"{len(senza_stato)} esercizi verificano solo quale comando hai digitato "
                        f"(es. {senza_stato[0]})")
    return problemi, esercizi


def main():
    tutti = "--tutti" in sys.argv
    indice = json.load(io.open("content/index.json", encoding="utf8"))
    ramo = next(r for r in indice["rami"] if r["id"] == "linux")
    fuori_standard = 0
    visti = set()

    print("%-6s %-38s %5s %s" % ("id", "titolo", "eser", "stato"))
    for mid in ramo["moduli"]:
        meta = next((m for m in indice["moduli"] if m["id"] == mid), None)
        if not meta or not meta.get("disponibile"):
            continue
        dati = json.load(io.open("content/" + meta["file"], encoding="utf8"))
        problemi, esercizi = controlla(mid, meta["titolo"], dati, visti)
        for e in esercizi:
            visti |= comandi_di(e.get("soluzione"))
        if problemi:
            fuori_standard += 1
        if problemi or tutti:
            stato = "ok" if not problemi else "DA RIFARE"
            print("%-6s %-38s %5d %s" % (mid, meta["titolo"][:38], len(esercizi), stato))
            for p in problemi:
                print("       - " + p)

    print()
    print("tutti i moduli sono a standard" if not fuori_standard
          else f"{fuori_standard} moduli sotto standard")
    sys.exit(1 if fuori_standard else 0)


main()
