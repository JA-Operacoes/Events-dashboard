/**
 * Extrai largura/altura lendo só o cabeçalho do arquivo — sem depender de lib
 * externa (pacotes tipo `image-size` têm parsers de outros formatos com CVE
 * de DoS por loop infinito; como só aceitamos PNG/JPEG/WEBP, é mais seguro
 * ler esses três "na mão", em código pequeno e auditável).
 */
export type ImageDimensions = { width: number; height: number };

function readPng(buf: Buffer): ImageDimensions | null {
  // assinatura PNG (8 bytes) + chunk IHDR: length(4) + "IHDR"(4) + width(4) + height(4)
  if (buf.length < 24) return null;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(sig)) return null;
  if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function readJpeg(buf: Buffer): ImageDimensions | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  const MAX_MARKERS = 500; // limite duro — nunca deixa um loop rodar sem fim
  for (let i = 0; i < MAX_MARKERS && offset + 4 <= buf.length; i++) {
    if (buf[offset] !== 0xff) return null;
    const marker = buf[offset + 1];
    // SOF0..SOF15, exceto DHT(0xC4)/JPG(0xC8)/DAC(0xCC), carregam as dimensões
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    const segLen = buf.readUInt16BE(offset + 2);
    if (isSof) {
      if (offset + 9 > buf.length) return null;
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    if (segLen < 2) return null; // segmento inválido — evita loop sem avanço
    offset += 2 + segLen;
  }
  return null;
}

function readWebp(buf: Buffer): ImageDimensions | null {
  if (buf.length < 30) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
  const format = buf.toString("ascii", 12, 16);
  if (format === "VP8 ") {
    // VP8 lossy: dimensões (14 bits) ficam no offset 26/28 do frame
    const w = buf.readUInt16LE(26) & 0x3fff;
    const h = buf.readUInt16LE(28) & 0x3fff;
    return { width: w, height: h };
  }
  if (format === "VP8L") {
    const bits = buf.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  }
  if (format === "VP8X") {
    const width = (buf.readUIntLE(24, 3) & 0xffffff) + 1;
    const height = (buf.readUIntLE(27, 3) & 0xffffff) + 1;
    return { width, height };
  }
  return null;
}

export function getImageDimensions(buf: Buffer): ImageDimensions | null {
  return readPng(buf) ?? readJpeg(buf) ?? readWebp(buf);
}
