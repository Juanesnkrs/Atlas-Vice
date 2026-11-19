-- =============================================================================
-- ATLAS VICE - 03_seed_data.sql
-- Datos de EJEMPLO (metadata_json.sample = true), generados desde src/data/seed.ts
-- con los mismos UUIDs. Ejecutar DESPUÉS de schema.sql y 02_rls_and_triggers.sql.
-- Necesario para que user_progress (FK a entities / map_markers) sincronice sin errores.
-- Idempotente: ON CONFLICT (id) DO NOTHING. No modifica el esquema.
-- No son datos oficiales del juego.
-- =============================================================================
BEGIN;

-- 1. MÓDULOS (7)
INSERT INTO public.modules (id, slug, nombre, icono, activo, orden, created_at) VALUES
  ('a71a5000-0000-4000-8000-000000000001', 'mapa', 'Mapa de Leonida', 'map', true, 1, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000002', 'armas', 'Armas', 'crosshair', true, 2, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000003', 'vehiculos', 'Vehículos', 'car', true, 3, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000004', 'coleccionables', 'Coleccionables', 'gem', true, 4, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000005', 'guias', 'Guías y Misiones', 'book', true, 5, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000006', 'foro', 'Foro y Comunidad', 'messages', true, 6, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000007', 'radio', 'Estaciones de Radio', 'radio', false, 7, '2026-06-01T12:00:00.000Z')
ON CONFLICT (id) DO NOTHING;

-- 2. ENTIDADES (23)
INSERT INTO public.entities (id, module_id, titulo, subtitulo, categoria, imagen_url, stats_json, metadata_json, created_at) VALUES
  ('a71a5000-0000-4000-8000-000000000010', 'a71a5000-0000-4000-8000-000000000002', 'Pistola Compacta C9', 'Arma corta de uso diario', 'Pistolas', NULL, '{"dano":38,"cadencia":62,"precision":70,"alcance":35}'::jsonb, '{"ubicacion":"Ocean Beach","precio":1200,"municion":"9 mm","silueta":"pistol","sample":true}'::jsonb, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000011', 'a71a5000-0000-4000-8000-000000000002', 'Revólver Magnum R44', 'Gran potencia, recarga lenta', 'Pistolas', NULL, '{"dano":82,"cadencia":25,"precision":66,"alcance":48}'::jsonb, '{"ubicacion":"Vice Beach","precio":3400,"municion":".44","silueta":"pistol","sample":true}'::jsonb, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000012', 'a71a5000-0000-4000-8000-000000000002', 'Subfusil Ráfaga S7', 'Cadencia alta a corta distancia', 'Subfusiles', NULL, '{"dano":42,"cadencia":90,"precision":48,"alcance":30}'::jsonb, '{"ubicacion":"Downtown","precio":2800,"municion":"9 mm","silueta":"smg","sample":true}'::jsonb, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000013', 'a71a5000-0000-4000-8000-000000000002', 'Fusil de Asalto Leonida AR', 'Versátil en todo rango', 'Rifles de Asalto', NULL, '{"dano":64,"cadencia":74,"precision":68,"alcance":72}'::jsonb, '{"ubicacion":"Port Gellhorn","precio":5200,"municion":"5.56","silueta":"rifle","sample":true}'::jsonb, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000014', 'a71a5000-0000-4000-8000-000000000002', 'Carabina Táctica CT-3', 'Ligera y estable', 'Rifles de Asalto', NULL, '{"dano":58,"cadencia":70,"precision":78,"alcance":66}'::jsonb, '{"ubicacion":"Grassrivers","precio":4600,"municion":"5.56","silueta":"rifle","sample":true}'::jsonb, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000015', 'a71a5000-0000-4000-8000-000000000002', 'Escopeta Corredera P-12', 'Devastadora de cerca', 'Escopetas', NULL, '{"dano":92,"cadencia":28,"precision":30,"alcance":18}'::jsonb, '{"ubicacion":"Grassrivers","precio":3100,"municion":"Calibre 12","silueta":"shotgun","sample":true}'::jsonb, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000016', 'a71a5000-0000-4000-8000-000000000002', 'Rifle de Precisión Halcón', 'Disparo único a larga distancia', 'Francotiradores', NULL, '{"dano":95,"cadencia":15,"precision":96,"alcance":98}'::jsonb, '{"ubicacion":"Ambrosia","precio":7800,"municion":".308","silueta":"sniper","sample":true}'::jsonb, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000020', 'a71a5000-0000-4000-8000-000000000003', 'Deportivo Cometa GT', 'Coupé de alto rendimiento', 'Deportivos', NULL, '{"velocidad":92,"aceleracion":88,"frenado":70,"manejo":84}'::jsonb, '{"ubicacion":"Vice Beach","precio":148000,"plazas":2,"silueta":"sports","sample":true}'::jsonb, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000021', 'a71a5000-0000-4000-8000-000000000003', 'Muscle Bruto V8', 'Par motor y humo', 'Muscle', NULL, '{"velocidad":80,"aceleracion":78,"frenado":52,"manejo":50}'::jsonb, '{"ubicacion":"Grassrivers","precio":72000,"plazas":2,"silueta":"muscle","sample":true}'::jsonb, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000022', 'a71a5000-0000-4000-8000-000000000003', 'SUV Cayo Explorer', 'Robusto para caminos de tierra', 'SUV', NULL, '{"velocidad":62,"aceleracion":55,"frenado":64,"manejo":60}'::jsonb, '{"ubicacion":"Grassrivers","precio":54000,"plazas":5,"silueta":"suv","sample":true}'::jsonb, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000023', 'a71a5000-0000-4000-8000-000000000003', 'Sedán Costero LX', 'Cómodo y discreto', 'Sedanes', NULL, '{"velocidad":60,"aceleracion":58,"frenado":68,"manejo":66}'::jsonb, '{"ubicacion":"Downtown","precio":38000,"plazas":4,"silueta":"sedan","sample":true}'::jsonb, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000024', 'a71a5000-0000-4000-8000-000000000003', 'Moto Relámpago 600', 'Ágil entre el tráfico', 'Motos', NULL, '{"velocidad":86,"aceleracion":92,"frenado":60,"manejo":72}'::jsonb, '{"ubicacion":"Ocean Beach","precio":26000,"plazas":2,"silueta":"bike","sample":true}'::jsonb, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000025', 'a71a5000-0000-4000-8000-000000000003', 'Lancha Marea Veloz', 'Perfecta para los Cayos', 'Náuticos', NULL, '{"velocidad":78,"aceleracion":66,"frenado":40,"manejo":58}'::jsonb, '{"ubicacion":"Leonida Keys","precio":64000,"plazas":4,"silueta":"boat","sample":true}'::jsonb, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000030', 'a71a5000-0000-4000-8000-000000000004', 'Paquetes Ocultos', 'Cápsulas escondidas por toda la isla', 'Paquetes Ocultos', '/assets/complexmusic_1794873298_4032011328293408607_12790857096.jpg', '{"rareza":40}'::jsonb, '{"region":"Varias","total":3,"ubicacion":"Varias regiones","sample":true}'::jsonb, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000031', 'a71a5000-0000-4000-8000-000000000004', 'Reliquias de la Costa', 'Piezas antiguas halladas en el litoral', 'Reliquias', '/assets/rockstargames_1782392540_3927315665585859597_184595688.jpg', '{"rareza":70}'::jsonb, '{"region":"Vice Beach","total":2,"ubicacion":"Vice Beach y Ocean Beach","sample":true}'::jsonb, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000032', 'a71a5000-0000-4000-8000-000000000004', 'Graffitis de Downtown', 'Obras de arte urbano por descubrir', 'Graffitis', '/assets/complexmusic_1794873298_4032011329073355805_12790857096.jpg', '{"rareza":35}'::jsonb, '{"region":"Downtown","total":1,"ubicacion":"Downtown","sample":true}'::jsonb, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000033', 'a71a5000-0000-4000-8000-000000000004', 'Placas de Matrícula Raras', 'Series limitadas de matrículas', 'Reliquias', '/assets/rockstargames_1790262334_3993332294647284992_184595688.jpg', '{"rareza":82}'::jsonb, '{"region":"Port Gellhorn","total":1,"ubicacion":"Port Gellhorn","sample":true}'::jsonb, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000034', 'a71a5000-0000-4000-8000-000000000004', 'Cápsulas del Pantano', 'Escondidas entre la vegetación', 'Paquetes Ocultos', '/assets/complexmusic_1794873298_4032011331254611421_12790857096.jpg', '{"rareza":58}'::jsonb, '{"region":"Grassrivers","total":1,"ubicacion":"Grassrivers","sample":true}'::jsonb, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000035', 'a71a5000-0000-4000-8000-000000000004', 'Postales de los Cayos', 'Imágenes de colección del archipiélago', 'Graffitis', '/assets/rockstargames_1791475498_4003509049827826360_184595688.jpg', '{"rareza":46}'::jsonb, '{"region":"Leonida Keys","total":1,"ubicacion":"Leonida Keys","sample":true}'::jsonb, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000040', 'a71a5000-0000-4000-8000-000000000005', 'Primer día en Leonida', 'Cómo empezar sin perderse', 'Consejos', NULL, '{}'::jsonb, '{"spoiler":false,"pasos":["Explora la costa cercana al inicio.","Activa el mapa y revisa las capas.","Marca todo hallazgo para llevar tu avance."],"sample":true}'::jsonb, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000041', 'a71a5000-0000-4000-8000-000000000005', 'Ruta de la Tienda de Armas', 'Recorrido por tiendas de la costa', 'Tiendas', NULL, '{}'::jsonb, '{"spoiler":false,"pasos":["Empieza en Ocean Beach.","Sigue la costa hasta Vice Beach.","Compara precios en el Inspector."],"sample":true}'::jsonb, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000042', 'a71a5000-0000-4000-8000-000000000005', 'Evento aleatorio en carretera', 'Cómo reconocerlo y qué esperar', 'Eventos', NULL, '{}'::jsonb, '{"spoiler":false,"pasos":["Circula por la autopista de Grassrivers.","Detente al ver el vehículo averiado.","Interactúa con el conductor."],"sample":true}'::jsonb, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000043', 'a71a5000-0000-4000-8000-000000000005', 'Misión de ejemplo: Gasolinera', 'Resumen con avisos de spoiler', 'Misión Principal', NULL, '{}'::jsonb, '{"spoiler":true,"pasos":["Llega a la gasolinera antes del atardecer.","Observa la zona antes de actuar.","Sal por la vía lateral."],"sample":true}'::jsonb, '2026-06-01T12:00:00.000Z')
ON CONFLICT (id) DO NOTHING;

-- 3. MARCADORES (20)
INSERT INTO public.map_markers (id, entity_id, region, titulo, descripcion, coord_x, coord_y, media_url, created_at) VALUES
  ('a71a5000-0000-4000-8000-000000000100', 'a71a5000-0000-4000-8000-000000000030', 'Vice Beach', 'Paquete oculto junto al muelle', 'Cápsula escondida bajo el pasamanos del muelle.', 765.25, 318.5, '/assets/complexmusic_1794873298_4032011328293408607_12790857096.jpg', '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000101', 'a71a5000-0000-4000-8000-000000000030', 'Downtown', 'Paquete oculto en la azotea', 'Accesible desde la escalera de incendios.', 618, 352.75, NULL, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000102', 'a71a5000-0000-4000-8000-000000000030', 'Grassrivers', 'Paquete oculto en el embarcadero', 'Cerca del embarcadero de madera.', 262.5, 178, NULL, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000103', 'a71a5000-0000-4000-8000-000000000031', 'Vice Beach', 'Reliquia de la costa', 'Pieza antigua semienterrada en la arena.', 800, 280.25, '/assets/rockstargames_1782392540_3927315665585859597_184595688.jpg', '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000104', 'a71a5000-0000-4000-8000-000000000032', 'Downtown', 'Graffiti en el callejón', 'Mural visible desde el callejón trasero.', 590.5, 385, '/assets/complexmusic_1794873298_4032011329073355805_12790857096.jpg', '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000105', 'a71a5000-0000-4000-8000-000000000033', 'Port Gellhorn', 'Placa rara en el astillero', 'Sobre la baranda de un contenedor.', 520, 140.5, '/assets/rockstargames_1790262334_3993332294647284992_184595688.jpg', '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000106', 'a71a5000-0000-4000-8000-000000000034', 'Grassrivers', 'Cápsula del pantano', 'Entre las raíces de un manglar.', 215.75, 225, '/assets/complexmusic_1794873298_4032011331254611421_12790857096.jpg', '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000107', 'a71a5000-0000-4000-8000-000000000035', 'Leonida Keys', 'Postal de los Cayos', 'En el faro del cayo más pequeño.', 330, 610, '/assets/rockstargames_1791475498_4003509049827826360_184595688.jpg', '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000108', 'a71a5000-0000-4000-8000-000000000031', 'Ocean Beach', 'Reliquia de Ocean Beach', 'Bajo el paseo marítimo.', 695.5, 480, NULL, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000109', 'a71a5000-0000-4000-8000-000000000010', 'Ocean Beach', 'Tienda de armas Ocean', 'Venta de la Pistola Compacta C9.', 705, 455.5, NULL, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000110', 'a71a5000-0000-4000-8000-000000000011', 'Vice Beach', 'Armería de Vice Beach', 'Venta del Revólver Magnum R44.', 745.25, 360, NULL, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000111', 'a71a5000-0000-4000-8000-000000000013', 'Port Gellhorn', 'Depósito de ejemplo', 'Punto de venta del Fusil Leonida AR.', 548, 118, NULL, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000112', 'a71a5000-0000-4000-8000-000000000016', 'Ambrosia', 'Torre de vigilancia', 'Ubicación de ejemplo del rifle de precisión.', 810, 170.5, NULL, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000113', 'a71a5000-0000-4000-8000-000000000020', 'Vice Beach', 'Concesionario Cometa', 'Exposición del Deportivo Cometa GT.', 780.5, 340, NULL, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000114', 'a71a5000-0000-4000-8000-000000000021', 'Grassrivers', 'Taller del pantano', 'Aparece el Muscle Bruto V8 en el taller.', 240, 268.25, NULL, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000115', 'a71a5000-0000-4000-8000-000000000025', 'Leonida Keys', 'Marina de los Cayos', 'Amarre de la Lancha Marea Veloz.', 410, 575, NULL, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000116', 'a71a5000-0000-4000-8000-000000000041', 'Ocean Beach', 'Inicio de la ruta de tiendas', 'Primer punto de la guía de tiendas.', 690, 500.5, NULL, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000117', 'a71a5000-0000-4000-8000-000000000042', 'Grassrivers', 'Evento de carretera', 'Zona donde puede aparecer el evento de ejemplo.', 330, 210, NULL, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000118', 'a71a5000-0000-4000-8000-000000000040', 'Vice Beach', 'Punto de partida de ejemplo', 'Primer paso de la guía de inicio.', 735, 300, NULL, '2026-06-01T12:00:00.000Z'),
  ('a71a5000-0000-4000-8000-000000000119', NULL, 'Downtown', 'Mirador del centro', 'Punto de interés sin entidad asociada.', 640.25, 330, NULL, '2026-06-01T12:00:00.000Z')
ON CONFLICT (id) DO NOTHING;

COMMIT;

