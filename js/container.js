// Immagini e container finti: descrivono isolamento e riproducibilita', senza Docker reale.
import { ErroreFs } from "./vfs.js";
export function statoContainer(sh, scenario={}) { sh.container={ immagini:{"python:3.12":true,...(scenario.immagini||{})}, attivi:[]}; return sh; }
export const CONTAINER={
  docker(sh,args){const [azione,...resto]=args;if(azione==="images")return Object.keys(sh.container.immagini).map(i=>`${i} simulata`).join("\n");if(azione==="run"){const immagine=resto.find(a=>!a.startsWith("-"));if(!immagine||!sh.container.immagini[immagine])throw new ErroreFs("immagine non disponibile");sh.container.attivi.push(immagine);return `container ${immagine} avviato in isolamento`; }if(azione==="build"){const i=resto.indexOf("-t"),tag=i>=0?resto[i+1]:null;if(!tag)throw new ErroreFs("docker build: usa -t nome");sh.container.immagini[tag]=true;return `immagine ${tag} costruita`; }throw new ErroreFs("docker: usa images, run o build");}
};
