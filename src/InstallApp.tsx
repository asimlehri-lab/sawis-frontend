// "Install SAWIS as an app" -- puts a SAWIS icon on the phone's home screen
// (or the computer's app list) so it opens full screen like a normal app.
//
// How it works:
//  * Android / desktop Chrome and Edge fire a `beforeinstallprompt` event once
//    the site is installable (manifest + icons, see public/manifest.webmanifest).
//    We catch it at module load -- it can fire before React renders -- keep it,
//    and call .prompt() from our own button.
//  * iPhone / iPad Safari has no install API at all, so there we show the three
//    taps the person has to do themselves.
//  * Once installed (running standalone, or the `appinstalled` event) nothing
//    here shows any more.
//
// Two pieces are exported: InstallMenuItem (a button in the side menu, for
// everyone -- Settings is admin-only so it can't live there) and InstallBanner
// (a small dismissible card shown on phones; dismissed = quiet for 30 days).

import { useState, useSyncExternalStore } from "react";

type InstallChoice = { outcome: "accepted" | "dismissed" };
type DeferredPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
};

const DISMISS_KEY = "sawis_install_dismissed";
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;
const PHONE_QUERY = "(max-width: 700px)";

function runningInstalled(): boolean {
  try {
    const nav = navigator as Navigator & { standalone?: boolean };
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      nav.standalone === true
    );
  } catch {
    return false;
  }
}

// iPhone, iPad, and iPadOS (which calls itself a Mac but has a touch screen).
function onApple(): boolean {
  const ua = navigator.userAgent;
  return (
    /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

// ---- tiny module-level store, so every component sees the same state -------
type Snap = { prompt: DeferredPrompt | null; installed: boolean };
let snap: Snap = { prompt: null, installed: typeof window !== "undefined" && runningInstalled() };
const listeners = new Set<() => void>();
function setSnap(next: Partial<Snap>) {
  snap = { ...snap, ...next };
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep it for our own button instead of the browser's mini-bar
    setSnap({ prompt: e as DeferredPrompt });
  });
  window.addEventListener("appinstalled", () => {
    setSnap({ prompt: null, installed: true });
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
const getSnap = () => snap;

function usePhone(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(PHONE_QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

// "none" = nothing to offer (already installed, or this browser can't install).
type Mode = "none" | "prompt" | "apple";

function useInstall() {
  const s = useSyncExternalStore(subscribe, getSnap, getSnap);
  const phone = usePhone();
  let mode: Mode = "none";
  if (!s.installed) {
    if (s.prompt) mode = "prompt";
    else if (onApple()) mode = "apple";
  }
  async function install(): Promise<boolean> {
    const p = snap.prompt;
    if (!p) return false;
    try {
      await p.prompt();
      const choice = await p.userChoice;
      // A prompt can only be used once, whatever the answer was.
      setSnap({ prompt: null });
      return choice.outcome === "accepted";
    } catch {
      setSnap({ prompt: null });
      return false;
    }
  }
  return { mode, phone, install };
}

function snoozed(): boolean {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(t) && t > 0 && Date.now() - t < SNOOZE_MS;
  } catch {
    return false;
  }
}

function IosSteps({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal install-steps"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-steps-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="install-steps-title">Add SAWIS to your home screen</h2>
        <ol>
          <li>
            Tap the <b>Share</b> button in Safari (the square with an arrow, at the bottom of the
            screen).
          </li>
          <li>
            Scroll down and tap <b>Add to Home Screen</b>.
          </li>
          <li>
            Tap <b>Add</b>. The SAWIS icon now sits on your home screen.
          </li>
        </ol>
        <p className="install-note">
          Not seeing it? Open this page in Safari first. Other iPhone browsers hide the option.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn-primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

// Side-menu button. Shown to everyone whenever the browser can install SAWIS.
export function InstallMenuItem() {
  const { mode, phone, install } = useInstall();
  const [steps, setSteps] = useState(false);
  if (mode === "none") return null;
  return (
    <>
      <button
        type="button"
        className="nav-btn"
        style={{ marginBottom: 4 }}
        onClick={() => {
          if (mode === "prompt") void install();
          else setSteps(true);
        }}
      >
        ⬇ Install SAWIS on {phone ? "this phone" : "this computer"}
      </button>
      {steps && <IosSteps onClose={() => setSteps(false)} />}
    </>
  );
}

// First-visit card on phones. "Not now" hides it for 30 days; installing, or
// already running as an app, hides it for good.
export function InstallBanner() {
  const { mode, phone, install } = useInstall();
  const [hidden, setHidden] = useState(snoozed);
  const [steps, setSteps] = useState(false);
  if (!phone || mode === "none" || hidden) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode: it just comes back next visit */
    }
    setHidden(true);
  }

  return (
    <>
      <div className="install-banner" role="region" aria-label="Install SAWIS">
        <img src="/icon-192.png" alt="" className="install-banner-icon" width={40} height={40} />
        <div className="install-banner-text">
          <b>Put SAWIS on your home screen</b>
          <span>Opens full screen, like any other app.</span>
        </div>
        <div className="install-banner-actions">
          <button
            type="button"
            className="btn-primary small"
            onClick={() => {
              if (mode === "prompt") void install();
              else setSteps(true);
            }}
          >
            {mode === "prompt" ? "Install" : "Show me"}
          </button>
          <button type="button" className="btn-ghost" onClick={dismiss}>
            Not now
          </button>
        </div>
      </div>
      {steps && <IosSteps onClose={() => setSteps(false)} />}
    </>
  );
}
