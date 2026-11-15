import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { SceneFade, Watermark } from "./components";
import { Challenge, Future, HowItWorks, Intro, Title } from "./scenes";
import { colors, OVERLAP, SCENES } from "./theme";

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

export const MarsViewPitch: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: colors.bg }}>
    <Scene name="1 · Quem somos (0-2 s)" range={SCENES.intro} first>
      <Intro />
    </Scene>
    <Scene name="2 · O desafio (2-5 s)" range={SCENES.challenge}>
      <Challenge />
    </Scene>
    <Scene name="3 · Nome e frase (5-10 s)" range={SCENES.title}>
      <Title />
    </Scene>
    <Scene name="4 · Como funciona (10-20 s)" range={SCENES.how}>
      <HowItWorks />
    </Scene>
    <Scene name="5 · O futuro (20-29 s)" range={SCENES.future} last>
      <Future />
    </Scene>
    <Watermark />
  </AbsoluteFill>
);
