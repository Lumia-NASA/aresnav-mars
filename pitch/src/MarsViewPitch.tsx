import React from "react";
import { Audio } from "@remotion/media";
import { AbsoluteFill, Sequence, staticFile, useVideoConfig } from "remotion";
import { SceneFade, Watermark } from "./components";
import { Close, Fix, Globe, Helmet, Plan } from "./scenes";
import { colors, OVERLAP, SCENES } from "./theme";
import voice from "./voice-lines.json";

/** Narração: uma fala por arquivo (pitch/public/voice, gerado por pitch/scripts/voice.py), cada uma no seu segundo */
const Narration: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <>
      {voice.lines.map((l) => (
        <Sequence key={l.id} name={`Voz: ${l.text}`} from={Math.round(l.start * fps)} layout="none">
          <Audio src={staticFile(`voice/${l.id}.mp3`)} />
        </Sequence>
      ))}
    </>
  );
};

/** Uma cena: entra e sai com fade e se sobrepõe um pouco à próxima (OVERLAP quadros) */
const Scene: React.FC<{ name: string; range: readonly [number, number]; first?: boolean; last?: boolean; children: React.ReactNode }> = ({
  name,
  range,
  first,
  last,
  children,
}) => {
  const [from, to] = range;
  const duration = to - from + (last ? 0 : OVERLAP);
  return (
    <Sequence name={name} from={from} durationInFrames={duration}>
      <SceneFade duration={duration} fadeIn={first ? 6 : OVERLAP} fadeOut={last ? 10 : OVERLAP}>
        {children}
      </SceneFade>
    </Sequence>
  );
};

const len = (r: readonly [number, number]) => r[1] - r[0] + OVERLAP;

export const MarsViewPitch: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: colors.bg }}>
    <Scene name="1 · Globo até Jezero (0-6 s)" range={SCENES.globe} first>
      <Globe length={len(SCENES.globe)} />
    </Scene>
    <Scene name="2 · Three Forks, NO-GO (6-13 s)" range={SCENES.plan}>
      <Plan length={len(SCENES.plan)} />
    </Scene>
    <Scene name="3 · Why? e 13,5 kg (13-20 s)" range={SCENES.fix}>
      <Fix length={len(SCENES.fix)} />
    </Scene>
    <Scene name="4 · Capacete, turn back now (20-24,6 s)" range={SCENES.helmet}>
      <Helmet length={len(SCENES.helmet)} />
    </Scene>
    <Scene name="5 · Logo (24,6-29 s)" range={SCENES.close} last>
      <Close length={SCENES.close[1] - SCENES.close[0]} />
    </Scene>
    <Watermark />
    <Narration />
  </AbsoluteFill>
);
