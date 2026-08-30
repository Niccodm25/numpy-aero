// Esecuzione dichiarativa finta di playbook: insegna il report changed/ok senza rete.
import { ErroreFs } from "./vfs.js";
export function statoAutomazione(sh){sh.automazione={eseguiti:new Set()};return sh;}
export const AUTOMAZIONE={
  "ansible-playbook"(sh,args){const file=args.find(a=>!a.startsWith("-"));if(!file)throw new ErroreFs("manca il playbook");const prima=sh.automazione.eseguiti.has(file);sh.automazione.eseguiti.add(file);return `PLAY RECAP\ncluster : ok=1 changed=${prima?0:1} failed=0`;}
};
