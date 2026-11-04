# Sources and claim map

The CVE records below were reviewed on **2026-10-31** for their upstream affected-release scope. The older community references are retained as context and were not revalidated in this review; none establishes applicability to Sony Orbis.

| Source | Claims used | Notes |
| --- | --- | --- |
| [PS4 Developer Wiki — Vulnerabilities](https://www.psdevwiki.com/ps4/Vulnerabilities) | Slopkit is listed through 13.52 and at least partly patched in 14.00; AIO/relapse implementation through 13.52 and possibly patched in 14.00; mast1c0re remains unpatched as of 14.00; non-AF_UNIX socket restriction from 14.00 and browser privilege caveat. | Community-maintained technical index; some analyses are marked undocumented or uncertain. |
| [PS4 Developer Wiki — WebKit Bugs](https://www.psdevwiki.com/ps4/WebKit_Bugs) | WebKit bug range and patch/test notes used as supporting context for the Slopkit discussion. | Community-maintained; entries identify test ranges and upstream fix references where available. |
| [ConsoleMods — PS4 Exploit Chart](https://consolemods.org/wiki/PS4%3AExploit_Chart) | Current public exploit availability summary: no public userland or kernel exploit listed for 14.00 and newer. | Status chart, not proof that private bugs do not exist. |
| [ConsoleMods — PS4 Getting Started](https://consolemods.org/wiki/Ps4_getting_started) | Cross-check of latest publicly exploitable firmware versus 14.00. | Practical community guide; status may be revised. |
| [Sony — PS4 system software support](https://www.playstation.com/en-us/support/hardware/ps4/system-software/) | Official source for current system software update/support information. | Does not provide a vulnerability-by-vulnerability changelog for 14.00. |

## Primary CVE scope records

| Record | Claim supported | Limitation |
| --- | --- | --- |
| [CVE-2026-58087](https://www.cve.org/CVERecord?id=CVE-2026-58087), [CVE-2026-58098](https://www.cve.org/CVERecord?id=CVE-2026-58098) | Upstream FreeBSD affected release branches for the two cited records. | Neither record identifies Sony Orbis as an affected product or proves the relevant code exists in Orbis. |
| [CVE-2026-58093](https://www.cve.org/CVERecord?id=CVE-2026-58093), [CVE-2026-58094](https://www.cve.org/CVERecord?id=CVE-2026-58094) | Upstream FreeBSD affected release branches. | Same limitation; no Orbis lineage or patch comparison. |
| [CVE-2026-7270](https://www.cve.org/CVERecord?id=CVE-2026-7270), [CVE-2026-45251](https://www.cve.org/CVERecord?id=CVE-2026-45251) | Upstream FreeBSD affected release branches. | Same limitation; FreeBSD 9/Orbis applicability is unestablished. |
| [CVE-2026-101308](https://www.cve.org/CVERecord?id=CVE-2026-101308), [CVE-2026-101307](https://www.cve.org/CVERecord?id=CVE-2026-101307), [CVE-2026-49415](https://www.cve.org/CVERecord?id=CVE-2026-49415) | Upstream FreeBSD affected release branches. | Same limitation; branch/date comparison alone cannot prove Sony patch status. |

## Source handling

- A “patched” range is quoted only as the source states it; no claim is made about Sony’s internal patch rationale unless a source identifies it.
- “May be patched” remains tentative.
- Public exploit availability is distinct from vulnerability existence and from a complete exploit chain.
- The repository does not copy source code or claim authorship of external research.
