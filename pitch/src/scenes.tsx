import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Backdrop, Chip, Label, Logo, Words } from "./components";
import { colors, EASE, fonts } from "./theme";

// Roteiro de 29 s do docs/PITCH.md:
// 0-6 s globo até Jezero · 6-13 s Three Forks, NO-GO · 13-20 s Why? e levar 13,5 kg · 20-24,6 s capacete, "turn back now" · 24,6-29 s logo
// As telas são do app real com a rota sem os desvios de 1 m (o mapa de antes do PR 29), gravadas por scripts/capture.mjs com NO_DETOUR=1.

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const cover: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" };
const pad = (n: number) => String(n).padStart(3, "0");

/* ---------------------------------------------------------------- 0-6 s: o globo voa até Jezero */
const FLY_COUNT = 30;
export const Globe: React.FC<{ length: number }> = ({ length }) => {
  const frame = useCurrentFrame();
  const play = length - 30;
  const t = interpolate(frame, [0, play], [0, FLY_COUNT - 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const i = Math.floor(t);
  const j = Math.min(i + 1, FLY_COUNT - 1);
  const settle = interpolate(frame, [play - 8, play + 8], [0, 1], clamp);
  const questions = [
    { text: "Can I get there?", at: 92 },
    { text: "Can I get back?", at: 116 },
    { text: "Will anyone hear me?", at: 140 },
  ];
  return (
    <AbsoluteFill>
      <Img src={staticFile(`footage/fly/f_${pad(i)}.jpg`)} style={cover} />
      <Img src={staticFile(`footage/fly/f_${pad(j)}.jpg`)} style={{ ...cover, opacity: t - i }} />
      <Img src={staticFile("footage/jezero-clean.jpg")} style={{ ...cover, opacity: settle }} />
      <AbsoluteFill style={{ background: "linear-gradient(90deg, rgba(18,18,15,0.88) 0%, rgba(18,18,15,0.55) 50%, rgba(18,18,15,0.2) 100%)" }} />
      <div style={{ position: "absolute", left: 130, top: 112 }}>
        <Label>Team Lumia · NASA Space Apps 2026</Label>
      </div>
      <div style={{ position: "absolute", left: 130, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 22 }}>
        <Words text="Before every walk on Mars," start={6} stagger={3} style={{ fontSize: 60, fontWeight: 300, color: colors.muted }} />
        {questions.map((q) => (
          <Words key={q.text} text={q.text} start={q.at} stagger={3} style={{ fontSize: 104, fontWeight: 300, letterSpacing: "-0.025em" }} />
        ))}
      </div>
      <div style={{ position: "absolute", right: 130, bottom: 120, opacity: interpolate(frame, [play - 10, play + 10], [0, 1], clamp) }}>
        <Label color={colors.fg} size={22}>Jezero crater · 18.4° N 77.5° E</Label>
      </div>
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- tela do app numa moldura, com legenda à esquerda */
type Layer = { src: string; at?: number; origin: string; zoom: [number, number] };
const Screen: React.FC<{ layers: Layer[]; length: number }> = ({ layers, length }) => {
  const frame = useCurrentFrame();
  return (
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
        background: colors.panel,
        translate: interpolate(frame, [0, 22], ["90px 0px", "0px 0px"], { ...clamp, easing: EASE }),
        opacity: interpolate(frame, [0, 10], [0, 1], clamp),
      }}
    >
      {layers.map((l) => {
        const at = l.at || 0;
        return (
          <Img
            key={l.src}
            src={staticFile(`footage/${l.src}.jpg`)}
            style={{
              ...cover,
              transformOrigin: l.origin,
              scale: interpolate(frame, [at, length], l.zoom, { ...clamp, easing: Easing.out(Easing.quad) }),
              opacity: at ? interpolate(frame, [at, at + 10], [0, 1], clamp) : 1,
            }}
          />
        );
      })}
    </div>
  );
};

const Caption: React.FC<{ step: string; children: React.ReactNode; chips?: { text: string; at: number }[]; from?: number; to?: number }> = ({
  step,
  children,
  chips = [],
  from = 0,
  to = 99999,
}) => {
  const frame = useCurrentFrame();
  if (frame < from - 1 || frame > to + 1) return null;
  const opacity = interpolate(frame, [from, from + 6, to - 8, to], [0, 1, 1, 0], clamp);
  return (
    <div style={{ position: "absolute", left: 110, top: 190, width: 540, opacity }}>
      <Label size={22}>{step}</Label>
      <div style={{ marginTop: 26 }}>{children}</div>
      <div style={{ marginTop: 44, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 12 }}>
        {chips.map((c) => (
          <Chip key={c.text} start={c.at}>
            {c.text}
          </Chip>
        ))}
      </div>
    </div>
  );
};

const big: React.CSSProperties = { fontSize: 64, fontWeight: 300, lineHeight: 1.12, letterSpacing: "-0.015em" };

/** Selo do veredito (as cores do app) */
const Verdict: React.FC<{ text: string; tone: "crit" | "warn"; at: number }> = ({ text, tone, at }) => {
  const frame = useCurrentFrame();
  const c = tone === "crit" ? colors.crit : colors.warn;
  return (
    <div
      style={{
        display: "inline-block",
        marginTop: 34,
        fontFamily: fonts.mono,
        fontSize: 30,
        fontWeight: 500,
        letterSpacing: "0.12em",
        color: c,
        border: `2px solid ${c}`,
        borderRadius: 10,
        padding: "12px 22px",
        opacity: interpolate(frame, [at, at + 6], [0, 1], clamp),
        scale: interpolate(frame, [at, at + 14], [1.25, 1], { ...clamp, easing: EASE }),
      }}
    >
      {text}
    </div>
  );
};

/* ---------------------------------------------------------------- 6-13 s: Three Forks, NO-GO */
export const Plan: React.FC<{ length: number }> = ({ length }) => (
  <AbsoluteFill>
    <Backdrop glow={0.08} />
    <Screen length={length} layers={[{ src: "planner-nogo", origin: "0% 58%", zoom: [1.0, 1.35] }]} />
    <Caption
      step="Three Forks · 3.73 km"
      chips={[
        { text: "HiRISE 1 m terrain", at: 40 },
        { text: "MEDA weather", at: 70 },
        { text: "Perseverance route", at: 100 },
      ]}
    >
      <Words text="Real NASA and ESA data, one verdict." start={4} stagger={3} accent={[5, 6]} style={big} />
      <Verdict text="NO-GO · NOT ENOUGH O₂" tone="crit" at={170} />
    </Caption>
  </AbsoluteFill>
);

/* ---------------------------------------------------------------- 13-20 s: Why? e levar 13,5 kg */
export const Fix: React.FC<{ length: number }> = ({ length }) => {
  const SWITCH = 96;
  return (
    <AbsoluteFill>
      <Backdrop glow={0.08} />
      <Screen
        length={length}
        layers={[
          { src: "why", origin: "50% 50%", zoom: [1.08, 1.4] },
          { src: "planner-caution", at: SWITCH, origin: "0% 58%", zoom: [1.0, 1.3] },
        ]}
      />
      <Caption step="Why?" to={SWITCH} chips={[{ text: "Return O₂ 21% < 30%", at: 30 }, { text: "Turn back at 3.07 km", at: 52 }]}>
        <Words text="It says why, in numbers." start={4} stagger={3} accent={[3, 4]} style={big} />
      </Caption>
      <Caption step="What to change" from={SWITCH}>
        <Words text="Carry 13.5 kg instead of 18.5." start={SWITCH + 4} stagger={3} accent={[1, 2]} style={big} />
        <Verdict text="CAUTION" tone="warn" at={SWITCH + 40} />
      </Caption>
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- 20-24,6 s: capacete, Follow live, "turn back now" */
export const Helmet: React.FC<{ length: number }> = ({ length }) => (
  <AbsoluteFill>
    <Backdrop glow={0.08} />
    <Screen
      length={length}
      layers={[
        { src: "helmet-3d", origin: "100% 45%", zoom: [1.0, 1.25] },
        { src: "helmet-3d-turnback", at: 58, origin: "100% 45%", zoom: [1.0, 1.25] },
      ]}
    />
    <Caption step="Follow live" chips={[{ text: "Simulated walk · real terrain", at: 30 }]}>
      <Words text="Out there, ARES calls the turn-back point." start={4} stagger={3} accent={[2, 3]} style={big} />
      <Verdict text="TURN BACK NOW" tone="crit" at={62} />
    </Caption>
  </AbsoluteFill>
);

/* ---------------------------------------------------------------- 24,6-29 s: logo */
export const Close: React.FC<{ length: number }> = ({ length }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Backdrop glow={0.12} />
      <AbsoluteFill style={{ opacity: 0.22 }}>
        <Img
          src={staticFile("footage/jezero-clean.jpg")}
          style={{ ...cover, filter: "blur(5px)", scale: interpolate(frame, [0, length], [1.06, 1.14], clamp) }}
        />
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 30 }}>
        <div
          style={{
            opacity: interpolate(frame, [0, 12], [0, 1], clamp),
            scale: interpolate(frame, [0, 30], [0.8, 1], { ...clamp, easing: EASE }),
          }}
        >
          <Logo size={150} />
        </div>
        <Words text="MARSVIEW" start={6} style={{ fontSize: 112, fontWeight: 600, letterSpacing: "0.3em", paddingLeft: "0.3em" }} />
        <Words text="Every step planned. Every breath counted." start={30} stagger={5} accent={[3, 4, 5]} style={{ fontSize: 44, fontWeight: 300, justifyContent: "center" }} />
        <div style={{ opacity: interpolate(frame, [70, 84], [0, 1], clamp), display: "flex", flexDirection: "column", alignItems: "center", gap: 14, marginTop: 14 }}>
          <Label color={colors.muted} size={22} style={{ letterSpacing: "0.24em" }}>
            Team Lumia · NASA Space Apps 2026
          </Label>
          <Label color={colors.muted} size={18} style={{ letterSpacing: "0.2em", opacity: 0.8 }}>
            Built with open NASA, ESA and USGS data
          </Label>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
