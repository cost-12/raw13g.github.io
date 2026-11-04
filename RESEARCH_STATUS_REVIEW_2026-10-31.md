# Research status review — 2026-10-31

This review cross-checks the three local research folders against the files and test artifacts in this repository. It records what those artifacts establish and what still needs target-specific evidence. An upstream FreeBSD CVE, a matching hash, or a successful model test does not by itself establish a vulnerability or a working chain on PS4 Orbis.

## FreeBSD CVE applicability

The FreeBSD CVE records list affected release branches for the cited issues. The records below do not list FreeBSD 9 or Orbis OS. This does **not** prove that Sony's fork is unaffected; it means the local reports need a source-lineage or binary comparison before calling any of these a PS4 14.00 candidate.

| CVE | Releases listed as affected by the CVE record | What can be concluded for Orbis 14.00 |
| --- | --- | --- |
| [CVE-2026-58087](https://www.cve.org/CVERecord?id=CVE-2026-58087) | FreeBSD 14.4, 15.0, 15.1 | Orbis applicability is unknown. The record does not establish the reported FreeBSD 9 sequence-counter claim. |
| [CVE-2026-58098](https://www.cve.org/CVERecord?id=CVE-2026-58098) | FreeBSD 14.4, 14.5, 15.0, 15.1 | Orbis applicability is unknown. |
| [CVE-2026-58093](https://www.cve.org/CVERecord?id=CVE-2026-58093) | FreeBSD 14.4, 15.0, 15.1 | Orbis applicability is unknown. |
| [CVE-2026-58094](https://www.cve.org/CVERecord?id=CVE-2026-58094) | FreeBSD 14.4, 15.0, 15.1 | Orbis applicability is unknown. |
| [CVE-2026-7270](https://www.cve.org/CVERecord?id=CVE-2026-7270) | FreeBSD 13.5, 14.3, 14.4, 15.0 | Orbis applicability is unknown; the affected list does not include FreeBSD 9. |
| [CVE-2026-45251](https://www.cve.org/CVERecord?id=CVE-2026-45251) | FreeBSD 14.3, 14.4, 15.0 | Orbis applicability is unknown. |
| [CVE-2026-101308](https://www.cve.org/CVERecord?id=CVE-2026-101308) | FreeBSD 14.4, 14.5, 15.1 | Orbis applicability is unknown. |
| [CVE-2026-101307](https://www.cve.org/CVERecord?id=CVE-2026-101307) | FreeBSD 15.1 | Orbis applicability is unknown. |
| [CVE-2026-49415](https://www.cve.org/CVERecord?id=CVE-2026-49415) | FreeBSD 14.3, 14.4, 15.0, 15.1 | Orbis applicability is unknown. |

The CVE records describe upstream FreeBSD releases and patch boundaries. They do not show whether the corresponding source is present, changed, or patched in Sony's Orbis fork. The prior labels “very high,” “likely present,” “confirmed unpatched,” and “affects all FreeBSD versions” in the local candidate report are withdrawn pending that comparison.

## Offset naming conflict

The research files use `SYSENT` for two values:

- `1400_offsets.txt`, `1400.c`, and the browser table use `k_sysent = 0x01102B70`.
- `ps4-14-00-security-notes/RESEARCH.md` calls `0x0110A760` the `SYSENT` base.
- The browser table separately names `k_sysent_661 = 0x0110A760`.

The files suggest these may be different table symbols, but the local material does not provide enough symbol or kernel-image evidence to resolve the naming. No offset was changed in this review. Treat both labels as unresolved until their exact symbol meanings are tied to a primary 14.00 kernel reference.

## BD-J image status and integrity

`PS4-14.00-BD-JB-INFO/src/NOTICE.txt` calls the image a “local HEN review candidate” and warns that the kernel stage is not independently verified. Its README separately says “confirmed working after 14 attempts,” but the directory contains no raw console logs or independent run record supporting that statement. The supported status is therefore **unverified candidate**, not confirmed working.

The extracted `hen.bin` does match the SHA-256 pin embedded in `InitXlet.java` (`29ec095f…edec06`). That confirms the file matches its local pin; it does not confirm that the disc boots, the kernel stage succeeds, or the HEN runs. A local `jarsigner -verify` of `src/BDMV/JAR/00000.jar` reports that SHA-1 signatures are disabled and the JAR is treated as unsigned by the current JDK. The archive has signature metadata, but that output does not establish a trusted publisher or runtime acceptance by a PS4.

The BD-J dossier is separate from this repository's WebKit host. Its claims are not evidence that the WebKit flow in this project works on 14.00.

## SHAREfactory reports

The two SHAREfactory PDFs describe a separate PS4 11.00 / CUSA00572 MP4 parser issue. Both say instruction-pointer control and code execution were not achieved; one identifies a crash/heap corruption but says a process-memory layout is still needed. These reports do not validate the 14.00 WebKit host, the FreeBSD CVE candidates, or the BD-J image.

## PS4-14.00-Research cross-check and latest host runs

The added [`PS4-14.00-Research/`](PS4-14.00-Research/README.md) workspace is internally consistent with the evidence boundary used here: it reports measured browser-process read/write and native code reuse, while leaving sandbox escape, kernel read/write, and a complete jailbreak **not demonstrated**. Its evidence rules explicitly classify operator firmware labels, user-agent data, source hashes, and captures separately; a capture hash does not attest to a Sony binary or kernel state. The workspace also records a direct UID baseline of `1`, a denied `setuid(0)` (`EPERM`), and a sandbox-state call returning `1`; those are userland boundary observations, not permission to import kernel offsets.

Two new host executions were received after the bounded-diagnostics release:

| Run | Profile | Result | Interpretation |
| --- | --- | --- | --- |
| `1793432334148-181594` | 2,800,000 slots; 1 attempt; `drain=256`; slab 4 MiB | `ADDROF-COPY` reported `source-covered=true`; run remained active and a second page was blocked by the execution lock | Carrier coverage passed; this is not an OOM or an offset failure. |
| `1793432492791-490850` | Same profile | `SSV-PLACEMENT-MISS: TypeError: Unable to deserialize data` followed by `attempt-ceiling` and `placement-miss` at stage 1 | The current reproducible failure is SSV placement/deserialization, before any kernel stage. |

Both runs reported the same offset digest (`0634abc5`), 77 numeric entries, 62 aligned entries, and zero missing required entries. The new research notes reinforce the safe conclusion: do not lower the carrier based on these runs, do not reuse page-local addresses, and do not promote a placement exception to a kernel result. The host keeps extra attempts opt-in; a further attempt should be treated as a fresh stage-1 calibration after the page/browser is closed, not as an automatic retry after a kernel stage.

## Changes based on this review

- The root README now marks firmware 14.00 as configured but not hardware-validated by this WebKit host.
- Upstream CVE notes now separate FreeBSD release scope from unverified Orbis applicability.
- The upstream sentinel uses a repository-relative output path and labels keyword/path matches as review signals, not PS4 zero-days.
- The interactive HTML pages now identify themselves as simulations and no longer print fake “root obtained” or “gadget verified” outcomes.
- The local arithmetic, race, dispatcher and credential harnesses now describe what they actually exercise; the misleading semctl kernel-R/W fixture was replaced by a 15-bit counter model.
- BD-J notes now identify the image as an unverified candidate and distinguish local hash matching from authenticated signatures/runtime success.
- No exploit chain, kernel offset, or payload was changed based on these reports.
