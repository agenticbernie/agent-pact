import { useEffect, useState } from "react";
import { api } from "./api";
import type { AppSettings } from "../types";

/** Loads public, non-secret app settings (network, model label) from the API. */
export function useSettings(): AppSettings | null {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .settings()
      .then((s) => alive && setSettings(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return settings;
}
