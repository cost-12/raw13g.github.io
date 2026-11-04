# Análise das execuções FW 14.00 no PS4
Data da análise: 03/11/2026 (horário local America/Fortaleza)

## Resumo executivo

As imagens e o log local mostram pressão de memória durante o estágio WebKit. A mensagem do sistema exibida foi "There is not enough free system memory." O último run recebido pelo servidor terminou nos diagnósticos do estágio 1, com falha de desserialização do `history.state`; não há `execution.end`, passagem da primitiva, transição HX1400, download de `hen.bin` ou evidência de HEN/GoldHEN carregado.

O alerta de memória não identifica por si só a alocação exata que falhou. A pressão de memória é uma explicação consistente com os valores observados, mas ainda é uma inferência, não uma causa raiz confirmada.

## Evidência de console e registros

### Run 1793756218038-320391
Início: 03/11/2026 22:36:58 (hora local).

- Firmware 14.00 reconhecido pelo navegador.
- Perfil `silverps4hen-mem1`: carrier 8.700.000 slots (69.600.000 bytes), drain 96 x 32 KiB, slab 3 MiB.
- Primeira cópia ADDROF: 924.176 caracteres.
- Marcadores do navegador: `SSV-RETURNED-CLEARED`, `READ-PRIMITIVE-PASS`, `PRIMITIVE-OK` e `LIBKERNEL-ERROR-IMPORT-RESOLVED`.
- O log termina sem `execution.end`. Não aparecem conclusão de descoberta de libkernel, início HX1400, `hen.bin` alcançado ou HEN observado.
- `PAIR-STATUS` relata `state=disabled promoted=false` e que 137 MB permanecem fixos. Esse valor é o texto de diagnóstico do código, não uma medição independente da memória física livre.

O marcador `READ-PRIMITIVE-PASS` é client-reported. Não é atestação independente de leitura arbitrária ou de acesso ao kernel.

### Run 1793757225797-146376
Início: 03/11/2026 22:53:45 (hora local).

- O AppCache v68 foi descarregado e marcou 100%/cached imediatamente antes desta execução.
- A primeira tentativa usou 924.176 caracteres e registrou ZERO-HEADER-MISS.
- As tentativas seguintes copiaram 34.478.608 caracteres. As tentativas 2 e 3 registraram falha de desserialização de `history.state`.
- Resultado final: `placement-miss`; `hen.bin` não alcançado.

### Run 1793757441761-658762
Início: 03/11/2026 22:57:21 (hora local). É o run mais recente presente no log lido.

- Perfil novamente em 8.700.000 slots / drain 96 / slab 3 MiB.
- A primeira tentativa copiou 34.478.608 caracteres.
- A auditoria calcula 68.957.200 bytes requeridos para a cópia, contra carrier de 69.600.000 bytes. A margem calculada é 642.800 bytes, aproximadamente 0,61 MiB.
- A primeira tentativa registrou `SSV-PLACEMENT-MISS` com `TypeError: Unable to deserialize data` na etapa `history-state`.
- Nas tentativas 2 e 3 houve ZERO-HEADER-MISS. O limite de tentativas foi atingido e apareceu `HEAP-PLACEMENT-MISS`.
- Não há `execution.end`; portanto o encerramento da página não foi registrado como um resultado terminal da execução.

A foto do terminal contém `ADDROF-COPY [1] chars=924176`, que coincide com a primeira cópia do run 22:36:58. O run das 22:57:21 registra 34.478.608 caracteres na tentativa 1. Como a imagem não fornece um timestamp verificável, a associação exata da foto a uma execução permanece incerta.

## Interpretação da mensagem de memória

Os dados mostram várias alocações grandes e, no último run, uma margem de cobertura muito pequena. Isso torna a pressão de memória plausível. Contudo:

- O alerta do sistema não informa qual objeto ou alocação falhou.
- Os números do carrier, drain, slab e a mensagem de 137 MB têm origens e semânticas distintas; não devem ser somados como se fossem medições independentes e sem sobreposição.
- `source-covered=true` é apenas o resultado do cálculo local de cobertura. Não comprova leitura arbitrária, escrita no kernel ou escape do sandbox.
- `attempt-ceiling` e `HEAP-PLACEMENT-MISS` são sinais de encerramento/recuperação, não a causa raiz.

## Correções locais feitas nesta rodada

1. O servidor local agora preserva campos sanitizados de `execution.blocked`: proprietário, estado, etapa, idade e timestamps do heartbeat. Antes, o navegador os enviava, mas o servidor descartava esses campos.
2. Os testes do servidor cobrem a preservação desses campos.
3. Os diagnósticos FW14 deixaram de emitir `PROOF-OK` para as tabelas RAW13G legadas deliberadamente desativadas. Agora emitem:
   - `LEGACY-KERNEL-TABLE-SKIPPED`
   - `LEGACY-KPATCH-TABLE-SKIPPED`
   - `LEGACY-PAYLOAD-TABLE-SKIPPED`
4. O texto `fw_status` identifica a configuração como referência derivada de captura Sentrix, sem alegar validação independente no console local.
5. README documenta a separação entre offsets legados e dados HX1400.

Não foram alterados os valores do perfil `mem=1`, a rotina de grooming, a promoção de memória, nem o código da cadeia HX1400. Durante as alterações no host, não executei payload nem cadeia de exploit no console. As execuções analisadas neste adendo foram realizadas pelo usuário.

## Validação do host

- `npm test`: 78/78 aprovados.
- `git diff --check`: aprovado.
- AppCache local: `20261103-v69-hx1400-skipped-legacy-tables`.
- Servidor LAN em `192.168.100.204:8080`: health check OK antes da reinicialização remota; atualmente está parado, com `ECONNREFUSED`.
- SHA-256 dos arquivos `jb.js` e `ps4_offsets.js` servidos por HTTP coincidem com os arquivos locais.

O log do PS4 confirma AppCache atualizado em 03/11/2026 às 23:31:59 (horário local), com progresso de 100% e evento `appcache.cached`. Um segundo carregamento também terminou em `appcache.cached` às 23:34:52. O servidor estava servindo a revisão `20261103-v69-hx1400-skipped-legacy-tables` nesses horários. O registro do navegador não grava o texto/hash da revisão, portanto a associação com v69 é baseada na revisão servida pelo host e na conclusão do download naquele intervalo.

## Adendo: execuções posteriores em 03/11/2026

### Run 1793759521380-982881
Início: 23:32:01.383 (hora local).

- Perfil `silverps4hen-mem1`, sem mudança: 8.700.000 slots, drain 96, blocos de 32 KiB e slab de 3 MiB.
- Tentativa 1: 924.176 caracteres, `ZERO-HEADER-MISS`.
- Tentativa 2: 34.478.608 caracteres, `SSV-PLACEMENT-MISS` por `Unable to deserialize data` em `history-state`.
- Tentativa 3: 924.176 caracteres, `SSV-RETURNED-CLEARED`, seguido dos marcadores de navegador `READ-PRIMITIVE-PASS` e `PRIMITIVE-OK`.
- A execução entrou na resolução nativa: `NATIVE-FUNCTION-LOOKUP-OK`, `WEBKIT-BASE-RESOLVED`, `LIBKERNEL-ERROR-IMPORT-RESOLVED` e `LIBKERNEL-ELF-SCAN-START` (step 0x4000, maxSteps 257).
- Não há `LIBKERNEL-ELF-SCAN-COMPLETE`, `HX1400-START`, `execution.end` nem evento de asset HEN.

### Run 1793759539205-560155
Início: 23:32:19.206 (hora local).

- Mesmo perfil `silverps4hen-mem1`.
- Tentativa 1: 924.176 caracteres e `ZERO-HEADER-MISS`.
- Tentativa 2: 34.478.608 caracteres, `SSV-RETURNED-CLEARED`, `READ-PRIMITIVE-PASS` e `PRIMITIVE-OK`.
- Também chegou a `LIBKERNEL-ELF-SCAN-START`, mas não há conclusão do scan, entrada HX1400 ou evento terminal da execução.

### Bloqueios de tentativas adicionais

O servidor recebeu dois eventos `execution.blocked` após os runs acima. O primeiro, às 23:32:13, identificou como proprietário `1793759521380-982881`, estado `running`, etapa 1 e idade aproximada de 12,3 segundos. O segundo, às 23:32:27, identificou `1793759539205-560155` como proprietário, também em `running`, etapa 1.

Os campos do lock agora estão preservados no NDJSON. Isso confirma que páginas posteriores encontraram uma execução anterior ainda marcada como em andamento e foram bloqueadas pelo mecanismo de concorrência. Não prova que a rotina continuava efetivamente ativa no processador, mas, combinado com a ausência de `execution.end` e de `LIBKERNEL-ELF-SCAN-COMPLETE`, aponta para a resolução ELF como o último ponto observado antes da interrupção/estagnação.

### Run 1793759694794-840785
Início: 23:34:54.797 (hora local), após o segundo `appcache.cached`.

- Tentativa 1: 924.176 caracteres e `ZERO-HEADER-MISS`.
- Tentativas 2 e 3: 34.478.608 caracteres cada, ambas com `ZERO-HEADER-MISS`.
- A execução terminou com `THREW: ... attempt-ceiling`, `HEAP-PLACEMENT-MISS` e `execution.end status=placement-miss`.
- `application.asset` registra `status=not-reached` para `hen.bin`.
- Não houve passagem da primitiva, transição HX1400 ou evidência de HEN.

## Interpretação atualizada

Há dois comportamentos distintos nesta rodada: duas execuções avançaram até o início da busca ELF do libkernel, mas não registraram a conclusão; uma terceira voltou a falhar no posicionamento WebKit/SSV. O perfil de memória permaneceu inalterado. Os registros não comprovam que o alerta visual de falta de memória tenha ocorrido nestas três execuções específicas.

A atualização v69 foi descarregada pelo navegador. Entretanto, os eventos `LEGACY-KERNEL-TABLE-SKIPPED`, `LEGACY-KPATCH-TABLE-SKIPPED` e `LEGACY-PAYLOAD-TABLE-SKIPPED` não aparecem no NDJSON porque o filtro do servidor não os incluía. Corrigi o filtro local e acrescentei cobertura de teste, mas a reinicialização remota do servidor foi bloqueada. O processo do servidor foi encerrado e o endpoint `127.0.0.1:8080/__health` respondeu `ECONNREFUSED`; portanto, o servidor está parado no momento desta análise. Para retomá-lo manualmente no host: `cd /home/thiago/raw13g.github.io && node ./scripts/dev-server.js --lan`.

## Próxima decisão

Não recomendo novas tentativas nesta inicialização. As duas execuções que avançaram deixaram a etapa de resolução ELF sem conclusão e o lock registrou novas páginas tentando iniciar enquanto o proprietário anterior ainda constava como `running`. Faça encerramento completo do navegador e reinicialização completa do console antes de qualquer nova sessão. A prioridade de investigação é entender por que a busca ELF não registra conclusão, sem aumentar alocações nem alterar o perfil de memória simultaneamente.

A suíte local permanece em 78/78 testes aprovados e `git diff --check` passou. Nenhum commit, push, deploy, payload ou execução adicional foi realizado durante esta análise.
