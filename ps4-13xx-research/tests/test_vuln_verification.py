#!/usr/bin/env python3
"""Toy arithmetic models for research discussion; not FreeBSD/Orbis tests.

These checks do not call kernel syscalls, create races, inspect firmware, or
establish that any CVE affects PS4. They only demonstrate elementary arithmetic
assumptions used in the accompanying notes.
"""

import time


def model_length_delta():
    """Compare two manually supplied formulas; not the upstream kernel code."""
    begin_argv = 0x2000
    endp = 0x3000
    consume = 512
    model_a = endp - begin_argv + consume
    model_b = endp - begin_argv - consume
    return model_a - model_b, consume * 2


def model_15_bit_counter_wrap():
    """Demonstrate masking arithmetic only; does not model SysV IPC state."""
    counter = 0
    started = time.perf_counter()
    for _ in range(0x8000):
        counter = (counter + 1) & 0x7FFF
    elapsed = time.perf_counter() - started
    return counter, elapsed


def main():
    print("Toy arithmetic models — no PS4, Orbis or FreeBSD kernel validation")

    delta, expected = model_length_delta()
    assert delta == expected
    print(f"PASS: selected formulas differ by {delta} bytes (arithmetic only)")

    counter, elapsed = model_15_bit_counter_wrap()
    assert counter == 0
    print(f"PASS: 15-bit mask returns to zero in the model ({elapsed * 1000:.2f} ms)")

    print("SKIP: poll/close race is not modeled; no race-success metric is collected")
    print("Result: model checks passed; no vulnerability or exploitability was verified")


if __name__ == "__main__":
    main()
