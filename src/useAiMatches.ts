import { useEffect, useRef, useState } from "react";
import { AiMatchOff, aiMatchNames } from "./api";
import type { AiMatch } from "./api";

// Asks the AI, once, about names a screen could not match (after remembered matches and our own
// rules). Quiet by design: if the AI is off, over its monthly cap or unreachable, nothing shows and
// the normal "Did you mean" chips carry on. Every name is asked about at most once per screen.
export function useAiMatches(
  accessToken: string,
  kind: "items" | "dishes",
  names: string[],
  enabled = true,
  onlyIds?: string[],
): { get: (name: string) => AiMatch | undefined; loading: boolean } {
  const [found, setFound] = useState<Record<string, AiMatch>>({});
  const [loading, setLoading] = useState(false);
  const asked = useRef<Set<string>>(new Set());
  const off = useRef(false);

  const cleaned = Array.from(new Set(names.map((n) => n.replace(/\s+/g, " ").trim()).filter(Boolean)));
  const key = cleaned.join("\u0001");

  useEffect(() => {
    if (!enabled || off.current) return;
    const fresh = cleaned.filter((n) => !asked.current.has(n.toLowerCase()));
    if (fresh.length === 0) return;
    // Wait a moment so rows that are being matched right now are not sent.
    const timer = window.setTimeout(async () => {
      fresh.forEach((n) => asked.current.add(n.toLowerCase()));
      setLoading(true);
      try {
        for (let i = 0; i < fresh.length; i += 60) {
          const res = await aiMatchNames(accessToken, kind, fresh.slice(i, i + 60), onlyIds);
          setFound((prev) => {
            const next = { ...prev };
            for (const m of res.matches) if (m.id) next[m.name.toLowerCase()] = m;
            return next;
          });
          if (res.capped) break;
        }
      } catch (err) {
        if (err instanceof AiMatchOff) off.current = true;
      } finally {
        setLoading(false);
      }
    }, 600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, accessToken, kind]);

  return {
    get: (name: string) => found[name.replace(/\s+/g, " ").trim().toLowerCase()],
    loading,
  };
}
