// Inventario hardware e parametri kernel coerenti, senza esporre la macchina vera.
import { ErroreFs } from "./vfs.js";
export function statoHardware(sh, scenario = {}) { sh.hardware = { moduli: ["nvme", "i915"], parametri: { "vm.swappiness": "60", "net.ipv4.ip_forward": "0" }, ...(scenario || {}) }; return sh; }
export const HARDWARE = {
  lspci() { return "00:02.0 VGA compatible controller: Simulata GPU\n00:14.0 USB controller: Simulato controller USB\n01:00.0 Network controller: Simulata scheda di rete"; },
  lshw() { return "*-cpu\n     product: CPU simulata\n*-network\n     logical name: enp0s3\n     configuration: link=yes"; },
  dmidecode() { return "System Information\n    Manufacturer: Laboratorio\n    Product Name: Stazione simulata\nMemory Device\n    Size: 16 GB"; },
  lsmod(sh) { return "Module                  Size  Used by\n" + sh.hardware.moduli.map((m) => `${m.padEnd(22)} 16384  0`).join("\n"); },
  modprobe(sh,args) { const m=args[0]; if(!m) throw new ErroreFs("modprobe: manca il modulo"); if(!sh.hardware.moduli.includes(m)) sh.hardware.moduli.push(m); return ""; },
  sysctl(sh,args) { const scrivi=args[0]==="-w"; const voce=args[scrivi?1:0]; if(!voce) throw new ErroreFs("sysctl: manca il parametro"); const [k,v]=voce.split("="); if(scrivi){ if(v===undefined) throw new ErroreFs("sysctl -w richiede nome=valore"); sh.hardware.parametri[k]=v; return `${k} = ${v}`; } if(sh.hardware.parametri[k]===undefined) throw new ErroreFs(`parametro sconosciuto: ${k}`); return `${k} = ${sh.hardware.parametri[k]}`; },
};
