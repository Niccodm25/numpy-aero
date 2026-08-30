// Metriche coerenti per distinguere CPU, memoria e I/O senza eseguire profiler.
export function statoPrestazioni(sh, scenario = {}) { sh.prestazioni={ cpu:92, memoria:78, io:4.8, ...(scenario||{})}; return sh; }
export const PRESTAZIONI={
  vmstat(sh){const p=sh.prestazioni; return `procs -----------memory---------- ---swap-- -----io----\n r  b   swpd   free  buff  cache   si   so    bi    bo\n ${p.cpu>80?2:0}  0      0   ${8192-p.memoria*80}   400  1200    0    0    ${Math.round(p.io*10)}    12`;},
  iostat(sh){return `Device            tps    kB_read/s    kB_wrtn/s\nnvme0n1          ${sh.prestazioni.io}       1200.00        340.00`;},
  perf(){return " Performance counter stats:\n       2,100,000 cycles\n       1,400,000 instructions";},
  strace(){return "openat(AT_FDCWD, \"dati.csv\", O_RDONLY) = 3\nread(3, ..., 4096) = 4096";},
  bpftrace(){return "Attaching 1 probe...\n@latency: 12";},
  tuned(){return "Current active profile: throughput-performance";},
};
