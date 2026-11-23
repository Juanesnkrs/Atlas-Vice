/** Lectura de tipo real y dimensiones desde la cabecera de JPEG y WebP, sin librerias. */

export interface ImageInfo {
  mime: 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
}

function probeJpeg(b: Buffer): ImageInfo | null {
  let i = 2; // tras FFD8
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    while (b[i + 1] === 0xff) i += 1; // bytes de relleno FF
    const marker = b[i + 1] ?? 0;
    i += 2;
    // Marcadores sin longitud: TEM, RSTn, SOI, EOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
    if (i + 2 > b.length) return null;
    const len = b.readUInt16BE(i);
    if (len < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 7 > b.length) return null;
      const height = b.readUInt16BE(i + 3);
      const width = b.readUInt16BE(i + 5);
      return width > 0 && height > 0 ? { mime: 'image/jpeg', width, height } : null;
    }
    if (marker === 0xda) return null; // comienzo de datos de imagen sin SOF previo
    i += len;
  }
  return null;
}

function probeWebp(b: Buffer): ImageInfo | null {
  if (b.length < 30) return null;
  // Contenedor RIFF coherente: el tamaño declarado (sin los 8 bytes de "RIFF"+tamaño) coincide con el archivo
  // (un WebP conforme no lleva bytes sobrantes ni truncados) y el primer chunk cabe entero dentro de él.
  if (b.readUInt32LE(4) + 8 !== b.length) return null;
  const chunk = b.toString('ascii', 12, 16);
  const chunkSize = b.readUInt32LE(16);
  const minChunk = chunk === 'VP8L' ? 5 : 10;
  if (chunkSize < minChunk || 20 + chunkSize > b.length) return null;
  let width: number;
  let height: number;
  if (chunk === 'VP8 ') {
    // Fotograma clave: firma 9D 01 2A en los bytes 23..25 y dimensiones de 14 bits.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    width = b.readUInt16LE(26) & 0x3fff;
    height = b.readUInt16LE(28) & 0x3fff;
  } else if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    width = (bits & 0x3fff) + 1;
    height = ((bits >>> 14) & 0x3fff) + 1;
  } else if (chunk === 'VP8X') {
    width = b.readUIntLE(24, 3) + 1;
    height = b.readUIntLE(27, 3) + 1;
  } else {
    return null;
  }
  return width > 0 && height > 0 ? { mime: 'image/webp', width, height } : null;
}

/** Devuelve el tipo (por firma magica real) y las dimensiones, o `null` si no es JPEG/WebP o la cabecera esta malformada. */
export function probeImage(b: Buffer): ImageInfo | null {
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return probeJpeg(b);
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return probeWebp(b);
  return null;
}
