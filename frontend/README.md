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
| Relevo de qualquer lugar de Marte | `/api/v1/dem/patch/:lat/:lon` |
| Minerais hidratados (CRISM) | `/api/v1/crism` |
| Fotos da Navcam | `/api/v1/navcam/...` |

Se o backend cair ou responder `degraded: true`, o app entra em **redundância local** e mostra `OFFLINE TELEMETRY (CACHED)`: usa a última telemetria guardada, o relevo e o trajeto da pasta `data/` e um conjunto pequeno de imagens em `data/tiles/`. As fotos do rover e o zoom de alta resolução só funcionam com o backend.

## Idiomas

A interface abre em **inglês** (idioma da submissão) e tem **português** pelo botão no canto superior direito. A escolha fica guardada no navegador; também dá para forçar com `?lang=en` ou `?lang=pt` no endereço. Números, datas, pontos cardeais e o aviso por voz acompanham o idioma. O código escreve os textos em português e `i18n.js` traduz o que entra na tela.

## Descer em qualquer lugar de Marte

1. Clique no bonequinho (canto inferior direito) e depois em qualquer ponto do globo ou do mapa. Ou use a busca e desça lá.
2. O app pede ao backend o relevo real do lugar (`/api/v1/dem/patch/:lat/:lon`: blocos de 2° × 2°, HRSC + MOLA, cerca de 230 m por ponto) e põe a câmera a 1,7 m do chão, em **escala real**.
3. No Capacete, modo Terreno 3D:
   - **Passo real:** 2,9 km/h a 1,7 m do chão (Shift = 5,8 km/h).
   - **Visualização:** `E` sobe, `Q` desce (ou a roda do mouse, ou o controle "Altura", de 1,7 m a 20 km); a velocidade cresce com a altura.
   - O rodapé do visor mostra latitude, longitude, altitude do chão, sua altura e o declive local, tudo calculado do relevo da NASA.

No globo, o relevo também está em escala real; o botão `1×` / `2,5×` exagera a altura só para leitura na vista de cima. No chão a escala é sempre 1×. Como HiRISE e CTX são imagens em tons de cinza, o modo de caminhada aplica um filtro que pinta os cinzas com a paleta do solo marciano.

## Interface

O mapa ocupa a tela toda e os painéis flutuam por cima, no formato dos exploradores de planeta:

- **Barra superior:** busca de lugares em Marte (nome ou "lat, lon"; atalho `/`), troca de modo, Telemetria e Dados.
- **Painel esquerdo (Conteúdo da missão):** checklist de saída, carga do traje, camadas e destinos. Recolhe pela aba lateral.
- **Painel direito (Plano da caminhada):** veredito, números da rota, perfil de altitude, horários, alertas e paradas.
- **Canto inferior direito:** entrar no capacete, alternar 3D/2D, apontar para o norte e zoom.
- **Canto inferior esquerdo:** troca rápida da imagem de fundo.
- **Barra de baixo:** simulação da caminhada, corte de enlace e emergência; no rodapé, a posição sob o cursor e a altitude da câmera.

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
- **Roteiro passo a passo**: cada trecho da caminhada com rumo, distância, tempo, hora de chegada, oxigênio previsto e declive máximo.
- **Voz do copiloto**: o aviso de NO-GO usa a melhor voz instalada no navegador para o idioma (as "Natural"/"Neural" soam bem melhor), com um bipe de rádio antes.

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

**Porta única (produção / VPS):** o backend também serve o frontend. Basta ligar o backend e abrir http://localhost:3000. Nesse caso a API é chamada na mesma origem, sem CORS. Com Docker, a partir da raiz do repositório:

```bash
docker build -t aresnav .
```

```bash
docker run -d -p 3000:3000 --read-only --tmpfs /tmp --security-opt=no-new-privileges:true --cap-drop=ALL --user 1000:1000 aresnav
```

Para apontar para outro endereço de backend, defina `window.ARESNAV_API` em `config.js`. Se usar outra porta para o frontend em desenvolvimento, inclua a origem em `ALLOWED_ORIGIN` no `.env` do backend.

## Demonstração para os jurados

- **Carga do traje:** o slider "Carga de amostras e equipamento" (0 a 25 kg) muda na hora o limite de declive (`max(8, 15 − 0,2 × kg)`) e o consumo (`1 + 0,018 × kg`). A rota é recalculada; se não houver caminho dentro do limite ou o oxigênio previsto na volta cair abaixo de 30%, o veredito vira `[ NO-GO: SLOPE OVERLOAD ]` ou `[ NO-GO: METABOLIC OVERLOAD ]`, o visor alerta e o navegador fala o aviso. As fórmulas estão em `physics.js` e têm testes em `tests/physics-test.js`.
- **Corte de enlace:** o botão `[ 🟢 UPLINK: NASA LIVE ]`, ao lado do ▶, simula a queda da comunicação Terra–Marte. O app passa a usar só dados locais e o cache do backend, e a navegação continua funcionando.
- **Squad Mesh Link:** no Capacete, o painel da esquerda mostra você, o parceiro (a distância oscila durante a simulação) e o rover de apoio com a distância até o ponto de extração.
- **Passo real:** no Terreno 3D do Capacete, "Passo real" anda a 2,9 km/h (5,8 com Shift), como um astronauta de traje; "Visualização" é o sobrevoo rápido. A simulação da caminhada tem 1× (tempo real), 60× e 360×.
- **Procedência:** o rodapé mostra de onde vêm os dados e o selo SHA-256 do EvidenceGate lido do backend.

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
- Fora de Jezero o relevo sob demanda tem cerca de 230 m por ponto e a imagem é THEMIS de 100 m com cor do Viking: de perto, no chão, fica borrado. A geometria (montanhas, crateras, cânions) é real.
- A qualidade da voz depende das vozes instaladas no navegador de quem apresenta.
- A skill cita a camada `Mars_MGS_MOLA_ClrShade_blend_mola_128ppd`, mas esse endereço responde 404 no Mars Trek. O app usa a equivalente `Mars_MOLA_blend200ppx_HRSC_ClrShade` (MOLA + HRSC).
- A bússola do Capacete é aproximada: usa a orientação do rover informada nos metadados da foto, sem corrigir a inclinação do terreno.
- As faixas de panorama da Navcam vêm em preto e branco e recebem um tom de cor no app. Elas cobrem 26° de altura, então acima e abaixo aparece um fundo liso.
- Nem toda parada do rover tem panorama completo. O rodapé do visor mostra o sol e a parada de cada foto.
- O limite de declive seguro é 12°, o mesmo `max_safe_slope_deg` do `CONTRATO_API.json`.

## Estrutura

- `index.html`, `style.css`: página e visual
- `config.js`, `boot.js`: configuração e partida (sem scripts embutidos no HTML, por causa do CSP)
- `physics.js`: física da carga do traje (limite de declive, consumo, veredito)
- `app.js`: acesso ao backend, contrato, rota (A*), simulação da caminhada, mapa 2D, checklist, plano e pop-up de foto de solo
- `globe.js`: globo 3D (CesiumJS)
- `helmet.js`: modo Capacete (fotos do rover e terreno 3D)
- `ui.js`: casca da interface (painéis, busca, controles do mapa, barra de estado)
- `i18n.js`: idiomas (inglês e português)
- `telemetry.js`: modo Telemetria
- `data/`: redundância local (relevo, trajeto, telemetria e `tiles/`) e o índice de panoramas
- `../tools/build-pano-cache.py`: gera o índice de panoramas
