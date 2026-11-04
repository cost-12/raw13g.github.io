/*
 * test_poll_uaf_race.c
 * Local poll/close concurrency exercise; not a CVE verification test
 *
 * This runs on the host OS and does not establish behavior in FreeBSD/Orbis.
 * Researcher: Adrián García Casado (@adri22235) - García Casado Security Research
 *
 * Hypothesized upstream behavior (not established for Orbis):
 *   In sys/kern/sys_generic.c / kern_descrip.c, closing a file descriptor while
 *   a concurrent thread is blocked in poll(2) or select(2) frees the underlying
 *   file/socket object without safely removing the blocked thread from the
 *   per-object wait queue. Upon thread wake-up, a Use-After-Free condition occurs.
 */

#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <fcntl.h>
#include <poll.h>
#include <pthread.h>
#include <stdatomic.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <errno.h>

#define NUM_ITERATIONS 5000

static atomic_int g_stop_flag = 0;
static atomic_long g_poll_calls = 0;
static atomic_long g_close_successes = 0;

typedef struct {
    int fds[2];
    atomic_int ready;
} thread_ctx_t;

static void *poll_worker(void *arg) {
    thread_ctx_t *ctx = (thread_ctx_t *)arg;
    struct pollfd pfd;

    while (!atomic_load(&g_stop_flag)) {
        while (!atomic_load(&ctx->ready) && !atomic_load(&g_stop_flag)) {
            usleep(10);
        }
        if (atomic_load(&g_stop_flag)) break;

        pfd.fd = ctx->fds[0];
        pfd.events = POLLIN | POLLPRI;
        pfd.revents = 0;

        // Block with a short timeout to catch the close race window
        poll(&pfd, 1, 2);

        atomic_store(&ctx->ready, 0);
        atomic_fetch_add(&g_poll_calls, 1);
    }
    return NULL;
}

int main(void) {
    printf("[*] =========================================================\n");
    printf("[*] Local host poll/close concurrency exercise\n");
    printf("[*] Successful close calls are not race detections or UAF evidence\n");
    printf("[*] Researcher: Adrian Garcia Casado (@adri22235)\n");
    printf("[*] =========================================================\n\n");

    pthread_t th;
    thread_ctx_t ctx;
    ctx.fds[0] = -1;
    ctx.fds[1] = -1;
    atomic_init(&ctx.ready, 0);

    if (pthread_create(&th, NULL, poll_worker, &ctx) != 0) {
        perror("[-] pthread_create");
        return 1;
    }

    struct timeval start, end;
    gettimeofday(&start, NULL);

    printf("[+] Executing %d host-process poll/close attempts...\n", NUM_ITERATIONS);

    for (int i = 0; i < NUM_ITERATIONS; i++) {
        if (socketpair(AF_UNIX, SOCK_STREAM, 0, ctx.fds) < 0) {
            perror("[-] socketpair");
            break;
        }

        // Signal worker to enter poll(2)
        atomic_store(&ctx.ready, 1);

        // Microsecond delay to allow worker thread to enter kernel poll wait-queue
        usleep(25);

        // Concurrent close while worker is inside poll()
        if (close(ctx.fds[0]) == 0) {
            atomic_fetch_add(&g_close_successes, 1);
        }
        close(ctx.fds[1]);

        while (atomic_load(&ctx.ready)) {
            usleep(10);
        }
    }

    atomic_store(&g_stop_flag, 1);
    pthread_join(th, NULL);

    gettimeofday(&end, NULL);
    double elapsed_ms = (end.tv_sec - start.tv_sec) * 1000.0 + (end.tv_usec - start.tv_usec) / 1000.0;

    printf("[+] Host poll calls completed: %ld in %.2f ms\n", atomic_load(&g_poll_calls), elapsed_ms);
    printf("[+] Host close calls returned success: %ld\n", atomic_load(&g_close_successes));
    printf("[+] No race condition or target-kernel behavior was detected by this harness.\n");

    return 0;
}
