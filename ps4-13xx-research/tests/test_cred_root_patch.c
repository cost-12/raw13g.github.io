/*
 * test_cred_root_patch.c
 * 
 * Modelo de asignación emulado em estruturas locais
 * Entorno de investigación: García Casado Security Research
 * Marco Legal: ISO/IEC 29147 (CVD) - Safe Harbor
 * 
 * Demonstra mudanças de campos em structs locais de exemplo. Não acessa kernel:
 * - struct proc (lista allproc)
 * - struct ucred (UID/GID = 0, cr_prison = &prison0)
 * - struct filedesc (fd_rdir = rootvnode, fd_jdir = rootvnode)
 */

#include <stdio.h>
#include <inttypes.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>

#define FW_VERSION "14.00"

// Valores transcritos das notas, sem validação independente no alvo.
#define KERNEL_BASE_SIMULATED   0xFFFFFFFF82000000ULL
#define K1400_PRISON0_OFFSET    0x0111FA18ULL
#define K1400_ROOTVNODE_OFFSET  0x02136E90ULL
#define K1400_ALLPROC_OFFSET    0x01B28538ULL

// Estructura simplificada representativa de struct ucred en FreeBSD 9 / Orbis OS
typedef struct {
    uint32_t cr_ref;        // Contador de referencias
    uint32_t cr_uid;        // Effective user ID
    uint32_t cr_ruid;       // Real user ID
    uint32_t cr_svuid;      // Saved user ID
    int32_t  cr_ngroups;     // Número de grupos suplementarios
    uint32_t cr_rgid;       // Real group ID
    uint32_t cr_svgid;      // Saved group ID
    uint64_t cr_prison;     // Puntero a struct prison (cárcel de aislamiento)
    uint32_t cr_groups[16]; // Grupos suplementarios
} simulated_ucred_t;

// Estructura simplificada representativa de struct filedesc
typedef struct {
    uint64_t fd_rdir;       // Directorio raíz actual del proceso (vnode)
    uint64_t fd_jdir;       // Directorio raíz de jail (vnode)
    uint64_t fd_cdir;       // Directorio de trabajo actual
} simulated_filedesc_t;

// Estructura simplificada representativa de struct proc
typedef struct sim_proc {
    struct sim_proc *p_next; // Enlace a siguiente proceso en allproc
    int32_t p_pid;           // ID de proceso
    char p_comm[32];         // Nombre del ejecutable
    simulated_ucred_t *p_ucred;     // Puntero a credenciales
    simulated_filedesc_t *p_fd;     // Puntero a tabla de descriptores
} simulated_proc_t;

/*
 * Aplica la elevación defensiva de credenciales y ruptura de sandbox en la estructura
 */
static void simulate_credential_assignments(simulated_proc_t *proc, uint64_t prison0_addr, uint64_t rootvnode_addr) {
    printf("[+] Alterando somente struct local para PID %d (%s):\n", proc->p_pid, proc->p_comm);
    
    // 1. UID / GID a Root (0)
    printf("    -> Sobrescribiendo UID: %u -> 0\n", proc->p_ucred->cr_uid);
    proc->p_ucred->cr_uid = 0;
    proc->p_ucred->cr_ruid = 0;
    proc->p_ucred->cr_svuid = 0;
    proc->p_ucred->cr_rgid = 0;
    proc->p_ucred->cr_svgid = 0;
    proc->p_ucred->cr_groups[0] = 0;

    // 2. Escape de Jail: reasignar puntero a PRISON0
    printf("    -> Jail Break: Reasignando cr_prison (0x%016" PRIx64 " -> 0x%016" PRIx64 ")\n",
           (uint64_t)proc->p_ucred->cr_prison, (uint64_t)prison0_addr);
    proc->p_ucred->cr_prison = prison0_addr;

    // 3. Asignar raíz del sistema de ficheros completa a rootvnode
    printf("    -> Chroot Escape: Reasignando fd_rdir y fd_jdir -> 0x%016" PRIx64 "\n", (uint64_t)rootvnode_addr);
    proc->p_fd->fd_rdir = rootvnode_addr;
    proc->p_fd->fd_jdir = rootvnode_addr;
}

int main(void) {
    printf("================================================================\n");
    printf("[+] Modelo local de campos de credencial (rótulo de firmware %s)\n", FW_VERSION);
    printf("[+] Não acessa credenciais, offsets ou sandbox do PS4\n");
    printf("================================================================\n\n");

    uint64_t kbase = KERNEL_BASE_SIMULATED;
    uint64_t prison0_addr   = kbase + K1400_PRISON0_OFFSET;
    uint64_t rootvnode_addr = kbase + K1400_ROOTVNODE_OFFSET;
    uint64_t allproc_addr   = kbase + K1400_ALLPROC_OFFSET;

    printf("[1] Aritmética de endereços com base fictícia e offsets transcritos:\n");
    printf("    Kernel Base: 0x%016" PRIx64 "\n", kbase);
    printf("    PRISON0:     0x%016" PRIx64 " (Offset: +0x%08" PRIx64 ")\n", prison0_addr, (uint64_t)K1400_PRISON0_OFFSET);
    printf("    ROOTVNODE:   0x%016" PRIx64 " (Offset: +0x%08" PRIx64 ")\n", rootvnode_addr, (uint64_t)K1400_ROOTVNODE_OFFSET);
    printf("    ALLPROC:     0x%016" PRIx64 " (Offset: +0x%08" PRIx64 ")\n", allproc_addr, (uint64_t)K1400_ALLPROC_OFFSET);

    // Configurar estructuras simuladas en memoria de prueba
    simulated_ucred_t ucred = {
        .cr_ref = 1,
        .cr_uid = 1002,     // Usuario restringido de WebKit/SceShellUI
        .cr_ruid = 1002,
        .cr_svuid = 1002,
        .cr_ngroups = 1,
        .cr_rgid = 1002,
        .cr_svgid = 1002,
        .cr_prison = kbase + 0x02800000ULL, // Jail restringida
        .cr_groups = { 1002 }
    };

    simulated_filedesc_t fdesc = {
        .fd_rdir = kbase + 0x02900000ULL, // Sandboxed root
        .fd_jdir = kbase + 0x02900000ULL,
        .fd_cdir = kbase + 0x02900000ULL
    };

    simulated_proc_t target_proc = {
        .p_next = NULL,
        .p_pid = 42,
        .p_comm = "SceWebKitApp",
        .p_ucred = &ucred,
        .p_fd = &fdesc
    };

    printf("\n[2] Estado Previo de las Credenciales del Proceso:\n");
    printf("    PID: %d | Comm: %s | UID: %u | Prison: 0x%016llx\n",
           target_proc.p_pid, target_proc.p_comm, target_proc.p_ucred->cr_uid,
           target_proc.p_ucred->cr_prison);

    // Ejecutar el parche
    printf("\n[3] Aplicando atribuições simuladas à struct local:\n");
    simulate_credential_assignments(&target_proc, prison0_addr, rootvnode_addr);

    // Verificaciones
    assert(target_proc.p_ucred->cr_uid == 0);
    assert(target_proc.p_ucred->cr_prison == prison0_addr);
    assert(target_proc.p_fd->fd_rdir == rootvnode_addr);

    printf("\n[4] Verificación de Aserciones Post-Parche:\n");
    printf("    [OK] As structs locais receberam os valores definidos pelo mock\n");

    printf("\n[+] Atribuições locais concluídas; offsets e impacto no PS4 não foram verificados.\n");
    return 0;
}
