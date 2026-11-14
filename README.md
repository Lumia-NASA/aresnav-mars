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

## 🛡️ Arquitetura de Defesa e Resiliência
* **Offline-First Cache:** Todos os dados científicos possuem cache local em `/backend/data/cache/` para operação 100% autônoma e à prova de oscilações de internet ou da API da NASA.
* **ScopeGuard (KhaosForge):** Bloqueio estrito contra SSRF, limitando conexões aos domínios oficiais da NASA (`mars.nasa.gov`, `trek.nasa.gov`, `api.nasa.gov`).
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
├── tests/                    # Suíte de Smoke Tests de arquitetura e contrato
│   └── smoke-test.js
└── pitch/                    # Roteiro de 30s, slides e demo para os juízes
```

---

## 🧪 Como Executar os Testes de Validação
```bash
node tests/smoke-test.js
```
