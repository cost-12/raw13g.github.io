# PS4 14.00 security notes

These files collect research claims, offsets and local simulations. They are not a verified exploit chain or proof that upstream FreeBSD vulnerabilities affect Orbis 14.00.

## Evidence status (2026-10-31)

| Area | What the local files establish | What remains unverified |
| --- | --- | --- |
| WebKit gadgets | A table of candidate offsets and a scanner/test harness are present. | No firmware dump, scanner output or hardware result is included here to independently establish the offsets or memory primitives. |
| ROP dispatcher | A C model describes a 10-qword frame and alignment arithmetic. | It does not execute a gadget chain or validate the target ABI on a PS4. |
| FreeBSD CVEs | Public CVE records identify affected upstream release branches. | Source lineage, patch status and reachability in Orbis 14.00 are unknown. |
| Kernel offsets | Several files list offsets. | `SYSENT` is labeled both `0x01102B70` and `0x0110A760`; the exact symbol mapping needs primary target evidence. |
| Interactive HTML | The page prints preset messages and uses a local `ArrayBuffer` demo. | It does not inspect a console, read a firmware dump, execute a ROP chain, trigger a CVE or obtain root. |

The detailed dossier in [`RESEARCH.md`](RESEARCH.md) contains historic hypotheses. Read this status note as authoritative where those sections use stronger labels such as “verified,” “confirmed,” or “active.” The CVE/source scope and offset conflict are summarized in [`../RESEARCH_STATUS_REVIEW_2026-10-31.md`](../RESEARCH_STATUS_REVIEW_2026-10-31.md).

## Files

- [`RESEARCH.md`](RESEARCH.md): research claims and their evidence limits.
- [`exploit_1400.html`](exploit_1400.html): visual simulation only; it does not execute an exploit.
- [`SOURCES.md`](SOURCES.md): references and claim map.

## Responsible use

Do not treat a successful model assertion or a message rendered by the HTML page as a target finding. A finding requires target-specific evidence and independent reproduction.
