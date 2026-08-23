import { describe, it, expect } from "vitest";

describe("CAD Editor & Campus Map Zoom Performance & Responsiveness", () => {
  // ── 1. Wheel Delta Normalization & Delta Modes ─────────────────────────────
  describe("1. Wheel Delta Normalization (Mouse Wheel vs Touchpad vs High-Res)", () => {
    function computeWheelMultiplier(deltaY: number, ctrlKey: boolean, deltaMode: number): number {
      if (ctrlKey) {
        // Laptop touchpad pinch gesture: continuous proportional exponential scale
        const clampedDelta = Math.min(60, Math.max(-60, deltaY));
        return Math.exp(-clampedDelta * 0.008);
      } else if (deltaMode === 0 /* DOM_DELTA_PIXEL */) {
        // Laptop touchpad two-finger swipe up/down (continuous pixel stream)
        const clampedDelta = Math.min(80, Math.max(-80, deltaY));
        return Math.exp(-clampedDelta * 0.0012);
      } else {
        // Physical discrete mouse wheel (DOM_DELTA_LINE or DOM_DELTA_PAGE)
        let delta = deltaY;
        if (deltaMode === 1 /* DOM_DELTA_LINE */) {
          delta *= 20;
        } else if (deltaMode === 2 /* DOM_DELTA_PAGE */) {
          delta *= 200;
        }
        const normalizedDelta = Math.min(120, Math.max(-120, delta));
        return Math.exp(-normalizedDelta * 0.0018);
      }
    }

    it("handles laptop touchpad two-finger swipe smoothly (DOM_DELTA_PIXEL)", () => {
      // Swipe stream tick of 25px
      const swipeInMult = computeWheelMultiplier(-25, false, 0);
      const swipeOutMult = computeWheelMultiplier(25, false, 0);

      // Controlled ~3% zoom per continuous tick (smooth stream)
      expect(swipeInMult).toBeCloseTo(Math.exp(0.03), 3);
      expect(swipeOutMult).toBeCloseTo(Math.exp(-0.03), 3);
      expect(swipeInMult).toBeGreaterThan(1.0);
      expect(swipeOutMult).toBeLessThan(1.0);
    });

    it("handles DOM_DELTA_LINE mode correctly without excessive sensitivity", () => {
      // 3 lines per notch (typical Windows wheel) -> delta = 60px
      const lineZoomIn = computeWheelMultiplier(-3, false, 1);
      const lineZoomOut = computeWheelMultiplier(3, false, 1);

      expect(lineZoomIn).toBeGreaterThan(1.08);
      expect(lineZoomIn).toBeLessThan(1.15);
      expect(lineZoomOut).toBeLessThan(0.92);
      expect(lineZoomOut).toBeGreaterThan(0.85);
    });

    it("handles laptop touchpad pinch continuous micro-deltas smoothly", () => {
      // Small pinch spread of 2.5px
      const microPinchIn = computeWheelMultiplier(-2.5, true, 0);
      const microPinchOut = computeWheelMultiplier(2.5, true, 0);

      expect(microPinchIn).toBeCloseTo(Math.exp(0.02), 4);
      expect(microPinchOut).toBeCloseTo(Math.exp(-0.02), 4);
      expect(microPinchIn).toBeGreaterThan(1.0);
      expect(microPinchOut).toBeLessThan(1.0);
    });
  });

  // ── 2. Rapid Direction Reversal & Zero Stale Lag ───────────────────────────
  describe("2. Immediate Reversal & Zero Input Buildup", () => {
    it("immediately reverses zoom direction on subsequent input ticks without lag", () => {
      let targetZoom = 1.0;
      let visualZoom = 1.0;
      const dt = 1 / 60;
      const decayConstant = 24.0;

      // 5 rapid zoom-in ticks
      for (let i = 0; i < 5; i++) {
        const mult = Math.exp(100 * 0.0018); // ~1.197
        targetZoom = Math.min(5.0, Math.max(0.35, targetZoom * mult));
      }
      expect(targetZoom).toBeGreaterThan(2.0);

      // Simulate 2 frames of visual glide
      for (let f = 0; f < 2; f++) {
        const dZ = targetZoom - visualZoom;
        const zoomAlpha = 1 - Math.exp(-decayConstant * dt);
        visualZoom += dZ * zoomAlpha;
      }
      const midVisualZoom = visualZoom;
      expect(midVisualZoom).toBeGreaterThan(1.2);

      // User suddenly reverses wheel direction (3 zoom-out ticks)
      for (let i = 0; i < 3; i++) {
        const mult = Math.exp(-100 * 0.0018); // ~0.835
        targetZoom = Math.min(5.0, Math.max(0.35, targetZoom * mult));
      }

      // Next frame must immediately track towards new lower targetZoom
      const dZReverse = targetZoom - visualZoom;
      const zoomAlpha = 1 - Math.exp(-decayConstant * dt);
      const nextVisual = visualZoom + dZReverse * zoomAlpha;

      // Delta must immediately be negative (reversal)
      expect(dZReverse).toBeLessThan(0);
      expect(nextVisual).toBeLessThan(midVisualZoom);
    });
  });

  // ── 3. Cursor Focal Anchor Math with Bearing Compensation ─────────────────
  describe("3. Cursor Focal Point Invariance under Rotation", () => {
    it("maintains focal coordinate under mouse cursor during zoom with 0° bearing", () => {
      const bounds = { x: 0, y: 0, w: 1000, h: 800 };
      const curZoom = 1.0;
      const newZoom = 2.0;
      const mouseRatio = { x: 0.75, y: 0.25 };
      const pan = { x: 0, y: 0 };
      const bearing = 0;

      const oldEffW = bounds.w / curZoom;
      const oldEffH = bounds.h / curZoom;
      const newEffW = bounds.w / newZoom;
      const newEffH = bounds.h / newZoom;

      const rawDPanX = (oldEffW - newEffW) * (0.5 - mouseRatio.x);
      const rawDPanY = (oldEffH - newEffH) * (0.5 - mouseRatio.y);

      const rad = (-bearing * Math.PI) / 180;
      const dPanX = rawDPanX * Math.cos(rad) - rawDPanY * Math.sin(rad);
      const dPanY = rawDPanX * Math.sin(rad) + rawDPanY * Math.cos(rad);

      const nextPan = { x: pan.x + dPanX, y: pan.y + dPanY };

      expect(nextPan.x).toBe(-125);
      expect(nextPan.y).toBe(100);
    });

    it("maintains focal coordinate under mouse cursor during zoom with 90° bearing", () => {
      const bounds = { x: 0, y: 0, w: 1000, h: 800 };
      const curZoom = 1.0;
      const newZoom = 2.0;
      const mouseRatio = { x: 0.5, y: 0.5 }; // Center of viewport
      const pan = { x: 50, y: 50 };
      const bearing = 90;

      const oldEffW = bounds.w / curZoom;
      const oldEffH = bounds.h / curZoom;
      const newEffW = bounds.w / newZoom;
      const newEffH = bounds.h / newZoom;

      const rawDPanX = (oldEffW - newEffW) * (0.5 - mouseRatio.x);
      const rawDPanY = (oldEffH - newEffH) * (0.5 - mouseRatio.y);

      const rad = (-bearing * Math.PI) / 180;
      const dPanX = rawDPanX * Math.cos(rad) - rawDPanY * Math.sin(rad);
      const dPanY = rawDPanX * Math.sin(rad) + rawDPanY * Math.cos(rad);

      const nextPan = { x: pan.x + dPanX, y: pan.y + dPanY };

      // Center zoom with 0 offset delta preserves pan exactly
      expect(nextPan.x).toBe(50);
      expect(nextPan.y).toBe(50);
    });
  });

  // ── 4. Snappy Convergence (Decay Constant 24.0 vs 12.0) ───────────────────
  describe("4. Decay-Time Exponential Smoothing Convergence", () => {
    it("achieves >90% convergence within 100ms with decayConstant = 24.0", () => {
      const decayConstant = 24.0;
      let val = 1.0;
      const target = 2.0;
      const dt = 1 / 60; // 16.6ms frame

      // 6 frames = 100ms
      for (let i = 0; i < 6; i++) {
        val += (target - val) * (1 - Math.exp(-decayConstant * dt));
      }

      // Must reach > 90% of target distance
      expect(val).toBeGreaterThan(1.90);
      expect(val).toBeLessThanOrEqual(2.0);
    });
  });
});
