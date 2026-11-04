# PS4 firmware 14.00: revisão dos candidatos de kernel

**Revisado em:** 2026-10-31  
**Escopo:** avaliar o que as notas locais e os registros públicos de CVE realmente demonstram.

> **Conclusão:** os itens abaixo são referências para comparação de código. Os registros públicos descrevem branches recentes do FreeBSD; não demonstram que o código vulnerável esteja presente, sem patch, no fork Orbis da Sony. Não há nesta pasta uma comparação de fonte/binário de Orbis 14.00 que confirme esses candidatos. Portanto, não os classifique como vulnerabilidades confirmadas, “provavelmente presentes” ou exploráveis no PS4.

## Limites da evidência

- Uma correção upstream publicada depois da data de lançamento do firmware não prova que a Sony não tenha aplicado uma correção equivalente antes ou depois do lançamento.
- A descrição “Orbis derivado de FreeBSD 9” não é suficiente para concluir que uma função, implementação ou bug específico foi mantido. É preciso comparar o código ou o binário do alvo.
- Os testes locais são modelos pequenos e não executam o kernel FreeBSD/Orbis. Eles não demonstram acessibilidade, condição de corrida, corrupção de memória nem escalada de privilégio no console.
- Os valores `SYSENT` estão em conflito entre os arquivos locais: `0x01102B70` e `0x0110A760`. O segundo também aparece nomeado como `k_sysent_661`. Nenhum dos dois deve ser tratado como confirmado até a identidade do símbolo ser documentada com uma referência primária do kernel 14.00.

## Registros upstream citados

As faixas abaixo resumem as versões de FreeBSD declaradas como afetadas nos registros CVE. “Orbis desconhecido” significa que o registro upstream não estabelece presença nem ausência no fork da Sony.

| CVE | Branches upstream listadas como afetadas | Estado para Orbis 14.00 |
| --- | --- | --- |
| [CVE-2026-58087](https://www.cve.org/CVERecord?id=CVE-2026-58087) | 14.4 antes de p8; 15.0 antes de p12; 15.1 antes de p2 | Desconhecido; não confirma a alegação de que o bug atravessa todas as versões desde FreeBSD 4/9. |
| [CVE-2026-58098](https://www.cve.org/CVERecord?id=CVE-2026-58098) | 14.4 antes de p10; 14.5 antes de p1; 15.0 antes de p14; 15.1 antes de p4 | Desconhecido. |
| [CVE-2026-58093](https://www.cve.org/CVERecord?id=CVE-2026-58093) | 14.4 antes de p9; 15.0 antes de p13; 15.1 antes de p3 | Desconhecido. |
| [CVE-2026-58094](https://www.cve.org/CVERecord?id=CVE-2026-58094) | 14.4 antes de p9; 15.0 antes de p13; 15.1 antes de p3 | Desconhecido. |
| [CVE-2026-7270](https://www.cve.org/CVERecord?id=CVE-2026-7270) | 13.5 antes de p13; 14.3 antes de p12; 14.4 antes de p3; 15.0 antes de p7 | Desconhecido; o registro não lista FreeBSD 9. |
| [CVE-2026-45251](https://www.cve.org/CVERecord?id=CVE-2026-45251) | 14.3 antes de p14; 14.4 antes de p5; 15.0 antes de p9 | Desconhecido. |
| [CVE-2026-101308](https://www.cve.org/CVERecord?id=CVE-2026-101308) | 14.4 antes de p11; 14.5 antes de p2; 15.1 antes de p5 | Desconhecido. |
| [CVE-2026-101307](https://www.cve.org/CVERecord?id=CVE-2026-101307) | 15.1 antes de p5 | Desconhecido; a faixa declarada é especificamente FreeBSD 15.1. |
| [CVE-2026-49415](https://www.cve.org/CVERecord?id=CVE-2026-49415) | 14.3 antes de p16; 14.4 antes de p7; 15.0 antes de p11; 15.1 antes de p1 | Desconhecido. |

Esses limites são os declarados pelos registros CVE e não substituem análise do código. Uma branch não listada como afetada não equivale a uma prova de ausência em um fork derivado.

## Outras alegações locais

### IPMI / syscall 622

As notas atribuem a um pesquisador um possível `Use-After-Scope` em `sys_ipmimgr_call`, mas não incluem advisory público, diff de código, relatório de divulgação ou resultado reproduzível que sustente as versões listadas. Estado: **alegação não verificada**. Não usar o número de syscall ou o nome do símbolo como referência confirmada.

### Relatórios SHAREfactory

Os PDFs anexados descrevem uma falha de parser de mídia em PS4 11.00 / CUSA00572. Os próprios relatórios dizem que não alcançaram controle de RIP nem execução de código. O material é independente dos candidatos de kernel de 14.00 e não valida o host WebKit nem o payload BD-J.

## Próxima evidência necessária

Para promover qualquer candidato, registrar: versão exata do binário de Orbis, símbolo/função correspondente, comparação do trecho vulnerável com a implementação corrigida, configuração/driver relevante no console e resultado reproduzível não destrutivo. Até então, mantenha os CVEs como referências upstream e os offsets como não resolvidos quando houver conflito.

## Histórico

Este documento substitui as classificações anteriores de “alta prioridade”, “muito provável”, “confirmado sem patch” e “afeta todas as versões”. As hipóteses anteriores não foram comprovadas pelas evidências disponíveis nesta árvore.
