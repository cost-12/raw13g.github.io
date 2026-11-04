/*
 * Arithmetic-only model for a 15-bit generation counter.
 *
 * This program does not call semctl(2), inspect kernel memory, leak a pointer,
 * defeat KASLR, or test CVE-2026-58087/-58098. The CVE records list modern
 * FreeBSD branches; applicability to Sony Orbis is unknown.
 */

#include <assert.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>

int main(void) {
    uint32_t counter = 0;
    const uint32_t mask = 0x7fff;
    const uint32_t increments = 0x8000;

    for (uint32_t i = 0; i < increments; ++i) {
        counter = (counter + 1) & mask;
    }

    assert(counter == 0);
    printf("15-bit masking model: %" PRIu32 " increments -> 0x%04" PRIx32 "\n",
           increments, counter);
    printf("PASS: arithmetic assertion only; no SysV IPC or kernel vulnerability tested.\n");
    return 0;
}
