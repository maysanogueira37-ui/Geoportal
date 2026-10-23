import sqlite3, struct, math, json, zlib, base64, os
import numpy as np

os.makedirs("data", exist_ok=True)

def parse_gpkg_geom(blob):
    magic, version, flags, srs_id = struct.unpack('<2sBBi', blob[:8])
    envelope_type = (flags >> 1) & 0x07
    env_sizes = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}
    wkb_offset = 8 + env_sizes.get(envelope_type, 0)
    return srs_id, blob[wkb_offset:]

def parse_wkb(wkb, offset=0):
    endian = '<' if wkb[offset] == 1 else '>'
    geom_type = struct.unpack(endian + 'I', wkb[offset+1:offset+5])[0]
    offset += 5
    base_type = geom_type & 0xFF
    if base_type == 3:
        num_rings = struct.unpack(endian + 'I', wkb[offset:offset+4])[0]
        offset += 4
        rings = []
        for _ in range(num_rings):
            num_pts = struct.unpack(endian + 'I', wkb[offset:offset+4])[0]
            offset += 4
            pts = struct.unpack(endian + f'{num_pts*2}d', wkb[offset:offset+num_pts*16])
            offset += num_pts * 16
            rings.append([(pts[i], pts[i+1]) for i in range(0, len(pts), 2)])
        return ('Polygon', rings), offset
    elif base_type == 6:
        num_polys = struct.unpack(endian + 'I', wkb[offset:offset+4])[0]
        offset += 4
        polys = []
        for _ in range(num_polys):
            poly, offset = parse_wkb(wkb, offset)
            polys.append(poly[1])
        return ('MultiPolygon', polys), offset

def utm23s_to_lonlat(easting, northing):
    a = 6378137.0
    f = 1.0 / 298.257222101
    e2 = 2*f - f*f
    e_prime2 = e2 / (1.0 - e2)
    k0 = 0.9996
    lon0 = math.radians(-45.0)
    x = easting - 500000.0
    y = northing - 10000000.0
    M = y / k0
    mu = M / (a * (1.0 - e2/4.0 - 3.0*e2*e2/64.0 - 5.0*e2*e2*e2/256.0))
    e1 = (1.0 - math.sqrt(1.0 - e2)) / (1.0 + math.sqrt(1.0 - e2))
    phi1 = (mu
            + (3.0*e1/2.0 - 27.0*(e1**3)/32.0) * math.sin(2.0*mu)
            + (21.0*e1*e1/16.0 - 55.0*(e1**4)/32.0) * math.sin(4.0*mu)
            + (151.0*(e1**3)/96.0) * math.sin(6.0*mu)
            + (1097.0*(e1**4)/512.0) * math.sin(8.0*mu))
    sin_phi1 = math.sin(phi1)
    cos_phi1 = math.cos(phi1)
    tan_phi1 = math.tan(phi1)
    N1 = a / math.sqrt(1.0 - e2 * sin_phi1 * sin_phi1)
    T1 = tan_phi1 * tan_phi1
    C1 = e_prime2 * cos_phi1 * cos_phi1
    R1 = a * (1.0 - e2) / ((1.0 - e2 * sin_phi1 * sin_phi1) ** 1.5)
    D = x / (N1 * k0)
    lat = phi1 - (N1 * tan_phi1 / R1) * (
        D*D/2.0
        - (5.0 + 3.0*T1 + 10.0*C1 - 4.0*C1*C1 - 9.0*e_prime2) * (D**4)/24.0
        + (61.0 + 90.0*T1 + 298.0*C1 + 45.0*T1*T1 - 252.0*e_prime2 - 3.0*C1*C1) * (D**6)/720.0
    )
    lon = lon0 + (
        D
        - (1.0 + 2.0*T1 + C1) * (D**3)/6.0
        + (5.0 - 2.0*C1 + 28.0*T1 - 3.0*C1*C1 + 8.0*e_prime2 + 24.0*T1*T1) * (D**5)/120.0
    ) / cos_phi1
    return [round(math.degrees(lon), 6), round(math.degrees(lat), 6)]

def lonlat_to_utm23s_numpy(lon_deg, lat_deg):
    a = 6378137.0
    f = 1.0 / 298.257222101
    e2 = 2*f - f*f
    ep2 = e2 / (1.0 - e2)
    k0 = 0.9996
    lon0 = np.radians(-45.0)
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)

    sin_lat = np.sin(lat)
    cos_lat = np.cos(lat)
    tan_lat = np.tan(lat)

    N = a / np.sqrt(1.0 - e2 * sin_lat * sin_lat)
    T = tan_lat * tan_lat
    C = ep2 * cos_lat * cos_lat
    A = cos_lat * (lon - lon0)

    M = a * (
        (1.0 - e2/4.0 - 3.0*e2*e2/64.0 - 5.0*e2*e2*e2/256.0) * lat
        - (3.0*e2/8.0 + 3.0*e2*e2/32.0 + 45.0*e2*e2*e2/1024.0) * np.sin(2.0*lat)
        + (15.0*e2*e2/256.0 + 45.0*e2*e2*e2/1024.0) * np.sin(4.0*lat)
        - (35.0*e2*e2*e2/3072.0) * np.sin(6.0*lat)
    )

    easting = 500000.0 + k0 * N * (
        A + (1.0 - T + C) * (A**3) / 6.0
        + (5.0 - 18.0*T + T*T + 72.0*C - 58.0*ep2) * (A**5) / 120.0
    )
    northing = 10000000.0 + k0 * (
        M + N * tan_lat * (
            (A**2) / 2.0
            + (5.0 - T + 9.0*C + 4.0*C*C) * (A**4) / 24.0
            + (61.0 - 58.0*T + T*T + 600.0*C - 330.0*ep2) * (A**6) / 720.0
        )
    )
    return easting, northing

def encode_rgba_png(rgba_array):
    height, width, _ = rgba_array.shape
    raw_rows = b"".join(b"\x00" + rgba_array[r].tobytes() for r in range(height))
    compressed = zlib.compress(raw_rows, level=9)
    def chunk(ctype, data):
        c = ctype + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")

XMIN, YMIN, XMAX, YMAX = 358000, 7466350, 380200, 7487060
W = (XMAX - XMIN) // 10 # 2220
H = (YMAX - YMIN) // 10 # 2071

def rasterize_gpkg(fname, table):
    grid = np.zeros((H, W), dtype=np.uint8)
    conn = sqlite3.connect(fname)
    cur = conn.cursor()
    cur.execute(f'SELECT DN, geom FROM "{table}"')
    for dn, blob in cur.fetchall():
        _, wkb = parse_gpkg_geom(blob)
        geom, _ = parse_wkb(wkb)
        verts = {}
        for ring in geom[1]:
            for i in range(len(ring) - 1):
                x1, y1 = ring[i]
                x2, y2 = ring[i+1]
                if x1 == x2:
                    c = int(round((x1 - XMIN) / 10))
                    r1 = int(round((min(y1, y2) - YMIN) / 10))
                    r2 = int(round((max(y1, y2) - YMIN) / 10))
                    verts.setdefault(c, []).append((r1, r2))
        if not verts: continue
        min_c, max_c = min(verts.keys()), max(verts.keys())
        min_r = min(r1 for segs in verts.values() for r1, _ in segs)
        max_r = max(r2 for segs in verts.values() for _, r2 in segs)
        diff = np.zeros((max_r - min_r, max_c - min_c + 1), dtype=np.uint8)
        for c, segs in verts.items():
            for r1, r2 in segs:
                diff[r1 - min_r : r2 - min_r, c - min_c] ^= 1
        mask = np.bitwise_xor.accumulate(diff[:, :-1], axis=1)
        sub = grid[min_r:max_r, min_c:max_c]
        sub[mask == 1] = dn
    return grid

print("1. Rasterizing NDVI 2016 & 2026 onto exact 10m UTM grid...")
g16 = rasterize_gpkg('NDVI_2016.gpkg', 'ndvi_2016')
g26 = rasterize_gpkg('NDVI_2026.gpkg', 'ndvi_2026')
inside_utm = (g16 > 0) & (g26 > 0)

# Extract full-precision limite_Extrema GeoJSON (ZERO vertex decimation!)
print("2. Extracting full-precision limite_Extrema boundary...")
conn_lim = sqlite3.connect('limite_Extrema.gpkg')
cur_lim = conn_lim.cursor()
cur_lim.execute('SELECT geom, AREA_KM2 FROM limite_extrema LIMIT 1')
blob_lim, area_ibge = cur_lim.fetchone()
_, wkb_lim = parse_gpkg_geom(blob_lim)
geom_lim, _ = parse_wkb(wkb_lim)

lim_rings_lonlat = []
lim_rings_utm = []
all_lons = []
all_lats = []
for poly in geom_lim[1]:
    ring = poly[0]
    lim_rings_utm.append(ring)
    pts = [utm23s_to_lonlat(pt[0], pt[1]) for pt in ring]
    if pts[0] != pts[-1]:
        pts.append(pts[0])
    for lon, lat in pts:
        all_lons.append(lon)
        all_lats.append(lat)
    lim_rings_lonlat.append(pts)

print(f"   limite_Extrema vertices preserved: {sum(len(r) for r in lim_rings_lonlat)}")

limite_geojson = {
    "type": "FeatureCollection",
    "features": [{
        "type": "Feature",
        "properties": {"NM_MUN": "Extrema", "SIGLA_UF": "MG", "CD_MUN": "3125101", "AREA_KM2": area_ibge},
        "geometry": {"type": "Polygon", "coordinates": lim_rings_lonlat}
    }]
}

# Fill 2-pixel (20m) exterior halo of g16 and g26 in UTM space so boundary pixels never fall on empty staircase steps
g16_pad = g16.copy()
g26_pad = g26.copy()
for _ in range(3):
    zero_mask = (g16_pad == 0)
    for dr, dc in [(-1,0), (1,0), (0,-1), (0,1), (-1,-1), (-1,1), (1,-1), (1,1)]:
        shifted16 = np.roll(np.roll(g16_pad, dr, axis=0), dc, axis=1)
        shifted26 = np.roll(np.roll(g26_pad, dr, axis=0), dc, axis=1)
        fill = zero_mask & (shifted16 > 0)
        g16_pad[fill] = shifted16[fill]
        g26_pad[fill] = shifted26[fill]
        zero_mask = (g16_pad == 0)

# Rasterize exact vector polygon of limite_Extrema onto a high-res Geographic (Lon/Lat) grid
# that matches Leaflet's L.imageOverlay projection!
LON_MIN = min(all_lons) - 0.0015
LON_MAX = max(all_lons) + 0.0015
LAT_MIN = min(all_lats) - 0.0015
LAT_MAX = max(all_lats) + 0.0015

print("3. Warping UTM 23S raster to exact Geographic (WGS84/SIRGAS 2000) grid and clipping to limite_Extrema...")
lons_1d = LON_MIN + (np.arange(W) + 0.5) / W * (LON_MAX - LON_MIN)
# Row 0 is top (North = LAT_MAX), Row H-1 is bottom (South = LAT_MIN)
lats_1d = LAT_MAX - (np.arange(H) + 0.5) / H * (LAT_MAX - LAT_MIN)
lon_grid, lat_grid = np.meshgrid(lons_1d, lats_1d)

east_grid, north_grid = lonlat_to_utm23s_numpy(lon_grid, lat_grid)
col_utm = np.floor((east_grid - XMIN) / 10.0).astype(np.int32)
row_utm = np.floor((north_grid - YMIN) / 10.0).astype(np.int32)
valid_utm = (col_utm >= 0) & (col_utm < W) & (row_utm >= 0) & (row_utm < H)

col_safe = np.clip(col_utm, 0, W - 1)
row_safe = np.clip(row_utm, 0, H - 1)

g16_geo = np.where(valid_utm, g16_pad[row_safe, col_safe], 0)
g26_geo = np.where(valid_utm, g26_pad[row_safe, col_safe], 0)

# Rasterize exact limite_Extrema polygon in (Lon, Lat) grid using scanline ray-casting along rows!
poly_mask_geo = np.zeros((H, W), dtype=bool)
for ring in lim_rings_lonlat:
    # For each segment (lon1, lat1) -> (lon2, lat2), find rows it crosses
    pts = np.array(ring)
    x1s, y1s = pts[:-1, 0], pts[:-1, 1]
    x2s, y2s = pts[1:, 0], pts[1:, 1]
    for r in range(H):
        y = lats_1d[r]
        crosses = ((y1s <= y) & (y2s > y)) | ((y2s <= y) & (y1s > y))
        if not np.any(crosses):
            continue
        x_int = x1s[crosses] + (y - y1s[crosses]) / (y2s[crosses] - y1s[crosses]) * (x2s[crosses] - x1s[crosses])
        x_int.sort()
        c_int = np.floor((x_int - LON_MIN) / (LON_MAX - LON_MIN) * W).astype(np.int32)
        c_int = np.clip(c_int, 0, W)
        for k in range(0, len(c_int) - 1, 2):
            poly_mask_geo[r, c_int[k]:c_int[k+1]] ^= True

# Clip warped grids strictly to the exact vector polygon mask of limite_Extrema!
g16_clipped = np.where(poly_mask_geo, g16_geo, 0).astype(np.uint8)
g26_clipped = np.where(poly_mask_geo, g26_geo, 0).astype(np.uint8)

# Build Spatial Cube PNG (already oriented with Row 0 = LAT_MAX = North!)
cube = np.zeros((H, W, 4), dtype=np.uint8)
cube[:, :, 0] = g16_clipped
cube[:, :, 1] = g26_clipped
cube[:, :, 2] = 0
cube[:, :, 3] = 255

png_bytes = encode_rgba_png(cube)
with open("data/extrema_spatial_cube.png", "wb") as f:
    f.write(png_bytes)
cube_b64 = "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")

# Núcleos Geográficos de Transição (calculados na matriz UTM original)
yy, xx = np.mgrid[0:H, 0:W]
utm_x = XMIN + xx * 10.0
utm_y = YMIN + yy * 10.0

hotspots_defs = [
    ("NC-01", "Setor Centro-Oeste (Eixo 364.300 m E)", "Quadrante Centro-Ocidental", 364300, 7474200, 2400),
    ("NC-02", "Quadrante Sudoeste (Eixo 361.400 m E)", "Porção Sudoeste Municipal", 361400, 7470900, 2300),
    ("NC-03", "Setor Centro-Norte (Eixo 367.900 m E)", "Quadrante Centro-Setentrional", 367900, 7477500, 2200),
    ("NC-04", "Extremo Oeste (Eixo 360.200 m E)", "Borda Ocidental do Município", 360200, 7472800, 1800),
    ("NC-05", "Setor Centro-Sul (Eixo 366.800 m E)", "Quadrante Meridional Central", 366800, 7471900, 1900),
]
hotspots_list = []
for hid, hname, hsector, hx, hy, hrad in hotspots_defs:
    d = np.hypot(utm_x - hx, utm_y - hy)
    hmask = inside_utm & (d <= hrad)
    c3_to_c2 = float(np.sum(hmask & (g16 == 3) & (g26 == 2)) * 100 / 1e6)
    c3_to_c1 = float(np.sum(hmask & (g16 == 3) & (g26 == 1)) * 100 / 1e6)
    tot_drop = c3_to_c2 + c3_to_c1
    hotspots_list.append({
        "id": hid,
        "name": hname,
        "sector": hsector,
        "utm_e": hx,
        "utm_n": hy,
        "lonlat": utm23s_to_lonlat(hx, hy),
        "radius_m": hrad,
        "mod_to_low_km2": round(c3_to_c2, 2),
        "mod_to_vlow_km2": round(c3_to_c1, 2),
        "total_drop_km2": round(tot_drop, 2),
        "pct_of_total_drop": round(tot_drop / 8.1577 * 100.0, 1)
    })

# Transition matrix 5x5 (from exact 10m UTM grid)
tm_km2 = []
for i in range(1, 6):
    row = []
    for j in range(1, 6):
        val = float(np.sum((g16 == i) & (g26 == j)) * 100 / 1e6)
        row.append(round(val, 4))
    tm_km2.append(row)

# Extract topologically gap-free states for inset map using coordinate quantization (preserves 100% shared borders!)
conn_uf = sqlite3.connect('estados.gpkg')
cur_uf = conn_uf.cursor()
cur_uf.execute("SELECT SIGLA_UF, NM_UF, geom FROM br_uf_2025 WHERE SIGLA_UF IN ('MG','SP','RJ','ES','PR','MS','GO','DF','BA','MT')")
uf_features = []
for sigla, nm, blob in cur_uf.fetchall():
    _, wkb = parse_gpkg_geom(blob)
    geom, _ = parse_wkb(wkb)
    polys = geom[1] if geom[0] == 'MultiPolygon' else [geom[1]]
    simp_polys = []
    for p in polys:
        ring = p[0]
        if len(ring) < 6:
            continue
        # Quantize to 0.01 deg grid (pure function of coordinate -> 100% shared vertices between adjacent states!)
        pts = []
        for x, y in ring:
            qx = round(x, 2)
            qy = round(y, 2)
            if not pts or pts[-1][0] != qx or pts[-1][1] != qy:
                pts.append([qx, qy])
        if len(pts) >= 4:
            if pts[0] != pts[-1]:
                pts.append(pts[0])
            simp_polys.append([pts])
    if simp_polys:
        uf_features.append({
            "type": "Feature",
            "properties": {"SIGLA_UF": sigla, "NM_UF": nm},
            "geometry": {"type": "MultiPolygon", "coordinates": simp_polys}
        })

payload = {
    "metadata": {
        "title": "Mudanças na distribuição das classes de NDVI em Extrema (MG): comparação entre 2016 e 2026",
        "municipality": "Extrema (MG)",
        "cd_mun": "3125101",
        "crs": "SIRGAS 2000 / UTM Zona 23S",
        "epsg": "EPSG:31983",
        "source_sensor": "Sentinel-2 MSI, nível L2A (10m)",
        "source_vector": "IBGE, 2025",
        "author": "Maysa Nogueira | Agosto/2026",
        "area_ibge_km2": 244.575,
        "area_raster_km2": 244.483,
        "pixel_count_total": 2444830,
        "pixel_area_m2": 100,
        "utm_bbox": [XMIN, YMIN, XMAX, YMAX],
        "grid_size": [W, H],
        "latlon_bounds": [[round(LAT_MIN, 6), round(LON_MIN, 6)], [round(LAT_MAX, 6), round(LON_MAX, 6)]]
    },
    "classes": [
        {
            "id": 1,
            "code": "Classe 1",
            "name": "NDVI muito baixo",
            "range": "-1,00 a 0,00",
            "min": -1.0,
            "max": 0.0,
            "color": "#d61f1f",
            "area_2016_km2": 0.6136,
            "area_2026_km2": 1.8427,
            "perc_2016": 0.25,
            "perc_2026": 0.75,
            "dif_km2": 1.23,
            "dif_perc": 200.31,
            "count_2016": 6136,
            "count_2026": 18427,
            "vec_2016_km2": 0.3141,
            "vec_2026_km2": 1.3466
        },
        {
            "id": 2,
            "code": "Classe 2",
            "name": "NDVI baixo",
            "range": "0,00 a 0,20",
            "min": 0.0,
            "max": 0.2,
            "color": "#f07d0a",
            "area_2016_km2": 14.0442,
            "area_2026_km2": 14.9916,
            "perc_2016": 5.74,
            "perc_2026": 6.13,
            "dif_km2": 0.95,
            "dif_perc": 6.75,
            "count_2016": 140442,
            "count_2026": 149916,
            "vec_2016_km2": 10.9415,
            "vec_2026_km2": 14.5007
        },
        {
            "id": 3,
            "code": "Classe 3",
            "name": "NDVI moderado",
            "range": "0,20 a 0,40",
            "min": 0.2,
            "max": 0.4,
            "color": "#f5ee09",
            "area_2016_km2": 127.1074,
            "area_2026_km2": 91.1536,
            "perc_2016": 51.99,
            "perc_2026": 37.28,
            "dif_km2": -35.95,
            "dif_perc": -28.29,
            "count_2016": 1271074,
            "count_2026": 911536,
            "vec_2016_km2": 134.9480,
            "vec_2026_km2": 90.4588
        },
        {
            "id": 4,
            "code": "Classe 4",
            "name": "NDVI alto",
            "range": "0,40 a 0,60",
            "min": 0.4,
            "max": 0.6,
            "color": "#197a19",
            "area_2016_km2": 99.5039,
            "area_2026_km2": 134.7434,
            "perc_2016": 40.70,
            "perc_2026": 55.11,
            "dif_km2": 35.24,
            "dif_perc": 35.42,
            "count_2016": 995039,
            "count_2026": 1347434,
            "vec_2016_km2": 96.6935,
            "vec_2026_km2": 137.5963
        },
        {
            "id": 5,
            "code": "Classe 5",
            "name": "NDVI muito alto",
            "range": "0,60 a 0,80",
            "min": 0.6,
            "max": 0.8,
            "color": "#12491b",
            "area_2016_km2": 3.2139,
            "area_2026_km2": 1.7517,
            "perc_2016": 1.31,
            "perc_2026": 0.72,
            "dif_km2": -1.46,
            "dif_perc": -45.50,
            "count_2016": 32139,
            "count_2026": 17517,
            "vec_2016_km2": 1.5859,
            "vec_2026_km2": 0.5806
        }
    ],
    "transition_matrix_km2": tm_km2,
    "hotspots_transition": hotspots_list,
    "geojson": {
        "limite_extrema": limite_geojson,
        "estados_inset": {"type": "FeatureCollection", "features": uf_features}
    },
    "spatial_cube_b64": cube_b64
}

with open("data/geoportal_data.js", "w", encoding="utf-8") as f:
    f.write("window.GEOPORTAL_DATA = ")
    json.dump(payload, f, ensure_ascii=False)
    f.write(";\n")

print("Successfully rebuilt precision-warped & boundary-clipped data/geoportal_data.js! Size:", os.path.getsize("data/geoportal_data.js") / 1024, "KB")
