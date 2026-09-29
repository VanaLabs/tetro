"use client"

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"

/** The colours actually on screen. */
export type Theme = "light" | "dark"
/** What the person chose; "system" follows macOS. */
export type ThemePreference = Theme | "system"

const THEME_STORAGE_KEY = "tetro-theme"
// Earlier builds stored the theme under the inherited Meetily key; read it once so nobody loses their choice.
const LEGACY_THEME_STORAGE_KEY = "meetily-theme"

interface ThemeContextValue {
  /** Resolved theme currently shown. */
  theme: Theme
  preference: ThemePreference
  setPreference: (preference: ThemePreference) => void
  /** Kept for callers that pick an explicit light/dark theme. */
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

const systemQuery = () => window.matchMedia("(prefers-color-scheme: dark)")
const resolve = (preference: ThemePreference): Theme =>
  preference === "system" ? (systemQuery().matches ? "dark" : "light") : preference

function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "light"
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY)
    return stored === "dark" || stored === "system" ? stored : "light"
  } catch {
    return document.documentElement.classList.contains("dark") ? "dark" : "light"
  }
}

// Colour transitions on individual elements would otherwise animate at different speeds
// during a theme swap and look like flicker, so transitions pause for the swap itself.
let resumeTransitions: number | undefined

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (root.classList.contains("dark") === (theme === "dark") && root.style.colorScheme === theme) return
  root.classList.add("tetro-theme-swap")
  root.classList.toggle("dark", theme === "dark")
  root.style.colorScheme = theme
  void root.offsetHeight // commit the new colours before transitions come back
  if (resumeTransitions) cancelAnimationFrame(resumeTransitions)
  resumeTransitions = requestAnimationFrame(() => {
    resumeTransitions = requestAnimationFrame(() => root.classList.remove("tetro-theme-swap"))
  })
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("light")
  const [theme, setThemeState] = useState<Theme>("light")

  useEffect(() => {
    const initial = readStoredPreference()
    setPreferenceState(initial)
  }, [])

  // Apply the preference, and keep following macOS while "system" is chosen.
  useEffect(() => {
    const update = () => { const next = resolve(preference); setThemeState(next); applyTheme(next) }
    update()
    if (preference !== "system") return
    const query = systemQuery()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [preference])

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // The class still updates when local storage is unavailable.
    }
  }, [])

  const setTheme = useCallback((next: Theme) => setPreference(next), [setPreference])
  const toggleTheme = useCallback(() => setPreference(theme === "dark" ? "light" : "dark"), [setPreference, theme])

  return (
    <ThemeContext.Provider value={{ theme, preference, setPreference, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)

  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }

  return context
}
