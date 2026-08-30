# -*- coding: utf-8 -*-
"""Ogni comando (e ogni opzione) che compare in una soluzione dei moduli shell
deve essere passato prima per una lezione: quel modulo o uno precedente.
Serve a non far trovare in un esercizio un comando mai spiegato.

    python tools/check_lezioni.py
"""
import glob
import io
import json
import sys

sys.stdout.reconfigure(encoding="utf8")

# Falsi positivi noti: pezzi di script fra apici, assegnazioni, forme scritte
# nelle lezioni con un argomento in mezzo (find . -name).
IGNORA = {"wc -l'"}  # pezzo di uno script scritto fra apici

problemi = 0
visto = ""
for f in sorted(glob.glob("content/l0*.json")) + sorted(glob.glob("content/w0*.json")):
    d = json.load(io.open(f, encoding="utf8"))
    visto += " " + " ".join(l["md"] + " " + l["titolo"] for l in d.get("lezioni") or [])
    manca = {}
    for r in d["raccolte"]:
        for e in r["esercizi"]:
            for riga in (e.get("soluzione") or "").splitlines():
                for pezzo in riga.split("|"):
                    parole = pezzo.strip().split()
                    if not parole:
                        continue
                    c = parole[0]
                    if "=" in c:
                        continue
                    if c == "sudo" and len(parole) > 1:
                        c = parole[1]
                    if c not in visto and c not in IGNORA:
                        manca.setdefault(c, e["id"])
                    # L'opzione si cerca da sola: nelle lezioni compare spesso
                    # con un argomento in mezzo (find . -name, Sort-Object Length
                    # -Descending), e pretendere l'adiacenza darebbe solo rumore.
                    for a in parole[1:]:
                        if a.startswith("-") and len(a) > 1 and a not in visto:
                            if f"{c} {a}" not in IGNORA:
                                manca.setdefault(f"{c} {a}", e["id"])
    if manca:
        problemi += len(manca)
        print(f"{f}: mai spiegati -> {json.dumps(manca, ensure_ascii=False)}")

print("tutto spiegato" if not problemi else f"{problemi} da spiegare")
sys.exit(1 if problemi else 0)
