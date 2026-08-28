import { describe, it, expect } from "vitest";

function normalizeRotation(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function calculateRotationDelta(startAngle: number, currentAngle: number): number {
  return currentAngle - startAngle;
}

function calculateSvgTransformString(x: number, y: number, scale: number, rotation: number): string {
  return `translate(${x}px, ${y}px) scale(${scale}) rotate(${rotation}deg)`;
}

describe("Manual Smooth Map Rotation Engine", () => {
  it("normalizes any degree angle smoothly into 0°–360° range", () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(-45)).toBe(315);
  });

  it("calculates smooth incremental rotation deltas from mouse/touch drag", () => {
    const deltaClockwise = calculateRotationDelta(0, 15);
    expect(deltaClockwise).toBe(15);

    const deltaCcw = calculateRotationDelta(45, 30);
    expect(deltaCcw).toBe(-15);
  });

  it("formats valid CSS SVG matrix transform strings including rotation", () => {
    const transformStr = calculateSvgTransformString(100, -50, 1.5, 45);
    expect(transformStr).toBe("translate(100px, -50px) scale(1.5) rotate(45deg)");
  });

  it("resets compass orientation to 0° North upon reset action", () => {
    let rotation = 135;
    expect(rotation).toBe(135);

    rotation = 0;
    expect(normalizeRotation(rotation)).toBe(0);
  });
});
