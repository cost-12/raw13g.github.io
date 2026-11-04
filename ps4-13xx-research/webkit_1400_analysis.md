# Notas de offsets candidatos: libSceNKWebKit.sprx (PS4 FW 14.00)

> **Estado de evidencia (2026-10-31):** el binario descifrado, los resultados de extracción y una reproducción en consola no están incluidos en este checkout. Los offsets y deltas de abajo son afirmaciones transcritas de notas locales; no se consideran verificados ni prueban ejecución, R/W o una cadena funcional en firmware 14.00.

## García Casado Security Research — Octubre 2026
**Investigadores:** Adrián García Casado (`@adri22235`) & H4SS9M  
**Marco:** ISO/IEC 29147 (CVD) — Laboratorio de Ciberseguridad Ofensiva  

---

## 1. Métricas atribuidas al binario (no comprobables con los archivos presentes)
- **Fichero declarado:** `libSceNKWebKit.sprx.decrypted` (no incluido en este checkout)
- **Firmware origen:** PlayStation 4 Orbis OS — FW 14.00 (16 de septiembre de 2026)
- **Tamaño exacto:** `70.255.992 bytes` (67,0 MB)
- **Arquitectura:** AMD x86_64 (ELF64 / SCE SPRX format)
- **Metodología de extracción:** Búsqueda exhaustiva por secuencias de bytes y análisis comparativo diferencial (BinDiff).

---

## 2. Deltas declarados en las notas (+0x4000)
Los valores listados abaixo tienen esa diferencia aritmética; sin ambos binarios ni el informe del escáner, eso no demuestra un desplazamiento real del segmento de código de Sony:

| Componente / Función | Offset FW 13.50 | Offset FW 14.00 | Desplazamiento (Delta) | Estado |
|----------------------|-----------------|-----------------|------------------------|--------|
| `wk_LEAVE_RET`       | `0x000182F7`    | `0x0001C2F7`    | **`+0x4000`**          | Candidato |
| `wk_POP_RAX_RET`     | `0x00010504`    | `0x00014504`    | **`+0x4000`**          | Candidato |
| `wk_POP_RBX_RET`     | `0x000079E8`    | `0x0000B9E8`    | **`+0x4000`**          | Candidato |
| `wk_POP_RCX_RET`     | `0x0001BADE`    | `0x0001FADE`    | **`+0x4000`**          | Candidato |
| `wk_POP_RDI_RET`     | `0x0005C480`    | `0x00060480`    | **`+0x4000`**          | Candidato |
| `wk_POP_RDX_RET`     | `0x0012C5BA`    | `0x001305BA`    | **`+0x4000`**          | Candidato |
| `wk_POP_RSI_RET`     | `0x0006E45E`    | `0x0007245E`    | **`+0x4000`**          | Candidato |
| `wk_POP_R12_RET`     | `0x02426B15`    | `0x0242AB15`    | **`+0x4000`**          | Candidato |

La resta entre los pares de valores da `0x4000`; atribuirlo a una reubicación del segmento de Sony requiere verificar los binarios correspondientes.

---

## 3. Catálogo de gadgets candidatos (29 entradas; no verificados en el blanco)

### A. Stack Pivots (Redirección de Pila)
- **`wk_XCHG_RAX_RSP_RET`** (`0x03F755A8`): 
  - Mnemónico: `xchg rax, rsp; ret`
  - Propósito: Intercambia el puntero de pila nativo (`RSP`) por la dirección del búfer controlado en memoria de usuario (`RAX`), permitiendo el inicio inmediato de la cadena de ejecución.
- **`wk_POP_RSP_RET`** (`0x00073017`):
  - Mnemónico: `pop rsp; ret`

### B. Primitivas de Lectura y Escritura Arbitraria
- **`wk_MOV_QWORD_RDI_RAX_RET`** (`0x0000948B`):
  - Mnemónico: `mov [rdi], rax; ret`
  - Escritura de 64 bits en la dirección apuntada por `RDI`.
- **`wk_MOV_RAX_QWORD_RDI_RET`** (`0x000E2EA0`):
  - Mnemónico: `mov rax, [rdi]; ret`
  - Lectura de 64 bits desde `RDI` hacia el acumulador `RAX`.
- **`wk_MOV_RAX_QWORD_RAX_RET`** (`0x00014021`):
  - Mnemónico: `mov rax, [rax]; ret`

### C. Configuración de Argumentos para Syscalls (ABI AMD64)
- **`RDI` (Argumento 1):** `0x00060480`
- **`RSI` (Argumento 2):** `0x0007245E`
- **`RDX` (Argumento 3):** `0x001305BA`
- **`RCX` (Argumento 4):** `0x0001FADE`
- **`RAX` (Número de Syscall):** `0x00014504`
- **`R8` (Argumento 5):** `0x0230CBE1`

### D. Operaciones Aritméticas y Control
- **`wk_XOR_RAX_RAX_RET`** (`0x023D14F6`): Limpieza y puesta a cero de `RAX`.
- **`wk_ADD_RAX_RCX_RET`** (`0x00084F67`): Suma de offsets dinámicos.
- **`wk_JMP_RAX`** (`0x00004082`): Salto indirecto para invocación de librerías.

---

## 4. Integración en el Pipeline de Explotación
Los gadgets obtenidos están completamente integrados en:
1. **`webkit_gadgets_1400.js`**: Objeto exportable para inclusión directa en páginas HTML.
2. **`exploit_1400.html`**: Suite interactiva servida en el puerto 8080.
3. **`tests/test_rop_dispatcher_1400.c`**: Banco de pruebas compilado para validación de alineación SSE (16 bytes).
