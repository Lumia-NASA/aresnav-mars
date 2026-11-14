# Hipóteses do modelo e sensibilidade

O veredito do AresNav (GO / CAUTION / NO-GO) é uma **simulação para planejamento**. Ele junta dados reais (relevo, trajeto do rover, imagens) a um modelo do traje que **não foi validado** com astronautas, trajes reais nem normas da NASA. Esta página lista cada hipótese e quanto ela pesa no resultado. Assim a equipe e os jurados podem julgar o quanto confiar em cada número.

Os parâmetros estão em `frontend/physics.js` (`SLOPE_RULE` e `ALGORITHM`, versão 1.3.0) e vão junto no GeoJSON exportado.

## As hipóteses

| Hipótese | Valor usado | De onde vem | Status |
|---|---|---|---|
| Limite de declive com carga | 15° − 0,2° por kg, piso de 8° | escolha de projeto do AresNav | **hipótese de simulação**, não é limite de EVA validado |
| Autonomia de O₂ | 480 min | ordem de grandeza de uma EVA de 8 h | hipótese |
| Reserva mínima de O₂ na volta | 30% | margem de projeto do AresNav | hipótese |
| Consumo extra por carga | +1,8% por kg | escolha de projeto | hipótese |
| Ritmo perdido por carga | −1,2% por kg | escolha de projeto | hipótese |
| Ritmo de caminhada (Tobler) | 2,7 km/h no plano, pico em descida suave | função de Tobler com v₀ de astronauta de traje (referência SEXTANT/Apollo) | forma clássica; o valor de v₀ é hipótese |
| Antena do habitat e capacete | 2 m e 1,7 m | escolha de projeto | hipótese (uma antena mais alta muda muito o resultado do rádio) |
| Relevo | HRSC + MOLA, 200 m por ponto | NASA Mars Trek | **dado real**. Não enxerga pedras nem degraus; fica em média 19 m acima da altitude medida pelo Perseverance em 613 paradas (σ 19 m) |
| Relevo do corredor | HiRISE DTM controlado, 1 m (JEZ_hirise_soc_006) | USGS Astrogeology / MRO HiRISE | **dado real**. Declive medido em 5 m; limite do trecho íngreme = limite da rota. Difere do de 200 m em 3 a 6 m na base |
| Clima (MEDA) | valores do contrato | `CONTRATO_API.json` | valores de exemplo de um sol, não leitura ao vivo |

## Quanto cada hipótese mexe no resultado

Caso usado: a caminhada padrão da demo, até o depósito de amostras Three Forks. São 3,73 km de ida, com 214 min andando e 71 min parado, e 18,5 kg de carga. O resultado padrão é **21% de O₂ na volta: NO-GO**, porque o mínimo é 30%.

| Mudança (uma de cada vez) | O₂ na volta | Veredito |
|---|---|---|
| Nenhuma (padrão) | 21% | NO-GO |
| Autonomia −10% (432 min) | 12% | NO-GO |
| Autonomia +10% (528 min) | 28% | NO-GO |
| Consumo por kg −25% (1,35%/kg) | 26% | NO-GO |
| Consumo por kg +25% (2,25%/kg) | 16% | NO-GO |
| Ritmo por kg −25% (0,9%/kg) | 25% | NO-GO |
| Ritmo por kg +25% (1,5%/kg) | 16% | NO-GO |
| Carga 13,5 kg (sugestão do app) | 30% | CAUTION (no limite) |
| Carga 10 kg | 36% | CAUTION |
| Sem carga | 51% | GO no O₂ (o rádio ainda dá CAUTION) |

**Leitura:** com 18,5 kg, essa caminhada é NO-GO para qualquer variação razoável dos parâmetros do traje. A conclusão "leve menos carga" é robusta. Já o número exato de quilos sugerido (13,5 kg) depende das hipóteses e deve ser lido como uma ordem de grandeza.

### Regra de declive

Limite com 18,5 kg conforme os parâmetros:

| Regra | Limite com 18,5 kg |
|---|---|
| Padrão: 15° − 0,2°/kg | 11,3° |
| Base 13° | 9,3° |
| Base 17° | 13,3° |
| 0,15°/kg (−25%) | 12,2° |
| 0,25°/kg (+25%) | 10,4° |

Para uma rota com pico de 11°, a carga a partir da qual ela vira NO-GO cai de 20,5 kg para 10,5 kg se a base for 13° em vez de 15°. Esse cálculo está em `tests/physics-test.js`. A regra de declive é a hipótese **mais sensível** do modelo. Por isso o app a chama de "regra simulada" e o card "Por quê?" avisa que ela não é um limite validado.

## O que mudaria isso em um projeto real
- Limites de declive e consumo medidos com o traje em ensaio (por exemplo, dados de caminhadas análogas da NASA).
- Relevo HiRISE de 1 m também na escolha do caminho (hoje ele só confere o corredor da rota de 200 m e dá o chão do capacete).
- Clima vindo do MEDA mais recente, com a idade do dado exibida (o GeoJSON exportado já registra essa idade).
