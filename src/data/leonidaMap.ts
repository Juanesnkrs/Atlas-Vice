// Marco de coordenadas del mapa de Leonida (lienzo 0-1000 x 0-700, origen arriba a la izquierda, Y hacia abajo).
// La base cartográfica es el mapa comunitario con sus colores originales, publicado como pirámide de teselas en
// `public/map-tiles/` (ver `mapPaint.ts` y DesignSpec §6.4). Los marcadores reales de MongoDB están
// calibrados sobre esas teselas con la transformación lineal del referente (px, py en píxeles del original):
//   x = (px - 500) * 0.2 * K + 249.5966      y = (py - 650) * 0.2 * K + 13.1738      K = 0.387112

export const MAP_W = 1000;
export const MAP_H = 700;
/** Contorno de la isla de Leonida (con sus cayos) dentro del lienzo: base del encuadre y de los límites de paneo. */
export const ISLAND_BBOX = { x0: 265, y0: 22, x1: 731, y1: 696 } as const;

// ---- Calcas de referencia (solo Modo Editor) ---------------------------------------------------------------------------------
/** Imagen de referencia ya colocada sobre el lienzo (x, y, w, h en unidades del mapa). */
export interface MapRefImage {
  id: string;
  label: string;
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Fracción del ancho de la imagen que se muestra (recorta la leyenda del mapa comunitario). */
  cropW: number;
}
export const REF_IMAGES: ReadonlyArray<MapRefImage> = [
  {
    id: 'community',
    label: 'Mapa comunitario',
    src: '/ref%20Leonida%20map/The%20final%20version%20of%20Commnunity%20map.jpeg',
    x: 210.88,
    y: -37.15,
    w: 812.94,
    h: 774.22,
    cropW: 0.68,
  },
  {
    id: 'leonida',
    label: 'Leonida',
    src: '/ref%20Leonida%20map/Leonida.jpeg',
    x: 229.82,
    y: -0.76,
    w: 546.32,
    h: 697.39,
    cropW: 1,
  },
];
