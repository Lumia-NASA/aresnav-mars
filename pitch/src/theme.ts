import { Easing } from "remotion";
import { loadFont as loadManrope } from "@remotion/google-fonts/Manrope";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

// Mesma identidade da landing page e do app: carvão quente, marfim, terracota.
export const colors = {
  bg: "#12120F",
  panel: "#191916",
  line: "#2C2A26",
  edge: "#34312C",
  fg: "#ECE6DC",
  muted: "#9C958A",
  accent: "#CF9B83",
  rust: "#C46F4B",
  crit: "#D8664F",
  warn: "#D8A74E",
  ok: "#9DBB98",
};

export const fonts = {
  sans: loadManrope("normal", { weights: ["300", "400", "600", "700"], subsets: ["latin"] }).fontFamily,
  mono: loadMono("normal", { weights: ["400", "500"], subsets: ["latin"] }).fontFamily,
};

// Nomes de quem apresenta (o guia do Space Apps pede nome e equipe no começo). Ex.: "Thiago, Naldrin, Lucas, Franzoi"
export const PRESENTERS = "";

export const FPS = 30;
// Entrada suave: sai rápido e chega devagar
export const EASE = Easing.bezier(0.16, 1, 0.3, 1);

// Linha do tempo (quadros a 30 fps). Total: 29 s, para nunca passar do limite de 30 s do Space Apps.
export const OVERLAP = 10;
// Roteiro do docs/PITCH.md; as falas e o segundo de cada uma estão em voice-lines.json.
export const SCENES = {
  globe: [0, 183], // 0-6 s       o globo voa até Jezero: as três perguntas
  plan: [183, 400], // 6-13,3 s   Three Forks: dados reais, NO-GO
  fix: [400, 600], // 13,3-20 s   Why? e levar 13,5 kg: CAUTION
  helmet: [600, 738], // 20-24,6 s capacete, Follow live: "turn back now"
  close: [738, 870], // 24,6-29 s logo e frase
} as const;
export const TOTAL_FRAMES = 870;
