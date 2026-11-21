import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePuck } from "@puckeditor/core";
import type { PuckItem } from "@bs/blocks";
import { ROOT_ZONE } from "./wrap-on-drop.ts";
import { cloneWithNewIds, countNested, getClipboardItem, insertIntoZone, setClipboardItem, subscribeClipboard } from "./section-clipboard.ts";

/**
 * Copy / Paste / Duplicate / Delete for the selected element: buttons next to the "Outline" title and a right-click
 * menu on the Outline rows and on the canvas. They drive Puck's own state and actions, so the canvas, the outline,
 * undo/redo and saving all see the change like any edit. The provider is always mounted inside Puck (so the canvas
 * menu works whichever sidebar tab is open); the Outline override only draws the buttons.
 */

const CSS = `
.bse-outline { position: relative; }
.bse-outline-actions { position: absolute; top: 0; right: 46px; z-index: 2; height: 40px; display: flex; align-items: center; gap: 2px; }
.bse-outline-actions button { width: 28px; height: 28px; padding: 0; border: 0; border-radius: 7px; background: transparent; color: #3f3f46; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.bse-outline-actions button:hover:not(:disabled) { background: #f4f4f5; }
.bse-outline-actions button[data-danger]:hover:not(:disabled) { background: #fee2e2; color: #b91c1c; }
.bse-outline-actions button:disabled { opacity: .35; cursor: not-allowed; }
.bse-outline-actions button:focus-visible { outline: 2px solid #2563eb; outline-offset: 1px; }
.bse-outline-toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 1001; padding: 6px 12px; border-radius: 7px; background: #18181b; color: #fff; font-size: 12px; font-weight: 600; box-shadow: 0 4px 14px rgba(0,0,0,.18); pointer-events: none; }
.bse-confirm-backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(24,24,27,.45); display: flex; align-items: center; justify-content: center; padding: 16px; }
.bse-confirm { width: 100%; max-width: 380px; background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 20px 50px rgba(0,0,0,.25); font-family: inherit; }
.bse-confirm h3 { margin: 0 0 6px; font-size: 15px; font-weight: 700; color: #18181b; }
.bse-confirm p { margin: 0 0 16px; font-size: 13px; line-height: 1.45; color: #52525b; }
.bse-confirm-row { display: flex; justify-content: flex-end; gap: 8px; }
.bse-confirm-row button { height: 32px; padding: 0 14px; border-radius: 7px; border: 1px solid #d4d4d8; background: #fff; color: #18181b; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
.bse-confirm-row button[data-danger] { background: #dc2626; border-color: #dc2626; color: #fff; }
.bse-confirm-row button:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
.bse-ctx { position: fixed; z-index: 1002; padding: 4px; background: #fff; border: 1px solid #e4e4e7; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.18); font-family: inherit; box-sizing: border-box; }
.bse-ctx-title { padding: 6px 10px 4px; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #71717a; }
.bse-ctx button { display: flex; width: 100%; align-items: center; gap: 8px; height: 30px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; color: #18181b; font-size: 13px; font-family: inherit; text-align: left; cursor: pointer; }
.bse-ctx button:hover:not(:disabled), .bse-ctx button:focus-visible { background: #f4f4f5; outline: none; }
.bse-ctx button[data-danger] { color: #b91c1c; }
.bse-ctx button[data-danger]:hover:not(:disabled) { background: #fee2e2; }
.bse-ctx button:disabled { opacity: .4; cursor: not-allowed; }
.bse-ctx hr { margin: 4px 0; border: 0; border-top: 1px solid #e4e4e7; }
`;

const icon = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

const CopyIcon = () => (
  <svg {...icon}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </svg>
);
const PasteIcon = () => (
  <svg {...icon}>
    <rect x="8" y="3" width="8" height="4" rx="1" />
    <path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
  </svg>
);
const DuplicateIcon = () => (
  <svg {...icon}>
    <rect x="8" y="8" width="13" height="13" rx="2" />
    <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
  </svg>
);
const TrashIcon = () => (
  <svg {...icon}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
  </svg>
);

const labelOf = (type: string) => type.replace(/([a-z])([A-Z])/g, "$1 $2");

interface Actions {
  hasSelection: boolean;
  name: string;
  copied: PuckItem | null;
  copy: () => void;
  paste: () => void;
  askDelete: () => void;
}
const ActionsContext = createContext<Actions | null>(null);

/** Outline override: the buttons sit in the header row (positioned by CSS); the logic lives in the provider. */
export function OutlineWithActions({ children }: { children?: ReactNode }) {
  const a = useContext(ActionsContext);
  return (
    <div className="bse-outline">
      {a ? (
        <div className="bse-outline-actions" role="toolbar" aria-label="Outline actions">
          <button type="button" onClick={a.copy} disabled={!a.hasSelection} title={a.hasSelection ? `Copy ${a.name}` : "Select an element to copy"} aria-label="Copy">
            <CopyIcon />
          </button>
          <button type="button" onClick={a.paste} disabled={!a.copied} title={a.copied ? `Paste ${labelOf(a.copied.type)}` : "Nothing copied yet"} aria-label="Paste">
            <PasteIcon />
          </button>
          <button type="button" data-danger="" onClick={a.askDelete} disabled={!a.hasSelection} title={a.hasSelection ? `Delete ${a.name}` : "Select an element to delete"} aria-label="Delete">
            <TrashIcon />
          </button>
        </div>
      ) : null}
      {children}
    </div>
  );
}

const MENU_W = 184;
const MENU_H = 200;

export function SectionActionsProvider({ children }: { children?: ReactNode }) {
  const { appState, selectedItem, dispatch } = usePuck();
  const copied = useSyncExternalStore(subscribeClipboard, getClipboardItem, () => null);
  const [toast, setToast] = useState<{ text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const selector = appState.ui.itemSelector;
  const item = (selectedItem ?? null) as PuckItem | null;
  const hasSelection = Boolean(selector && item);

  const say = (text: string) => setToast({ text });

  const copy = () => {
    if (!item) return;
    setClipboardItem(item);
    say(`${labelOf(item.type)} copied`);
  };

  const paste = () => {
    if (!copied) return;
    const clone = cloneWithNewIds(copied);
    const zone = selector?.zone ?? ROOT_ZONE;
    const index = selector ? selector.index + 1 : appState.data.content.length;
    const content = insertIntoZone(appState.data.content as unknown as PuckItem[], zone, index, clone);
    if (!content) return say("Could not paste here");
    // One setData keeps the whole copy (nested elements and all their settings) as a single undo step.
    dispatch({ type: "setData", data: { content } as never, recordHistory: true });
    dispatch({ type: "setUi", ui: { itemSelector: { index, ...(selector?.zone ? { zone: selector.zone } : {}) } } });
    say(`${labelOf(clone.type)} pasted`);
  };

  const duplicate = () => {
    if (!selector) return;
    dispatch({ type: "duplicate", sourceIndex: selector.index, sourceZone: selector.zone ?? ROOT_ZONE });
    say("Duplicated");
  };

  const remove = () => {
    setConfirming(false);
    if (!selector) return;
    dispatch({ type: "remove", index: selector.index, zone: selector.zone ?? ROOT_ZONE });
    dispatch({ type: "setUi", ui: { itemSelector: null } });
    say("Deleted");
  };

  // Right-click on an Outline row or a canvas element: select it (as a click would), then open the menu at the pointer.
  const open = useCallback((target: EventTarget | null, e: MouseEvent, frame: HTMLIFrameElement | null) => {
    const el = target as Element | null;
    const layer = el?.closest?.("[data-puck-layer-tree-id]");
    const comp = layer ? null : el?.closest?.("[data-puck-component]");
    const row = layer ? (layer.querySelector('[class*="Layer-clickable"]') as HTMLElement | null) : (comp as HTMLElement | null);
    if (!row) return;
    e.preventDefault();
    row.click();
    let x = e.clientX;
    let y = e.clientY;
    if (frame) {
      // The canvas iframe is scaled to fit; map its pointer position back to the page.
      const r = frame.getBoundingClientRect();
      const scale = frame.offsetWidth ? r.width / frame.offsetWidth : 1;
      x = r.left + e.clientX * scale;
      y = r.top + e.clientY * scale;
    }
    setMenu({ x: Math.max(4, Math.min(x, window.innerWidth - MENU_W - 4)), y: Math.max(4, Math.min(y, window.innerHeight - MENU_H - 4)) });
  }, []);

  useEffect(() => {
    const onMain = (e: MouseEvent) => open(e.target, e, null);
    const closeMain = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest?.(".bse-ctx")) setMenu(null);
    };
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    let attached: Document | null = null;
    let frameEl: HTMLIFrameElement | null = null;
    const onFrame = (e: MouseEvent) => open(e.target, e, frameEl);
    const detach = () => {
      attached?.removeEventListener("contextmenu", onFrame);
      attached?.removeEventListener("mousedown", close);
      attached?.removeEventListener("keydown", onKey);
    };
    const attach = () => {
      const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
      const doc = f?.contentDocument ?? null;
      if (!f || !doc || doc === attached) return;
      detach();
      attached = doc;
      frameEl = f;
      doc.addEventListener("contextmenu", onFrame);
      doc.addEventListener("mousedown", close);
      doc.addEventListener("keydown", onKey);
    };
    attach();
    const poll = setInterval(attach, 600);
    document.addEventListener("contextmenu", onMain);
    document.addEventListener("mousedown", closeMain);
    document.addEventListener("keydown", onKey);
    return () => {
      clearInterval(poll);
      detach();
      document.removeEventListener("contextmenu", onMain);
      document.removeEventListener("mousedown", closeMain);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const nested = item ? countNested(item) : 0;
  const name = item ? labelOf(item.type) : "element";
  const actions: Actions = { hasSelection, name, copied, copy, paste, askDelete: () => setConfirming(true) };
  const run = (fn: () => void) => () => {
    setMenu(null);
    fn();
  };

  return (
    <ActionsContext.Provider value={actions}>
      <style>{CSS}</style>
      {children}
      {menu ? (
        <div className="bse-ctx" role="menu" aria-label={`${name} actions`} style={{ left: menu.x, top: menu.y, width: MENU_W }}>
          <div className="bse-ctx-title">{name}</div>
          <button type="button" role="menuitem" onClick={run(copy)} disabled={!hasSelection}>
            <CopyIcon /> Copy
          </button>
          <button type="button" role="menuitem" onClick={run(paste)} disabled={!copied}>
            <PasteIcon /> Paste{copied ? ` ${labelOf(copied.type)}` : ""}
          </button>
          <button type="button" role="menuitem" onClick={run(duplicate)} disabled={!hasSelection}>
            <DuplicateIcon /> Duplicate
          </button>
          <hr />
          <button type="button" role="menuitem" data-danger="" onClick={run(() => setConfirming(true))} disabled={!hasSelection}>
            <TrashIcon /> Delete
          </button>
        </div>
      ) : null}
      {toast ? (
        <div className="bse-outline-toast" role="status">
          {toast.text}
        </div>
      ) : null}
      {confirming ? (
        <div className="bse-confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setConfirming(false)} onKeyDown={(e) => e.key === "Escape" && setConfirming(false)}>
          <div className="bse-confirm" role="alertdialog" aria-modal="true" aria-labelledby="bse-confirm-title">
            <h3 id="bse-confirm-title">Delete {name}?</h3>
            <p>
              {nested > 0 ? `This removes the ${name} and the ${nested} element${nested === 1 ? "" : "s"} inside it. ` : `This removes the ${name}. `}
              You can undo it until you leave the editor.
            </p>
            <div className="bse-confirm-row">
              <button type="button" autoFocus onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button type="button" data-danger="" onClick={remove}>
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ActionsContext.Provider>
  );
}
