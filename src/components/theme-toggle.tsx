"use client";

// Dark / light switch. The dark theme is the default; "light" is stored in
// localStorage and applied as a class on <html> (see the inline script in
// layout.tsx that prevents a flash on load).
import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

export function ThemeToggle() {
  const light = useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains("light"),
    () => false,
  );

  function toggle() {
    const next = !document.documentElement.classList.contains("light");
    document.documentElement.classList.toggle("light", next);
    try {
      localStorage.setItem("theme", next ? "light" : "dark");
    } catch {
      /* private mode */
    }
  }

  return (
    <button
      onClick={toggle}
      aria-label={light ? "Switch to dark mode" : "Switch to light mode"}
      title={light ? "Dark mode" : "Light mode"}
      className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
    >
      {light ? <Moon size={19} aria-hidden /> : <Sun size={19} aria-hidden />}
    </button>
  );
}
