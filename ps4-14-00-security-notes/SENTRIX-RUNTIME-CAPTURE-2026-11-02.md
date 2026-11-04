# PS4 14.00 Sentrix runtime capture (2026-11-02)

## Evidence source

This note records the user-provided photographs in:

`/home/thiago/Pictures/14.00/`

Files: `IMG_1742.JPG` through `IMG_1750.JPG`.

The visible EXIF timestamps span 2026-11-02 20:08:13 to 20:09:59 (local time). These are photographs of the Sentrix page log, not raw machine-readable telemetry. Values below are transcribed from the images and should be treated as screenshot-derived evidence.

## Observed successful run

### WebKit and kernel-base discovery

The captures show:

- Two scheduled retries before `READ-PRIMITIVE-PASS [3]`.
- `PRIMITIVE-OK`.
- `HX1400-KBASE 0xffffffffc1800000`.
- `HX1400-MILESTONE2 kbase discovery complete`.

The KBASE value is a runtime kernel base pointer. It is not a static firmware RVA and must not be copied into an offsets table.

### HX kernel sequence

The later captures show:

- `KV-ATTEMPT 3/6`.
- `KV-JOINED victim=129 fd=144`.
- `KV-HELD` with a retained victim.
- `D-TREE` with one tree entry.
- `E-GADGET ... ok=true`.
- `F-ROTATE` and `F-FAKEOPS ... ok=true`.

This is materially different from the earlier failed photos, which ended with `FATAL leak scan: no victim held`. The new photographs document a later successful run.

### Credential, guard, and patch checks

The captures show:

- `H-UID before=1 after=0 marker=true`.
- `I-GUARDS stock=24 patched=0 odd=0 total=24 error=none`.
- `J-BLOB ... bytes=632 ... verified=true`.
- `J-PATCH-AFTER rc=0`.
- `K-PATCH-CHECK ... first6=6 narg=2 applied=true`.

The local file `patches/1400.bin` is 632 bytes and has SHA-256:

`165d2ad966b3829d1fbcb53d5e7ecbc20563de4a6a49ee70d8126d0256a49c02`

That matches the PKB SHA-256 embedded in the Sentrix HX tables. This confirms blob identity, not that every local kernel symbol or code path is compatible.

### HEN payload return

The screenshots show:

- `L-AUTHORITY getuid=0 is_jailbroken=1`.
- `L-HEN-SOURCE downloaded 562240 bytes`.
- Payload SHA-256 beginning `756077919fd59abd...` and matching the previously inspected Sentrix `hen.bin`.
- `L-PAYLOAD-COPY bytes=562240 exact=true`.
- `L-HEN-DIRECT-RETURN rc=0 complete=true`.
- `L-HEN-DIRECT-AFTER getuid=0 direct rc=0`.
- `EXPM1-RESTORED`.
- `PROOF-SUMMARY-FINAL pass=6 fail=0`.

Combined with the user's report that GoldHEN appeared normally, this is strong evidence of a successful Sentrix FW 14.00 run. It is not evidence that the local RAW13G legacy kernel chain has been ported.

## Memory profile visible in the successful capture

The on-screen memory box and the inspected Sentrix `core.js` profile indicate:

| Parameter | Observed profile |
| --- | ---: |
| Carrier slots | 9,100,000 |
| Drain count | 48 |
| Drain size | 0x8000 (32 KiB) |
| Slab | 0x300000 (3 MiB) |
| Butterfly hole | 0x60000 |
| Separator | 0x8000 |
| Early hole | 0x60000 |
| Guard | 0x70000 |
| Predecessor | 0x60000 |
| Final hole | 0x60000 |

The screenshots show the Sentrix run reaching primitive success on attempt 3. These values are therefore a useful Stage 1 calibration reference, but not a guarantee that the same heap layout works unchanged in RAW13G: its local SSV/history ordering, ADDROF refresh, allocation lifecycle, and retry logic differ from the external implementation.

## Relevance to RAW13G

Sentrix 14.00 uses the 13.52 WebKit gadget family for userland work, while its kernel path is implemented by the separate HX1400 modules and `hx_tables.js`. Its own offset table explicitly marks the FW 14.00 entry as not intended for the legacy RAW13G full-jailbreak path and leaves legacy kernel offsets undefined.

Therefore:

1. Do not reuse the old RAW13G 13.04/13.52 kernel offsets as FW 14.00 values.
2. Do not treat `0xffffffffc1800000` as an offsets-table constant.
3. Keep `patches/1400.bin` intact; its digest matches the Sentrix PKB.
4. Porting HX Stage 2 and later phases is a separate engineering task. It requires adapting and validating the HX code path, not merely substituting offsets.
5. The memory values above may be used as a controlled Stage 1 experiment, but the local core's different allocation/SSV behavior must be measured independently.

## Local code status after the first correction pass

The FW 14.00 entry in RAW13G now:

- aliases the 13.52 WebKit family;
- marks `kernel_supported=false` and `stage1_only=true`;
- explicitly leaves unverified legacy kernel values undefined;
- carries the screenshot-derived Stage 1 memory profile as an experimental default;
- stops before the legacy RAW13G worker/socket kernel Stage 2.

This is deliberately conservative. It prevents a Stage 1 calibration run from falling into the unrelated legacy kernel path. It does not yet implement the Sentrix/HX kernel chain.

## Validation

After the first correction pass:

- `node --check` passed for the changed JavaScript modules.
- `npm test`: 40 passed, 0 failed.
- `npm run audit:gates`: completed. Its report still describes the older local telemetry run ending in `placement-miss`; it is historical telemetry, not a test of the newly edited profile.
- `git -c core.whitespace=cr-at-eol diff --check`: passed.

No exploit was run on the console as part of these edits.
