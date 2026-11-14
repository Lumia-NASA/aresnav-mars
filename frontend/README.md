# AresNav · Trilha Jezero (frontend)

Controle de missão para caminhadas de astronautas na Cratera Jezero, em Marte. Projeto para o desafio de Marte do NASA Space Apps Challenge 2026.

Escolha um destino e o app traça a rota a pé a partir da base. Ele calcula distância, tempo, oxigênio e horários, monta um checklist GO / NO-GO e sugere paradas científicas. A caminhada pode ser simulada do começo ao fim com o botão ▶.

## Os quatro modos

| Modo | O que mostra |
|---|---|
| **Globo 3D** | Marte inteiro em 3D (CesiumJS), com relevo real e as imagens de alta resolução de Jezero. Clique fora de Jezero para voar até lá; clique dentro para escolher o destino. |
| **Mapa** | Mapa 2D (Leaflet) de Marte inteiro, com as mesmas camadas. |
| **Capacete** | Marte visto de dentro do visor, com HUD de oxigênio, sinais vitais, bússola e direção do destino. Tem duas fontes: **Fotos do rover** (panoramas reais de 360° da Navcam do Perseverance; dá pra andar para frente e para trás pelo caminho que o rover fez, como num street view) e **Terreno 3D** (vista gerada só com dados orbitais, que funciona em Marte inteiro). |
| **Telemetria** | Mostradores e gráficos da caminhada: altitude e declive reais ao longo da rota, mais sinais vitais e dados do traje simulados. |

## Como rodar

É só HTML, CSS e JavaScript, sem build. Precisa de um servidor local (abrir o `index.html` com dois cliques não funciona) e de internet:

```bash
python -m http.server 5183
```

Depois abra http://localhost:5183. Também funciona no GitHub Pages, Netlify ou Vercel.

Se o backend AresNav estiver ligado em `http://localhost:3000`, o painel de ambiente (MEDA) lê `/api/v1/telemetry`. Para isso, a origem do frontend precisa estar na lista de CORS do backend. Sem o backend, ele mostra os valores de exemplo do contrato.

## Dados (todos oficiais da NASA)

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

A tabela no rodapé do app mostra, ao vivo, se cada fonte respondeu. A pasta `data/` guarda cópias do relevo e do trajeto: se o Mars Trek cair, o app usa as cópias e avisa no topo.

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
- **Simulado:** sinais vitais, consumo de oxigênio, dados do traje, a dupla e o rover de apoio. São calculados a partir do ritmo e do declive real da rota.
- **Hipotético:** a base Ares-1.

## Limitações conhecidas

- O relevo da rota tem 200 m de resolução. Serve pra escolher o caminho geral, mas esconde pedras e degraus. Próximo passo: DTM HiRISE de 1 m de Jezero (`JEZ_hirise_soc_006_DTM...` no catálogo do Mars Trek).
- No globo 3D a altura do relevo está exagerada 2,5× para dar leitura. As distâncias do painel não usam o globo: são calculadas com o raio de Marte (3.389,5 km).
- A bússola do Capacete é aproximada: usa a orientação do rover informada nos metadados da foto, sem corrigir a inclinação do terreno.
- As faixas de panorama da Navcam vêm em preto e branco e recebem um tom de cor no app. Elas cobrem 26° de altura, então acima e abaixo aparece um fundo liso.
- Nem toda parada do rover tem panorama completo. O rodapé do visor mostra o sol e a parada de cada foto.
- O limite de declive seguro é 12°, o mesmo `max_safe_slope_deg` do `CONTRATO_API.json`.

## Estrutura

- `index.html`, `style.css`: página e visual
- `app.js`: dados, rota (A*), simulação da caminhada, mapa 2D, checklist e plano
- `globe.js`: globo 3D (CesiumJS)
- `helmet.js`: modo Capacete (fotos do rover e terreno 3D)
- `telemetry.js`: modo Telemetria
- `data/`: cópias locais do relevo e do trajeto, e o índice de panoramas
- `../tools/build-pano-cache.py`: gera o índice de panoramas
