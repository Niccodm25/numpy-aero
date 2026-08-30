// Dischi, mount e volumi simulati: stato esplicito, nessuna modifica reale.
import { ErroreFs } from "./vfs.js";
export function statoStorage(sh, scenario = {}) { sh.storage={ montati:{"/dev/nvme0n1p1":"/"}, ...(scenario||{})}; return sh; }
export const STORAGE={
  lsblk(){return "NAME        SIZE TYPE MOUNTPOINTS\nnvme0n1     200G disk\n└─nvme0n1p1 200G part /\nsdb         1T   disk";},
  mount(sh,args){if(!args.length)return Object.entries(sh.storage.montati).map(([d,p])=>`${d} on ${p} type ext4 (rw)`).join("\n"); if(args.length!==2)throw new ErroreFs("mount: servono dispositivo e punto di mount"); sh.storage.montati[args[0]]=args[1];return "";},
  umount(sh,args){const p=args[0];const d=Object.keys(sh.storage.montati).find(d=>sh.storage.montati[d]===p||d===p);if(!d)throw new ErroreFs("umount: non montato");delete sh.storage.montati[d];return "";},
  mdadm(){return "mdadm: /dev/md0 assemblato, stato clean";},
  cryptsetup(){return "LUKS: volume simulato aperto";},
};
