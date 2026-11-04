# PS4 13.xx / 14.00 Security Research

Joint research by Adrián García Casado (@adri22235) and H4SS9M

> **Evidence status (2026-10-31):** this folder contains research notes and local models, not proof that the listed upstream bugs exist in Orbis 14.00 or that an end-to-end chain works. The SHAREfactory reports concern PS4 11.00 / CUSA00572 and do not establish code execution. See [`../RESEARCH_STATUS_REVIEW_2026-10-31.md`](../RESEARCH_STATUS_REVIEW_2026-10-31.md).

## Status

- **2026-10-19**: FW 14.00 upstream FreeBSD issues collected as leads; Orbis applicability not established (see [`vuln_research_1400.md`](vuln_research_1400.md))
- **2026-10-18**: Celsius KEX integrated for FW 13.04 (full chain: WebKit → Kernel → GoldHEN)
- **2026-09-24**: FW 14.00 kernel offsets added from Al-Azif (Scene-Collective)
- **2026-09-21**: PS4 13.04 jailbroken with GoldHEN v2.4b18.12
- **2026-09-19**: PS4 13.04 jailbroken with HEN 2.2.0
- **2026-09-16**: Sony releases FW 14.00

## Research Areas

### SHAREfactory MP4 issue (H4SS9M)
- The supplied reports describe a crash/heap corruption on PS4 11.00 / CUSA00572.
- They explicitly do not demonstrate instruction-pointer control or code execution.
- Reports: [`SHAREFactory.pdf`](SHAREFactory.pdf) and [`SHAREFACTORY INFORME BUG V1.0 2026-07.pdf`](SHAREFACTORY%20INFORME%20BUG%20V1.0%202026-07.pdf).

### WebKit (Jordy)
- The notes report arbitrary read/write on FW 13.04 and 13.52; this folder does not include independent hardware records for those claims.
- The SSV UAF → addrof → fake-cell → R/W sequence is a reported chain description, not evidence that each stage was reproduced by the included models.

### Kernel Offsets (Adrián)
- Full 13.04 offsets: https://github.com/adri22235/ps4-suid-scanner
- Full 14.00 offsets: `1400_offsets.txt` (source: Al-Azif, Scene-Collective/ps4-hen)

### 14.00 Key Offsets
```
PRISON0    = 0x0111FA18  (unchanged since 13.00)
ROOTVNODE  = 0x02136E90  (unchanged since 13.00)
SYSENT     = unresolved: local files label both 0x01102B70 and 0x0110A760
ALLPROC    = 0x01B28538  (same as 13.04)
```
These are transcribed values, not independently revalidated here. The `SYSENT` label conflict is unresolved; do not infer that every data address is stable across 13.00–14.00 from this list alone.

### FW 14.00 upstream kernel research leads
- Full analysis: [`vuln_research_1400.md`](vuln_research_1400.md)
- FreeBSD CVEs are leads for source comparison only. Their upstream release scope does not establish presence in Sony's Orbis fork or an unpatched PS4 14.00 kernel.
- No priority ranking or exploitability claim is supported by the local test models.

### exFAThax v2
- The local notes report a kernel panic on FW 13.04; no console log or reproduction record is included here.
- Build script: `build_exfathax_v2_image.py`

### Reported IPMI issue (H4SS9M)
- A local note reports a possible issue around syscall 622, but this folder does not include a public advisory, disclosure record, or reproducible evidence for the listed firmware versions.
- Treat the claim as unverified; do not use it as a confirmed offset or vulnerability.

## Credits
- Adrián García Casado — offsets, gadgets, analysis
- H4SS9M — SHAREfactory MP4 research and a reported, unverified IPMI issue
- Al-Azif — 14.00 kernel offsets
- SiSTRo — GoldHEN v2.4b18.12
- zecoxao — kernel dumps
- Pharaoh2k — offset verification
- MasterMaind (@ASaudidos) — BD-J escape confirmation
