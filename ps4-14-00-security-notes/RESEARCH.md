# PS4 Firmware 14.00 Technical Research Notes

> **Evidence correction (2026-10-31):** this is a collection of hypotheses and static notes, not a validated PS4 14.00 exploit dossier. The tree does not contain a target dump or independent runtime record supporting the claims of native WebKit R/W, gadget execution, kernel reachability, or completed privilege escalation. The CVEs below describe upstream FreeBSD release branches; their applicability to Sony's Orbis fork is unknown. A local model or HTML log is not target verification. See [`README.md`](README.md) and [`../RESEARCH_STATUS_REVIEW_2026-10-31.md`](../RESEARCH_STATUS_REVIEW_2026-10-31.md).

**Snapshot Date:** October 26, 2026  
**Lead Researcher:** Adrián García Casado (`@adri22235`)  
**Research Entity:** García Casado Security Research (García Casado Cyber Lab)  
**Primary Repository:** [adri22235/ps4-13xx-research](https://github.com/adri22235/ps4-13xx-research)  
**Target Scope:** PlayStation 4 Orbis OS Firmware 14.00 (Build Release: September 16, 2026)  
**Compliance Standard:** ISO/IEC 29147 (Coordinated Vulnerability Disclosure) & ISO/IEC 30111  

---

## 1. Executive Technical Summary

Firmware 14.00 represents a critical demarcation point within the PlayStation 4 system architecture. Disclosed on September 16, 2026, it immediately preceded the emergency security maintenance rollout of Firmware 14.10 on October 1, 2026.

Current evidence state:
* **WebKit:** the notes contain candidate gadget offsets and a proposed flow; this checkout alone does not establish native execution or arbitrary read/write on firmware 14.00.
* **Sandbox:** socket restrictions are reported by secondary/community sources and need target-specific confirmation before being treated as an observed property of this build.
* **Kernel:** FreeBSD issues are upstream research leads. No candidate below is confirmed present, unpatched, or reachable in Orbis 14.00.

---

## 2. Hypothesized firmware 14.00 architecture (not demonstrated)

The following is a proposed research diagram only; none of these transitions is demonstrated by the local harnesses:

```mermaid
flowchart LR
    A["Proposed WebKit entry\n(not verified on FW 14.00)"] --> B["Candidate pivot offset\n(target bytes not supplied)"]
    B --> C["Local dispatcher model\n(no gadget execution)"]
    C --> D{"Upstream CVE leads\n(Orbis applicability unknown)"}
    D -->|CVE-2026-101308| E["sound(4) claim\n(source comparison required)"]
    D -->|CVE-2026-7270| F["execve claim\n(FreeBSD 9 not listed)"]
    D -->|CVE-2026-58087| G["semctl claim\n(source comparison required)"]
    E --> H["Possible impact only\n(not demonstrated)"]
    F --> H
    G --> H
    H --> I["No ring0 or credential result\nin local evidence"]
```

---

## 3. WebKit Binary Analysis (`libSceNKWebKit.sprx`)

* **Target binary named in the notes:** `libSceNKWebKit.sprx.decrypted` (FW 14.00); it is not included in this checkout.
* **File size claimed by the notes:** 70,255,992 bytes (67.0 MB); not independently checked here.
* **Architecture delta claimed:** `+0x4000` for selected entries; arithmetic differences do not prove the addresses exist in the target binary.
* **Extraction tooling:** [`scripts/find_webkit_gadgets_1400.py`](https://github.com/adri22235/ps4-13xx-research/blob/main/scripts/find_webkit_gadgets_1400.py) is present, but no output from a verified firmware dump is included.

### Candidate gadget map (29 entries; target verification not supplied)

The offsets below are transcribed from the research notes. The firmware image, extraction output and independent target observation needed to verify them are not included in this checkout.

| Identifier | Offset (FW 14.00) | Offset (FW 13.50) | Delta | Instruction / Semantic Function |
| :--- | :--- | :--- | :--- | :--- |
| `wk_RET` | `0x00004032` | `0x03cbc51b` | Relocated | `ret` (Alignment / Trampoline) |
| `wk_LEAVE_RET` | `0x0001c2f7` | `0x000182f7` | `+0x4000` | `leave; ret` |
| `wk_POP_RAX_RET` | `0x00014504` | `0x00010504` | `+0x4000` | `pop rax; ret` (Syscall number / Return) |
| `wk_POP_RBX_RET` | `0x0000b9e8` | `0x000079e8` | `+0x4000` | `pop rbx; ret` |
| `wk_POP_RCX_RET` | `0x0001fade` | `0x0001bade` | `+0x4000` | `pop rcx; ret` (Argument 4 in C ABI) |
| `wk_POP_RDX_RET` | `0x001305ba` | `0x0012c5ba` | `+0x4000` | `pop rdx; ret` (Argument 3) |
| `wk_POP_RSI_RET` | `0x0007245e` | `0x0006e45e` | `+0x4000` | `pop rsi; ret` (Argument 2) |
| `wk_POP_RDI_RET` | `0x00060480` | `0x0005c480` | `+0x4000` | `pop rdi; ret` (Argument 1) |
| `wk_POP_RBP_RET` | `0x000040b6` | `0x03ccc7a2` | Relocated | `pop rbp; ret` |
| `wk_POP_RSP_RET` | `0x00073017` | `0x03cbc51a` | Relocated | `pop rsp; ret` |
| `wk_POP_R8_RET` | `0x0230cbe1` | `0x0005c47f` | Relocated | `pop r8; ret` (Argument 5) |
| `wk_POP_R12_RET` | `0x0242ab15` | `0x02426b15` | `+0x4000` | `pop r12; ret` |
| `wk_POP_R14_RET` | `0x000a9e91` | `0x000a5e91` | `+0x4000` | `pop r14; ret` |
| `wk_POP_R15_RET` | `0x0006047f` | `0x0005c47f` | `+0x4000` | `pop r15; ret` |
| `wk_MOV_RAX_RDI_RET` | `0x00023320` | `0x0001f320` | `+0x4000` | `mov rax, rdi; ret` |
| `wk_MOV_RDX_RAX_RET` | `0x001ceba9` | `0x001caba9` | `+0x4000` | `mov rdx, rax; ret` |
| `wk_XCHG_RAX_RSP_RET` | `0x03f755a8` | `0x03f715a8` | `+0x4000` | `xchg rax, rsp; ret` **(Primary Stack Pivot)** |
| `wk_MOV_QWORD_RDI_RAX_RET`| `0x0000948b` | `0x0000548b` | `+0x4000` | `mov [rdi], rax; ret` **(Arbitrary Write)** |
| `wk_MOV_RAX_QWORD_RAX_RET`| `0x00014021` | `0x00010021` | `+0x4000` | `mov rax, [rax]; ret` **(Arbitrary Read)** |
| `wk_MOV_RAX_QWORD_RDI_RET`| `0x000e2ea0` | `0x000deea0` | `+0x4000` | `mov rax, [rdi]; ret` **(Arbitrary Read)** |
| `wk_ADD_RAX_RCX_RET` | `0x00084f67` | `0x00080f67` | `+0x4000` | `add rax, rcx; ret` |
| `wk_SUB_RAX_RCX_RET` | `0x0098736c` | `0x0098336c` | `+0x4000` | `sub rax, rcx; ret` |
| `wk_XOR_RAX_RAX_RET` | `0x023d14f6` | `0x023cd4f6` | `+0x4000` | `xor rax, rax; ret` (Zero RAX) |
| `wk_INC_RAX_RET` | `0x00c5e51c` | `0x00c5a51c` | `+0x4000` | `inc rax; ret` |
| `wk_JMP_RAX` | `0x00004082` | `0x00004082` | `0x0000` | `jmp rax` |
| `wk_CALL_RAX` | `0x00004041` | `0x00004041` | `0x0000` | `call rax` |
| `wk_JMP_RCX` | `0x00012a2a` | `0x0000ea2a` | `+0x4000` | `jmp rcx` |
| `wk_POP_R13_R14_R15_RET` | `0x0006047b` | `0x0005c47b` | `+0x4000` | `pop r13; pop r14; pop r15; ret` |
| `wk_POP_RBX_RBP_RET` | `0x0000ad0f` | `0x00006d0f` | `+0x4000` | `pop rbx; pop rbp; ret` |

---

## 4. ROP Dispatcher Specification & ABI Compliance

The C harness in [`tests/test_rop_dispatcher_1400.c`](https://github.com/adri22235/ps4-13xx-research/blob/main/tests/test_rop_dispatcher_1400.c) models a 10-qword (80-byte) frame and checks arithmetic/alignment assumptions. It does not execute gadgets or validate a frame on firmware 14.00.

### Dispatcher Frame Layout

| Index | Element | Register Target / Purpose | Gadget Offset (14.00) |
| :---: | :--- | :--- | :--- |
| `[00]` | `base + GADGET_POP_RDI_RET` | Load Argument 1 | `0x00060480` |
| `[01]` | `arg1` (Immediate 64-bit) | RDI Register | — |
| `[02]` | `base + GADGET_POP_RSI_RET` | Load Argument 2 | `0x0007245E` |
| `[03]` | `arg2` (Immediate 64-bit) | RSI Register | — |
| `[04]` | `base + GADGET_POP_RDX_RET` | Load Argument 3 | `0x001305BA` |
| `[05]` | `arg3` (Immediate 64-bit) | RDX Register | — |
| `[06]` | `base + GADGET_POP_RCX_RET` | Load Argument 4 / Wrapper Target | `0x0001FADE` |
| `[07]` | `arg4` (Immediate 64-bit) | RCX Register | — |
| `[08]` | `base + GADGET_POP_RAX_RET` | Load Syscall ID / Dispatcher | `0x00014504` |
| `[09]` | `syscall_num` (Immediate 64-bit) | RAX Register | — |

### Technical Architecture Notes:
1. **Calling Conventions (System V AMD64 vs Direct Syscall):**
   * **Userspace Wrappers (`libkernel`):** Standard C calling conventions use `RDI`, `RSI`, `RDX`, `RCX`, `R8`, and `R9`. When dispatching through `libkernel.sprx` wrapper stubs, parameter 4 is correctly placed in `RCX`.
   * **Direct Hardware Syscalls:** The x86_64 `syscall` instruction natively clobbers `RCX` (saving return `RIP`) and `R11` (saving `RFLAGS`). The FreeBSD kernel ABI expects parameter 4 in `R10`. For direct kernel traps, the frame passes control through a wrapper or intermediary register move gadget (`mov r10, rcx`).
2. **Stack Alignment Invariant:**
   * Frame size: $10 \times 8 = 80\text{ bytes}$.
   * Alignment check: $80 \pmod{16} = 0$.
   * The frame structure inherently preserves 16-byte stack parity across calls. An auxiliary `ret` gadget (`0x00004032`) is prepended as an alignment shim whenever an entry pivot lands on an odd 8-byte boundary.

---

## 5. Firmware 14.00 Kernel Data Offsets (GoldHEN Standard)

Kernel symbol offsets for Firmware 14.00 have been cataloged for post-exploitation payload integration (`kpayload`):

| Symbol | FW 14.00 Offset | FW 13.04 Offset | Functionality in Ring0 Payload |
| :--- | :--- | :--- | :--- |
| `PRISON0` | `0x0111FA18` | `0x0111FA18` | Root jail context; zeroed to escape sandbox |
| `ROOTVNODE` | `0x02136E90` | `0x02136E90` | Root directory vnode; assigned to `p_fd->fd_rdir` |
| `ALLPROC` | `0x01B28538` | `0x01B28538` | Head of global process linked list (`struct proc`) |
| `SYSENT` | Conflicting labels: `0x0110A760` and `0x01102B70` | `0x01102B70` appears in other local files | Symbol identity and the claimed delta are unresolved; do not use as a verified target address |
| `XFAST_SYSCALL` | `0x000001C0` | `0x000001C0` | Kernel syscall entry handler |
| `memcpy` | `0x002BD850` | `0x002BD850` | Internal kernel memory copy subroutine |
| `proc_rwmem` | `0x00366A10` | `0x00366A10` | Cross-process memory read/write subroutine |

---

## 6. Upstream FreeBSD CVE scope

Orbis is described by secondary sources as FreeBSD-derived, but the exact code lineage for these components is not established here. The table states only the affected FreeBSD release branches listed in the CVE records. No entry confirms presence, patch state, or reachability in Orbis 14.00.

| CVE | Affected FreeBSD branches listed in the record | Orbis 14.00 |
| :--- | :--- | :--- |
| [CVE-2026-49415](https://www.cve.org/CVERecord?id=CVE-2026-49415) | 14.3, 14.4, 15.0, 15.1 | Unknown |
| [CVE-2026-101308](https://www.cve.org/CVERecord?id=CVE-2026-101308) | 14.4, 14.5, 15.1 | Unknown |
| [CVE-2026-7270](https://www.cve.org/CVERecord?id=CVE-2026-7270) | 13.5, 14.3, 14.4, 15.0 | Unknown; FreeBSD 9 is not listed |
| [CVE-2026-58087](https://www.cve.org/CVERecord?id=CVE-2026-58087) | 14.4, 15.0, 15.1 | Unknown |
| [CVE-2026-58098](https://www.cve.org/CVERecord?id=CVE-2026-58098) | 14.4, 14.5, 15.0, 15.1 | Unknown |
| [CVE-2026-58093](https://www.cve.org/CVERecord?id=CVE-2026-58093) | 14.4, 15.0, 15.1 | Unknown |
| [CVE-2026-58094](https://www.cve.org/CVERecord?id=CVE-2026-58094) | 14.4, 15.0, 15.1 | Unknown |
| [CVE-2026-45251](https://www.cve.org/CVERecord?id=CVE-2026-45251) | 14.3, 14.4, 15.0 | Unknown |
| [CVE-2026-101307](https://www.cve.org/CVERecord?id=CVE-2026-101307) | 15.1 | Unknown |

The previous “very high,” “fully intact in FreeBSD 9,” and “highly relevant to Orbis” descriptions are not substantiated by these records and are withdrawn pending source/binary comparison.

---

## 7. Firmware Version Timeline & Scene Context

* Firmware dates, update motivations, enforcement claims and exploit status in this historical section have not been independently verified in this checkout. Do not infer that a WebKit vulnerability remains exploitable from the date or offset table alone.
* **Cross-Platform PS5 Repository:** Detailed architectural analysis of FreeBSD vectors applied to Prospero OS (PS5) and hypervisor bridge specifications are documented at [adri22235/ps5-security-research](https://github.com/adri22235/ps5-security-research).
* **Research Recommendation:** Consoles targeting homebrew or security verification on Firmware 14.00 must remain strictly offline to prevent unwanted automatic updating to 14.10+.

---

## 8. Primary Tooling & Test Harness Inventory

The test harnesses supporting this research are located in the primary research repository:

1. `scripts/find_webkit_gadgets_1400.py` — scanner source; a scan against an independently verified 14.00 dump is not supplied here.
2. `scripts/freebsd_vuln_sentinel.py` — upstream commit keyword/path filter; it cannot infer Orbis applicability.
3. `tests/test_rop_dispatcher_1400.c` and `tests/model_semctl_sequence.c` — local models, not target execution.
4. `tests/test_cred_root_patch.c` — local structure model, not kernel offset or credential validation.
5. `exploit_1400.html` — visual simulation; generated messages are not observations from a PS4.
