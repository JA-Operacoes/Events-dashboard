// Logo custom do evento é sempre 650x200 (3.25:1) — renderiza retangular,
// já a logo padrão do Portal JA é o ícone quadrado de sempre.
export default function Logo({ size = 30, width: widthProp, src }: { size?: number; width?: number; src?: string | null }) {
  if (src) {
    const width = widthProp ?? Math.round(size * (650 / 200));
    const height = Math.round(width * (200 / 650));
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={width}
        height={height}
        style={{ width, height, objectFit: "contain", objectPosition: "left center", flexShrink: 0, borderRadius: 6 }}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/img/JA_Oper.png"
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size, objectFit: "contain", flexShrink: 0, borderRadius: 8 }}
    />
  );
}
