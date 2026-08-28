import { describe, it, expect } from "vitest";
import { calculateShortestAngleDelta } from "../lib/geo/haversine";

describe("Manual Smooth Map Rotation Suite", () => {
  // ── 1. Rotation Delta & Circular Boundary Wrapping ────────────────────────
  describe("1. Rotation Delta & Circular Boundary Wrapping", () => {
    it("correctly computes new bearing when rotating clockwise by delta degrees", () => {
      const initialBearing = 45;
      const delta = 15; // 15 deg clockwise
      const newBearing = (initialBearing + delta + 360) % 360;
      expect(newBearing).toBe(60);
    });

    it("correctly handles wrapping around 360° -> 0° when rotating clockwise", () => {
      const initialBearing = 350;
      const delta = 20; // 20 deg clockwise
      const newBearing = (initialBearing + delta + 360) % 360;
      expect(newBearing).toBe(10);
    });

    it("correctly handles wrapping around 0° -> 360° when rotating counter-clockwise", () => {
      const initialBearing = 10;
      const delta = -25; // 25 deg CCW
      const newBearing = (initialBearing + delta + 360) % 360;
      expect(newBearing).toBe(345);
    });
  });

  // ── 2. Intelligent Magnetic North Snapping Threshold ──────────────────────
  describe("2. Intelligent Magnetic North Snapping (Deadband Threshold)", () => {
    const snapToNorthIfClose = (bearing: number) => {
      const normalized = (bearing % 360 + 360) % 360;
      if (Math.abs(normalized) < 2.5 || Math.abs(normalized - 360) < 2.5) {
        return 0;
      }
      return normalized;
    };

    it("snaps to 0° (True North) when bearing is within 2.5° clockwise", () => {
      expect(snapToNorthIfClose(1.8)).toBe(0);
      expect(snapToNorthIfClose(2.4)).toBe(0);
    });

    it("snaps to 0° (True North) when bearing is within 2.5° counter-clockwise (357.5° - 360°)", () => {
      expect(snapToNorthIfClose(358.5)).toBe(0);
      expect(snapToNorthIfClose(357.8)).toBe(0);
    });

    it("retains exact angle when outside the 2.5° snapping deadband", () => {
      expect(snapToNorthIfClose(5.0)).toBe(5.0);
      expect(snapToNorthIfClose(350.0)).toBe(350.0);
      expect(snapToNorthIfClose(180.0)).toBe(180.0);
    });
  });

  // ── 3. Touch Two-Finger Twist Angle Delta ─────────────────────────────────
  describe("3. Touch Two-Finger Twist Angle Delta Simulation", () => {
    const computeTouchTwistBearing = (
      initialBearing: number,
      startTouchAngle: number,
      currentTouchAngle: number
    ) => {
      const angleDelta = currentTouchAngle - startTouchAngle;
      let newBearing = (initialBearing + angleDelta + 360) % 360;
      if (Math.abs(newBearing) < 2.5 || Math.abs(newBearing - 360) < 2.5) {
        newBearing = 0;
      }
      return newBearing;
    };

    it("rotates map by exact touch angle difference on 2-finger twist gesture", () => {
      const initialBearing = 0;
      const startAngle = 45;
      const currentAngle = 90; // rotated 45 degrees CW
      const bearing = computeTouchTwistBearing(initialBearing, startAngle, currentAngle);
      expect(bearing).toBe(45);
    });

    it("rotates map counter-clockwise when fingers twist CCW", () => {
      const initialBearing = 90;
      const startAngle = 180;
      const currentAngle = 150; // rotated 30 degrees CCW
      const bearing = computeTouchTwistBearing(initialBearing, startAngle, currentAngle);
      expect(bearing).toBe(60);
    });
  });

  // ── 4. Mouse Drag & Wheel Rotation Simulation ─────────────────────────────
  describe("4. Mouse Drag & Shift+Wheel Rotation Simulation", () => {
    it("simulates horizontal mouse drag rotation smoothly", () => {
      const initialBearing = 0;
      const mouseDragDx = 100; // dragged 100px right
      const sensitivity = 0.45;
      let newBearing = (initialBearing + mouseDragDx * sensitivity + 360) % 360;
      expect(newBearing).toBe(45);
    });

    it("simulates Shift + Mouse Wheel rotation step", () => {
      const initialBearing = 45;
      const wheelDeltaY = 100; // scroll down
      const step = wheelDeltaY > 0 ? 10 : -10;
      let newBearing = (initialBearing + step + 360) % 360;
      expect(newBearing).toBe(55);
    });
  });

  // ── 5. Exponential Smoothing Convergence for 120 FPS Motion ────────────────
  describe("5. 120 FPS Continuous Exponential Smoothing Convergence", () => {
    it("smoothly glides visual bearing towards target bearing without overshoot", () => {
      let visualBearing = 0;
      const targetBearing = 90;
      const dt = 1 / 120; // 120Hz frame time
      const rotSpeed = 24.0; // active gesture convergence speed

      for (let frame = 0; frame < 30; frame++) {
        const dB = calculateShortestAngleDelta(visualBearing, targetBearing);
        const rotAlpha = 1 - Math.exp(-rotSpeed * dt);
        visualBearing = (visualBearing + dB * rotAlpha + 360) % 360;
      }

      // After 30 frames (~0.25s), visualBearing should closely approach targetBearing (90°)
      expect(visualBearing).toBeGreaterThan(88);
      expect(visualBearing).toBeLessThanOrEqual(90);
    });
  });
});
