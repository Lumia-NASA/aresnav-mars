# AresNav — Interplanetary Survival Guide: Martian Map 🚀🔴

> **NASA Space Apps Challenge 2026**  
> **Team Lumia**  
> Target Region: **Jezero Crater Delta (`lat: 18.4447, lng: 77.4508`, `elev: -2540.5m`)**

---

## 🌟 Visão Geral
O **AresNav** é um protótipo de planejamento de caminhadas (EVA) em Marte. Junta dados históricos de missões da NASA e da ESA (relevo, imagens, trajeto do Perseverance, minerais) a um modelo simulado do traje e responde, para uma rota escolhida, se a caminhada é GO, CAUTION ou NO-GO, por quê, e o que mudar. Os dados vêm de arquivos e serviços públicos com cache local: **não são transmissões em tempo real**, e o veredito é uma **simulação para planejamento**, não uma autorização de segurança.

---

## 🛰️ As 3 Camadas Científicas da NASA Unificadas
1. **Topografia & Altimetria (MGS MOLA + Mars Express HRSC):** relevo de 200 m por ponto e declive calculado dele. Mostra o caminho geral e as encostas fortes; não enxerga pedras nem degraus menores que isso.
2. **Meteorologia Marciana (Perseverance MEDA):** mínima, máxima e pressão do último sol que a NASA publicou (`/api/v1/weather`), com a data e a idade do dado.
   - O feed público do MEDA não traz vento, poeira nem radiação. Esses valores vêm do contrato e aparecem com o selo **SAMPLE**.
   - O nascer e o pôr do Sol de hoje são calculados com o algoritmo do Mars24 e conferidos contra os horários do próprio MEDA (menos de 1 min de diferença).
3. **Mineralogia & Rota do Rover (Mars 2020 + CRISM):** trajeto real do Perseverance e detecções orbitais de minerais hidratados (CRISM), que indicam onde houve água.

---

## 🎬 A demo, do início ao fim
Rota científica → risco explicado → comparação → panorama real do local → decisão → corte de enlace. O roteiro completo, em inglês, está em [`docs/PITCH.md`](docs/PITCH.md).

1. **Rota científica:** escolha o depósito de amostras Three Forks, um lugar real onde o Perseverance deixou tubos de amostra, a 3,7 km da base, com 18,5 kg de carga.
2. **Risco explicado:** o veredito diz `NO-GO · METABOLIC` e o motivo, "O₂ na volta 21% < 30%". O botão **Por quê?** mostra que a ida (1 h 54) é mais lenta que a volta (1 h 40), porque o caminho sobe, e a calibração do relevo.
3. **Decisão em um clique:** clicar no veredito leva ao trecho depois do **ponto de retorno**. O quadro **O que fazer** oferece: virar ali, levar no máximo 13,5 kg ou usar a rota segura.
4. **Comparação:** a rota curta perigosa aparece em vermelho tracejado e o desvio seguro em verde. O mapa também mostra o alcance a pé de 15 e 30 min e o que dá para alcançar com a carga atual.
5. **Panorama real:** um panorama 360° da Mastcam-Z no local. As vistas sintéticas aparecem em roxo e com a etiqueta "não é foto".
6. **Copiloto ARES:** responde por voz ("Onde viro para voltar?") usando só os números do app. Funciona com o Claude ou em modo local.
7. **Executar a caminhada:** o botão **Executar caminhada** acompanha a EVA ao vivo (simulada) no Capacete.
   - **Painel:** plano x real (tempo e O₂), contagem até o ponto de retorno (pelo O₂ ou pela luz do dia, o que vencer primeiro), próxima parada, rádio e desvio da rota.
   - **ARES:** fala sozinho nos pontos-chave. Com o ritmo real em 85%, aparecem o atraso, o "vire em 5 min" e o "vire agora".
8. **Corte de enlace:** o botão UPLINK simula a queda Terra–Marte. Rota, veredito e física continuam funcionando. As camadas que dependem da internet avisam "indisponível offline".

---

## ⚠️ Limites (dizemos isso na apresentação)
- **Relevo de 200 m:** escolhe o caminho geral, mas esconde pedras e degraus. Confira os trechos marcados na imagem HiRISE.
- **Calibração:** o relevo fica em média 19 m acima da altitude medida pelo Perseverance em 613 paradas (σ 19 m). O app mostra isso no "Por quê?".
- **Física simulada:** consumo de O₂, batimentos e ritmo × carga vêm de um modelo, não de um traje real. As hipóteses e o peso de cada uma estão em [`docs/HIPOTESES.md`](docs/HIPOTESES.md).
- **Clima em dois conjuntos:** temperatura e pressão são medições reais do MEDA, mas datadas (último sol público: abril de 2024). Vento, radiação e poeira são valores de exemplo, com o selo SAMPLE. Esses valores não entram no cálculo do veredito; só a idade da medição aparece como ressalva no checklist.
- **Rota:** a busca roda numa grade de 200 m dentro da área da missão. "Nenhuma rota segura encontrada" vale para esse modelo, não prova que o caminho não existe.
- **Base hipotética:** a Ares-1 não existe.
- **Ainda não testado:** celular de verdade e o copiloto com chave da API ao vivo. Os números de desempenho estão em [`docs/DESEMPENHO.md`](docs/DESEMPENHO.md).

---

## 🛡️ Arquitetura de Defesa e Resiliência
* **Offline-First Cache:** Os dados da rota (relevo, trajeto, telemetria) têm cache local em `/backend/data/cache/` e seguem funcionando sem internet. Camadas da FU Berlin, mapas globais e panoramas 360° só funcionam offline se já estiverem no cache. Oscilações da internet ou da API da NASA não derrubam o app.
* **ScopeGuard (KhaosForge):** Bloqueio estrito contra SSRF, limitando conexões aos domínios da NASA (`mars.nasa.gov`, `trek.nasa.gov`, `api.nasa.gov`) e ao WebGIS de Jezero da FU Berlin (`maps.planet.fu-berlin.de`).
* **EvidenceGate:** o backend calcula o SHA-256 de cada resposta e o envia junto. Isso permite conferir que o dado não mudou **entre o backend e a tela** (e entra no GeoJSON exportado). Não é integridade de ponta a ponta e **não autentica a origem**: o trecho entre a NASA e o nosso backend não é coberto, e o hash é calculado pelo nosso próprio servidor, não assinado pela NASA.
* **CORS Restrito & Rate Limiting:** Proteção de backend Fastify contra abusos e negação de serviço.

---

## 📁 Estrutura do Repositório
```
aresnav-mars/
├── CONTRATO_API.json         # Contrato unificado de integração Frontend <-> Backend
├── .gitignore                # Isolamento estrito de segredos e skills confidenciais
├── backend/                  # Backend Fastify 5 (proxy com allowlist, cache, rate limit, CSP)
│   ├── server.js             # Rotas /health, telemetry, traverse, waypoints, tiles, dem, crism e navcam
│   ├── package.json          # Dependências do backend
│   ├── Dockerfile            # Container hardening (Alpine, non-root, dumb-init)
│   ├── .env.example          # Variáveis de ambiente
│   └── data/cache/           # Cache de telemetria local resiliente
├── frontend/                 # HUD Tático Marciano (Leaflet 2D / CesiumJS 3D)
├── tests/
│   ├── smoke-test.js         # Contrato, ScopeGuard e EvidenceGate
│   ├── physics-test.js       # Física do traje, Tobler, ponto de retorno, rádio, veredito e decisão
│   ├── sun-test.js           # Sol e hora em Marte contra o MEDA e o pouso do Perseverance
│   ├── exec-test.js          # Motor da execução: posição, O₂, ponto de retorno por O₂ e luz, avisos
│   ├── fub-test.js           # Camadas da FU Berlin, visor 360° e modo offline (sobe o backend numa porta de teste)
│   └── demo-flow-test.js     # Percurso completo da apresentação num Chrome sem janela
├── tools/build-fub-cache.py  # Baixa e converte as camadas da FU Berlin
├── tools/prewarm-demo.js     # Pré-carrega e confere offline o que a demo usa
└── docs/
    ├── PITCH.md              # Roteiro da demo para os jurados (inglês)
    ├── DESEMPENHO.md         # Medições de carregamento, 360° e memória
    └── HIPOTESES.md          # Hipóteses do modelo e sensibilidade do veredito
```

---

## 🧪 Como Executar os Testes de Validação
```bash
npm ci --prefix backend
node tests/smoke-test.js
node tests/physics-test.js
node tests/sun-test.js
node tests/exec-test.js
node tests/fub-test.js
node tests/demo-flow-test.js   # percurso completo da demo num Chrome sem janela
```
Ou tudo de uma vez: `cd backend && npm test`, que roda os seis em sequência.

O percurso da demo testa o panorama 360° em dois cenários: um que aceita falha da rede desde que o visor explique o que houve, e outro com o panorama já no cache, que exige a imagem completa.

**Antes da apresentação** (com o backend rodando e internet):
```bash
cd backend && npm run prewarm         # grava no cache tudo o que a demo usa (~45 s)
npm run check-offline                 # confere sem internet que os 813 itens abrem do cache
```
