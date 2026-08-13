"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardTitle, CardDescription } from "@/shared/components/ui/card";

type Point = { hour: string; sessions: number };

// Deterministic hourly signal (SSR-safe).
function synthSeries(): Point[] {
  const base = [12, 8, 6, 6, 10, 22, 46, 82, 110, 138, 152, 168, 170, 160, 148, 138, 122, 96, 70, 52, 38, 28, 22, 16];
  return base.map((s, i) => ({
    hour: `${String(i).padStart(2, "0")}:00`,
    sessions: s,
  }));
}

export function AnalyticsCharts() {
  const [data, setData] = useState<Point[]>(synthSeries());
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setData((s) =>
        s.map((p, i) =>
          i === new Date().getHours()
            ? { ...p, sessions: p.sessions + Math.floor(Math.random() * 4) }
            : p,
        ),
      );
      setPulse((p) => p + 1);
    }, 3000);
    return () => clearInterval(t);
  }, []);

  const max = Math.max(...data.map((d) => d.sessions));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <CardTitle>Sessions by hour</CardTitle>
            <CardDescription>Updated live · UTC today</CardDescription>
          </div>
          <span className="text-xs text-[rgb(var(--muted-fg))]">
            pulses: {pulse}
          </span>
        </div>
        <svg viewBox="0 0 640 200" className="h-56 w-full">
          {data.map((p, i) => {
            const h = (p.sessions / max) * 160;
            const x = (i / data.length) * 620 + 8;
            return (
              <motion.rect
                key={i}
                initial={{ height: 0, y: 180 }}
                animate={{ height: h, y: 180 - h }}
                transition={{ duration: 0.4 }}
                x={x}
                width={18}
                rx={3}
                fill="rgb(var(--primary))"
                opacity={0.85}
              />
            );
          })}
          <line
            x1="0"
            y1="180"
            x2="640"
            y2="180"
            stroke="rgb(var(--border))"
          />
        </svg>
      </Card>

      <Card>
        <CardTitle>Route mix</CardTitle>
        <CardDescription>Where people spend their walk.</CardDescription>
        <div className="mt-4 space-y-3">
          {[
            ["Outdoor walkways", 62, "rgb(var(--primary))"],
            ["Indoor corridors", 24, "rgb(var(--success))"],
            ["Stairs & lifts", 9, "rgb(var(--warning))"],
            ["Roads", 5, "rgb(var(--muted-fg))"],
          ].map(([label, pct, color]) => (
            <div key={label as string}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span>{label as string}</span>
                <span className="text-[rgb(var(--muted-fg))]">{pct as number}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[rgb(var(--muted))]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct as number}%`,
                    background: color as string,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
