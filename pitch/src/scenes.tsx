import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Backdrop, Chip, Label, Logo, Photo, Words } from "./components";
import { colors, EASE, fonts, PRESENTERS } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const cover: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" };
const pad = (n: number) => String(n).padStart(3, "0");

/* ---------------------------------------------------------------- 0-2 s: quem somos */
export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Backdrop glow={0.16} />
      <div style={{ position: "absolute", left: 130, top: 112 }}>
        <Label>NASA Space Apps Challenge 2026</Label>
      </div>
      {PRESENTERS ? (
        <div style={{ position: "absolute", left: 130, bottom: 128, opacity: interpolate(frame, [22, 38], [0, 1], clamp) }}>
          <Label color={colors.muted} size={26} style={{ letterSpacing: "0.2em" }}>
            {PRESENTERS}
          </Label>
        </div>
      ) : null}
      <div style={{ position: "absolute", right: 130, top: 92, opacity: interpolate(frame, [4, 20], [0, 1], clamp) }}>
        <Logo size={96} />
      </div>
      <div style={{ position: "absolute", left: 124, top: 0, bottom: 0, display: "flex", alignItems: "center" }}>
        <Words text="Team Lumia" start={4} stagger={7} accent={[1]} style={{ fontSize: 250, fontWeight: 300, letterSpacing: "-0.035em", columnGap: "0.2em" }} />
      </div>
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- 2-5 s: o desafio */
export const Challenge: React.FC = () => (
  <AbsoluteFill>
    <Backdrop />
    <Photo src="footage/fly/f_000.jpg" dim={0.6} from={1.04} to={1.16} duration={110} origin="70% 50%" shift="380px 40px" />
    <div style={{ position: "absolute", left: 130, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 30 }}>
      <Label>The challenge</Label>
      <Words text="Interplanetary Survival Guide:" start={6} stagger={4} style={{ fontSize: 92, fontWeight: 300, letterSpacing: "-0.02em", maxWidth: 1250 }} />
      <Words text="Martian Map" start={26} stagger={5} accent={[0, 1]} style={{ fontSize: 150, fontWeight: 300, letterSpacing: "-0.03em" }} />
      <Label color={colors.muted} size={22} style={{ marginTop: 14, letterSpacing: "0.2em" }}>
        A layered map for the first astronauts to walk on Mars
      </Label>
    </div>
  </AbsoluteFill>
);

/* ---------------------------------------------------------------- 5-10 s: nome e frase */
const FLY_COUNT = 30;
const FlyBackground: React.FC<{ play: number }> = ({ play }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [0, play], [0, FLY_COUNT - 1], clamp);
  const i = Math.floor(t);
  const j = Math.min(i + 1, FLY_COUNT - 1);
  const settle = interpolate(frame, [play - 8, play + 8], [0, 1], clamp);
  return (
    <AbsoluteFill>
      <Img src={staticFile(`footage/fly/f_${pad(i)}.jpg`)} style={cover} />
      <Img src={staticFile(`footage/fly/f_${pad(j)}.jpg`)} style={{ ...cover, opacity: t - i }} />
      <Img src={staticFile("footage/jezero-clean.jpg")} style={{ ...cover, opacity: settle }} />
      <AbsoluteFill style={{ background: "radial-gradient(1100px 650px at 50% 50%, rgba(18,18,15,0.62), rgba(18,18,15,0.9))" }} />
    </AbsoluteFill>
  );
};

export const Title: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Backdrop glow={0.05} />
      <FlyBackground play={110} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 34 }}>
        <div
          style={{
            opacity: interpolate(frame, [6, 22], [0, 1], clamp),
            scale: interpolate(frame, [6, 34], [0.6, 1], { ...clamp, easing: EASE }),
          }}
        >
          <Logo size={170} />
        </div>
        <Words text="MARSVIEW" start={16} style={{ fontSize: 150, fontWeight: 600, letterSpacing: "0.3em", paddingLeft: "0.3em" }} />
        <Words text="Every step planned. Every breath counted." start={50} stagger={5} accent={[3, 4, 5]} style={{ fontSize: 50, fontWeight: 300, justifyContent: "center", letterSpacing: "0.01em" }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- 10-20 s: como funciona (5 telas reais de 2 s) */
type ShotCfg = { src: string; caption: string; accent: number[]; chips: string[]; origin: string; zoom: [number, number] };
const SHOT_LEN = 60;
const SHOTS: ShotCfg[] = [
  { src: "nogo-turnback", caption: "Pick a route. NASA terrain says NO-GO.", accent: [5, 6], chips: ["HiRISE 1 m", "MOLA · HRSC"], origin: "0% 60%", zoom: [1.0, 1.4] },
  { src: "why", caption: "It shows why, in numbers.", accent: [4, 5], chips: ["613 rover stops check the terrain", "Mars24 sunset"], origin: "50% 50%", zoom: [1.12, 1.85] },
  { src: "planner-caution", caption: "And what to change: carry less.", accent: [5, 6], chips: ["Suit payload model"], origin: "12% 68%", zoom: [1.0, 1.45] },
  { src: "helmet-turnback", caption: "Live in the helmet, ARES calls the turn-back.", accent: [5, 6, 7], chips: ["Perseverance Navcam", "MEDA weather"], origin: "95% 52%", zoom: [1.0, 1.85] },
  { src: "pano360", caption: "Real rover views of the place.", accent: [1, 2, 3], chips: ["Mastcam-Z 360°", "ESA HRSC · FU Berlin"], origin: "50% 62%", zoom: [1.0, 1.18] },
];

const Shot: React.FC<{ cfg: ShotCfg; index: number; total: number; length: number }> = ({ cfg, index, total, length }) => {
  const frame = useCurrentFrame();
  const imgOpacity = index === 0 ? 1 : interpolate(frame, [0, 8], [0, 1], clamp);
  const slide = index === 0 ? interpolate(frame, [0, 22], ["90px 0px", "0px 0px"], { ...clamp, easing: EASE }) : "0px 0px";
  const textOpacity = interpolate(frame, [0, 6, SHOT_LEN - 8, SHOT_LEN], [0, 1, 1, 0], clamp);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 700,
          top: 190,
          width: 1160,
          height: 653,
          borderRadius: 22,
          overflow: "hidden",
          border: `1px solid ${colors.edge}`,
          boxShadow: "0 50px 140px rgba(0,0,0,0.65)",
          opacity: imgOpacity,
          translate: slide,
        }}
      >
        <Img
          src={staticFile(`footage/${cfg.src}.jpg`)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transformOrigin: cfg.origin,
            scale: interpolate(frame, [0, length], cfg.zoom, { ...clamp, easing: Easing.out(Easing.quad) }),
          }}
        />
      </div>
      <div style={{ position: "absolute", left: 110, top: 190, width: 530, opacity: textOpacity }}>
        <Label size={22}>
          {`0${index + 1} / 0${total}`}
        </Label>
        <Words text={cfg.caption} start={3} stagger={3} accent={cfg.accent} style={{ marginTop: 26, fontSize: 64, fontWeight: 300, lineHeight: 1.12, letterSpacing: "-0.015em" }} />
        <div style={{ marginTop: 44, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 12 }}>
          {cfg.chips.map((c, i) => (
            <Chip key={c} start={16 + i * 6}>
              {c}
            </Chip>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const HowItWorks: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Backdrop glow={0.08} />
      {SHOTS.map((s, i) => (
        <Sequence key={s.src} name={`Tela ${i + 1}: ${s.src}`} from={i * SHOT_LEN} durationInFrames={SHOT_LEN + (i < SHOTS.length - 1 ? 8 : 0)}>
          <Shot cfg={s} index={i} total={SHOTS.length} length={SHOT_LEN + 8} />
        </Sequence>
      ))}
      {/* barra de progresso das 5 telas */}
      <div style={{ position: "absolute", left: 110, top: 800, display: "flex", gap: 10 }}>
        {SHOTS.map((s, i) => (
          <div key={s.src} style={{ width: 96, height: 4, borderRadius: 4, background: colors.line, overflow: "hidden" }}>
            <div style={{ width: `${interpolate(frame, [i * SHOT_LEN, (i + 1) * SHOT_LEN], [0, 100], clamp)}%`, height: "100%", background: colors.accent }} />
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- 20-29 s: o futuro e o fechamento */
const Statement: React.FC<{ text: string; from: number; to: number; accent?: number[]; size?: number }> = ({ text, from, to, accent, size = 104 }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [from, from + 4, to - 8, to], [0, 1, 1, 0], clamp);
  if (frame < from - 2 || frame > to + 2) return null;
  return (
    <div style={{ position: "absolute", left: 130, right: 130, top: 0, bottom: 0, display: "flex", alignItems: "center", opacity }}>
      <Words text={text} start={from} stagger={4} accent={accent} style={{ fontSize: size, fontWeight: 300, letterSpacing: "-0.025em", lineHeight: 1.08 }} />
    </div>
  );
};

export const Future: React.FC = () => {
  const frame = useCurrentFrame();
  const CLOSE = 190;
  const closing = interpolate(frame, [CLOSE - 2, CLOSE + 14], [0, 1], clamp);
  return (
    <AbsoluteFill>
      <Backdrop glow={0.1} />
      <div style={{ opacity: 1 - closing * 0.35 }}>
        <Photo src="footage/jezero-clean.jpg" dim={0.78} from={1.06} to={1.16} duration={270} blur={5} />
      </div>
      <Statement text="Any site on Mars." from={4} to={50} accent={[2, 3]} />
      <Statement text="On a tablet, in a visor, with real suit data." from={46} to={112} accent={[8, 9]} size={92} />
      <Statement text="Safer, bolder science." from={110} to={CLOSE - 8} accent={[0, 1, 2]} size={130} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 30, opacity: closing }}>
        <div style={{ scale: interpolate(frame, [CLOSE, CLOSE + 30], [0.8, 1], { ...clamp, easing: EASE }) }}>
          <Logo size={150} />
        </div>
        <div style={{ fontFamily: fonts.sans, fontSize: 112, fontWeight: 600, letterSpacing: "0.3em", paddingLeft: "0.3em", color: colors.fg }}>MARSVIEW</div>
        <div style={{ fontFamily: fonts.sans, fontSize: 40, fontWeight: 300, color: colors.fg }}>
          Every step planned. <span style={{ color: colors.accent }}>Every breath counted.</span>
        </div>
        <Label color={colors.muted} size={22} style={{ marginTop: 18, letterSpacing: "0.24em" }}>
          Team Lumia · NASA Space Apps 2026
        </Label>
        <Label color={colors.muted} size={18} style={{ letterSpacing: "0.2em", opacity: 0.8 }}>
          Built with open NASA, ESA and USGS data
        </Label>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
