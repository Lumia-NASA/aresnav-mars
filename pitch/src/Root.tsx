import React from "react";
import { Composition } from "remotion";
import { MarsViewPitch } from "./MarsViewPitch";
import { FPS, TOTAL_FRAMES } from "./theme";

// 29 s a 30 fps = 870 quadros (o limite do Space Apps é 30 s; 29 s dá folga)
export const RemotionRoot: React.FC = () => (
  <Composition id="MarsViewPitch" component={MarsViewPitch} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} />
);
