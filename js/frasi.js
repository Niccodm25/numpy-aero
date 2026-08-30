// Frasi mostrate quando una risposta e' sbagliata.
//
// Sostituiscono "Questo esercizio torna in fondo alla coda", che era vera e
// suonava come una penalita'. Sbagliare qui e' il funzionamento normale: il
// sistema di ripasso esiste apposta, e un esercizio che torna indietro sta
// facendo il suo mestiere.
//
// Regole che le tengono decenti: niente punti esclamativi a raffica, niente
// complimenti per qualcosa che non e' successo, e niente promesse. Una frase
// che dice "bravissimo" a chi ha appena sbagliato viene letta come presa in
// giro la seconda volta che compare.

export const FRASI_SBAGLIATO = [
  "Sbagliare qui costa niente. È esattamente il posto giusto per farlo.",
  "Questo è il momento in cui si impara qualcosa. Quando indovini, no.",
  "Un errore trovato adesso è un errore che non farai in sede d'esame.",
  "Rileggi la traccia: nove volte su dieci la risposta è in una parola che hai saltato.",
  "Nessuno lo sa al primo colpo. Chi dice il contrario ha dimenticato com'era.",
  "Torna alla lezione un momento. Non è tempo perso, è la scorciatoia.",
  "La differenza fra chi impara e chi no è cosa fa nei trenta secondi dopo un errore.",
  "Se avessi indovinato per caso, non avresti imparato niente.",
  "Questo esercizio tornerà. Meglio così: significa che non lo perdi.",
  "Un tentativo andato male è un dato, non un verdetto.",
  "Guarda il suggerimento. Chiedere aiuto al momento giusto è una competenza.",
  "La memoria si costruisce sugli errori, non sulle risposte giuste.",
  "Poco importa quante volte sbagli, conta che alla fine lo sappia senza pensarci.",
  "Prova a spiegarti ad alta voce perché pensavi fosse quella. Spesso l'errore si vede da solo.",
  "Chi non sbaglia mai sta facendo esercizi troppo facili.",
  "Un passo indietro adesso, due avanti fra due giorni.",
  "L'errore è la parte del lavoro che nessuno vede e che regge tutto il resto.",
  "Riprova con calma. La fretta è l'unica cosa che qui non serve a niente.",
  "Questo lo sbagliano quasi tutti la prima volta.",
  "Sei più vicino di quanto sembri: hai capito la domanda, manca il dettaglio.",
  "Rileggi la tua risposta come se fosse di qualcun altro. È più facile trovarci l'errore.",
  "Nessuna fretta. L'esercizio non scappa e nemmeno tu.",
  "Meglio scoprirlo qui che dentro un codice di trecento righe.",
  "Il ripasso non è una punizione: è il motivo per cui fra un mese te lo ricorderai.",
  "Ci sei quasi. Cambia una cosa sola e riprova.",
  "Un errore ripetuto è un concetto da rivedere, non un difetto tuo.",
  "Sapere di non saperlo è già metà del lavoro.",
  "Questa è la parte noiosa. Dopo diventa automatica.",
  "Il codice non ti sta giudicando: ti sta dicendo cosa non torna.",
  "Se ti sembra assurdo, probabilmente c'è un dettaglio che non fa rumore.",
  "Chi impara in fretta è chi rilegge, non chi tira a indovinare.",
  "Non memorizzare la risposta: capisci perché è quella.",
  "Il tuo cervello sta lavorando proprio adesso, non quando indovini.",
  "Ogni volta che torna, torna un po' più facile.",
  "Fermati un secondo e chiediti cosa ti aspettavi che succedesse.",
  "Anche chi lo fa da vent'anni rilegge la documentazione.",
  "Sbagliare in fretta è meglio che rimandare a domani.",
  "Il fatto che ti dia fastidio significa che ti interessa.",
  "Questo è il tipo di errore che si fa una volta sola.",
  "Prendi la soluzione, ma leggi anche la spiegazione: è lì che sta la roba utile.",
  "L'obiettivo non è finire il modulo, è non doverlo rifare.",
  "Un conto è non saperlo, un conto è non sapere dove guardare. Tu sai dove guardare.",
  "Se fosse ovvio non ci sarebbe un esercizio.",
  "Anche i secondi tentativi contano. Contano quasi tutti.",
  "Il punto non è avere ragione adesso, è averla quando servirà.",
  "Riprova senza guardare il suggerimento. Se non viene, guardalo pure.",
  "La padronanza è fatta di errori dimenticati.",
  "Segnati mentalmente cosa ti ha ingannato: è quello che vale l'esercizio.",
  "Non è una gara, e non c'è nessuno che ti guarda.",
  "Ci hai messo attenzione. Adesso mettici anche un secondo tentativo.",
  "La versione di te fra un mese ti ringrazia per questo errore.",
  "Il primo tentativo serve a scoprire la domanda, il secondo a rispondere.",
  "Nessun errore qui dentro rompe niente. Sperimenta.",
  "Se non sei sicuro del perché, la spiegazione vale più della risposta.",
  "Quello che stai facendo adesso si chiama studiare.",
];

/** Una a caso. */
export const fraseSbagliato = () =>
  FRASI_SBAGLIATO[Math.floor(Math.random() * FRASI_SBAGLIATO.length)];
