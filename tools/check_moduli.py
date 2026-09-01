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

    # La quota di composti si misura sugli esercizi di terminale: una raccolta di
    # sole predizioni non puo' avere una soluzione, e un modulo teorico — la
    # storia di Linux — non deve fingere di averne.
    terminali = [e for e in esercizi if e["tipo"] == "terminale"]
    composti = [e for e in terminali
                if len((e.get("soluzione") or "").splitlines()) > 1 or "|" in (e.get("soluzione") or "")]
    if terminali and len(composti) / len(terminali) < QUOTA_COMPOSTI:
        problemi.append(f"solo {len(composti)}/{len(terminali)} esercizi di terminale sono composti, "
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
        # Solo per le raccolte che hanno esercizi di terminale: una raccolta di
        # predizioni finisce con una domanda, ed e' giusto cosi'.
        if not any(e["tipo"] == "terminale" for e in r["esercizi"]):
            continue
        coda = r["esercizi"][-2:]
        if coda and not any(len(comandi_di(e.get("soluzione"))) > 1 for e in coda):
            problemi.append(f"la raccolta «{r['comando']}» non finisce con uno scenario composto")

    senza_stato = [e["id"] for e in esercizi
                   if e["tipo"] == "terminale" and set(e.get("verifica", {})) <= {"usa"}]
    if senza_stato:
        problemi.append(f"{len(senza_stato)} esercizi verificano solo quale comando hai digitato "
                        f"(es. {senza_stato[0]})")
    return problemi, esercizi



# I moduli di teoria (ramo Dinamica del volo) hanno esercizi di formula, numero,
# ordinamento e insieme invece che di terminale: le regole di forma restano —
# 24 esercizi in 3 raccolte, difficolta' crescente — ma "composto" qui vuol dire
# un'altra cosa, e la si misura sul tipo.
TIPI_FISICA = {"formula", "numerico", "ordina", "insieme"}
QUOTA_FORMULE = 0.40   # esercizi in cui la risposta e' una formula o un conto


def controlla_teoria(dati):
    problemi = []
    raccolte = dati.get("raccolte") or []
    esercizi = [e for r in raccolte for e in r["esercizi"]]

    if len(esercizi) < MINIMO:
        problemi.append(f"{len(esercizi)} esercizi, ne servono {MINIMO}")
    if len(raccolte) < 3:
        problemi.append(f"{len(raccolte)} raccolte, ne servono almeno 3")
    for r in raccolte:
        if len(r["esercizi"]) < PER_RACCOLTA:
            problemi.append(f"la raccolta «{r['comando']}» ha {len(r['esercizi'])} esercizi su {PER_RACCOLTA}")

    fuori_tipo = [e["id"] for e in esercizi if e["tipo"] not in TIPI_FISICA]
    if fuori_tipo:
        problemi.append(f"{len(fuori_tipo)} esercizi di tipo non previsto (es. {fuori_tipo[0]})")

    # Riconoscere non e' saper fare: la meta' abbondante degli esercizi deve
    # chiedere di scrivere una formula o di ricavare un numero.
    scrivono = [e for e in esercizi if e["tipo"] in ("formula", "numerico")]
    if esercizi and len(scrivono) / len(esercizi) < QUOTA_FORMULE:
        problemi.append(f"solo {len(scrivono)}/{len(esercizi)} esercizi chiedono una formula o un conto, "
                        f"il minimo e' {int(QUOTA_FORMULE * 100)}%")

    senza = [e["id"] for e in esercizi if not e.get("soluzione") or not e.get("verifica")]
    if senza:
        problemi.append(f"{len(senza)} esercizi senza soluzione o senza verifica (es. {senza[0]})")

    # Il 2026-09-01 gli esercizi sono nati con la soluzione scritta nel
    # segnaposto della casella: si apriva l'esercizio e la risposta era gia'
    # li'. La forma della risposta la decide l'app, per tipo; il modulo no.
    con_segnaposto = [e["id"] for e in esercizi if e.get("segnaposto")]
    if con_segnaposto:
        problemi.append(f"{len(con_segnaposto)} esercizi dichiarano un segnaposto (es. {con_segnaposto[0]}): "
                        "la casella non deve suggerire la risposta")

    # Negli esercizi a elenco le opzioni si mostrano apposta: la risposta e'
    # scegliere il sottoinsieme giusto, non indovinare le parole.
    regala = [e["id"] for e in esercizi
              if e["tipo"] in ("formula", "numerico")
              and e.get("soluzione") and len(e["soluzione"]) > 3
              and e["soluzione"].replace(" ", "") in e.get("testo", "").replace(" ", "")]
    if regala:
        problemi.append(f"{len(regala)} esercizi hanno la soluzione dentro il testo (es. {regala[0]})")

    senza_perche = [e["id"] for e in esercizi if not e.get("spiegazione")]
    if senza_perche:
        problemi.append(f"{len(senza_perche)} esercizi senza spiegazione (es. {senza_perche[0]})")

    # La difficolta' sale dentro la raccolta: 2 base, 3 composto, 4 scenario.
    for r in raccolte:
        livelli = [e.get("difficolta", 0) for e in r["esercizi"]]
        if any(b < a for a, b in zip(livelli, livelli[1:])):
            problemi.append(f"la raccolta «{r['comando']}» ha la difficolta' che scende")
        if livelli and max(livelli) < 4:
            problemi.append(f"la raccolta «{r['comando']}» non finisce con uno scenario (difficolta' 4)")

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

    # Il ramo di teoria, con le sue regole.
    teoria = next((r for r in indice["rami"] if r["id"] == "dinamica"), None)
    for mid in (teoria or {}).get("moduli", []):
        meta = next((m for m in indice["moduli"] if m["id"] == mid), None)
        if not meta or not meta.get("disponibile"):
            continue
        dati = json.load(io.open("content/" + meta["file"], encoding="utf8"))
        problemi, esercizi = controlla_teoria(dati)
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
