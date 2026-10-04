import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { usePuck } from "@puckeditor/core";
import { Dropdown, type DropdownOption } from "./Dropdown.tsx";
import { COMPACT_CSS } from "./compact.ts";

/**
 * The editor's top bar, replacing Puck's own header so everything lives in one row:
 *   [< Back] | [sidebar toggles] [page switcher]  ......  [status] [undo redo] [Save draft] [Publish]
 * Puck still owns the document and history; this bar only reads them through usePuck. The values that
 * change while editing arrive through context so the component keeps one identity (Puck remounts a header
 * whose function identity changes, which would close open menus on every keystroke).
 */

export interface EditorHeaderState {
  backLabel: string;
  onBack: () => void;
  /** Switches between the pages of the host (a theme's home, collection, product... pages). */
  pages?: { value: string; options: DropdownOption[]; onChange: (value: string) => void } | undefined;
  title: string;
  busy: boolean;
  /** Something is unsaved (the canvas, or work elsewhere in the host). */
  dirty: boolean;
  status: { kind: "ok" | "error"; text: string } | null;
  note?: string | undefined;
  onSaveDraft: () => void;
  onPublish: () => void;
  onPreview?: (() => void) | undefined;
}

export const EditorHeaderContext = createContext<EditorHeaderState | null>(null);

// Narrow screens: the back link and buttons collapse to icons, the status line and undo/redo give way first.
const CSS = `
/* Puck's grid cell for the header would grow to the toolbar's content width; let it shrink to the screen. */
[class*="PuckLayout-header"] { min-width: 0; max-width: 100vw; overflow: hidden; }
.bse-header { display: flex; align-items: center; gap: 6px; height: 44px; padding: 0 10px; background: #fff; border-bottom: 1px solid #e4e4e7; box-sizing: border-box; min-width: 0; width: 100%; }
.bse-header * { box-sizing: border-box; }
.bse-group { display: flex; align-items: center; gap: 6px; min-width: 0; }
.bse-sep { width: 1px; height: 20px; background: #e4e4e7; flex: none; }
.bse-spacer { flex: 1 1 auto; min-width: 0; }
.bse-btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 28px; padding: 0 10px; border: 1px solid #d4d4d8; border-radius: 7px; background: #fff; color: #18181b; font-size: 12px; font-weight: 600; line-height: 1; font-family: inherit; cursor: pointer; white-space: nowrap; }
.bse-btn:hover:not(:disabled) { background: #f4f4f5; }
.bse-btn:disabled { opacity: .5; cursor: not-allowed; }
.bse-btn--primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.bse-btn--primary:hover:not(:disabled) { background: #1d4ed8; }
.bse-icon { width: 28px; height: 28px; padding: 0; border: 0; border-radius: 7px; background: transparent; color: #3f3f46; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex: none; }
.bse-icon:hover:not(:disabled) { background: #f4f4f5; }
.bse-icon:disabled { opacity: .35; cursor: not-allowed; }
.bse-back { gap: 4px; padding: 0 10px 0 6px; border-color: transparent; background: #f4f4f5; }
.bse-pages { width: 170px; min-width: 120px; flex: 0 1 170px; }
.bse-status { font-size: 11px; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bse-focus:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
@media (max-width: 1100px) { .bse-status { display: none; } }

/*
 * The preview controls (Desktop / Tablet / Mobile, zoom) move up into the middle of this toolbar on wide
 * screens, which frees their row above the canvas. They stay where Puck puts them on narrower screens,
 * where the middle of the toolbar is needed by the other controls.
 */
@media (min-width: 1180px) {
  [class*="PuckCanvas_"]:not([class*="PuckCanvas--fullScreen"]) [class*="PuckCanvas-controls"] { position: fixed; top: 0; left: 50%; transform: translateX(-50%); z-index: 30; height: 44px; display: flex; align-items: center; padding: 0; width: auto; }
  [class*="PuckCanvas-controls"] [class*="ViewportControls_"] { display: flex; align-items: center; }
  [class*="PuckCanvas-controls"] [class*="ViewportControls-actionsInner"] { align-items: center; gap: 2px; }
  [class*="PuckCanvas-controls"] button { font-size: 12px; }
  [class*="PuckCanvas-controls"] svg { width: 15px; height: 15px; }
  [class*="PuckCanvas-controls"] select { font-size: 12px; }
}
@media (max-width: 900px) { .bse-btn .bse-label { display: none; } .bse-btn { padding: 0 9px; } .bse-back { padding: 0 8px 0 4px; } }
@media (max-width: 720px) { .bse-history { display: none; } .bse-pages { width: 140px; flex-basis: 140px; } .bse-header { padding: 0 8px; } }
/* The sidebar toggles stay: on a phone they are how the sidebars are opened. */
@media (max-width: 560px) { .bse-sep { display: none; } .bse-pages { width: 120px; flex-basis: 120px; } }
`;

const icon = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

const Svg = ({ children }: { children: ReactNode }) => <svg {...icon}>{children}</svg>;

export function EditorHeader() {
  const state = useContext(EditorHeaderContext);
  const { appState, dispatch, history } = usePuck();
  if (!state) return <></>;

  const ui = appState.ui;
  const toggle = (side: "left" | "right") => {
    const key = side === "left" ? "leftSideBarVisible" : "rightSideBarVisible";
    const other = side === "left" ? "rightSideBarVisible" : "leftSideBarVisible";
    const narrow = typeof window !== "undefined" && !window.matchMedia("(min-width: 638px)").matches;
    dispatch({ type: "setUi", ui: { [key]: !ui[key], ...(narrow ? { [other]: false } : {}) } });
  };

  const statusColor = state.status?.kind === "error" ? "#b00020" : state.status ? "#0b6b42" : state.dirty ? "#b26a00" : "#71717a";
  const statusText = state.status?.text ?? (state.dirty ? "Unsaved changes" : (state.note ?? ""));

  return (
    <>
      <style>{CSS + COMPACT_CSS}</style>
      <header className="bse-header" aria-label="Editor toolbar">
        <div className="bse-group">
          <button type="button" className="bse-btn bse-back bse-focus" onClick={state.onBack} disabled={state.busy} title={state.backLabel} aria-label={state.backLabel}>
            <Svg>
              <path d="M15 18l-6-6 6-6" />
            </Svg>
            <span className="bse-label">{state.backLabel}</span>
          </button>
        </div>
        <span className="bse-sep" aria-hidden="true" />
        <div className="bse-group bse-sidebars">
          <button type="button" className="bse-icon bse-focus" onClick={() => toggle("left")} aria-pressed={ui.leftSideBarVisible} title="Toggle left sidebar" aria-label="Toggle left sidebar">
            <Svg>
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16" />
            </Svg>
          </button>
          <button type="button" className="bse-icon bse-focus" onClick={() => toggle("right")} aria-pressed={ui.rightSideBarVisible} title="Toggle right sidebar" aria-label="Toggle right sidebar">
            <Svg>
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M15 4v16" />
            </Svg>
          </button>
        </div>
        {state.pages ? (
          <div className="bse-pages">
            <Dropdown compact ariaLabel="Page" value={state.pages.value} options={state.pages.options} onChange={state.pages.onChange} />
          </div>
        ) : (
          <strong style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{state.title}</strong>
        )}

        <div className="bse-spacer" />

        <span role="status" className="bse-status" style={{ color: statusColor } as CSSProperties}>
          {statusText}
        </span>
        <div className="bse-group bse-history">
          <button type="button" className="bse-icon bse-focus" onClick={() => history.back()} disabled={!history.hasPast} title="Undo" aria-label="Undo">
            <Svg>
              <path d="M9 14L4 9l5-5" />
              <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
            </Svg>
          </button>
          <button type="button" className="bse-icon bse-focus" onClick={() => history.forward()} disabled={!history.hasFuture} title="Redo" aria-label="Redo">
            <Svg>
              <path d="M15 14l5-5-5-5" />
              <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
            </Svg>
          </button>
        </div>
        <span className="bse-sep" aria-hidden="true" />
        <div className="bse-group">
          {state.onPreview ? (
            <button type="button" className="bse-btn bse-focus" onClick={state.onPreview} disabled={state.busy} title="Preview on store" aria-label="Preview on store">
              <Svg>
                <path d="M14 3h7v7M10 14L21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
              </Svg>
              <span className="bse-label">Preview</span>
            </button>
          ) : null}
          <button type="button" className="bse-btn bse-focus" onClick={state.onSaveDraft} disabled={state.busy || !state.dirty} title="Save draft" aria-label="Save draft">
            <Svg>
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <path d="M17 21v-8H7v8M7 3v5h8" />
            </Svg>
            <span className="bse-label">Save draft</span>
          </button>
          <button type="button" className="bse-btn bse-btn--primary bse-focus" onClick={state.onPublish} disabled={state.busy} title="Publish" aria-label="Publish">
            <Svg>
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
            </Svg>
            <span className="bse-label">Publish</span>
          </button>
        </div>
      </header>
    </>
  );
}
