# Trilha Jezero

Planejador de caminhada para astronautas na Cratera Jezero, em Marte. Projeto para o desafio de Marte do NASA Space Apps Challenge 2026.

Escolha um destino no mapa e o app traça a rota a pé a partir da base. Ele calcula distância, tempo de ida e volta, oxigênio que sobra, horários e alertas, e sugere paradas científicas no caminho. O modo emergência calcula a volta mais rápida pra base.

## Como rodar

O projeto é só HTML, CSS e JavaScript, sem build. Precisa ser servido por um servidor local (abrir o `index.html` direto com dois cliques não funciona):

```bash
python -m http.server 5180
```

Depois abra http://localhost:5180. Também funciona com `npx serve`, ou publicando a pasta no GitHub Pages, Netlify ou Vercel.

## Dados (todos oficiais da NASA, via Mars Trek)

| Camada | Missão / instrumento | Serviço |
|---|---|---|
| Imagem 25 cm | MRO / HiRISE | `trek.nasa.gov/tiles/Mars/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd` (WMTS) |
| Imagem 6 m | MRO / CTX | `trek.nasa.gov/tiles/Mars/EQ/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0` (WMTS) |
| Mosaico de pouso | HiRISE + CTX + HRSC | `NES_JEZ_MID_Visible_Mosaic_HiRISE_CTX_HRSC_GCS_MARS_07-10-2018` (WMTS) |
| Relevo colorido | MGS MOLA + Mars Express HRSC | `Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw` (WMTS) |
| Altitude para a rota | MOLA + HRSC, 200 m | `trekarcgis/.../Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw/ImageServer` (exportImage) |
| Infravermelho diurno | Mars Odyssey / THEMIS | `THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018` (WMTS) |
| Minerais hidratados | MRO / CRISM | `trekarcgis/.../Hydrous_Mineral_Detections_OMEGA_CRISM_clon0/MapServer/0` (GeoJSON) |
| Trajeto do Perseverance | Mars 2020 | `trekarcgis/.../Perseverance_Traverse_Path/MapServer/0` (GeoJSON) |

Para achar outras camadas, o catálogo completo do Mars Trek pode ser consultado em:
`https://trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?start=0&rows=500&facetKeys=itemType&facetValues=product`

A pasta `data/` guarda cópias do relevo e do trajeto. Se o Mars Trek sair do ar durante a apresentação, o app usa essas cópias automaticamente e avisa no topo da tela.

## Limitações conhecidas

- O relevo usado no cálculo da rota tem 200 m de resolução. Serve pra escolher o caminho geral, mas esconde pedras e degraus menores. Próximo passo: usar o DTM HiRISE de 1 m de Jezero (`JEZ_hirise_soc_006_DTM...`, está no catálogo do Mars Trek e no PDS).
- Clima, horários de sol e consumo de oxigênio são valores de exemplo, dentro das faixas medidas pelo MEDA e RAD.
- A base Ares-1 é hipotética. Os pontos de interesse usam a posição real do Perseverance nos sóis indicados.
- A barra de escala do Leaflet usa o raio da Terra, então é só aproximada. As distâncias do painel usam o raio de Marte (3.389,5 km).

## Estrutura

- `index.html`: layout da página
- `style.css`: visual
- `app.js`: mapa (Leaflet), carregamento dos dados, rota (A*), cálculos e painel
- `data/`: cópias locais de segurança
