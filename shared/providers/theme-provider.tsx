"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";

type Theme = "light" | "dark";
type Ctx = { theme: Theme; setTheme: (t: Theme) => void; resolved: "light" | "dark" };

const ThemeCtx = createContext<Ctx | null>(null);
const useIsoLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

function apply(theme: Theme): "light" | "dark" {
  const isDark = theme === "dark";
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", isDark);
  }
  return isDark ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useIsoLayout(() => {
    const stored = localStorage.getItem("theme");
    const validTheme: Theme = stored === "dark" ? "dark" : "light";
    setThemeState(validTheme);
    setResolved(apply(validTheme));
  }, []);

  const setTheme = (t: Theme) => {
    const validTheme: Theme = t === "dark" ? "dark" : "light";
    localStorage.setItem("theme", validTheme);
    setThemeState(validTheme);
    setResolved(apply(validTheme));
  };

  return (
    <ThemeCtx.Provider value={{ theme, setTheme, resolved }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
