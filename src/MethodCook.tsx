// Cook view of a recipe's Method: one step at a time, big text, made for a phone or tablet in the kitchen.
// No costs are shown here, so it is safe for the whole team.
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { RecipeLine } from "./api";
import type { MethodPhoto, MethodStep } from "./methodApi";

interface Props {
  recipeName: string;
  steps: MethodStep[];
  lineById: Map<string, RecipeLine>;
  colorOf: (lineId: string) => string;
  finished: MethodPhoto | null;
  contains: string[];
  mayContain: string[];
  // Staff follow the method but cannot change it: a small cue says so.
  readOnly?: boolean;
}

const SCALES = [0.5, 1, 2, 4];
const fmt = (n: number): string => String(parseFloat((Math.round(n * 100) / 100).toFixed(2)));
const mmss = (n: number): string => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const cv = (c: string): CSSProperties => ({ "--c": c } as CSSProperties);

export default function MethodCook({ recipeName, steps, lineById, colorOf, finished, contains, mayContain, readOnly }: Props) {
  const [i, setI] = useState(0); // steps.length means the finish screen
  const [scale, setScale] = useState(1);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [goal, setGoal] = useState(false);
  const [left, setLeft] = useState(0);
  const [running, setRunning] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const n = steps.length;
  const step = i < n ? steps[i] : null;

  // The timer starts from the step's minutes and counts down once started.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setLeft((v) => {
        if (v <= 1) {
          setRunning(false);
          try {
            navigator.vibrate?.(300);
          } catch {
            /* not every device can vibrate */
          }
          return 0;
        }
        return v - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [running]);

  function go(to: number) {
    setI(to);
    setRunning(false);
    setLeft(0);
    setGoal(false);
    bodyRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (n === 0) {
    return (
      <div className="mt-cookwrap">
        <div className="mt-card mt-emptycard"><h3>No method written yet</h3><p>A manager can build the step-by-step guide on this tab.</p></div>
      </div>
    );
  }

  const finish = i >= n;
  const shown = (step?.lines ?? []).filter((l) => Number(l.qty) > 0 && lineById.has(l.recipe_line));
  const total = step ? step.timer_minutes * 60 : 0;
  const timerLabel = running || left ? left : total;

  return (
    <div className="mt-cookwrap">
      <div className="mt-phone">
        <div className="mt-ptop">
          <div className="mt-prow">
            <div className="mt-ptitle">{recipeName}</div>
            <div className="mt-psub">{finish ? "All done" : `Step ${i + 1} of ${n}`}</div>
          </div>
          {readOnly && <div className="mt-cue">View only · managers edit</div>}
          <div className="mt-dots" aria-hidden>
            {steps.map((s, ix) => <i key={s.key} className={ix < i ? "dn" : ix === i ? "on" : ""} />)}
          </div>
          <div className="mt-portions">
            <span className="mt-psub">Portions</span>
            <div className="mt-scale" role="group" aria-label="Scale the amounts">
              {SCALES.map((s) => (
                <button type="button" key={s} className={scale === s ? "on" : ""} onClick={() => setScale(s)} aria-pressed={scale === s}>
                  {s === 0.5 ? "×½" : `×${s}`}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-cbody" ref={bodyRef}>
          {goal && finished?.url ? (
            <>
              <div className="mt-cstep">Target look</div>
              <div className="mt-cphoto tall"><img src={finished.url} alt={`How ${recipeName} should look`} /></div>
              <button type="button" className="mt-btn" onClick={() => setGoal(false)}>Back to the step</button>
            </>
          ) : finish ? (
            <>
              <div className="mt-cstep">Finished</div>
              <div className="mt-ctext">{recipeName} is ready.</div>
              {finished?.url && <div className="mt-cphoto tall"><img src={finished.url} alt={`The finished ${recipeName}`} /></div>}
              <div className="mt-fin">
                <h4>Allergens</h4>
                {contains.length === 0 && mayContain.length === 0 ? <p>None recorded for this recipe.</p> : null}
                {contains.length > 0 && <p><b>Contains:</b> {contains.join(", ")}</p>}
                {mayContain.length > 0 && <p><b>May contain:</b> {mayContain.join(", ")}</p>}
              </div>
            </>
          ) : step ? (
            <>
              <div className="mt-cstep">Step {i + 1}</div>
              {step.text.trim() ? <div className="mt-ctext">{step.text}</div> : <div className="mt-ctext muted">No instructions written for this step.</div>}
              {shown.length > 0 && (
                <div className="mt-cing">
                  {shown.map((l) => {
                    const line = lineById.get(l.recipe_line)!;
                    const key = `${step.key}:${l.recipe_line}`;
                    return (
                      <button type="button" key={key} className={`mt-crow${ticks[key] ? " on" : ""}`} style={cv(colorOf(line.id))} aria-pressed={!!ticks[key]}
                        onClick={() => setTicks((t) => ({ ...t, [key]: !t[key] }))}>
                        <span className="mt-cb" aria-hidden>✓</span>
                        <span className="mt-nm">{line.item_name ?? line.sub_recipe_name}</span>
                        <span className="mt-am">{fmt(Number(l.qty) * scale)} {line.unit}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {step.photos.some((p) => p.url) && (
                <div className="mt-pgal">
                  {step.photos.filter((p) => p.url).map((p, ix, all) => (
                    <div className="mt-cphoto" key={p.id}>
                      <img src={p.url!} alt={`Step ${i + 1}, photo ${ix + 1}`} />
                      {all.length > 1 && <span className="mt-pcount">{ix + 1}/{all.length}</span>}
                    </div>
                  ))}
                </div>
              )}
              {total > 0 && (
                <div className="mt-ctimer">
                  <div><div className="mt-psub">Timer</div><div className="mt-tm" aria-live="off">{mmss(timerLabel)}</div></div>
                  <button type="button" className="mt-btn p" onClick={() => { if (!running && !left) setLeft(total); setRunning(!running); }}>{running ? "Pause" : left && left < total ? "Resume" : "Start"}</button>
                </div>
              )}
              {(step.note.trim() || step.arrow_photo?.url) && (
                <div className="mt-ctip">
                  {step.arrow_photo?.url && <img src={step.arrow_photo.url} alt="" />}
                  <div><b>{i < n - 1 ? `Before step ${i + 2}:` : "Before finishing:"}</b> {step.note}</div>
                </div>
              )}
              {finished?.url && (
                <button type="button" className="mt-goal" onClick={() => setGoal(true)}>
                  <span className="mt-gth"><img src={finished.url} alt="" /></span>
                  <span><b>Target look</b><br /><small>Tap to see how it should look</small></span>
                </button>
              )}
            </>
          ) : null}
        </div>

        <div className="mt-cfoot">
          <button type="button" disabled={i === 0} onClick={() => go(i - 1)}>Back</button>
          <button type="button" className="go" onClick={() => (finish ? (setTicks({}), go(0)) : go(i + 1))}>{finish ? "Start again" : i === n - 1 ? "Finish" : "Next step"}</button>
        </div>
      </div>
    </div>
  );
}
