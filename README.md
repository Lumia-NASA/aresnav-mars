# AresNav — Interplanetary Survival Guide: Martian Map 🚀🔴

> **NASA Space Apps Challenge 2026**  
> **Team Lumia**  
> Target Region: **Jezero Crater Delta (`lat: 18.4447, lng: 77.4508`, `elev: -2540.5m`)**

---

## 🌟 Visão Geral
O **AresNav** é um sistema tático de navegação e sobrevivência para astronautas em atividade extraveicular (EVA) na superfície de Marte. Integrando camadas científicas em tempo real da NASA a um HUD tático com mapas 2D/3D interativos, o AresNav antecipa desastres de terreno, tempestades de poeira e guia astronautas para rotas seguras e alvos biológicos prioritários.

---

## 🛰️ As 3 Camadas Científicas da NASA Unificadas
1. **Topografia & Altimetria (MGS MOLA):** Mapeamento digital de elevação (DEM) e cálculo de declividade (`slope_deg`) para prevenir colapsos em encostas acidentadas (>15°).
2. **Meteorologia Marciana (Perseverance MEDA):** Monitoramento contínuo de ventos, temperaturas extremas (até -68.4°C), alerta de tempestades de poeira e índice de radiação diária.
3. **Mineralogia & Rota do Rover (Mars 2020 Traverse):** Traçado histórico e atual do rover Perseverance, indicando depósitos de carbonatos e filossilicatos (argilas) com alto potencial de bioassinaturas fósseis.

---

## 🎬 A demo de ponta a ponta
Rota científica → risco explicado → comparação → panorama real do local → decisão → corte de enlace. O roteiro completo, em inglês, está em [`docs/PITCH.md`](docs/PITCH.md).

1. **Rota científica:** escolha o depósito de amostras Three Forks, um lugar real onde o Perseverance deixou tubos de amostra, a 3,7 km da base, com 18,5 kg de carga.
2. **Risco explicado:** o veredito diz `NO-GO · METABOLIC` e o motivo, "O₂ na volta 21% < 30%". O botão **Por quê?** mostra que a ida (1 h 54) é mais lenta que a volta (1 h 40), porque o caminho sobe, e a calibração do relevo.
3. **Decisão em um clique:** clicar no veredito leva ao trecho depois do **ponto de retorno**. O quadro **O que fazer** oferece: virar ali, levar no máximo 13,5 kg ou usar a rota segura.
4. **Comparação:** a rota curta perigosa aparece em vermelho tracejado e o desvio seguro em verde. O mapa também mostra o alcance a pé de 15 e 30 min e o que dá para alcançar com a carga atual.
5. **Panorama real:** um panorama 360° da Mastcam-Z no local. As vistas sintéticas aparecem em roxo e com a etiqueta "não é foto".
6. **Copiloto ARES:** responde por voz ("Onde viro para voltar?") usando só os números do app. Funciona com o Claude ou em modo local.
7. **Corte de enlace:** o botão UPLINK simula a queda Terra–Marte. Rota, veredito e física continuam funcionando. As camadas que dependem da internet avisam "indisponível offline".

---

## ⚠️ Limites (dizemos isso na apresentação)
- **Relevo de 200 m:** escolhe o caminho geral, mas esconde pedras e degraus. Confira os trechos marcados na imagem HiRISE.
- **Calibração:** o relevo fica em média 19 m acima da altitude medida pelo Perseverance em 613 paradas (σ 19 m). O app mostra isso no "Por quê?".
- **Física simulada:** consumo de O₂, batimentos e ritmo × carga vêm de um modelo, não de um traje real. O clima vem dos valores de exemplo do contrato (MEDA).
- **Base hipotética:** a Ares-1 não existe.
- **Ainda não testado:** celular de verdade e o copiloto com chave da API ao vivo. Os números de desempenho estão em [`docs/DESEMPENHO.md`](docs/DESEMPENHO.md).

---

## 🛡️ Arquitetura de Defesa e Resiliência
* **Offline-First Cache:** Os dados da rota (relevo, trajeto, telemetria) têm cache local em `/backend/data/cache/` e seguem funcionando sem internet. Camadas da FU Berlin, mapas globais e panoramas 360° só funcionam offline se já estiverem no cache. Oscilações da internet ou da API da NASA não derrubam o app.
* **ScopeGuard (KhaosForge):** Bloqueio estrito contra SSRF, limitando conexões aos domínios da NASA (`mars.nasa.gov`, `trek.nasa.gov`, `api.nasa.gov`) e ao WebGIS de Jezero da FU Berlin (`maps.planet.fu-berlin.de`).
* **EvidenceGate:** Selamento criptográfico SHA-256 de cada telemetria processada, garantindo integridade auditável ponta a ponta.
* **CORS Restrito & Rate Limiting:** Proteção de backend Fastify contra abusos e negação de serviço.

---

## 📁 Estrutura do Repositório
```
aresnav-mars/
├── CONTRATO_API.json         # Contrato unificado de integração Frontend <-> Backend
├── .gitignore                # Isolamento estrito de segredos e skills confidenciais
├── backend/                  # Módulo Extrator Fastify blindado
│   ├── server.js             # Rotas /health, telemetry, traverse, waypoints, tiles, dem, crism e navcam
│   ├── package.json          # Dependências do backend
│   ├── Dockerfile            # Container hardening (Alpine, non-root, dumb-init)
│   ├── .env.example          # Variáveis de ambiente
│   └── data/cache/           # Cache de telemetria local resiliente
├── frontend/                 # HUD Tático Marciano (Leaflet 2D / CesiumJS 3D)
├── tests/
│   ├── smoke-test.js         # Contrato, ScopeGuard e EvidenceGate
│   ├── physics-test.js       # Física do traje, Tobler, ponto de retorno, rádio, veredito e decisão
│   └── fub-test.js           # Camadas da FU Berlin, visor 360° e modo offline (sobe o backend numa porta de teste)
├── tools/build-fub-cache.py  # Baixa e converte as camadas da FU Berlin
└── docs/
    ├── PITCH.md              # Roteiro da demo para os jurados (inglês)
    └── DESEMPENHO.md         # Medições de carregamento, 360° e memória
```

---

## 🧪 Como Executar os Testes de Validação
```bash
node tests/smoke-test.js
node tests/physics-test.js
npm ci --prefix backend && node tests/fub-test.js
```
Os três rodam no CI a cada pull request.
