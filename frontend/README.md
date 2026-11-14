# AresNav · Trilha Jezero (frontend)

Controle de missão para caminhadas de astronautas na Cratera Jezero, em Marte. Projeto para o desafio de Marte do NASA Space Apps Challenge 2026.

Escolha um destino e o app traça a rota a pé a partir da base. Ele calcula distância, tempo, oxigênio e horários, monta um checklist GO / NO-GO e sugere paradas científicas. A caminhada pode ser simulada do começo ao fim com o botão ▶.

## Regra de ouro: tudo passa pelo backend

O navegador **nunca chama a NASA direto** (skill `01-frontend-hud-skill`). Imagens, relevo, trajeto, minerais, fotos e telemetria vêm do backend AresNav, que repassa os dados da NASA, valida e guarda em cache:

| O que | Rota do backend |
|---|---|
| Telemetria unificada (`CONTRATO_API.json`) | `/api/v1/telemetry` |
| Trajeto do Perseverance | `/api/v1/traverse` |
| Blocos de imagem do Mars Trek | `/api/v1/tiles/:camada/:z/:y/:x` |
| Relevo de Jezero (200 m) | `/api/v1/dem/jezero` |
| Minerais hidratados (CRISM) | `/api/v1/crism` |
| Fotos da Navcam | `/api/v1/navcam/...` |

Se o backend cair ou responder `degraded: true`, o app entra em **redundância local** e mostra `OFFLINE TELEMETRY (CACHED)`: usa a última telemetria guardada, o relevo e o trajeto da pasta `data/` e um conjunto pequeno de imagens em `data/tiles/`. As fotos do rover e o zoom de alta resolução só funcionam com o backend.

## Modos de operação

O botão no topo alterna entre os dois modos pedidos pela skill:

- **`[ HABITAT PLANNER ]`**: visão ampla para planejar a rota. Tem três abas:
  - **Globo 3D**: Marte inteiro em CesiumJS, com o elipsoide marciano (3396,2 / 3376,2 km), relevo real e as imagens de alta resolução de Jezero.
  - **Mapa**: mapa 2D (Leaflet) com as mesmas camadas.
  - **Telemetria**: mostradores e gráficos da caminhada, mais os blocos do contrato (ambiente MEDA, mobilidade, topografia, posição).
- **`[ HELMET HUD ]`**: interface compacta de dentro do visor. Mostra o que vem do contrato (O₂, dupla, rover de apoio, carga do traje, declive e limite seguro, MEDA, alertas) sobre a vista de Marte. A vista tem duas fontes: **Fotos do rover** (panoramas reais da Navcam; dá pra andar pelo caminho do rover) e **Terreno 3D** (gerado só com dados orbitais, funciona em Marte inteiro).

Outros componentes:

- **Pop-up "1st Person Ground Truth"**: clicar em qualquer alvo científico ou ponto de interesse abre a foto real de solo tirada pelo Perseverance (`optical_first_person_url` do contrato; se não houver, a foto da Navcam mais próxima), com posição, altitude, declive, mineral e contexto geológico.
- **Rotas com gradiente de perigo**: a rota a pé e o trajeto do rover são coloridos pelo declive (verde até 4°, âmbar de 4° a 8°, vermelho acima de 8°).
- **Carga do traje**: o limite de declive seguro vem do contrato (`max_safe_slope_deg`, 12° com 18,5 kg; 15° sem carga) e é o limite usado no cálculo da rota.
- **HUD a 1 Hz**: os textos do HUD e da telemetria atualizam uma vez por segundo.

## Como rodar

1. Ligue o backend (porta 3000):

```bash
cd backend && npm install && npm start
```

2. Sirva o frontend (porta 5183, que já está liberada no CORS do backend):

```bash
cd frontend && python -m http.server 5183
```

3. Abra http://localhost:5183.

Para apontar para outro endereço de backend, defina `window.ARESNAV_API` no `index.html`. Se usar outra porta para o frontend, inclua a origem em `ALLOWED_ORIGIN` no `.env` do backend.

## Dados (todos oficiais da NASA, sempre pelo backend)

| Camada | Missão / instrumento | Serviço |
|---|---|---|
| Mosaico global colorido | Viking Orbiter | Mars Trek WMTS `Mars_Viking_MDIM21_ClrMosaic_global_232m` |
| Imagem 25 cm | MRO / HiRISE | Mars Trek WMTS `JEZ_hirise_soc_006_orthoMosaic_25cm_...` |
| Imagem 6 m | MRO / CTX | Mars Trek WMTS `JEZ_ctx_B_soc_008_orthoMosaic_6m_...` |
| Mosaico de pouso | HiRISE + CTX + HRSC | Mars Trek WMTS `NES_JEZ_MID_Visible_Mosaic_...` |
| Relevo colorido | MGS MOLA + Mars Express HRSC | Mars Trek WMTS `Mars_MOLA_blend200ppx_HRSC_ClrShade_...` |
| Relevo global do globo 3D | MGS MOLA | Mars Trek ImageServer `mola128_mola64_merge_90Nto90S_SimpleC_clon0` (cópia em `data/`) |
| Altitude para a rota | MOLA + HRSC, 200 m | Mars Trek ImageServer `Mars_MOLA_blend200ppx_HRSC_DEM_...` |
| Infravermelho diurno | Mars Odyssey / THEMIS | Mars Trek WMTS `THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018` |
| Minerais hidratados | MRO / CRISM | Mars Trek FeatureServer `Hydrous_Mineral_Detections_OMEGA_CRISM_clon0` |
| Trajeto do Perseverance | Mars 2020 | Mars Trek FeatureServer `Perseverance_Traverse_Path` |
| Fotos do modo Capacete | Mars 2020 / Navcam | `mars.nasa.gov/rss/api` (imagens brutas) |

A tabela no rodapé do app mostra, ao vivo, se cada fonte veio do backend ou do cache local.

### Panoramas do Capacete

Ao fim de cada deslocamento o rover tira 5 faixas de 96° × 26° na altura do horizonte. O app cola essas faixas num panorama de 360° usando o ângulo do mastro (metadado da foto) e a direção do rover (lista oficial de paradas). `data/pano/index.json` guarda, para cada parada do rover que tem panorama completo, a posição, a direção e os endereços das fotos (as fotos continuam hospedadas na NASA). Para gerar de novo:

```bash
python tools/build-pano-cache.py
```

O script lê as paradas em `backend/data/cache/m20_waypoints.cached.json` e consulta a API de imagens brutas, devagar, porque ela bloqueia rajadas de pedidos.

Controles: arraste para olhar em volta; `↑` `↓` (ou os botões) andam para a parada seguinte ou anterior do rover; `←` `→` viram.

### Terreno 3D do Capacete

Usa o mesmo globo do modo Globo 3D, com a câmera na altura dos olhos. `W`/`S` ou `↑`/`↓` andam, `A`/`D` ou `←`/`→` viram, `Shift` corre e o menu "Ir para…" leva a outros lugares de Marte. Em Jezero a imagem é HiRISE de 25 cm; no resto do planeta é o mosaico Viking de 232 m, então de perto fica borrado.

## O que é real e o que é simulado

- **Real:** imagens, relevo, declive, trajeto do rover, detecção CRISM, fotos da Navcam, posição dos pontos de interesse.
- **Do contrato (backend):** O₂ restante, distância da dupla, rover de apoio, carga do traje, declive e limite seguro, MEDA, alvos científicos e alertas. Hoje o backend serve valores de exemplo do `CONTRATO_API.json`.
- **Simulado no frontend:** batimentos, ritmo, bateria e a previsão de oxigênio ao longo da caminhada. São calculados a partir do declive real da rota.
- **Hipotético:** a base Ares-1.

## Limitações conhecidas

- O relevo da rota tem 200 m de resolução. Serve pra escolher o caminho geral, mas esconde pedras e degraus. Próximo passo: DTM HiRISE de 1 m de Jezero (`JEZ_hirise_soc_006_DTM...` no catálogo do Mars Trek).
- No globo 3D a altura do relevo está exagerada 2,5× para dar leitura.
- A skill cita a camada `Mars_MGS_MOLA_ClrShade_blend_mola_128ppd`, mas esse endereço responde 404 no Mars Trek. O app usa a equivalente `Mars_MOLA_blend200ppx_HRSC_ClrShade` (MOLA + HRSC).
- A bússola do Capacete é aproximada: usa a orientação do rover informada nos metadados da foto, sem corrigir a inclinação do terreno.
- As faixas de panorama da Navcam vêm em preto e branco e recebem um tom de cor no app. Elas cobrem 26° de altura, então acima e abaixo aparece um fundo liso.
- Nem toda parada do rover tem panorama completo. O rodapé do visor mostra o sol e a parada de cada foto.
- O limite de declive seguro é 12°, o mesmo `max_safe_slope_deg` do `CONTRATO_API.json`.

## Estrutura

- `index.html`, `style.css`: página e visual
- `app.js`: acesso ao backend, contrato, rota (A*), simulação da caminhada, mapa 2D, checklist, plano e pop-up de foto de solo
- `globe.js`: globo 3D (CesiumJS)
- `helmet.js`: modo Capacete (fotos do rover e terreno 3D)
- `telemetry.js`: modo Telemetria
- `data/`: redundância local (relevo, trajeto, telemetria e `tiles/`) e o índice de panoramas
- `../tools/build-pano-cache.py`: gera o índice de panoramas
