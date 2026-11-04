/*
 * test_sound_mmap_race.c
 * Local concurrency mock for the scenario described by CVE-2026-101308
 *
 * This host-process mock is not a FreeBSD/Orbis kernel or mmap test.
 * Researcher: Adrián García Casado (@adri22235) - García Casado Security Research
 *
 * Hypothesized upstream behavior (not established for Orbis):
 *   In sys/dev/sound/pcm/channel.c / buffer.c, audio channel buffer resizing
 *   checks that a buffer is not memory-mapped, drops the channel lock to
 *   allocate replacement memory, but fails to re-verify the mapping status
 *   after re-acquiring the lock. A concurrent mmap(2) maps the original buffer,
 *   which is then freed by the resize path, causing a Kernel Use-After-Free (UAF).
 */

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <stdbool.h>
#include <pthread.h>
#include <unistd.h>
#include <assert.h>

typedef struct {
    pthread_mutex_t lock;
    void *buffer_ptr;
    size_t buffer_size;
    bool is_mapped;
} mock_snd_channel_t;

static mock_snd_channel_t g_channel;

// Simulates kernel channel buffer resize routine
static int chn_resize_buffer(mock_snd_channel_t *c, size_t new_size) {
    pthread_mutex_lock(&c->lock);

    // Initial check: cannot resize if actively mapped
    if (c->is_mapped) {
        pthread_mutex_unlock(&c->lock);
        return -1;
    }

    // Vulnerable window: drop lock to perform kernel memory allocation
    pthread_mutex_unlock(&c->lock);
    void *new_buf = malloc(new_size);
    usleep(100); // Window where concurrent mmap(2) succeeds
    pthread_mutex_lock(&c->lock);

    // BUG: Missing re-verification of c->is_mapped after reacquiring lock!
    // Correct fix: if (c->is_mapped) { free(new_buf); pthread_mutex_unlock(&c->lock); return -1; }

    void *old_buf = c->buffer_ptr;
    c->buffer_ptr = new_buf;
    c->buffer_size = new_size;

    // Free the old buffer even though it was mapped concurrently -> UAF!
    free(old_buf);

    pthread_mutex_unlock(&c->lock);
    return 0;
}

static void *mmap_interceptor(void *arg) {
    mock_snd_channel_t *c = (mock_snd_channel_t *)arg;
    usleep(50); // Enter precisely during the unlocked allocation window

    pthread_mutex_lock(&c->lock);
    c->is_mapped = true;
    printf("[!] Race triggered: Concurrent mmap(2) mapped buffer at %p\n", c->buffer_ptr);
    pthread_mutex_unlock(&c->lock);

    return NULL;
}

int main(void) {
    printf("[*] =========================================================\n");
    printf("[*] Local state-machine mock: sound resize/mmap scenario\n");
    printf("[*] No sound device, kernel buffer, or mmap syscall is used\n");
    printf("[*] Researcher: Adrian Garcia Casado (@adri22235)\n");
    printf("[*] =========================================================\n\n");

    pthread_mutex_init(&g_channel.lock, NULL);
    g_channel.buffer_size = 4096;
    g_channel.buffer_ptr = malloc(g_channel.buffer_size);
    g_channel.is_mapped = false;

    printf("[+] Initial channel buffer allocated at: %p (size: %zu)\n", 
           g_channel.buffer_ptr, g_channel.buffer_size);

    pthread_t th;
    pthread_create(&th, NULL, mmap_interceptor, &g_channel);

    int ret = chn_resize_buffer(&g_channel, 8192);
    pthread_join(th, NULL);

    printf("[+] Resize routine completed with return code: %d\n", ret);
    printf("[!] Mock state: is_mapped = %s, current buffer = %p\n",
           g_channel.is_mapped ? "TRUE (flag only; mapping not performed)" : "FALSE",
           g_channel.buffer_ptr);

    printf("\n[+] Mock completed; no UAF, CVE, firmware impact, or exploitability was verified.\n");

    free(g_channel.buffer_ptr);
    pthread_mutex_destroy(&g_channel.lock);
    return 0;
}
