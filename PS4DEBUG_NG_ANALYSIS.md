# Auditoria Técnica e Arquitetural: ps4debug-NG v1.3.3

O ps4debug-NG é um payload avançado de depuração para PlayStation 4 desbloqueado, compatível com GoldHEN e PS4-HEN. Ele combina um servidor TCP em espaço de usuário, um módulo de acesso ao kernel e um instalador que reúne os componentes em um único binário de release.

A versão integrada ao host RAW13G é a **1.3.3**, validada com suporte declarado a 38 versões de firmware entre 5.05 e 14.00. O payload fornece leitura e escrita de memória, execução remota de funções (RPC), depuração de threads, breakpoints de hardware e software, carregamento dinâmico de ELF e mecanismos de varredura de memória.

---

## 1. Identificação e Arquitetura

Primeiro, uma distinção importante: o projeto encontrado não é o código-fonte do GoldHEN. É o **ps4debug-NG**, um payload de depuração desenvolvido para funcionar em consoles PS4 desbloqueados, inclusive em ambientes com PS4-HEN e GoldHEN.

O projeto é uma reimplementação independente do ps4debug v1.1.19, mantendo compatibilidade com o protocolo de clientes existentes.

A arquitetura possui três componentes:

| Componente | Responsabilidade |
|---|---|
| `installer` | Instalação do payload e aplicação dos patches no kernel. |
| `kdebugger` | Módulo responsável pelas operações privilegiadas no kernel. |
| `debugger` | Servidor TCP, gerenciamento de processos, depuração e protocolo de comunicação. |

O instalador incorpora os outros dois componentes no binário final usando `installer/source/embed.s`.

### Fluxo de execução

1. O payload é carregado pelo mecanismo de execução de payloads do PS4.
2. O instalador identifica o firmware e inicializa as referências do kernel.
3. Aplica os patches específicos do firmware.
4. Instala as chamadas de sistema personalizadas.
5. Carrega o módulo `kdebugger.elf`.
6. Injeta o servidor `debugger.bin`.
7. O servidor começa a aceitar conexões pela porta TCP 744.

O projeto anuncia suporte a **38 versões de firmware, entre 5.05 e 14.00**.

---

# 2. Achados críticos

Estes são os pontos que merecem maior atenção no código.

## CRÍTICO 1: Acesso privilegiado sem autenticação de rede

Arquivos:
- `debugger/source/server.c`
- `debugger/source/kern.c`
- `debugger/source/proc.c`
- `kdebugger/source/hooks.c`

O servidor é iniciado com:

```c
server.sin_addr.s_addr = IN_ADDR_ANY;
server.sin_port = sceNetHtons(SERVER_PORT);
```

Isso significa que ele escuta em todas as interfaces de rede disponíveis.

A porta TCP 744 disponibiliza operações como:

- Leitura arbitrária da memória de processos.
- Escrita arbitrária na memória de processos.
- Alocação e liberação de memória.
- Execução de funções em outros processos.
- Carregamento de executáveis ELF.
- Depuração de threads.
- Leitura da memória do kernel.
- Escrita na memória do kernel.

O problema mais importante está na implementação de `sys_kern_rw()`:

Arquivo: `kdebugger/source/hooks.c`, linhas 392–402.

```c
int sys_kern_rw(struct thread *td, struct sys_kern_rw_args *uap) {
    if(uap->write) {
        cpu_disable_wp();
        memcpy((void *)uap->address, uap->data, uap->length);
        cpu_enable_wp();
    } else {
        memcpy(uap->data, (void *)uap->address, uap->length);
    }

    td->td_retval[0] = 0;
    return 0;
}
```

A função realiza operações diretamente sobre endereços arbitrários do kernel.

O handler correspondente em `debugger/source/kern.c` não exige autenticação antes de processar leitura ou escrita.

**Consequência:** qualquer dispositivo que consiga alcançar o serviço na rede pode acessar operações com privilégios extremamente elevados.

Não é apenas uma questão de autenticação do scanner. O próprio acesso ao kernel está disponível sem passar pelo mecanismo `CMD_PROC_AUTH`.

Minha classificação: **CRÍTICA** quando o serviço está acessível a dispositivos não confiáveis.

## ALTO 2: Ausência de limite global para o tamanho dos pacotes

Arquivo: `debugger/source/server.c`, linhas 162–173.

O servidor recebe `datalen` diretamente do cabeçalho de rede:

```c
length = packet.datalen;

if (length) {
    data = net_alloc_buffer(length);

    if (!data) {
        goto error;
    }

    r = net_recv_all(fd, data, length, 1);
}
```

O tamanho é um `uint32_t`. Não existe um limite global antes da alocação.

A função utilizada para reservar memória é:

Arquivo: `debugger/source/kdbg.c`, linhas 15–19.

```c
void *net_alloc_buffer(size_t size) {
    void *p = malloc(size);
    if (p) prefault(p, size);
    return p;
}
```

`prefault()` percorre toda a memória solicitada.

Isso significa que um cliente pode solicitar uma alocação enorme antes mesmo de o servidor identificar qual comando está sendo enviado.

O problema fica mais relevante porque o servidor aceita até oito clientes simultâneos.

Também encontrei um segundo problema na implementação de transporte:

Arquivo: `debugger/source/net.c`.

`net_recv_all()` continua executando em loop quando recebe `EWOULDBLOCK` e `force` está habilitado.

Como os sockets são configurados como não bloqueantes, um cliente que envia apenas parte de uma requisição pode manter uma thread ocupada em um loop sem espera.

A mesma característica aparece em `net_send_all()`.

**Consequências:**

- Esgotamento de memória.
- Consumo excessivo de CPU.
- Threads de clientes presas indefinidamente.
- Possibilidade de indisponibilidade do debugger.

Minha classificação: **ALTA**.

---

# 3. Autenticação: inconsistências importantes

Este é um dos achados mais relevantes da análise.

## 3.1 A autorização é global, não individual

Arquivo: `debugger/source/proc.c`, linha 2076.

```c
uint32_t g_proc_auth_bits = 0;
```

O handler de autenticação modifica essa variável:

```c
if (ap->flags & 1) g_proc_auth_bits |= 1;
if (ap->flags & 2) g_proc_auth_bits |= 2;
```

Os handlers de varredura consultam a mesma variável global.

Entretanto, o README e o PROTOCOL.md descrevem a autenticação como específica de cada conexão.

Isso não corresponde à implementação.

O efeito prático é:

1. Cliente A autentica.
2. `g_proc_auth_bits` recebe o bit de autorização.
3. Cliente B estabelece outra conexão.
4. Cliente B também passa pelas verificações que consultam a variável global.

Não existe isolamento da autorização por cliente.

## 3.2 O mecanismo de desafio não é uma autenticação criptográfica

A função `proc_auth_xor_keystream()` utiliza estados iniciais fixos:

```c
g_auth_lfsr.s1 = 200;
g_auth_lfsr.s2 = 300;
g_auth_lfsr.s3 = 400;
g_auth_lfsr.s4 = 500;
```

O fluxo gerado é determinístico e o algoritmo está no código-fonte público.

O desafio recebido pelo cliente é transformado com esse fluxo por XOR.

Isso não constitui um mecanismo confiável de autenticação criptográfica: não existe um segredo independente da implementação que permita distinguir um cliente legítimo de qualquer outro que conheça o algoritmo.

Também existe estado global compartilhado no próprio mecanismo LFSR.

## 3.3 A documentação declara proteção que não existe

O README afirma que estas operações exigem autenticação:

- `CMD_PROC_SCAN`
- `CMD_PROC_SCAN_AOB`
- `CMD_PROC_SCAN_AOB_MULTI`
- Família iterativa de scans.

Mas a implementação apresenta outra situação:

| Handler | Verificação de autenticação |
|---|---|
| `proc_scan_handle()` | Não |
| `proc_scan_aob_handle()` | Não |
| `proc_scan_aob_multi_handle()` | Não |
| `proc_scan_start_handle()` | Sim |
| `proc_scan_count_handle()` | Sim |
| `proc_scan_get_handle()` | Sim |
| Família Turbo Scan | Sim, exceto CAPS |

É possível conferir isso procurando `SCAN_REQUIRE_AUTH` em `debugger/source/proc.c`.

O resultado é particularmente significativo: as verificações estão presentes somente na família iterativa, enquanto as duas famílias clássicas de busca não realizam a verificação anunciada.

**Classificação: ALTA.**

A correção arquitetural adequada é manter o contexto de autenticação dentro de cada `server_client`, aplicar autorização em todos os handlers privilegiados e substituir o mecanismo LFSR por autenticação criptográfica com segredo real.

---

# 4. Problemas no módulo de kernel

## ALTO 4: `proc_get_vm_map()` retorna sucesso mesmo quando falha

Arquivo: `kdebugger/source/proc.c`, linhas 52–102.

A função inicializa:

```c
int r = 0;
```

Em determinadas situações, modifica `r` para indicar falha:

```c
if (!info) {
    r = 1;
    goto error;
}
```

Entretanto, no final:

```c
return 0;
```

O resultado é que a função retorna sucesso independentemente do valor de `r`.

Isso afeta funções que dependem dela, especialmente:

- `proc_create_thread()`
- `sys_proc_elf_handle()`
- `sys_proc_elf_rpc_handle()`

Nos dois últimos handlers, o código verifica o retorno de `proc_get_vm_map()` e percorre `entries`.

Se a alocação falhar, `entries` permanece nulo, mas `num_entries` pode continuar positivo.

O código poderá tentar acessar:

```c
entries[i].prot
```

Isso pode provocar uma falha dentro do módulo de kernel.

Existe ainda outro problema: os arrays alocados por `proc_get_vm_map()` não são liberados pelos seus três locais de chamada. Isso representa vazamento de memória do kernel em operações repetidas de injeção e criação de threads.

**Minha avaliação:** este é um dos primeiros defeitos que corrigiria.

## ALTO 5: Validação insuficiente dos dados recebidos

Exemplo:

Arquivo: `debugger/source/kern.c`, linhas 14–19.

```c
struct cmd_kern_read_packet *rp =
    (struct cmd_kern_read_packet *)packet->data;

if (!rp) {
    net_send_int32(fd, CMD_DATA_NULL);
    return 0;
}
```

A função verifica se o ponteiro existe, mas não verifica se `packet->datalen` contém os 12 bytes necessários para representar a estrutura.

Uma requisição com corpo menor pode provocar leitura além do tamanho lógico da alocação.

O mesmo padrão aparece em outros handlers.

A correção precisa contemplar duas camadas:

- Verificação do tamanho da estrutura recebida.
- Validação dos campos individuais antes de utilizá-los.

Não basta verificar se o ponteiro é diferente de `NULL`.

## MÉDIO 6: Overflow na interpretação de padrões AOB múltiplos

Arquivo: `debugger/source/proc.c`, linhas 1917–1967.

Encontrei este cálculo:

```c
if (plen == 0 || cursor + 5 + 2 * plen > patterns_length)
    break;
```

`plen`, `cursor` e `patterns_length` são valores de 32 bits.

A expressão `2 * plen` pode sofrer overflow antes da comparação.

Posteriormente, o código calcula:

```c
const uint8_t *pat = blob + cursor + 5;
const uint8_t *msk = pat + plen;
```

Também acessa:

```c
pats[pi].first_fixed =
    (msk[0] == 1) ? (int16_t)pat[0] : (int16_t)-1;
```

Um tamanho malformado pode fazer o parser aceitar uma estrutura inválida e produzir ponteiros fora da região alocada.

O resultado provável é uma falha do processo servidor.

A validação precisa usar aritmética de 64 bits e verificar explicitamente o tamanho restante antes de cada avanço do cursor.

---

# 5. Concorrência e gerenciamento de conexões

Arquivo: `debugger/source/server.c`.

Encontrei uma condição de corrida na liberação de clientes.

A função `free_client()` começa assim:

```c
void free_client(struct server_client *svc) {
    svc->id = 0;
    sceNetSocketClose(svc->fd);

    if (svc->debugging) {
        debug_full_teardown(svc);
    }

    ...
}
```

O identificador é liberado antes da conclusão da limpeza.

Enquanto isso, `alloc_client()` procura entradas com `id == 0`.

Como a alocação acontece na thread de aceitação e a liberação acontece na thread do cliente, uma nova conexão pode reutilizar a estrutura antes de a conexão anterior terminar de limpá-la.

Isso pode gerar:

- Corrupção do estado de depuração.
- Liberação de recursos pertencentes ao novo cliente.
- Inconsistência nas sessões Turbo Scan.
- Comportamento imprevisível durante conexões simultâneas.

A solução é sincronizar o ciclo de vida das estruturas de cliente e somente disponibilizar uma entrada após a conclusão integral da limpeza.

**Classificação: MÉDIA.**

---

# 6. Compatibilidade com GoldHEN e firmware

Aqui encontrei uma decisão arquitetural positiva.

## Syscalls 257–262

O projeto utiliza:

| Função | Slot |
|---|---:|
| `SYS_PROC_LIST` | 257 |
| `SYS_PROC_RW` | 258 |
| `SYS_PROC_CMD` | 259 |
| `SYS_KERN_BASE` | 260 |
| `SYS_KERN_RW` | 261 |
| `SYS_CONSOLE_CMD` | 262 |

Isso evita utilizar diretamente o bloco tradicional 107–112 associado às implementações anteriores de ps4debug e aos serviços do HEN.

É uma escolha importante para coexistência com GoldHEN.

### Um detalhe que merece atenção

A verificação explícita dos slots 257–262 está presente no caminho especial do firmware 14.00, em `installer/source/installer.c`, aproximadamente nas linhas 845–861.

Nesse caminho, o instalador verifica se as entradas ainda apontam para `nosys` antes de modificá-las.

Nos demais firmwares, `install_hooks()` sobrescreve as estruturas de syscall diretamente.

Isso merece uniformização: a verificação de ocupação precisa existir para todas as versões suportadas.

## Firmware 14.00

A implementação específica do firmware 14.00 é interessante.

Ela verifica 17 regiões do kernel antes de escrever os patches. Também aceita algumas variantes de patch previamente aplicadas pelo loader e verifica os slots de syscall.

Outro detalhe positivo: salva o CR0 original e restaura exatamente o valor recebido após as alterações.

Nos firmwares anteriores, o caminho utiliza as tabelas de patches diretamente, sem a mesma validação individual das regiões antes da escrita.

Há também uma ressalva importante na própria documentação:

O suporte a 14.00 foi comparado com binários retail descriptografados, incluindo offsets de kernel e variantes de libkernel. O README não apresenta comprovação de validação em hardware para essa versão.

Portanto, a compatibilidade declarada não deve ser confundida com uma matriz de testes físicos concluídos.

---

# 7. Análise do Turbo Scan

Esta é uma das partes tecnicamente mais interessantes do projeto.

Arquivo principal: `debugger/source/scan_turbo.c`.

A implementação possui:

| Tecnologia | Finalidade |
|---|---|
| SIMD | Aceleração de comparações. |
| Server-resident | Manter resultados no PS4. |
| Snapshot | Registrar valores iniciais da memória. |
| Multi-segment | Examinar regiões descontínuas. |
| Aliasing | Acessar páginas por mapeamento alternativo. |
| Parallel compare | Distribuir a comparação entre threads. |
| Float policy | Controlar comparação de floats e doubles. |
| Spill to disk | Deslocar snapshots grandes para armazenamento. |

Há uma boa decisão de compatibilidade de hardware na implementação SIMD.

O PS4 utiliza AMD Jaguar, que oferece AVX1, mas não AVX2. O código evita depender de uma instrução de comparação inteira AVX2 de 256 bits que causaria `#UD` nesse processador.

A implementação utiliza cargas YMM e combina resultados de operações de 128 bits.

Também existe uma estratégia de fallback para leitura convencional quando o mecanismo de aliasing não consegue atender a uma região.

Isso é particularmente importante em um ambiente de kernel com diferentes tipos de mapeamento de memória.

Minha avaliação: **arquitetura avançada, com uma implementação que merece testes específicos de regressão e desempenho no console.**

---

# 8. Análise do binário de release

Arquivo:

`ps4debug-ng_v1.3.3_release_2026-11-02.bin`

| Propriedade | Resultado |
|---|---|
| Tamanho | 3.175.432 bytes |
| Tamanho em MiB | 3,03 MiB |
| Versão identificada | 1.3.3 |
| Arquitetura | x86-64 |
| Formato externo | Binário raw |
| ELF embutido | Sim |
| SHA-256 | `b348affbb6434ff6892ce24e5f1387e4e6657756c3ba42d117fb73b58d08f7a2` |

Uma descoberta importante: o arquivo externo não possui cabeçalho ELF convencional.

Por isso, `readelf -h` aplicado diretamente ao `.bin` não funciona.

A análise estrutural encontrou um ELF64 válido embutido no offset:

```text
0x58A0
```

Esse componente possui:

- ELF64.
- `ET_DYN`.
- Máquina `EM_X86_64`.
- Três segmentos de programa.
- Entry point `0x120`.

Ele corresponde à estrutura esperada para o módulo de kernel incorporado ao instalador.

O restante do payload utiliza o formato binário bruto produzido pelo processo de compilação.

O comando `file` o identifica como DOS COM, mas isso é uma classificação heurística. Não significa que seja um executável DOS.

### Integridade do release

Encontrei um detalhe importante:

O `.bin` está excluído do Git pela regra:

```gitignore
*.bin
```

Consequentemente, o binário não está versionado junto com o código-fonte.

A versão interna corresponde a 1.3.3 e o repositório está marcado com a tag `1.3.3`, mas não foi possível demonstrar equivalência binária entre o arquivo e uma compilação reproduzida desse commit.

O hash SHA-256 acima serve como identificação exata do artefato analisado.

---

# 9. Processo de compilação e qualidade do projeto

O `build.sh` exige:

| Ferramenta | Versão exigida |
|---|---|
| Sistema | Ubuntu 24.04 |
| GCC | 13.3.0 |
| Clang C++ | clang++-18 |
| Arquitetura de destino | x86-64 / AMD Jaguar |

A separação entre o compilador C e o compilador C++ é coerente com a integração do Keystone.

Também encontrei:

- Código licenciado sob GPL-3.0-only.
- Keystone 0.9.2.
- Zydis incorporado.
- Runtime C++ próprio para o ambiente PS4.
- Makefiles independentes para os componentes.

Entretanto, há uma deficiência de engenharia: não encontrei uma suíte de testes específica do ps4debug-NG nem uma configuração própria de CI para validar os componentes.

A máquina disponibilizada pelo Desktop Commander também não possui GCC, Make ou clang++-18 instalados. Por isso, não foi possível executar uma compilação de validação nem testes dinâmicos do payload.

A análise do binário foi estática.

---

# 10. Resumo de prioridades

| Prioridade | Achado | Componente |
|---|---|---|
| CRÍTICA | Acesso remoto ao kernel sem autenticação | Servidor / Kernel |
| ALTA | Comprimento de pacotes sem limite global | Servidor |
| ALTA | Autenticação global e documentação incorreta | Proc / Turbo Scan |
| ALTA | `proc_get_vm_map()` retorna sucesso após falha | Kernel |
| ALTA | Validação insuficiente dos tamanhos recebidos | Protocolo |
| MÉDIA | Overflow no parser AOB múltiplo | Proc |
| MÉDIA | Corrida durante liberação de clientes | Servidor |
| MÉDIA | Ausência de validação uniforme dos patches | Installer |
| MÉDIA | Falta de testes automatizados próprios | Projeto |

## 11. Veredito técnico

O ps4debug-NG é um projeto consideravelmente mais ambicioso que uma simples implementação de leitura e escrita de memória.

Ele possui três áreas particularmente fortes:

1. Integração de debugger de processos com controle de threads e registradores.
2. Sistema de busca de memória com snapshots, processamento paralelo e otimizações específicas para o Jaguar.
3. Arquitetura de compatibilidade com diferentes firmwares e coexistência com HEN por meio de slots de syscall separados.

Entretanto, existem problemas reais na camada de rede, na autenticação e no gerenciamento de memória do módulo de kernel.

O ponto mais preocupante é a exposição das operações privilegiadas pela porta 744 sem autenticação efetiva. O segundo é a combinação de pacotes sem limite, recepção bloqueada por loops ativos e handlers que não validam adequadamente os tamanhos recebidos.

**Minha recomendação de engenharia é corrigir primeiro a fronteira entre rede e kernel, depois os erros de gerenciamento de memória e, por último, as condições de concorrência e validação de firmware.**

A próxima etapa de maior retorno é uma revisão corretiva de `server.c`, `net.c`, `proc.c` e `kdebugger/source/proc.c`, com patches concretos e preservação da compatibilidade do protocolo v1.3.3.
