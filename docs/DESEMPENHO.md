# Desempenho do AresNav

Medições de 14/11/2026 num notebook Windows 11 com Chrome, rodando o backend local (`node backend/server.js`). "Celular" é a mesma máquina com a tela emulada em 375 × 812. **Ainda não foi medido em um celular de verdade.** A CPU e a GPU de um celular são mais lentas, então os tempos do visor 360° e do globo devem subir lá.

## Carregamento inicial

| | Antes | Depois |
|---|---|---|
| Dados da API na rede | 2.696 KB | **570 KB** |
| Pedidos à API no início | 14 | 13 |
| App pronto (rota, veredito e mapa) | ~2,0 s | ~2,0 s |
| Memória JS depois de carregar | 43 MB | 34–38 MB |

O que mudou:

| Dado | Antes | Depois | Como |
|---|---|---|---|
| Trajeto do Perseverance | 1.487 KB | 450 KB | compressão brotli no backend |
| Canais dos rios (FU Berlin) | 384 KB | 17 KB | Douglas-Peucker de 5 m + brotli |
| Margem do lago (FU Berlin) | 142 KB | 14 KB | Douglas-Peucker de 5 m + brotli |
| Paradas do rover | 526 KB no início | 93 KB, só ao abrir "Por quê?" ou exportar | carregamento sob demanda |

O tempo até ficar pronto é dominado pela resposta da NASA para o trajeto (~1,4 s) e o relevo (~1,2 s), pedidos em paralelo. Com cache e sem internet, cai para o tempo do disco.

A simplificação de 5 m não muda nada visível: o relevo usado na rota tem 200 m por ponto.

## Visor 360°

| Panorama | Blocos | Tempo até completo |
|---|---|---|
| Foto Mastcam-Z (cubo de 1.024 px por face) | 24 | 2,8 s |
| Vista sintética (cubo de 1.280 px por face) | 54 | 3,1 s |
| Esfera reprojetada em cubo | 6 | 0,4–1,5 s |

- A reprojeção da esfera em 6 faces de 512 px custa **~150 ms** de CPU no notebook.
- Abrir e fechar vários panoramas não faz a memória crescer (38 MB antes e 37 MB depois). O visor descarta os blocos ao fechar.
- Os blocos ficam em cache no disco do backend. Na segunda vez o panorama abre em fração de segundo e funciona offline.

## Carregado só quando precisa

- **Blocos de cor natural (WMS da FU Berlin):** só a partir do nível 8 (~300 km de altitude) e só na área de Jezero. No máximo 4 pedidos simultâneos ao servidor da universidade.
- **Poeira, firmeza e rugosidade (TES/MOLA):** só quando a camada é ligada.
- **Panoramas:** nenhum bloco antes de abrir.
- **Paradas do rover:** só ao abrir "Por quê?" ou exportar.

## O que ainda falta medir

- **Fluidez do globo em quadros por segundo.** O painel do navegador usado nos testes estava em segundo plano, e o navegador reduz a taxa de quadros nesse caso. Precisa medir com a janela visível.
- **Celular de verdade:** tempo do 360°, memória e aquecimento.
- **Rede lenta (3G):** a compressão ajuda, mas o trajeto ainda tem 450 KB.

## Como repetir

1. Abra o app, aperte F12, aba **Rede** (Network), recarregue e some a coluna "Transferido" dos pedidos a `/api/v1/`.
2. No console: `performance.memory.usedJSHeapSize / 1048576` (só no Chrome).
3. Visor 360°: abra um ponto e marque o tempo até a barra "Carregando…" sumir. Para os números exatos, use `App.pano360.load`.
