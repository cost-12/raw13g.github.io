CC      := gcc
CFLAGS  := -Wall -Wextra -O2 -pthread -std=gnu11
TARGETS := test_sound_mmap_race model_semctl_sequence test_execve_args_overflow \
           test_rop_dispatcher_1400 test_cred_root_patch

all: $(TARGETS)

test_sound_mmap_race: test_sound_mmap_race.c
	$(CC) $(CFLAGS) $< -o $@

model_semctl_sequence: model_semctl_sequence.c
	$(CC) $(CFLAGS) $< -o $@

test_execve_args_overflow: test_execve_args_overflow.c
	$(CC) $(CFLAGS) $< -o $@

test_rop_dispatcher_1400: test_rop_dispatcher_1400.c
	$(CC) $(CFLAGS) $< -o $@

test_cred_root_patch: test_cred_root_patch.c
	$(CC) $(CFLAGS) $< -o $@

run-all: all
	@echo "================================================================="
	@echo "  RUNNING LOCAL MODELS / HARNESS DEMONSTRATIONS"
	@echo "  No PS4 / PS5 kernel, firmware dump, or gadget chain is tested"
	@echo "  Standards: ISO/IEC 29147 CVD / García Casado Security Research"
	@echo "================================================================="
	@echo ""
	@echo "--- [1/5] Local model: sound(4) resize/mmap scenario ---"
	@./test_sound_mmap_race
	@echo ""
	@echo "--- [2/5] Arithmetic model: 15-bit counter ---"
	@./model_semctl_sequence
	@echo ""
	@echo "--- [3/5] Local model: execve length arithmetic ---"
	@./test_execve_args_overflow
	@echo ""
	@echo "--- [4/5] Local model: dispatcher frame arithmetic ---"
	@./test_rop_dispatcher_1400
	@echo ""
	@echo "--- [5/5] Local model: credential structure traversal ---"
	@./test_cred_root_patch
	@echo ""
	@echo "================================================================="
	@echo "  [✓] ALL 5 LOCAL HARNESSES COMPLETED"
	@echo "  This is not evidence of a vulnerability or exploit on any console"
	@echo "================================================================="

clean:
	rm -f $(TARGETS)

.PHONY: all clean run-all
