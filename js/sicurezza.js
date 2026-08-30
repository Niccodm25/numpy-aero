// Firewall difensivo simulato: nessuna regola tocca la macchina dell'utente.
import { ErroreFs } from "./vfs.js";
export function statoSicurezza(sh, scenario={}) { sh.sicurezza={ attivo:false, porte:new Set([22]), ...(scenario||{})}; return sh; }
export const SICUREZZA={
  ufw(sh,args){const a=args[0];if(a==="enable"){sh.sicurezza.attivo=true;return "Firewall attivo";}if(a==="allow"){const p=Number(args[1]);if(!p)throw new ErroreFs("ufw allow: manca la porta");sh.sicurezza.porte.add(p);return `Regola aggiunta: consenti ${p}`;}if(a==="status"){return `Status: ${sh.sicurezza.attivo?"active":"inactive"}\n`+[...sh.sicurezza.porte].sort((a,b)=>a-b).map(p=>`${p}/tcp ALLOW`).join("\n");}throw new ErroreFs("ufw: usa enable, allow o status");},
  "firewall-cmd"(sh,args){if(args.includes("--list-services"))return [...sh.sicurezza.porte].includes(22)?"ssh":"";throw new ErroreFs("firewall-cmd: usa --list-services");},
};
