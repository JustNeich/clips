import type { Stage3TemplateConfig } from "./stage3-template";

type Stage3CardConfig = Stage3TemplateConfig["card"];
type Stage3FrameConfig = Stage3TemplateConfig["frame"];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function updateTemplateRoadCard<K extends keyof Stage3CardConfig>(
  current: Stage3CardConfig,
  frame: Stage3FrameConfig,
  key: K,
  value: Stage3CardConfig[K]
): Stage3CardConfig {
  if (key !== "width") {
    return {
      ...current,
      [key]: value
    };
  }

  const nextWidth = Number(value);
  if (!Number.isFinite(nextWidth)) {
    return current;
  }

  const currentCenterX = current.x + current.width / 2;
  const unclampedX = currentCenterX - nextWidth / 2;
  const maxX = Math.max(0, frame.width - nextWidth);

  return {
    ...current,
    width: nextWidth,
    x: clamp(unclampedX, 0, maxX)
  };
}
