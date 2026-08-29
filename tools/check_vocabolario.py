"""Nessun esercizio deve usare comandi che il suo modulo non ha ancora insegnato.

    .venv/Scripts/python tools/check_vocabolario.py [m01 m02 ...]

Per ogni esercizio raccoglie i nomi usati davvero in setup, starter e soluzione
(analizzando l'albero sintattico, non con espressioni regolari) e li confronta
con il vocabolario ammesso: quello del modulo piu tutti i moduli precedenti.

Non e' un controllo di correttezza ma di ordine didattico: un esercizio del
modulo 1 che usa np.allclose chiede di conoscere il modulo 11.
"""
import ast
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..")

# Sempre ammesso: costrutti Python di base e cio' che l'app fornisce.
BASE = {
    "np", "print", "len", "range", "round", "int", "float", "bool", "str",
    "list", "tuple", "enumerate", "zip", "io", "StringIO",
}

# Vocabolario introdotto da ciascun modulo, cumulativo.
VOCABOLARIO = {
    "m01": {
        "array", "zeros", "ones", "full", "eye", "arange", "linspace",
        "shape", "ndim", "dtype", "size", "astype", "k", "retstep",
        "zeros_like", "ones_like", "full_like",
        "float64", "float32", "int32", "int64", "int8", "iinfo",
        "isclose", "allclose",  # confrontare float serve da subito
    },
    "m02": {
        "where", "any", "all", "copy", "shares_memory", "argsort", "nonzero",
        "sum",  # contare una maschera e' insegnato qui
        "nan",  # la lezione 5 lo introduce per le letture mancanti
    },
    "m03": {
        "newaxis", "meshgrid", "broadcast_shapes", "ravel", "column_stack",
        "indexing",
        "sqrt",  # usato nelle distanze
    },
    "m04": {
        "sin", "cos", "tan", "arctan", "arctan2", "exp", "log", "log10", "log2",
        "deg2rad", "rad2deg", "radians", "degrees", "pi", "hypot", "abs",
        "linalg", "det",
    },
    "m05": {
        "mean", "std", "var", "argmin", "argmax", "cumsum", "unravel_index",
        "min", "max", "axis",
        "ptp", "maximum", "minimum", "keepdims", "ddof", "percentile",
    },
    "m06": {"reshape", "transpose", "T", "concatenate", "stack", "vstack",
            "hstack", "split", "block", "flatten", "tile", "repeat",
            "order", "array_split"},
    "m07": {"@", "solve", "inv", "eig", "eigvals", "norm", "lstsq", "cond", "trace",
            "diag", "matmul", "dot", "identity", "polyfit", "polyval",
            "rcond", "real", "imag"},
    "m08": {"diff", "gradient", "trapezoid", "trapz", "interp", "polyder",
            "roots", "argsort", "left", "right", "isreal"},
    "m09": {"loadtxt", "genfromtxt", "savetxt", "save", "load", "isnan",
            "isfinite", "nanmean", "nanstd", "nanmax", "nansum", "nanargmax",
            "nan", "inf", "delimiter", "skiprows", "unpack", "usecols", "header"},
    "m10": {"random", "default_rng", "normal", "uniform", "integers", "choice",
            "quantile", "rng", "seed", "p", "endpoint", "replace"},
    "m11": {"isclose", "allclose", "finfo", "eps", "nbytes", "perf_counter",
            "time", "atol", "rtol", "int16"},
    "m12": {"dir", "help", "info", "searchsorted", "unique", "clip", "isin",
            "apply_along_axis", "sort", "lexsort", "return_counts", "return_index",
            "return_inverse", "block", "side", "startswith", "argwhere", "nanmedian",
            "nanargmax", "argpartition", "ptp",
            "lookfor"}  # la lezione insegna che e' stata rimossa in 2.0,
}

# Il ramo Python ha una scala propria: i suoi moduli non ereditano niente da
# NumPy, mentre i moduli NumPy danno per acquisito tutto il ramo Python.
VOCAB_PY = {
    "p01": {
        "print", "type", "int", "float", "str", "bool", "round", "abs", "len",
        "upper", "lower", "strip", "split", "join", "replace", "startswith",
        "splitlines", "__name__",
        # servono a mostrare che = lega un nome a un oggetto e non lo copia:
        # per dimostrarlo serve un tipo mutabile
        "append", "copy",
    },
    "p02": {
        # divmod chiude la coppia // e %; il resto della lezione e' sintassi
        # (operatori, f-string) e non passa dal vocabolario dei nomi
        "divmod", "isinstance", "chr",
    },
    "p03": {
        "list", "tuple", "dict", "set", "range", "zip", "enumerate",
        "sorted", "sum", "max", "min", "key", "reverse",
        "extend", "insert", "pop", "remove", "sort", "index", "count",
        "keys", "values", "items", "get", "add",
    },
    # Il controllo di flusso non porta nomi nuovi: if, for, while, break e continue
    # sono parole chiave, non funzioni. Resta start, il parametro di enumerate.
    "p04": {"start"},
    "p05": {
        # def, return, lambda e gli asterischi sono sintassi; questi sono i nomi
        "isinstance", "default", "__name__", "__doc__", "acc", "scala",
        "map", "filter", "sum", "dir",
        # nomi liberi passati a **kwargs: non sono vocabolario, ma l'analisi
        # dell'albero non distingue un argomento per nome da una funzione
        "griglia", "log",
    },
    "p06": {
        # i tipi di eccezione sono nomi come gli altri
        "Exception", "LookupError", "TypeError", "ValueError", "NameError",
        "IndexError", "KeyError", "AttributeError", "ZeroDivisionError",
        "hasattr", "quota",
        # nomi che NON esistono di proposito: sono il soggetto degli esercizi
        # su NameError e sui refusi
        "nome_inesistente", "rigaa",
    },
}

ORDINE_PY = [f"p{i:02d}" for i in range(1, 13)]
ORDINE = [f"m{i:02d}" for i in range(1, 13)]


def ammessi(mid):
    """Vocabolario del modulo piu tutti quelli precedenti dello stesso ramo."""
    if mid.startswith("p"):
        v = set()
        for m in ORDINE_PY:
            v |= VOCAB_PY.get(m, set())
            if m == mid:
                break
        return v
    v = set(BASE)
    for m in ORDINE:
        v |= VOCABOLARIO.get(m, set())
        if m == mid:
            break
    return v


def nomi_usati(codice):
    """Identificatori, attributi e parole chiave usati nel codice."""
    try:
        albero = ast.parse(codice)
    except SyntaxError:
        return set()  # gli starter incompleti non si parsano: e' normale
    trovati = set()
    for n in ast.walk(albero):
        if isinstance(n, ast.Name):
            trovati.add(n.id)
        elif isinstance(n, ast.Attribute):
            trovati.add(n.attr)
        elif isinstance(n, ast.keyword) and n.arg:
            trovati.add(n.arg)
        elif isinstance(n, ast.MatMult):
            trovati.add("@")   # il prodotto matriciale e' un operatore, non un nome
    return trovati


def main():
    voluti = sys.argv[1:] or (ORDINE_PY + ORDINE)
    indice = json.load(open(os.path.join(ROOT, "content", "index.json"), encoding="utf-8"))
    problemi = 0

    for meta in indice["moduli"]:
        mid = meta["id"]
        if mid not in voluti or (mid not in VOCABOLARIO and mid not in VOCAB_PY):
            continue
        f = os.path.join(ROOT, "content", meta["file"])
        if not os.path.exists(f):
            continue
        modulo = json.load(open(f, encoding="utf-8"))
        ok = ammessi(mid)

        gruppi = modulo.get("raccolte") or [{"comando": "-", "esercizi": modulo.get("esercizi", [])}]
        print(f"\n{mid} — {modulo['titolo']}")
        for r in gruppi:
            for e in r["esercizi"]:
                # I tre pezzi vanno analizzati separatamente: lo starter e'
                # incompleto per costruzione, e unirli farebbe fallire il parse
                # di tutto, scartando le violazioni invece di segnalarle.
                # Distinzione che conta: cio' che lo studente deve SCRIVERE
                # (soluzione) pesa piu di cio' che gli viene fornito (setup).
                da_scrivere = nomi_usati(e.get("soluzione", "")) | nomi_usati(e.get("starter", ""))
                fornito = nomi_usati(e.get("setup", ""))
                usati = da_scrivere | fornito
                fuori = sorted(n for n in usati if n not in ok and not n.startswith("_"))
                # I nomi definiti dall'esercizio stesso non contano: il codice
                # gia' scritto nello starter (un ciclo da eliminare, per dire)
                # lega le sue variabili, e chiederle in vocabolario non ha senso.
                definiti = set()
                for testo in (e.get("setup", ""), e.get("soluzione", ""), e.get("starter", "")):
                    try:
                        for n in ast.walk(ast.parse(testo)):
                            if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store):
                                definiti.add(n.id)
                            elif isinstance(n, ast.arg):
                                definiti.add(n.arg)
                            elif isinstance(n, ast.FunctionDef):
                                definiti.add(n.name)  # helper definito nel setup
                            elif isinstance(n, ast.ExceptHandler) and n.name:
                                definiti.add(n.name)  # la e di "except ... as e"
                    except SyntaxError:
                        pass
                fuori = [n for n in fuori if n not in definiti]
                # Il codice citato nella prosa conta quanto quello scritto: un
                # predict che chiede la shape di A[:, 1] presuppone il modulo 2
                # anche se non c'e' nessuna soluzione da analizzare.
                prosa = " ".join(
                    [e.get("testo", "")] + list(e.get("hint", []))
                )
                citati = set(re.findall(r"np\.(\w+)", prosa))
                fuori_prosa = sorted(n for n in citati if n not in ok)
                if fuori_prosa:
                    print(f"  {e['id']:<18} nel testo    {', '.join(fuori_prosa)}")
                    problemi += 1

                if fuori:
                    gravi = [n for n in fuori if n in da_scrivere]
                    lievi = [n for n in fuori if n not in da_scrivere]
                    marca = "DA SCRIVERE" if gravi else "solo fornito"
                    dettaglio = ", ".join(gravi) + (
                        f"  (nel setup: {', '.join(lievi)})" if gravi and lievi else ", ".join(lievi)
                    )
                    print(f"  {e['id']:<18} {marca:<12} {dettaglio}")
                    if gravi:
                        problemi += 1

    print()
    print("vocabolario coerente" if not problemi else f"{problemi} esercizi fuori vocabolario")
    return 1 if problemi else 0


if __name__ == "__main__":
    sys.exit(main())
