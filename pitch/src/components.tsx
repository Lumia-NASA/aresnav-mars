import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { colors, EASE, fonts } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Fundo carvão com um brilho terracota bem discreto no canto */
export const Backdrop: React.FC<{ glow?: number }> = ({ glow = 0.1 }) => (
  <AbsoluteFill
    style={{
      backgroundColor: colors.bg,
      backgroundImage: `radial-gradient(1200px 700px at 88% 4%, rgba(196,111,75,${glow}), transparent 65%)`,
    }}
  />
);

/** Entra e sai com fade (usa o quadro local da cena) */
export const SceneFade: React.FC<{ duration: number; fadeIn: number; fadeOut: number; children: React.ReactNode }> = ({
  duration,
  fadeIn,
  fadeOut,
  children,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, Math.max(1, fadeIn), duration - Math.max(1, fadeOut), duration], [0, 1, 1, 0], clamp);
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

/** Rótulo pequeno em mono, maiúsculo e espaçado, cor de ferrugem (como na landing) */
export const Label: React.FC<{ children: React.ReactNode; size?: number; color?: string; style?: React.CSSProperties }> = ({
  children,
  size = 24,
  color = colors.rust,
  style,
}) => (
  <div style={{ fontFamily: fonts.mono, fontSize: size, letterSpacing: "0.26em", textTransform: "uppercase", color, fontWeight: 500, ...style }}>
    {children}
  </div>
);

/** Texto que aparece palavra por palavra */
export const Words: React.FC<{
  text: string;
  start?: number;
  stagger?: number;
  accent?: number[];
  style?: React.CSSProperties;
}> = ({ text, start = 0, stagger = 3, accent = [], style }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", columnGap: "0.26em", rowGap: "0.04em", fontFamily: fonts.sans, color: colors.fg, ...style }}>
      {text.split(" ").map((w, i) => {
        const t = frame - start - i * stagger;
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              opacity: interpolate(t, [0, 12], [0, 1], clamp),
              translate: interpolate(t, [0, 16], ["0px 34px", "0px 0px"], { ...clamp, easing: EASE }),
              color: accent.includes(i) ? colors.accent : undefined,
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
};

/** Etiqueta de dado: nome da fonte NASA/ESA usada naquela tela */
export const Chip: React.FC<{ children: React.ReactNode; start: number }> = ({ children, start }) => {
  const frame = useCurrentFrame();
  const t = frame - start;
  return (
    <div
      style={{
        fontFamily: fonts.mono,
        fontSize: 22,
        letterSpacing: "0.08em",
        color: colors.fg,
        border: `1px solid ${colors.edge}`,
        background: "rgba(25,25,22,0.85)",
        borderRadius: 99,
        padding: "10px 22px",
        opacity: interpolate(t, [0, 10], [0, 1], clamp),
        translate: interpolate(t, [0, 14], ["0px 16px", "0px 0px"], { ...clamp, easing: EASE }),
      }}
    >
      {children}
    </div>
  );
};

/** O logo atual do MarsView: o ícone de órbita cor de cobre do site (Pagina-Domum1.0, Brand.tsx: Orbit do Lucide) */
export const COPPER = "#E99C72";
export const Logo: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={COPPER} strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <circle cx="19" cy="5" r="2" />
    <circle cx="5" cy="19" r="2" />
    <path d="M10.4 21.9a10 10 0 0 0 9.941-15.416" />
    <path d="M13.5 2.1a10 10 0 0 0-9.841 15.416" />
  </svg>
);

/** Marca d'água exigida pelo Space Apps para conteúdo feito com ajuda de IA */
export const Watermark: React.FC = () => (
  <div
    style={{
      position: "absolute",
      right: 40,
      bottom: 34,
      fontFamily: fonts.mono,
      fontSize: 17,
      letterSpacing: "0.22em",
      color: colors.fg,
      opacity: 0.85,
      background: "rgba(18,18,15,0.72)",
      border: `1px solid ${colors.edge}`,
      borderRadius: 6,
      padding: "7px 14px",
    }}
  >
    SI-ASSISTED · AI VOICE
  </div>
);

/** Foto cobrindo a tela inteira, com zoom lento */
export const Photo: React.FC<{
  src: string;
  dim?: number;
  from?: number;
  to?: number;
  duration: number;
  origin?: string;
  blur?: number;
  shift?: string;
}> = ({ src, dim = 0.5, from = 1.04, to = 1.14, duration, origin = "50% 50%", blur = 0, shift = "0px 0px" }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Img
        src={staticFile(src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transformOrigin: origin,
          scale: interpolate(frame, [0, duration], [from, to], { ...clamp, easing: Easing.linear }),
          translate: shift,
          filter: blur ? `blur(${blur}px)` : undefined,
        }}
      />
      <AbsoluteFill style={{ background: `linear-gradient(90deg, rgba(18,18,15,${dim + 0.3}) 0%, rgba(18,18,15,${dim}) 55%, rgba(18,18,15,${dim - 0.15}) 100%)` }} />
    </AbsoluteFill>
  );
};
