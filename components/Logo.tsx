export default function Logo({ size = 30, src }: { size?: number; src?: string | null }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src || "/img/JA_Oper.png"}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size, objectFit: "contain", flexShrink: 0, borderRadius: 8 }}
    />
  );
}
