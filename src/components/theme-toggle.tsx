"use client";

// Dark / light switch. The dark theme is the default; "light" is stored in
// localStorage and applied as a class on <html> (see the inline script in
// layout.tsx that prevents a flash on load).
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const [light, setLight] = useState<boolean | null>(null);

  useEffect(() => {
    setLight(document.documentElement.classList.contains("light"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("light");
    document.documentElement.classList.toggle("light", next);
    try {
      localStorage.setItem("theme", next ? "light" : "dark");
    } catch {
      /* private mode */
    }
    setLight(next);
  }

  return (
    <button
      onClick={toggle}
      aria-label={light ? "Switch to dark mode" : "Switch to light mode"}
      title={light ? "Dark mode" : "Light mode"}
      className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
    >
      {light === null ? (
        <Moon size={19} aria-hidden />
      ) : light ? (
        <Moon size={19} aria-hidden />
      ) : (
        <Sun size={19} aria-hidden />
      )}
    </button>
  );
}
