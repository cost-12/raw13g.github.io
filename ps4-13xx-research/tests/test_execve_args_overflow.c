/*
 * test_execve_args_overflow.c
 * Arithmetic model inspired by the upstream description of CVE-2026-7270
 *
 * This does not execute execve or verify the upstream implementation in Orbis.
 * Researcher: Adrián García Casado (@adri22235) - García Casado Security Research
 *
 * Hypothesis described in upstream notes (not established for Orbis):
 *   In sys/kern/kern_exec.c -> exec_args_adjust_args(), an operator precedence
 *   calculation flaw evaluates:
 *       memmove_size = endp - begin_argv + consume;  // BUG: Adds consume instead of subtracting
 *   evaluating to an inflated length that writes past the kernel argument slab
 *   buffer, corrupting adjacent exec_args slabs in kernel space.
 */

#include <stdio.h>
#include <stdint.h>
#include <assert.h>

/*
 * Compare manually supplied expressions only; this is not copied kernel code.
 */
static size_t calculate_vulnerable_memmove_size(uintptr_t endp, uintptr_t begin_argv, size_t consume) {
    // Vulnerable FreeBSD code (prior to SA-26:13.exec):
    // endp - begin_argv + consume (due to operator precedence / missing parenthesis)
    return (size_t)(endp - begin_argv + consume);
}

/*
 * Fixed calculation mandated by FreeBSD-SA-26:13.exec
 */
static size_t calculate_fixed_memmove_size(uintptr_t endp, uintptr_t begin_argv, size_t consume) {
    return (size_t)(endp - begin_argv - consume);
}

int main(void) {
    printf("[*] =========================================================\n");
    printf("[*] Local arithmetic model inspired by CVE-2026-7270 notes\n");
    printf("[*] No execve syscall, FreeBSD source, or PS4 kernel is tested\n");
    printf("[*] Researcher: Adrian Garcia Casado (@adri22235)\n");
    printf("[*] =========================================================\n\n");

    uintptr_t begin_argv = 0x1000;
    uintptr_t endp       = 0x1800; // 2048 bytes of arguments
    size_t consume       = 256;    // Interpreter replacement length

    size_t correct_size = calculate_fixed_memmove_size(endp, begin_argv, consume);
    size_t vuln_size    = calculate_vulnerable_memmove_size(endp, begin_argv, consume);

    printf("[+] Argument range: [%p - %p], Initial size = %zu bytes\n", 
           (void *)begin_argv, (void *)endp, (size_t)(endp - begin_argv));
    printf("[+] Consumed interpreter prefix: %zu bytes\n", consume);
    printf("[+] Correct remaining memmove size : %zu bytes\n", correct_size);
    printf("[!] Alternative model expression  : %zu bytes (difference: +%zu bytes)\n", 
           vuln_size, vuln_size - correct_size);

    assert(vuln_size > correct_size);
    assert((vuln_size - correct_size) == (2 * consume));

    printf("\n[+] Arithmetic assertion passed for these selected expressions only.\n");
    printf("    Difference is 2*consume (%zu bytes); no buffer or slab was accessed.\n",
           2 * consume);
    printf("[+] No CVE applicability, PS4 impact, or exploitability was verified.\n");

    return 0;
}
