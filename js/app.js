/**
 * Controlador Principal da Interface WebGIS Imersiva (Extrema - MG | 2016–2026)
 * Arquitetura Tela Cheia (100vw x 100vh), Barra Flutuante Compacta, Gaveta Off-Canvas,
 * Modais para Gráficos/Tabelas, Legenda Retrátil Inferior Direita e Controle Estrito de Camadas.
 */
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Configuração da Chave de API CARTO (?key=...) e Provedores de Mapa Base
  const CARTO_API_KEY = 'cb1_4qfj_1_797e63935e07c3f336d583ff';
  window.GEOPORTAL_API_KEY = CARTO_API_KEY;

  const data = window.GEOPORTAL_DATA;
  const engine = new window.SpatialEngine(data);

  const loadingOverlay = document.getElementById('mapLoadingOverlay');
  const loadingTextEl = document.getElementById('mapLoadingText');

  function showMapLoading(msg = 'Processando matriz espectral NDVI (10m)...') {
    if (loadingTextEl) loadingTextEl.textContent = msg;
    if (loadingOverlay) loadingOverlay.classList.add('active');
  }

  function hideMapLoading() {
    if (loadingOverlay) loadingOverlay.classList.remove('active');
  }

  function runWithMapLoading(message, taskFn) {
    showMapLoading(message);
    requestAnimationFrame(() => {
      setTimeout(() => {
        try {
          taskFn();
        } finally {
          setTimeout(hideMapLoading, 140);
        }
      }, 25);
    });
  }

  showMapLoading('Inicializando cubo matricial UTM 23S (10m)...');
  await engine.init();

  // Estado Global da Aplicação
  const state = {
    activeTab: 'overview',          // 'overview' | 'ndvi-alto' | 'transicao' | 'proporcao-2026' | 'classes-altas-2026'
    rasterMode: '2026',             // '2016' | '2026' | 'swipe' | 'class4_analysis' | 'temporal_algebra' | 'critical_proportion' | 'multi_class_filter'
    isolatedClass: null,            // null ou 1..5
    class4Submode: '2026_c4',       // '2016_c4' | '2026_c4' | 'diff_c4'
    algebraFrom: '3',
    algebraTo: '4',
    calcSelectedClasses: [4, 5],    // Classes marcadas na Calculadora de Soma
    calcMultiYear: '2026',          // '2016' | '2026'
    showHotspotsLayer: false,
    showUtmGrid: true,
    drawerOpen: false,              // Gaveta Off-Canvas oculta por padrão
    toolbarCollapsed: false,
    rasterOpacity: 0.92
  };

  // Inicializa o Mapa Leaflet em Modo Tela Cheia (100vw x 100vh)
  const bounds = L.latLngBounds(data.metadata.latlon_bounds[0], data.metadata.latlon_bounds[1]);
  const map = L.map('map', {
    center: bounds.getCenter(),
    zoom: 12,
    minZoom: 10,
    maxZoom: 16,
    zoomControl: false,
    attributionControl: true
  });

  // Posiciona o controle de zoom no canto inferior esquerdo junto aos botões simbólicos de Grade UTM e Enquadrar
  const zoomControl = L.control.zoom({ position: 'bottomleft' }).addTo(map);
  const zoomContainer = zoomControl.getContainer();

  const btnGridEl = L.DomUtil.create('a', 'leaflet-ctrl-tool active', zoomContainer);
  btnGridEl.id = 'btnToggleGrid';
  btnGridEl.href = '#';
  btnGridEl.role = 'button';
  btnGridEl.title = 'Exibir/ocultar Grade UTM 23S';
  btnGridEl.setAttribute('aria-label', 'Exibir/ocultar Grade UTM 23S');
  btnGridEl.innerHTML = '⊞';
  L.DomEvent.disableClickPropagation(btnGridEl);
  L.DomEvent.on(btnGridEl, 'click', L.DomEvent.preventDefault);

  const btnResetEl = L.DomUtil.create('a', 'leaflet-ctrl-tool', zoomContainer);
  btnResetEl.id = 'btnResetZoom';
  btnResetEl.href = '#';
  btnResetEl.role = 'button';
  btnResetEl.title = 'Enquadrar limite de Extrema';
  btnResetEl.setAttribute('aria-label', 'Enquadrar limite de Extrema');
  btnResetEl.innerHTML = '⌖';
  L.DomEvent.disableClickPropagation(btnResetEl);
  L.DomEvent.on(btnResetEl, 'click', L.DomEvent.preventDefault);

  L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);

  // Provedores de Mapa Base (CARTO com API Key + Alternativas Esri)
  const cartoDark = L.tileLayer(
    `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(CARTO_API_KEY)}`,
    {
      attribution: '&copy; OpenStreetMap &copy; CARTO | SIRGAS 2000 UTM 23S (EPSG:31983)',
      subdomains: 'abcd',
      maxZoom: 19
    }
  );

  const cartoLight = L.tileLayer(
    `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(CARTO_API_KEY)}`,
    {
      attribution: '&copy; OpenStreetMap &copy; CARTO | SIRGAS 2000 UTM 23S (EPSG:31983)',
      subdomains: 'abcd',
      maxZoom: 19
    }
  );

  const esriDarkGray = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    {
      attribution: '&copy; Esri, HERE, Garmin | SIRGAS 2000 UTM 23S (EPSG:31983)',
      maxZoom: 16
    }
  );

  const esriSatellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      attribution: '&copy; Esri World Imagery | SIRGAS 2000 UTM 23S (EPSG:31983)',
      maxZoom: 19
    }
  );

  const esriTopo = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    {
      attribution: '&copy; Esri World Topographic Map | SIRGAS 2000 UTM 23S (EPSG:31983)',
      maxZoom: 19
    }
  );

  const basemapMap = {
    cartoDark,
    esriDark: esriDarkGray,
    cartoLight,
    esriTopo,
    esriSat: esriSatellite
  };

  let currentBasemap = cartoDark;
  currentBasemap.addTo(map);

  function switchBasemap(key) {
    const nextLayer = basemapMap[key];
    if (!nextLayer || nextLayer === currentBasemap) return;
    if (map.hasLayer(currentBasemap)) {
      map.removeLayer(currentBasemap);
    }
    currentBasemap = nextLayer;
    currentBasemap.addTo(map);
    currentBasemap.bringToBack();
  }

  const selBasemapEl = document.getElementById('selBasemap');
  if (selBasemapEl) {
    selBasemapEl.addEventListener('change', (e) => {
      switchBasemap(e.target.value);
    });
  }

  let cartoFallbackTriggered = false;
  cartoDark.on('tileerror', () => {
    if (!cartoFallbackTriggered && map.hasLayer(cartoDark)) {
      cartoFallbackTriggered = true;
      switchBasemap('esriDark');
      if (selBasemapEl) selBasemapEl.value = 'esriDark';
    }
  });

  // ============================================================================
  // 5. CONTROLE ESTRITO DE CAMADAS E PREVENÇÃO DE SOBREPOSIÇÃO (Z-INDEX / REMOVE)
  // ============================================================================
  let activeRasterOverlay = null;
  let activeSwipeOverlay = null;

  // Camada Vetorial: Limite Municipal de Extrema (IBGE 2025)
  const limiteLayer = L.geoJSON(data.geojson.limite_extrema, {
    style: {
      color: '#991b1b',
      weight: 2.6,
      fillOpacity: 0
    }
  }).addTo(map);

  // Camada Vetorial: Núcleos de Transição para Classes Inferiores (Álgebra Temporal)
  const hotspotsLayer = L.layerGroup();
  const selectedHotspotLayer = L.layerGroup();
  state.selectedHotspot = null;

  // Qualquer troca de ferramenta, cenário ou seletor descarta o núcleo selecionado
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-map-mode], #btnToggleHotspots, #btnResetZoom, .legend-item, #btnPresetAlgebraDefault')) {
      state.selectedHotspot = null;
      document.querySelectorAll('#hotspotsTableBody tr.row-selected').forEach(r => r.classList.remove('row-selected'));
    }
  }, true);
  data.hotspots_transition.forEach((hs) => {
    const circle = L.circle([hs.lonlat[1], hs.lonlat[0]], {
      radius: hs.radius_m * 0.55,
      color: '#ff1744',
      weight: 2,
      dashArray: '6, 4',
      fillColor: '#ff9100',
      fillOpacity: 0.12
    });
    circle.bindPopup(
      `<div style="font-family:Inter,sans-serif;font-size:12px;color:#0f172a;">` +
      `<strong>${hs.id} — ${hs.name}</strong><br>` +
      `<span style="color:#475569;">${hs.sector}</span><hr style="margin:5px 0;border:0;border-top:1px solid #cbd5e1;">` +
      `Coordenada Central UTM: <code>${hs.utm_e} m E, ${hs.utm_n} m N</code><br>` +
      `Moderado → Baixo (3→2): <strong>${hs.mod_to_low_km2.toFixed(2).replace('.', ',')} km²</strong><br>` +
      `Moderado → Muito Baixo (3→1): <strong>${hs.mod_to_vlow_km2.toFixed(2).replace('.', ',')} km²</strong><br>` +
      `Total Redução no Núcleo: <strong style="color:#dc2626;">${hs.total_drop_km2.toFixed(2).replace('.', ',')} km² (${hs.pct_of_total_drop.toFixed(1).replace('.', ',')}%)</strong>` +
      `</div>`
    );
    hotspotsLayer.addLayer(circle);
  });

  // Grade de Coordenadas UTM Zona 23S (EPSG:31983)
  const utmGridLayer = L.layerGroup().addTo(map);
  function drawUtmGrid() {
    utmGridLayer.clearLayers();
    const eastings = [360000, 365000, 370000, 375000, 380000];
    const northings = [7470000, 7475000, 7480000, 7485000];

    const sw = data.metadata.latlon_bounds[0];
    const ne = data.metadata.latlon_bounds[1];
    const [xmin, ymin, xmax, ymax] = data.metadata.utm_bbox;

    eastings.forEach(e => {
      const fracX = (e - xmin) / (xmax - xmin);
      const lon = sw[1] + fracX * (ne[1] - sw[1]);
      const line = L.polyline([[sw[0], lon], [ne[0], lon]], {
        color: 'rgba(148, 163, 184, 0.22)',
        weight: 1,
        dashArray: '3, 3',
        interactive: false
      });
      utmGridLayer.addLayer(line);
      const marker = L.marker([sw[0] + 0.003, lon], {
        icon: L.divIcon({
          className: 'utm-grid-label',
          html: `${e} E`,
          iconSize: [58, 16]
        }),
        interactive: false
      });
      utmGridLayer.addLayer(marker);
    });

    northings.forEach(n => {
      const fracY = (n - ymin) / (ymax - ymin);
      const lat = sw[0] + fracY * (ne[0] - sw[0]);
      const line = L.polyline([[lat, sw[1]], [lat, ne[1]]], {
        color: 'rgba(148, 163, 184, 0.22)',
        weight: 1,
        dashArray: '3, 3',
        interactive: false
      });
      utmGridLayer.addLayer(line);
      const marker = L.marker([lat, sw[1] + 0.004], {
        icon: L.divIcon({
          className: 'utm-grid-label',
          html: `${n} N`,
          iconSize: [66, 16]
        }),
        interactive: false
      });
      utmGridLayer.addLayer(marker);
    });
  }
  drawUtmGrid();

  /**
   * Remove estritamente todas as camadas temáticas e vetoriais de análise anteriores do mapa
   * antes de renderizar o novo cenário ou ferramenta, evitando qualquer sobreposição.
   */
  function clearAnalysisLayers() {
    map.closePopup();

    if (activeSwipeOverlay) {
      const el = activeSwipeOverlay.getElement();
      if (el) el.style.clipPath = 'none';
      if (map.hasLayer(activeSwipeOverlay)) {
        map.removeLayer(activeSwipeOverlay);
      }
      activeSwipeOverlay = null;
    }

    if (activeRasterOverlay) {
      if (map.hasLayer(activeRasterOverlay)) {
        map.removeLayer(activeRasterOverlay);
      }
      activeRasterOverlay = null;
    }

    if (map.hasLayer(hotspotsLayer)) {
      map.removeLayer(hotspotsLayer);
    }

    selectedHotspotLayer.clearLayers();
    if (map.hasLayer(selectedHotspotLayer)) {
      map.removeLayer(selectedHotspotLayer);
    }
  }

  function refreshMapLayers(loadingMsg = 'Atualizando camada espectral NDVI (10m)...') {
    runWithMapLoading(loadingMsg, () => {
      // 1. Limpa todas as camadas de análise anteriores
      clearAnalysisLayers();

      const swipeBar = document.getElementById('swipeControlBar');

      // 2. Instancia e adiciona somente a camada correspondente ao modo ativo
      if (state.rasterMode === 'swipe') {
        swipeBar.classList.add('visible');

        const url2026 = engine.renderRasterDataURL({
          mode: '2026',
          isolatedClass: state.isolatedClass
        });
        const url2016 = engine.renderRasterDataURL({
          mode: '2016',
          isolatedClass: state.isolatedClass
        });

        activeRasterOverlay = L.imageOverlay(url2026, bounds, {
          opacity: state.rasterOpacity,
          interactive: false,
          zIndex: 200
        }).addTo(map);

        activeSwipeOverlay = L.imageOverlay(url2016, bounds, {
          opacity: state.rasterOpacity,
          interactive: false,
          zIndex: 210
        }).addTo(map);

        updateSwipeClip();
      } else {
        swipeBar.classList.remove('visible');

        const dataUrl = engine.renderRasterDataURL({
          mode: state.rasterMode,
          isolatedClass: state.isolatedClass,
          class4Submode: state.class4Submode,
          algebraFrom: state.algebraFrom,
          algebraTo: state.algebraTo,
          selectedClasses: state.calcSelectedClasses,
          multiYear: state.calcMultiYear
        });

        activeRasterOverlay = L.imageOverlay(dataUrl, bounds, {
          opacity: state.rasterOpacity,
          interactive: false,
          zIndex: 200
        }).addTo(map);
      }

      // 3. Adiciona camada vetorial de núcleos apenas se ativa
      if (state.showHotspotsLayer) {
        hotspotsLayer.addTo(map);
      }

      // 3b. Núcleo único selecionado na tabela (destacado, sem os demais)
      if (state.selectedHotspot) {
        const hs = state.selectedHotspot;
        const c = L.circle([hs.lonlat[1], hs.lonlat[0]], {
          radius: hs.radius_m * 0.55,
          color: '#fde047',
          weight: 3.5,
          dashArray: null,
          fillColor: '#facc15',
          fillOpacity: 0.10
        });
        c.bindTooltip(`${hs.id} — ${hs.total_drop_km2.toFixed(2).replace('.', ',')} km²`, {
          permanent: true,
          direction: 'top',
          className: 'hotspot-selected-label'
        });
        selectedHotspotLayer.addLayer(c);
        selectedHotspotLayer.addTo(map);
      }

      // 4. Garante ordenação de Z-Index (Mapa Base no fundo, Limite Municipal no topo)
      if (currentBasemap && map.hasLayer(currentBasemap)) {
        currentBasemap.bringToBack();
      }
      if (map.hasLayer(limiteLayer)) {
        limiteLayer.bringToFront();
      }

      updateOperationBanner();
      updateToolbarActiveStates();
      updateLegendHighlight();
    });
  }

  // Renderização inicial limpa
  map.fitBounds(bounds, { padding: [24, 24] });
  refreshMapLayers('Carregando Cenário NDVI 2026...');

  // Controle de Cortina (Swipe 2016 vs 2026)
  const swipeSlider = document.getElementById('swipeRange');
  function updateSwipeClip() {
    if (state.rasterMode !== 'swipe' || !activeSwipeOverlay) return;
    const el = activeSwipeOverlay.getElement();
    if (!el) return;
    const pct = Number(swipeSlider.value);
    document.getElementById('swipePctLabel').textContent = `${pct}%`;
    el.style.clipPath = `polygon(0 0, ${pct}% 0, ${pct}% 100%, 0 100%)`;
  }
  swipeSlider.addEventListener('input', updateSwipeClip);
  map.on('move zoom viewreset', updateSwipeClip);

  // Atualiza Faixa de Contexto da Operação Espacial
  function updateOperationBanner() {
    const tagEl = document.getElementById('opTag');
    const titleEl = document.getElementById('opTitle');
    const descEl = document.getElementById('opDesc');

    if (state.rasterMode === '2016' || state.rasterMode === '2026') {
      tagEl.textContent = `CENÁRIO ESPECTRAL ${state.rasterMode}`;
      if (state.isolatedClass !== null) {
        const cl = engine.classMap[state.isolatedClass];
        titleEl.textContent = `Filtro Isolado: ${cl.code} — ${cl.name} (${cl.range})`;
        const area = state.rasterMode === '2016' ? cl.area_2016_km2 : cl.area_2026_km2;
        const perc = state.rasterMode === '2016' ? cl.perc_2016 : cl.perc_2026;
        descEl.textContent = `Área oficial em ${state.rasterMode}: ${area.toFixed(2).replace('.', ',')} km² (${perc.toFixed(2).replace('.', ',')}% do território).`;
      } else {
        titleEl.textContent = `Distribuição das 5 Classes de NDVI (${state.rasterMode})`;
        descEl.textContent = `Clique em uma classe na legenda (canto inferior direito) para isolá-la ou clique em qualquer pixel de 10m.`;
      }
    } else if (state.rasterMode === 'swipe') {
      tagEl.textContent = 'COMPARAÇÃO TEMPORAL';
      titleEl.textContent = 'Cortina Deslizante: NDVI 2016 (Esq.) × NDVI 2026 (Dir.)';
      descEl.textContent = 'Arraste o controle deslizante para comparar a transição espacial pixel a pixel (10m).';
    } else if (state.rasterMode === 'class4_analysis') {
      tagEl.textContent = 'ISOLAMENTO DE CLASSE';
      titleEl.textContent = 'Classe 4: "NDVI alto" (0,40 a 0,60) — Expansão +35,24 km² (+35,42%)';
      descEl.textContent = state.class4Submode === 'diff_c4'
        ? 'Verde claro: ganho (2026) | Verde escuro: permanência | Âmbar: saída da classe.'
        : `Exibindo apenas os pixels de "NDVI alto" em ${state.class4Submode === '2016_c4' ? '2016 (99,50 km²)' : '2026 (134,74 km²)'}.`;
    } else if (state.rasterMode === 'temporal_algebra') {
      tagEl.textContent = 'ÁLGEBRA DE TRANSIÇÃO';
      if (state.algebraTo === 'c1_c2') {
        titleEl.textContent = 'Transição para Classes Inferiores de NDVI (2016 → 2026)';
        descEl.textContent = 'Laranja: Moderado → Baixo (8,03 km²) | Vermelho: Moderado → Muito Baixo (0,13 km²).';
      } else {
        const cFrom = engine.classMap[Number(state.algebraFrom)];
        const cTo = engine.classMap[Number(state.algebraTo)];
        if (cFrom && cTo) {
          titleEl.textContent = `Origem (2016): ${cFrom.code} (${cFrom.name}) → Destino (2026): ${cTo.code} (${cTo.name})`;
          const res = engine.computeCustomAlgebraStats(state.algebraFrom, state.algebraTo);
          descEl.textContent = `Área calculada na transição: ${res.areaKm2.toFixed(2).replace('.', ',')} km² (${res.pctTerritory.toFixed(2).replace('.', ',')}% do município).`;
        }
      }
    } else if (state.rasterMode === 'critical_proportion') {
      tagEl.textContent = 'PROPORÇÃO TERRITORIAL 2026';
      titleEl.textContent = 'Classes Baixas (Classes 1 e 2: "NDVI muito baixo" + "NDVI baixo"): 16,83 km² (6,88%)';
      descEl.textContent = 'Destacando em vermelho (Classe 1: 1,84 km²) e laranja (Classe 2: 14,99 km²) em 2026.';
    } else if (state.rasterMode === 'high_proportion') {
      tagEl.textContent = 'PROPORÇÃO TERRITORIAL 2026';
      titleEl.textContent = 'Classes Altas (Classes 4 e 5: "NDVI alto" + "NDVI muito alto"): 136,50 km² (55,83%)';
      descEl.textContent = 'Destacando em verde (Classe 4: 134,74 km²) e verde escuro (Classe 5: 1,75 km²) em 2026.';
    } else if (state.rasterMode === 'multi_class_filter') {
      tagEl.textContent = `SOMA DE CLASSES (${state.calcMultiYear})`;
      const selIds = state.calcSelectedClasses;
      const names = selIds.map(id => `Classe ${id}`).join(' + ');
      let area = 0;
      selIds.forEach(id => {
        const cl = engine.classMap[id];
        if (cl) area += (state.calcMultiYear === '2016' ? cl.area_2016_km2 : cl.area_2026_km2);
      });
      const pct = (area / data.metadata.area_raster_km2) * 100;
      titleEl.textContent = `Seleção: ${names || 'Nenhuma classe'} (${state.calcMultiYear})`;
      descEl.textContent = `Soma em ${state.calcMultiYear}: ${area.toFixed(2).replace('.', ',')} km² (${pct.toFixed(2).replace('.', ',')}% do território municipal).`;
    }
  }

  function updateToolbarActiveStates() {
    document.querySelectorAll('[data-map-mode]').forEach(btn => {
      const m = btn.getAttribute('data-map-mode');
      btn.classList.toggle('active', state.rasterMode === m);
    });
    document.getElementById('btnToggleHotspots').classList.toggle('active', state.showHotspotsLayer);
    document.getElementById('btnToggleGrid').classList.toggle('active', state.showUtmGrid);
  }

  function updateLegendHighlight() {
    document.querySelectorAll('.legend-item[data-class-id]').forEach(item => {
      const cid = Number(item.getAttribute('data-class-id'));
      const isIso = (state.isolatedClass === cid) || (state.rasterMode === 'class4_analysis' && cid === 4);
      item.classList.toggle('isolated', isIso);
    });
  }

  // ============================================================================
  // EVENTOS DA BARRA DE FERRAMENTAS FLUTUANTE (CANTO SUPERIOR ESQUERDO)
  // ============================================================================
  const floatingToolbar = document.getElementById('floatingToolbar');
  const btnCollapseToolbar = document.getElementById('btnCollapseToolbar');
  btnCollapseToolbar.addEventListener('click', () => {
    state.toolbarCollapsed = !state.toolbarCollapsed;
    floatingToolbar.classList.toggle('collapsed', state.toolbarCollapsed);
    btnCollapseToolbar.textContent = state.toolbarCollapsed ? '+' : '−';
  });

  document.querySelectorAll('[data-map-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetMode = btn.getAttribute('data-map-mode');
      state.rasterMode = targetMode;

      // Limpa isolamentos e camadas secundárias de outras ferramentas
      if (!['2016', '2026', 'swipe'].includes(targetMode)) {
        state.isolatedClass = null;
      }
      state.showHotspotsLayer = (targetMode === 'temporal_algebra');

      // Sincroniza a aba correspondente na gaveta off-canvas e abre ao acionar uma análise
      document.querySelectorAll('[data-open-modal]').forEach(b => b.classList.remove('active'));
      if (targetMode === 'class4_analysis') {
        syncDrawerTabUI('ndvi-alto');
        setDrawerOpen(true);
      } else if (targetMode === 'temporal_algebra') {
        state.algebraFrom = '3';
        state.algebraTo = 'c1_c2';
        syncDrawerTabUI('transicao');
        setDrawerOpen(true);
      } else if (targetMode === 'critical_proportion') {
        syncDrawerTabUI('proporcao-2026');
        setDrawerOpen(true);
      } else {
        syncDrawerTabUI('overview');
      }

      syncClass4ToggleButton();
      refreshMapLayers(`Ativando modo: ${btn.textContent.trim()}...`);
    });
  });

  document.getElementById('btnToggleHotspots').addEventListener('click', () => {
    state.showHotspotsLayer = !state.showHotspotsLayer;
    refreshMapLayers('Atualizando vetores dos núcleos de transição...');
  });

  document.getElementById('btnToggleGrid').addEventListener('click', () => {
    state.showUtmGrid = !state.showUtmGrid;
    if (state.showUtmGrid) {
      utmGridLayer.addTo(map);
    } else {
      map.removeLayer(utmGridLayer);
    }
    updateToolbarActiveStates();
  });

  document.getElementById('btnResetZoom').addEventListener('click', () => {
    state.isolatedClass = null;
    state.showHotspotsLayer = false;
    map.fitBounds(bounds, { padding: [24, 24] });
    refreshMapLayers('Restaurando enquadramento municipal...');
  });

  // ============================================================================
  // 2. GAVETA LATERAL DESLIZANTE (SEM OVERLAY/BLUR + REDIMENSIONAMENTO DINÂMICO DO LEAFLET)
  // ============================================================================
  const offCanvasDrawer = document.getElementById('offCanvasDrawer');
  let drawerResizeTimer = null;

  function syncLeafletViewportAfterDrawer() {
    map.invalidateSize({ animate: true });
    map.fitBounds(limiteLayer.getBounds(), {
      padding: [24, 24],
      animate: true,
      duration: 0.4
    });
  }

  function setDrawerOpen(isOpen) {
    if (state.drawerOpen === isOpen) return;
    state.drawerOpen = isOpen;
    document.body.classList.toggle('drawer-open', isOpen);
    offCanvasDrawer.classList.toggle('open', isOpen);
    offCanvasDrawer.setAttribute('aria-hidden', String(!isOpen));

    if (drawerResizeTimer) clearTimeout(drawerResizeTimer);
    drawerResizeTimer = setTimeout(syncLeafletViewportAfterDrawer, 300);
  }

  offCanvasDrawer.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'transform') {
      if (drawerResizeTimer) clearTimeout(drawerResizeTimer);
      syncLeafletViewportAfterDrawer();
    }
  });

  document.getElementById('btnFloatingDrawerTab').addEventListener('click', () => setDrawerOpen(true));
  document.getElementById('btnMinimizeDrawer').addEventListener('click', () => setDrawerOpen(false));
  document.getElementById('btnCloseDrawer').addEventListener('click', () => setDrawerOpen(false));

  const selDrawerAnalysis = document.getElementById('selDrawerAnalysis');
  const selDrawerTools = document.getElementById('selDrawerTools');

  // Transforma os <select> do painel em dropdowns customizados com animação suave (sem piscar nativo do SO)
  const customSelectRegistry = new Map();
  function enhanceSelectWithSmoothDropdown(selectEl) {
    if (!selectEl || customSelectRegistry.has(selectEl)) return;
    const wrap = document.createElement('div');
    wrap.className = 'cselect-wrap' + (selectEl.classList.contains('active-select') ? ' active-select' : '');
    selectEl.parentNode.insertBefore(wrap, selectEl);
    wrap.appendChild(selectEl);
    selectEl.classList.add('cselect-native-hidden');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cselect-trigger';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'cselect-label';
    const arrowSpan = document.createElement('span');
    arrowSpan.className = 'cselect-arrow';
    arrowSpan.textContent = '▼';
    trigger.append(labelSpan, arrowSpan);

    const menu = document.createElement('div');
    menu.className = 'cselect-menu';
    wrap.append(trigger, menu);

    function syncFromNative() {
      const selOpt = selectEl.options[selectEl.selectedIndex] || selectEl.options[0];
      labelSpan.textContent = selOpt ? selOpt.textContent : '';
      wrap.classList.toggle('active-select', selectEl.classList.contains('active-select'));
      menu.querySelectorAll('.cselect-option').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.val === selectEl.value && selectEl.value !== '');
      });
    }

    Array.from(selectEl.options).forEach(opt => {
      if (opt.value === '') return; // Não lista o placeholder como item clicável
      const itemBtn = document.createElement('button');
      itemBtn.type = 'button';
      itemBtn.className = 'cselect-option';
      itemBtn.dataset.val = opt.value;
      itemBtn.textContent = opt.textContent;
      itemBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        wrap.classList.remove('open');
        selectEl.value = opt.value;
        syncFromNative();
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      });
      menu.appendChild(itemBtn);
    });

    trigger.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const wasOpen = wrap.classList.contains('open');
      document.querySelectorAll('.cselect-wrap.open').forEach(w => w.classList.remove('open'));
      if (!wasOpen) wrap.classList.add('open');
    });

    syncFromNative();
    customSelectRegistry.set(selectEl, { syncFromNative, wrap });
  }

  document.addEventListener('click', () => {
    document.querySelectorAll('.cselect-wrap.open').forEach(w => w.classList.remove('open'));
  });

  [selDrawerAnalysis, selDrawerTools, document.getElementById('selAlgebraFrom'), document.getElementById('selAlgebraTo')].forEach(enhanceSelectWithSmoothDropdown);

  function syncDrawerTabUI(tabId) {
    state.activeTab = tabId;
    document.querySelectorAll('.tab-pane').forEach(p => {
      p.classList.toggle('active', p.id === `pane-${tabId}`);
    });

    const isAnalysisTab = ['overview', 'ndvi-alto', 'transicao', 'proporcao-2026', 'classes-altas-2026'].includes(tabId);
    if (selDrawerAnalysis && selDrawerTools) {
      if (isAnalysisTab) {
        selDrawerAnalysis.value = tabId;
        selDrawerTools.value = '';
        selDrawerAnalysis.classList.add('active-select');
        selDrawerTools.classList.remove('active-select');
      } else {
        selDrawerAnalysis.value = '';
        selDrawerAnalysis.classList.remove('active-select');
        selDrawerTools.classList.add('active-select');
      }
      customSelectRegistry.get(selDrawerAnalysis)?.syncFromNative();
      customSelectRegistry.get(selDrawerTools)?.syncFromNative();
    }
  }

  if (selDrawerAnalysis) {
    selDrawerAnalysis.addEventListener('change', (e) => {
      const tabId = e.target.value;
      if (!tabId) return;
      state.selectedHotspot = null;
      document.querySelectorAll('#hotspotsTableBody tr.row-selected').forEach(r => r.classList.remove('row-selected'));
      syncDrawerTabUI(tabId);
      state.isolatedClass = null;

      if (tabId === 'overview') {
        state.rasterMode = '2026';
        state.showHotspotsLayer = false;
        refreshMapLayers('Carregando Síntese Temporal (2016 × 2026)...');
      } else if (tabId === 'ndvi-alto') {
        state.rasterMode = 'class4_analysis';
        state.showHotspotsLayer = false;
        syncClass4ToggleButton();
        refreshMapLayers('Isolando camada Classe 4 — NDVI Alto (0,40 a 0,60)...');
      } else if (tabId === 'transicao') {
        state.rasterMode = 'temporal_algebra';
        state.algebraFrom = '3';
        state.algebraTo = 'c1_c2';
        state.showHotspotsLayer = true;
        refreshMapLayers('Destacando Maior Retração (Moderado → Baixo / Muito Baixo)...');
      } else if (tabId === 'proporcao-2026') {
        state.rasterMode = 'critical_proportion';
        state.showHotspotsLayer = false;
        refreshMapLayers('Destacando proporção das classes inferiores (2026)...');
      } else if (tabId === 'classes-altas-2026') {
        state.rasterMode = 'high_proportion';
        state.showHotspotsLayer = false;
        refreshMapLayers('Destacando proporção das classes superiores (2026)...');
      }
    });
  }

  // ============================================================================
  // 4. LEGENDA FLUTUANTE RETRÁTIL (CANTO INFERIOR DIREITO) & INSET MAP
  // ============================================================================
  const legendPanel = document.getElementById('mapLegendPanel');
  const btnCollapseLegend = document.getElementById('btnCollapseLegend');
  document.getElementById('legendHeaderToggle').addEventListener('click', () => {
    const isCol = legendPanel.classList.toggle('collapsed');
    btnCollapseLegend.textContent = isCol ? '+' : '−';
  });

  const insetCard = document.getElementById('insetMapCard');
  const btnCollapseInset = document.getElementById('btnCollapseInset');
  document.getElementById('insetHeaderToggle').addEventListener('click', () => {
    const isCol = insetCard.classList.toggle('collapsed');
    btnCollapseInset.textContent = isCol ? '+' : '−';
  });

  // Clique nos itens da Legenda para isolar qualquer classe de NDVI
  document.querySelectorAll('.legend-item[data-class-id]').forEach(item => {
    item.addEventListener('click', () => {
      const cid = Number(item.getAttribute('data-class-id'));
      if (state.isolatedClass === cid) {
        state.isolatedClass = null;
      } else {
        state.isolatedClass = cid;
        if (!['2016', '2026', 'swipe'].includes(state.rasterMode)) {
          state.rasterMode = '2026';
        }
      }
      syncClass4ToggleButton();
      refreshMapLayers(`Filtrando Classe ${cid} de NDVI...`);
    });
  });

  // ============================================================================
  // INSPEÇÃO DE PIXEL (10m) E COORDENADAS UTM 23S
  // ============================================================================
  map.on('mousemove', (e) => {
    const info = engine.queryAtLatLon(e.latlng.lat, e.latlng.lng);
    document.getElementById('utmCoordsDisplay').innerHTML =
      `<strong>UTM 23S:</strong> ${Math.round(info.easting).toLocaleString('pt-BR')} m E, ${Math.round(info.northing).toLocaleString('pt-BR')} m N`;
    if (info.inside) {
      const sign = info.deltaClass > 0 ? `+${info.deltaClass}` : `${info.deltaClass}`;
      document.getElementById('pixelProbeDisplay').innerHTML =
        `<strong>2016:</strong> ${info.class16.name} (${info.class16.range}) &rarr; ` +
        `<strong>2026:</strong> ${info.class26.name} (${info.class26.range}) [ΔClasse: ${sign}] | ${info.sectorName}`;
    } else {
      document.getElementById('pixelProbeDisplay').innerHTML = `Fora do limite municipal de Extrema`;
    }
  });

  map.on('click', (e) => {
    const info = engine.queryAtLatLon(e.latlng.lat, e.latlng.lng);
    if (!info.inside) return;

    const statusText = info.deltaClass > 0
      ? `<span style="color:#16a34a;font-weight:700;">Aumento de Índice (+${info.deltaClass} classe)</span>`
      : info.deltaClass < 0
        ? `<span style="color:#dc2626;font-weight:700;">Redução de Índice (${info.deltaClass} classe)</span>`
        : `<span style="color:#475569;font-weight:600;">Permanência de Classe (0)</span>`;

    L.popup()
      .setLatLng(e.latlng)
      .setContent(
        `<div style="font-family:Inter,sans-serif;font-size:12px;line-height:1.45;color:#0f172a;min-width:230px;">` +
        `<div style="font-weight:700;font-size:12.5px;border-bottom:1px solid #cbd5e1;padding-bottom:4px;margin-bottom:6px;">` +
        `Inspeção Espectral de Pixel (10m × 10m)` +
        `</div>` +
        `<div><strong>UTM 23S (EPSG:31983):</strong> <code>${Math.round(info.easting)} E, ${Math.round(info.northing)} N</code></div>` +
        `<div><strong>Setor Cartográfico:</strong> ${info.sectorName}</div>` +
        `<div><strong>2016:</strong> <span style="display:inline-block;width:10px;height:10px;background:${info.class16.color};border-radius:2px;"></span> ${info.class16.code} — ${info.class16.name} (${info.class16.range})</div>` +
        `<div><strong>2026:</strong> <span style="display:inline-block;width:10px;height:10px;background:${info.class26.color};border-radius:2px;"></span> ${info.class26.code} — ${info.class26.name} (${info.class26.range})</div>` +
        `<div><strong>Dinâmica 2016–2026:</strong> ${statusText}</div>` +
        `</div>`
      )
      .openOn(map);
  });

  // ============================================================================
  // CONTROLES ESPECÍFICOS DOS MÓDULOS DE ANÁLISE (CLASSE 4, ÁLGEBRA, PROPORÇÃO)
  // ============================================================================
  const btnToggleClass4 = document.getElementById('btnToggleClass4Isolate');
  function syncClass4ToggleButton() {
    const isClass4Active = (state.rasterMode === 'class4_analysis') || (state.isolatedClass === 4);
    btnToggleClass4.classList.toggle('active-toggle', isClass4Active);
    btnToggleClass4.innerHTML = isClass4Active
      ? '<span>● Camada "NDVI alto" (0,40 a 0,60) Isolada no Mapa — Clique para Mostrar Todas</span>'
      : '<span>Isolar e Renderizar Apenas a Classe "NDVI alto" (0,40 a 0,60) no Mapa</span>';
  }

  btnToggleClass4.addEventListener('click', () => {
    if (state.rasterMode === 'class4_analysis') {
      state.rasterMode = '2026';
      state.isolatedClass = null;
    } else {
      state.rasterMode = 'class4_analysis';
      state.isolatedClass = null;
    }
    syncClass4ToggleButton();
    refreshMapLayers('Alternando isolamento da Classe 4 (NDVI alto)...');
  });

  document.querySelectorAll('[data-class4-submode]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.class4Submode = btn.getAttribute('data-class4-submode');
      state.rasterMode = 'class4_analysis';
      document.querySelectorAll('[data-class4-submode]').forEach(b => b.classList.toggle('active', b === btn));
      syncClass4ToggleButton();
      refreshMapLayers(`Processando recorte: ${btn.textContent.trim()}...`);
    });
  });

  // ============================================================================
  // CALCULADORA HÍBRIDA DE NDVI: 1) COMPARAÇÃO/SOMA INDEPENDENTE (2016 x 2026) + 2) FLUXO DE TRANSIÇÃO
  // ============================================================================
  const calcBtns2016 = Array.from(document.querySelectorAll('#calcChecklist2016 .calc-class-toggle'));
  const calcBtns2026 = Array.from(document.querySelectorAll('#calcChecklist2026 .calc-class-toggle'));
  const btnAll2016 = document.getElementById('btnAll2016');
  const btnAll2026 = document.getElementById('btnAll2026');
  const btnCalcShowMap2016 = document.getElementById('btnCalcShowMap2016');
  const btnCalcShowMap2026 = document.getElementById('btnCalcShowMap2026');

  function updateCalcMultiClassSum(renderMap = false) {
    const selected2016 = calcBtns2016
      .filter(b => b.classList.contains('active'))
      .map(b => Number(b.getAttribute('data-calc-cid')));

    const selected2026 = calcBtns2026
      .filter(b => b.classList.contains('active'))
      .map(b => Number(b.getAttribute('data-calc-cid')));

    state.calcSelected2016 = selected2016;
    state.calcSelected2026 = selected2026;
    state.calcSelectedClasses = state.calcMultiYear === '2016' ? selected2016 : selected2026;

    const totalTerritory = data.metadata.area_raster_km2;

    let sum16 = 0;
    selected2016.forEach(cid => {
      const cl = engine.classMap[cid];
      if (cl) sum16 += cl.area_2016_km2;
    });

    let sum26 = 0;
    selected2026.forEach(cid => {
      const cl = engine.classMap[cid];
      if (cl) sum26 += cl.area_2026_km2;
    });

    const pct16 = totalTerritory > 0 ? (sum16 / totalTerritory) * 100 : 0;
    const pct26 = totalTerritory > 0 ? (sum26 / totalTerritory) * 100 : 0;
    const diffKm2 = sum26 - sum16;
    const diffRelPct = sum16 > 0 ? (diffKm2 / sum16) * 100 : 0;
    const diffPp = pct26 - pct16;

    const signKm2 = diffKm2 > 0.005 ? '+' : '';
    const signPct = diffRelPct > 0.005 ? '+' : '';
    const signPp = diffPp > 0.005 ? '+' : '';

    const lbl16 = selected2016.length === 5 ? 'Todas' : selected2016.map(c => `C${c}`).join('+');
    const lbl26 = selected2026.length === 5 ? 'Todas' : selected2026.map(c => `C${c}`).join('+');

    document.getElementById('calcSum2016Label').textContent = `2016 (${lbl16})`;
    document.getElementById('calcSum2016Area').textContent = `${sum16.toFixed(2).replace('.', ',')} km²`;
    document.getElementById('calcSum2016Pct').textContent = `${pct16.toFixed(2).replace('.', ',')}% do município`;

    document.getElementById('calcSum2026Label').textContent = `2026 (${lbl26})`;
    document.getElementById('calcSum2026Area').textContent = `${sum26.toFixed(2).replace('.', ',')} km²`;
    document.getElementById('calcSum2026Pct').textContent = `${pct26.toFixed(2).replace('.', ',')}% do município`;

    const diffAreaEl = document.getElementById('calcSumDiffArea');
    diffAreaEl.textContent = `${signKm2}${diffKm2.toFixed(2).replace('.', ',')} km²`;
    diffAreaEl.className = 'kpi-value ' + (diffKm2 > 0.005 ? 'pos-text' : diffKm2 < -0.005 ? 'neg-text' : '');

    document.getElementById('calcSumDiffPct').textContent =
      sum16 > 0
        ? `${signPct}${diffRelPct.toFixed(2).replace('.', ',')}% (${signPp}${diffPp.toFixed(2).replace('.', ',')} p.p.)`
        : '0,00%';

    if (renderMap) {
      state.rasterMode = 'multi_class_filter';
      state.showHotspotsLayer = false;
      refreshMapLayers(`Destacando seleção de ${state.calcMultiYear} no mapa...`);
    }
  }

  calcBtns2016.forEach(btn => {
    btn.addEventListener('click', () => {
      const activeCount = calcBtns2016.filter(b => b.classList.contains('active')).length;
      if (btn.classList.contains('active') && activeCount <= 1) return;
      btn.classList.toggle('active');
      state.calcMultiYear = '2016';
      if (btnCalcShowMap2016 && btnCalcShowMap2026) {
        btnCalcShowMap2016.classList.add('active');
        btnCalcShowMap2026.classList.remove('active');
      }
      updateCalcMultiClassSum(true);
    });
  });

  calcBtns2026.forEach(btn => {
    btn.addEventListener('click', () => {
      const activeCount = calcBtns2026.filter(b => b.classList.contains('active')).length;
      if (btn.classList.contains('active') && activeCount <= 1) return;
      btn.classList.toggle('active');
      state.calcMultiYear = '2026';
      if (btnCalcShowMap2016 && btnCalcShowMap2026) {
        btnCalcShowMap2026.classList.add('active');
        btnCalcShowMap2016.classList.remove('active');
      }
      updateCalcMultiClassSum(true);
    });
  });

  if (btnAll2016) {
    btnAll2016.addEventListener('click', () => {
      calcBtns2016.forEach(b => b.classList.add('active'));
      state.calcMultiYear = '2016';
      if (btnCalcShowMap2016 && btnCalcShowMap2026) {
        btnCalcShowMap2016.classList.add('active');
        btnCalcShowMap2026.classList.remove('active');
      }
      updateCalcMultiClassSum(true);
    });
  }

  if (btnAll2026) {
    btnAll2026.addEventListener('click', () => {
      calcBtns2026.forEach(b => b.classList.add('active'));
      state.calcMultiYear = '2026';
      if (btnCalcShowMap2016 && btnCalcShowMap2026) {
        btnCalcShowMap2026.classList.add('active');
        btnCalcShowMap2016.classList.remove('active');
      }
      updateCalcMultiClassSum(true);
    });
  }

  if (btnCalcShowMap2016 && btnCalcShowMap2026) {
    btnCalcShowMap2016.addEventListener('click', () => {
      state.calcMultiYear = '2016';
      btnCalcShowMap2016.classList.add('active');
      btnCalcShowMap2026.classList.remove('active');
      updateCalcMultiClassSum(true);
    });
    btnCalcShowMap2026.addEventListener('click', () => {
      state.calcMultiYear = '2026';
      btnCalcShowMap2026.classList.add('active');
      btnCalcShowMap2016.classList.remove('active');
      updateCalcMultiClassSum(true);
    });
  }

  const selFrom = document.getElementById('selAlgebraFrom');
  const selTo = document.getElementById('selAlgebraTo');

  function updateAlgebraLiveMetrics(renderMap = true) {
    state.algebraFrom = selFrom.value;
    state.algebraTo = selTo.value;

    const fromId = Number(state.algebraFrom);
    const toId = Number(state.algebraTo);
    const cFrom = engine.classMap[fromId];
    const cTo = engine.classMap[toId];
    const res = engine.computeCustomAlgebraStats(state.algebraFrom, state.algebraTo);

    const areaEl = document.getElementById('algebraAreaVal');
    areaEl.textContent = `${res.areaKm2.toFixed(2).replace('.', ',')} km²`;
    document.getElementById('algebraPctVal').textContent = `${res.pctTerritory.toFixed(2).replace('.', ',')}% do município`;

    // Participação sobre a classe de Origem (2016) e sobre a classe de Destino (2026)
    const originShare = (cFrom && cFrom.area_2016_km2 > 0) ? Math.min(100, (res.areaKm2 / cFrom.area_2016_km2) * 100) : 0;
    const destShare = (cTo && cTo.area_2026_km2 > 0) ? Math.min(100, (res.areaKm2 / cTo.area_2026_km2) * 100) : 0;

    document.getElementById('algebraOriginShareVal').textContent = `${originShare.toFixed(2).replace('.', ',')}%`;
    document.getElementById('algebraOriginShareSub').textContent = `da Classe ${fromId} de 2016`;

    document.getElementById('algebraDestShareVal').textContent = `${destShare.toFixed(2).replace('.', ',')}%`;
    document.getElementById('algebraDestShareSub').textContent = `da Classe ${toId} de 2026`;

    // Diagnóstico da direção espectral
    const delta = toId - fromId;
    const badgeEl = document.getElementById('algebraDirectionBadge');
    if (delta > 0) {
      badgeEl.className = 'calc-direction-badge pos';
      badgeEl.textContent = `▲ Aumento de Índice (+${delta} ${delta === 1 ? 'classe espectral' : 'classes espectrais'}: Classe ${fromId} → Classe ${toId})`;
      areaEl.className = 'kpi-value pos-text';
    } else if (delta < 0) {
      badgeEl.className = 'calc-direction-badge neg';
      badgeEl.textContent = `▼ Redução de Índice (${delta} ${delta === -1 ? 'classe espectral' : 'classes espectrais'}: Classe ${fromId} → Classe ${toId})`;
      areaEl.className = 'kpi-value warn-text';
    } else {
      badgeEl.className = 'calc-direction-badge same';
      badgeEl.textContent = `● Permanência Espectral (mesma classe entre 2016 e 2026: Classe ${fromId} → Classe ${toId})`;
      areaEl.className = 'kpi-value info-text';
    }

    if (renderMap && (state.activeTab === 'calculadora' || state.activeTab === 'transicao' || state.rasterMode === 'temporal_algebra')) {
      state.rasterMode = 'temporal_algebra';
      state.showHotspotsLayer = false;
      refreshMapLayers('Destacando fluxo de transição espectral no mapa...');
    }
  }

  selFrom.addEventListener('change', () => updateAlgebraLiveMetrics(true));
  selTo.addEventListener('change', () => updateAlgebraLiveMetrics(true));

  const btnShowTransitionOnMap = document.getElementById('btnShowTransitionOnMap');
  if (btnShowTransitionOnMap) {
    btnShowTransitionOnMap.addEventListener('click', () => {
      updateAlgebraLiveMetrics(true);
    });
  }

  const propLowBtns = ['btnHighlightPropBoth', 'btnHighlightPropC1', 'btnHighlightPropC2'];
  function setActiveChipGroup(ids, activeId) {
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('active', id === activeId);
    });
  }

  document.getElementById('btnHighlightPropBoth').addEventListener('click', () => {
    state.rasterMode = 'critical_proportion';
    state.isolatedClass = null;
    setActiveChipGroup(propLowBtns, 'btnHighlightPropBoth');
    refreshMapLayers('Destacando soma das Classes 1 e 2 (2026)...');
  });
  document.getElementById('btnHighlightPropC1').addEventListener('click', () => {
    state.rasterMode = '2026';
    state.isolatedClass = 1;
    setActiveChipGroup(propLowBtns, 'btnHighlightPropC1');
    refreshMapLayers('Isolando Classe 1 — NDVI muito baixo (2026)...');
  });
  document.getElementById('btnHighlightPropC2').addEventListener('click', () => {
    state.rasterMode = '2026';
    state.isolatedClass = 2;
    setActiveChipGroup(propLowBtns, 'btnHighlightPropC2');
    refreshMapLayers('Isolando Classe 2 — NDVI baixo (2026)...');
  });

  const propHighBtns = ['btnHighlightHighBoth', 'btnHighlightHighC4', 'btnHighlightHighC5'];
  document.getElementById('btnHighlightHighBoth').addEventListener('click', () => {
    state.rasterMode = 'high_proportion';
    state.isolatedClass = null;
    setActiveChipGroup(propHighBtns, 'btnHighlightHighBoth');
    refreshMapLayers('Destacando soma das Classes 4 e 5 (2026)...');
  });
  document.getElementById('btnHighlightHighC4').addEventListener('click', () => {
    state.rasterMode = '2026';
    state.isolatedClass = 4;
    setActiveChipGroup(propHighBtns, 'btnHighlightHighC4');
    refreshMapLayers('Isolando Classe 4 — NDVI alto (2026)...');
  });
  document.getElementById('btnHighlightHighC5').addEventListener('click', () => {
    state.rasterMode = '2026';
    state.isolatedClass = 5;
    setActiveChipGroup(propHighBtns, 'btnHighlightHighC5');
    refreshMapLayers('Isolando Classe 5 — NDVI muito alto (2026)...');
  });

  // ============================================================================
  // 3. GRÁFICOS E TABELAS DENTRO DO PAINEL DESCRITIVO (SEM MODAL — MAPA VISÍVEL)
  // ============================================================================
  const analyticsModal = document.getElementById('analyticsModal');
  const cartoModal = document.getElementById('cartoModal');
  const chartInstances = [];

  // Move as seções de gráficos e tabelas para dentro da gaveta lateral como abas próprias
  const drawerBody = document.querySelector('.drawer-body');
  const chartsPane = document.getElementById('modalViewCharts');
  const tablesPane = document.getElementById('modalViewTables');
  [[chartsPane, 'pane-graficos'], [tablesPane, 'pane-tabelas']].forEach(([el, id]) => {
    el.id = id;
    el.className = 'tab-pane drawer-analytics-pane';
    drawerBody.appendChild(el);
  });
  if (analyticsModal) analyticsModal.remove();

  // Abre o painel descritivo diretamente na aba de gráficos, tabelas, calculadora ou modal da prancha
  function openAnalyticsInDrawer(viewMode = 'charts') {
    if (viewMode === 'carto_sheet') {
      cartoModal.classList.add('open');
      if (selDrawerTools) {
        const revMap = { graficos: 'charts', tabelas: 'tables', calculadora: 'calculator' };
        selDrawerTools.value = revMap[state.activeTab] || '';
        customSelectRegistry.get(selDrawerTools)?.syncFromNative();
      }
      return;
    }
    const tabMap = {
      charts: 'graficos',
      tables: 'tabelas',
      calculator: 'calculadora'
    };
    const tabId = tabMap[viewMode] || 'graficos';
    if (selDrawerTools) selDrawerTools.value = viewMode;
    syncDrawerTabUI(tabId);
    setDrawerOpen(true);
    drawerBody.scrollTop = 0;
    if (viewMode === 'charts') {
      requestAnimationFrame(() => chartInstances.forEach(c => c.resize()));
      setTimeout(() => chartInstances.forEach(c => c.resize()), 320);
    } else if (viewMode === 'calculator') {
      updateCalcMultiClassSum(true);
      updateAlgebraLiveMetrics(false);
    }
  }
  function closeAnalyticsModal() { /* compatibilidade: não há mais modal analítico */ }

  if (selDrawerTools) {
    selDrawerTools.addEventListener('change', (e) => {
      const val = e.target.value;
      if (!val) return;
      openAnalyticsInDrawer(val);
    });
  }

  // Modal da Prancha Cartográfica Original
  document.getElementById('btnCloseCartoSheet').addEventListener('click', () => {
    cartoModal.classList.remove('open');
  });
  cartoModal.addEventListener('click', (e) => {
    if (e.target === cartoModal) cartoModal.classList.remove('open');
  });

  // Fechar modais e gaveta com tecla Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAnalyticsModal();
      cartoModal.classList.remove('open');
      setDrawerOpen(false);
    }
  });

  // Popula Tabela 2 (Núcleos Geográficos de Transição) dentro do Modal
  const hotspotsTbody = document.getElementById('hotspotsTableBody');
  data.hotspots_transition.forEach(hs => {
    const tr = document.createElement('tr');
    tr.title = 'Clique para fechar o modal e centralizar o mapa neste núcleo UTM';
    tr.innerHTML = `
      <td><strong>${hs.id}</strong> — ${hs.name}<br><span style="font-size:10.5px;color:#94a3b8;">UTM: ${hs.utm_e} E, ${hs.utm_n} N (${hs.sector})</span></td>
      <td class="num" style="color:#fb923c;">${hs.mod_to_low_km2.toFixed(2).replace('.', ',')}</td>
      <td class="num" style="color:#f87171;">${hs.mod_to_vlow_km2.toFixed(2).replace('.', ',')}</td>
      <td class="num"><strong style="color:#fff;">${hs.total_drop_km2.toFixed(2).replace('.', ',')} km²</strong></td>
    `;
    tr.dataset.hotspotId = hs.id;
    tr.addEventListener('click', () => {
      state.rasterMode = 'temporal_algebra';
      state.showHotspotsLayer = false;      // oculta todos os demais núcleos
      state.selectedHotspot = hs;           // exibe somente o núcleo clicado
      hotspotsTbody.querySelectorAll('tr').forEach(r => r.classList.toggle('row-selected', r === tr));
      refreshMapLayers(`Centralizando no núcleo ${hs.id}...`);
      map.flyTo([hs.lonlat[1], hs.lonlat[0]], 14, { duration: 0.7 });
    });
    hotspotsTbody.appendChild(tr);
  });

  // Popula Tabela 3 (Matriz de Transição 5x5 completa) dentro do Modal
  const matrixTbody = document.getElementById('transitionMatrixBody');
  data.transition_matrix_km2.forEach((row, rIdx) => {
    const cOrig = data.classes[rIdx];
    const tr = document.createElement('tr');
    let cellsHtml = `<td><span class="table-swatch" style="background:${cOrig.color};"></span><strong>C${cOrig.id}</strong></td>`;
    row.forEach((val, cIdx) => {
      const isDiag = rIdx === cIdx;
      const isDropMod = (rIdx === 2 && (cIdx === 0 || cIdx === 1));
      const isGainHigh = (rIdx === 2 && cIdx === 3);
      let style = '';
      if (isDropMod) style = 'background:rgba(239,68,68,0.24);color:#fca5a5;font-weight:700;';
      else if (isGainHigh) style = 'background:rgba(16,185,129,0.22);color:#6ee7b7;font-weight:700;';
      else if (isDiag) style = 'background:rgba(255,255,255,0.05);color:#e2e8f0;';
      cellsHtml += `<td class="num" style="${style}">${val.toFixed(2).replace('.', ',')}</td>`;
    });
    tr.innerHTML = cellsHtml;
    matrixTbody.appendChild(tr);
  });

  // ============================================================================
  // GRÁFICOS DINÂMICOS (CHART.JS DENTRO DO MODAL CENTRALIZADO)
  // ============================================================================
  Chart.defaults.color = '#94a3b8';
  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.font.size = 11.5;

  // 1. Gráfico Síntese: Área por Classe de NDVI — 2016 x 2026
  const ctxOverview = document.getElementById('chartOverviewBars').getContext('2d');
  chartInstances.push(new Chart(ctxOverview, {
    type: 'bar',
    data: {
      labels: [
        'Classe 1: Muito Baixo (-1,00 a 0,00)',
        'Classe 2: Baixo (0,00 a 0,20)',
        'Classe 3: Moderado (0,20 a 0,40)',
        'Classe 4: Alto (0,40 a 0,60)',
        'Classe 5: Muito Alto (0,60 a 0,80)'
      ],
      datasets: [
        {
          label: '2016 (km²)',
          data: [0.61, 14.04, 127.11, 99.50, 3.21],
          backgroundColor: '#1d3c96',
          borderRadius: 4
        },
        {
          label: '2026 (km²)',
          data: [1.84, 14.99, 91.15, 134.74, 1.75],
          backgroundColor: '#0ea39c',
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2).replace('.', ',')} km²`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(148,163,184,0.1)' },
          title: { display: true, text: 'Área (km²)' }
        },
        x: {
          grid: { display: false }
        }
      }
    }
  }));

  // 2. Gráfico Variação NDVI Alto: Evolução e Composição da Classe 4 ("NDVI alto")
  const ctxClass4 = document.getElementById('chartClass4Bars').getContext('2d');
  chartInstances.push(new Chart(ctxClass4, {
    type: 'bar',
    data: {
      labels: ['NDVI Alto em 2016', 'NDVI Alto em 2026', 'Saldo Líquido (+Δ)'],
      datasets: [{
        label: 'Área da Classe 4 — NDVI alto (km²)',
        data: [99.5039, 134.7434, 35.2395],
        backgroundColor: ['#1d3c96', '#197a19', '#10b981'],
        borderRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.parsed.y.toFixed(2).replace('.', ',')} km²`
          }
        }
      },
      scales: {
        y: { beginAtZero: true, grid: { color: 'rgba(148,163,184,0.1)' } },
        x: { grid: { display: false } }
      }
    }
  }));

  // 3. Gráfico de Rosca (Donut Chart) — Proporção Territorial em 2026
  const ctxPropDonut = document.getElementById('chartPropDonut').getContext('2d');
  chartInstances.push(new Chart(ctxPropDonut, {
    type: 'doughnut',
    data: {
      labels: [
        'C1 — Muito Baixo: 1,84 km² (0,75%)',
        'C2 — Baixo: 14,99 km² (6,13%)',
        'C3 — Moderado: 91,15 km² (37,28%)',
        'C4 — Alto: 134,74 km² (55,11%)',
        'C5 — Muito Alto: 1,75 km² (0,72%)'
      ],
      datasets: [{
        data: [1.8427, 14.9916, 91.1536, 134.7434, 1.7517],
        backgroundColor: ['#d61f1f', '#f07d0a', '#f5ee09', '#197a19', '#12491b'],
        borderColor: '#0f172a',
        borderWidth: 2,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 12, font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const val = ctx.parsed;
              const pct = (val / 244.483 * 100).toFixed(2).replace('.', ',');
              return ` ${val.toFixed(3).replace('.', ',')} km² (${pct}% do município)`;
            }
          }
        }
      }
    }
  }));

  // ============================================================================
  // MAPA DE SITUAÇÃO INSET ("LOCALIZAÇÃO DE EXTREMA EM MINAS GERAIS" — 2x RETINA)
  // ============================================================================
  function drawInsetSituationMap() {
    const canvas = document.getElementById('insetCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, W, H);

    // Recorte geográfico proporcional sem distorção (razão de aspecto cos(19.1°) aplicada)
    const lonMin = -51.8, lonMax = -39.2;
    const latMin = -24.1, latMax = -14.1;

    const proj = (lon, lat) => [
      ((lon - lonMin) / (lonMax - lonMin)) * W,
      ((latMax - lat) / (latMax - latMin)) * H
    ];

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const features = [...data.geojson.estados_inset.features].sort((a, b) => {
      if (a.properties.SIGLA_UF === 'MG') return 1;
      if (b.properties.SIGLA_UF === 'MG') return -1;
      return 0;
    });

    features.forEach(feat => {
      const isMG = feat.properties.SIGLA_UF === 'MG';
      ctx.fillStyle = isMG ? '#929597' : '#c5c7c9';
      ctx.strokeStyle = isMG ? '#4b5563' : '#64748b';
      ctx.lineWidth = isMG ? 2.0 : 1.3;

      feat.geometry.coordinates.forEach(poly => {
        const ring = poly[0];
        ctx.beginPath();
        ring.forEach((pt, idx) => {
          const [x, y] = proj(pt[0], pt[1]);
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      });
    });

    ctx.fillStyle = '#1e293b';
    ctx.font = '600 16px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labels = [
      ['Minas Gerais', -44.6, -18.8],
      ['SP', -48.6, -21.9],
      ['RJ', -42.6, -22.2],
      ['ES', -40.5, -19.6],
      ['GO', -49.6, -16.6],
      ['DF', -47.8, -15.8],
      ['MS', -51.8, -20.3],
      ['BA', -41.8, -14.8],
      ['PR', -50.4, -23.7],
      ['MT', -51.8, -15.6]
    ];
    labels.forEach(([uf, lon, lat]) => {
      const [lx, ly] = proj(lon, lat);
      ctx.fillText(uf, lx, ly);
    });

    const [exX, exY] = proj(-46.276, -22.814);
    ctx.fillStyle = 'rgba(214, 31, 31, 0.25)';
    ctx.fillRect(exX - 11, exY - 9, 22, 18);
    ctx.strokeStyle = '#8b1e1e';
    ctx.lineWidth = 2.6;
    ctx.strokeRect(exX - 11, exY - 9, 22, 18);

    ctx.beginPath();
    ctx.arc(exX, exY, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#d61f1f';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(exX + 11, exY + 2);
    ctx.lineTo(W - 115, H - 18);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.font = '700 15px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Extrema (MG)', W - 110, H - 17);
  }
  drawInsetSituationMap();

  document.getElementById('insetCanvas').addEventListener('click', () => {
    map.fitBounds(bounds, { padding: [24, 24] });
  });
});
