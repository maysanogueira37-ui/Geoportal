/**
 * Motor de Geoprocessamento Matricial e Vetorial (EPSG:31983 — SIRGAS 2000 / UTM Zona 23S)
 * Opera diretamente sobre o cubo matricial de 10m (2220 x 2071 células) mantendo-se estritamente ao índice NDVI.
 */
class SpatialEngine {
  constructor(data) {
    this.data = data;
    this.meta = data.metadata;
    this.classes = data.classes;
    this.classMap = {};
    this.classes.forEach(c => { this.classMap[c.id] = c; });

    this.width = this.meta.grid_size[0];  // 2220
    this.height = this.meta.grid_size[1]; // 2071
    this.xmin = this.meta.utm_bbox[0];
    this.ymin = this.meta.utm_bbox[1];
    this.xmax = this.meta.utm_bbox[2];
    this.ymax = this.meta.utm_bbox[3];

    this.latMin = this.meta.latlon_bounds[0][0];
    this.lonMin = this.meta.latlon_bounds[0][1];
    this.latMax = this.meta.latlon_bounds[1][0];
    this.lonMax = this.meta.latlon_bounds[1][1];

    this.cubePixels = null; // Uint8ClampedArray (W * H * 4)
    this.renderCanvas = document.createElement('canvas');
    this.renderCanvas.width = this.width;
    this.renderCanvas.height = this.height;
    this.renderCtx = this.renderCanvas.getContext('2d');

    // Paleta oficial das classes de NDVI (Mapa_Analitico_01_Extrema)
    this.classRGB = {
      1: [214, 31, 31],   // NDVI muito baixo (-1,00 a 0,00)
      2: [240, 125, 10],  // NDVI baixo (0,00 a 0,20)
      3: [245, 238, 9],   // NDVI moderado (0,20 a 0,40)
      4: [25, 122, 25],   // NDVI alto (0,40 a 0,60)
      5: [18, 73, 27]     // NDVI muito alto (0,60 a 0,80)
    };
  }

  async init() {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = this.width;
        tmpCanvas.height = this.height;
        const ctx = tmpCanvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        this.cubePixels = ctx.getImageData(0, 0, this.width, this.height).data;
        resolve(true);
      };
      img.onerror = reject;
      img.src = this.data.spatial_cube_b64;
    });
  }

  /**
   * Converte Lat/Lon (SIRGAS 2000 / WGS84) para UTM Zona 23S (EPSG:31983)
   */
  latlonToUtm23S(latDeg, lonDeg) {
    const a = 6378137.0;
    const f = 1.0 / 298.257222101;
    const e2 = 2 * f - f * f;
    const ep2 = e2 / (1.0 - e2);
    const k0 = 0.9996;
    const lon0 = -45.0 * Math.PI / 180.0;
    const lat = latDeg * Math.PI / 180.0;
    const lon = lonDeg * Math.PI / 180.0;

    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const tanLat = Math.tan(lat);

    const N = a / Math.sqrt(1.0 - e2 * sinLat * sinLat);
    const T = tanLat * tanLat;
    const C = ep2 * cosLat * cosLat;
    const A = cosLat * (lon - lon0);

    const M = a * (
      (1.0 - e2 / 4.0 - 3.0 * e2 * e2 / 64.0 - 5.0 * e2 * e2 * e2 / 256.0) * lat
      - (3.0 * e2 / 8.0 + 3.0 * e2 * e2 / 32.0 + 45.0 * e2 * e2 * e2 / 1024.0) * Math.sin(2.0 * lat)
      + (15.0 * e2 * e2 / 256.0 + 45.0 * e2 * e2 / 1024.0) * Math.sin(4.0 * lat)
      - (35.0 * e2 * e2 * e2 / 3072.0) * Math.sin(6.0 * lat)
    );

    const easting = 500000.0 + k0 * N * (
      A + (1.0 - T + C) * Math.pow(A, 3) / 6.0
      + (5.0 - 18.0 * T + T * T + 72.0 * C - 58.0 * ep2) * Math.pow(A, 5) / 120.0
    );

    const northing = 10000000.0 + k0 * (
      M + N * tanLat * (
        A * A / 2.0
        + (5.0 - T + 9.0 * C + 4.0 * C * C) * Math.pow(A, 4) / 24.0
        + (61.0 - 58.0 * T + T * T + 600.0 * C - 330.0 * ep2) * Math.pow(A, 6) / 720.0
      )
    );

    return { easting, northing };
  }

  /**
   * Identifica o quadrante geográfico a partir da coordenada UTM
   */
  getGeographicSector(easting, northing) {
    const ew = easting < 366500 ? 'Oeste' : (easting > 372500 ? 'Leste' : 'Central');
    const ns = northing > 7478500 ? 'Norte' : (northing < 7472500 ? 'Sul' : 'Centro');
    if (ns === 'Centro' && ew === 'Central') return 'Setor Central do Município';
    return `Setor ${ns}-${ew}`;
  }

  /**
   * Consulta o pixel de 10m no cubo espacial a partir de coordenadas Lat/Lon
   */
  queryAtLatLon(lat, lon) {
    const { easting, northing } = this.latlonToUtm23S(lat, lon);
    if (!this.cubePixels) return { easting, northing, inside: false };

    const col = Math.floor(((lon - this.lonMin) / (this.lonMax - this.lonMin)) * this.width);
    const row = Math.floor(((this.latMax - lat) / (this.latMax - this.latMin)) * this.height);

    if (col < 0 || col >= this.width || row < 0 || row >= this.height) {
      return { easting, northing, inside: false };
    }

    const idx = (row * this.width + col) * 4;
    const c16 = this.cubePixels[idx];
    const c26 = this.cubePixels[idx + 1];

    if (c16 === 0 || c26 === 0) {
      return { easting, northing, inside: false };
    }

    return {
      easting,
      northing,
      inside: true,
      c16,
      c26,
      class16: this.classMap[c16],
      class26: this.classMap[c26],
      deltaClass: c26 - c16,
      sectorName: this.getGeographicSector(easting, northing)
    };
  }

  /**
   * Executa Álgebra de Mapas personalizada sobre os 2.444.830 pixels de 10m
   */
  computeCustomAlgebraStats(fromFilter, toFilter) {
    if (!this.cubePixels) return { pixelCount: 0, areaKm2: 0, pctTerritory: 0 };
    const src = this.cubePixels;
    const len = this.width * this.height * 4;
    let matchCount = 0;
    let totalInside = 0;

    for (let i = 0; i < len; i += 4) {
      const c16 = src[i];
      const c26 = src[i + 1];
      if (c16 === 0 || c26 === 0) continue;
      totalInside++;

      if (this.matchesAlgebraRule(c16, c26, fromFilter, toFilter)) {
        matchCount++;
      }
    }

    const areaKm2 = (matchCount * 100.0) / 1e6;
    const pctTerritory = totalInside > 0 ? (matchCount / totalInside) * 100.0 : 0;
    return { pixelCount: matchCount, areaKm2, pctTerritory };
  }

  matchesAlgebraRule(c16, c26, fromFilter, toFilter) {
    if (fromFilter !== 'all' && c16 !== Number(fromFilter)) {
      return false;
    }
    if (toFilter === 'lower') return c26 < c16;
    if (toFilter === 'higher') return c26 > c16;
    if (toFilter === 'same') return c26 === c16;
    if (toFilter === 'c1_c2') return c26 === 1 || c26 === 2;
    if (toFilter === 'c4_c5') return c26 === 4 || c26 === 5;
    if (toFilter === 'all_diff') return c26 !== c16;
    return c26 === Number(toFilter);
  }

  /**
   * Renderiza a camada raster dinâmica (Data URL PNG) de acordo com o modo analítico ativo
   */
  renderRasterDataURL(options = {}) {
    const {
      mode = '2026',              // '2016' | '2026' | 'class4_analysis' | 'temporal_algebra' | 'critical_proportion' | 'multi_class_filter'
      isolatedClass = null,       // null ou 1..5
      class4Submode = '2026_c4',  // '2016_c4' | '2026_c4' | 'diff_c4'
      algebraFrom = '3',          // '3' (NDVI moderado) ou 'all' ou '1'..'5'
      algebraTo = 'c1_c2',        // 'c1_c2' (baixo/muito baixo) ou 'lower' | 'higher' | '1'..'5'
      selectedClasses = [4, 5],   // array de classes selecionadas na calculadora (1..5)
      multiYear = '2026'          // '2016' | '2026'
    } = options;
    const selectedSet = new Set((selectedClasses || []).map(Number));

    const imgData = this.renderCtx.createImageData(this.width, this.height);
    const dst = imgData.data;
    const src = this.cubePixels;
    const len = this.width * this.height * 4;

    for (let i = 0; i < len; i += 4) {
      const c16 = src[i];
      const c26 = src[i + 1];
      if (c16 === 0 || c26 === 0) {
        dst[i + 3] = 0;
        continue;
      }

      // Modo 1: Mapa Temático 2016 ou 2026
      if (mode === '2016' || mode === '2026') {
        const c = mode === '2016' ? c16 : c26;
        const rgb = this.classRGB[c];
        if (isolatedClass !== null && c !== isolatedClass) {
          dst[i] = 30; dst[i + 1] = 41; dst[i + 2] = 59; dst[i + 3] = 55;
        } else {
          dst[i] = rgb[0]; dst[i + 1] = rgb[1]; dst[i + 2] = rgb[2]; dst[i + 3] = 235;
        }
        continue;
      }

      // Modo Calculadora de Soma de Classes Selecionadas (2016 ou 2026)
      if (mode === 'multi_class_filter') {
        const c = multiYear === '2016' ? c16 : c26;
        const rgb = this.classRGB[c];
        if (selectedSet.has(c)) {
          dst[i] = rgb[0]; dst[i + 1] = rgb[1]; dst[i + 2] = rgb[2]; dst[i + 3] = 248;
        } else {
          dst[i] = Math.round(rgb[0] * 0.32);
          dst[i + 1] = Math.round(rgb[1] * 0.32);
          dst[i + 2] = Math.round(rgb[2] * 0.32);
          dst[i + 3] = 60;
        }
        continue;
      }

      // Análise 1: Variação e Isolamento da Classe 4 (NDVI alto: 0,40 a 0,60)
      if (mode === 'class4_analysis') {
        if (class4Submode === '2016_c4') {
          if (c16 === 4) {
            dst[i] = 25; dst[i + 1] = 122; dst[i + 2] = 25; dst[i + 3] = 245;
          } else {
            dst[i] = 25; dst[i + 1] = 35; dst[i + 2] = 52; dst[i + 3] = 65;
          }
        } else if (class4Submode === '2026_c4') {
          if (c26 === 4) {
            dst[i] = 25; dst[i + 1] = 122; dst[i + 2] = 25; dst[i + 3] = 245;
          } else {
            dst[i] = 25; dst[i + 1] = 35; dst[i + 2] = 52; dst[i + 3] = 65;
          }
        } else {
          // Dinâmica comparativa 2016 vs 2026 da Classe 4
          if (c16 !== 4 && c26 === 4) {
            dst[i] = 34; dst[i + 1] = 197; dst[i + 2] = 94; dst[i + 3] = 245;
          } else if (c16 === 4 && c26 === 4) {
            dst[i] = 21; dst[i + 1] = 128; dst[i + 2] = 61; dst[i + 3] = 215;
          } else if (c16 === 4 && c26 !== 4) {
            dst[i] = 245; dst[i + 1] = 158; dst[i + 2] = 11; dst[i + 3] = 230;
          } else {
            dst[i] = 20; dst[i + 1] = 30; dst[i + 2] = 48; dst[i + 3] = 55;
          }
        }
        continue;
      }

      // Análise 2: Álgebra de Mapas Temporal (Transição para Classes Inferiores)
      if (mode === 'temporal_algebra') {
        const matched = this.matchesAlgebraRule(c16, c26, algebraFrom, algebraTo);
        if (matched) {
          if (c26 === 1) {
            dst[i] = 255; dst[i + 1] = 23; dst[i + 2] = 68; dst[i + 3] = 250;
          } else if (c26 === 2) {
            dst[i] = 255; dst[i + 1] = 145; dst[i + 2] = 0; dst[i + 3] = 245;
          } else if (c26 > c16) {
            dst[i] = 0; dst[i + 1] = 230; dst[i + 2] = 118; dst[i + 3] = 240;
          } else {
            dst[i] = 56; dst[i + 1] = 189; dst[i + 2] = 248; dst[i + 3] = 240;
          }
        } else {
          const rgb = this.classRGB[c26];
          dst[i] = Math.round(rgb[0] * 0.35);
          dst[i + 1] = Math.round(rgb[1] * 0.35);
          dst[i + 2] = Math.round(rgb[2] * 0.35);
          dst[i + 3] = 65;
        }
        continue;
      }

      // Análise 3: Proporção de Classes Críticas em 2026 (Classe 1 + Classe 2)
      if (mode === 'critical_proportion') {
        if (c26 === 1) {
          dst[i] = 239; dst[i + 1] = 23; dst[i + 2] = 52; dst[i + 3] = 255;
        } else if (c26 === 2) {
          dst[i] = 255; dst[i + 1] = 136; dst[i + 2] = 0; dst[i + 3] = 245;
        } else {
          const rgb = this.classRGB[c26];
          dst[i] = Math.round(rgb[0] * 0.4);
          dst[i + 1] = Math.round(rgb[1] * 0.4);
          dst[i + 2] = Math.round(rgb[2] * 0.4);
          dst[i + 3] = 75;
        }
        continue;
      }

      // Análise 4: Proporção de Classes Altas em 2026 (Classe 4 + Classe 5)
      if (mode === 'high_proportion') {
        if (c26 === 4) {
          dst[i] = 25; dst[i + 1] = 135; dst[i + 2] = 25; dst[i + 3] = 245;
        } else if (c26 === 5) {
          dst[i] = 16; dst[i + 1] = 78; dst[i + 2] = 27; dst[i + 3] = 255;
        } else {
          const rgb = this.classRGB[c26];
          dst[i] = Math.round(rgb[0] * 0.36);
          dst[i + 1] = Math.round(rgb[1] * 0.36);
          dst[i + 2] = Math.round(rgb[2] * 0.36);
          dst[i + 3] = 65;
        }
      }
    }

    this.renderCtx.putImageData(imgData, 0, 0);
    return this.renderCanvas.toDataURL('image/png');
  }
}

window.SpatialEngine = SpatialEngine;
