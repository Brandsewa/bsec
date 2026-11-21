import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePuck } from "@puckeditor/core";
import type { PuckItem } from "@bs/blocks";
import { ROOT_ZONE } from "./wrap-on-drop.ts";
import { cloneWithNewIds, countNested, findById, getClipboard, insertIntoZone, setClipboard, subscribeClipboard, topLevelInsertIndex, type Clip } from "./section-clipboard.ts";

/**
 * Copy / Copy all / Paste / Duplicate / Delete for the page builder: buttons next to the "Outline" title, a Copy button on
 * every Outline row, and a right-click menu on the Outline rows and on the canvas. They drive Puck's own state and actions,
 * so the canvas, the outline, undo/redo and saving all see the change like any edit. The provider is always mounted
 * inside Puck (so the canvas menu works whichever sidebar tab is open); the Outline override only draws the buttons.
 */

const CSS = `
.bse-outline { position: relative; }
.bse-outline-actions { position: absolute; top: 0; right: 46px; z-index: 2; height: 40px; display: flex; align-items: center; gap: 2px; }
.bse-outline-actions button { width: 28px; height: 28px; padding: 0; border: 0; border-radius: 7px; background: transparent; color: #3f3f46; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.bse-outline-actions button:hover:not(:disabled) { background: #f4f4f5; }
.bse-outline-actions button[data-danger]:hover:not(:disabled) { background: #fee2e2; color: #b91c1c; }
.bse-outline-actions button:disabled { opacity: .35; cursor: not-allowed; }
.bse-outline-actions button:focus-visible { outline: 2px solid #2563eb; outline-offset: 1px; }
[class*="Layer-content"] > [class*="LayerActions"] { order: 2; }
.bse-row-copy { order: 1; flex: none; align-self: center; width: 22px; height: 22px; margin-inline-end: 2px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: inherit; display: none; align-items: center; justify-content: center; cursor: pointer; }
[class*="Layer-inner"]:hover .bse-row-copy { display: inline-flex; }
.bse-row-copy:hover { background: rgba(0,0,0,.07); }
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

// Copy (one element) is a clipboard with an arrow out, Copy all is a stack of layers and Paste a clipboard with an arrow
// in: all three are deliberately unlike Puck's own Duplicate icon (two overlapping squares).
const COPY_PATHS = '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><path d="M16 4h2a2 2 0 0 1 2 2v2M21 14H11"/><path d="m15 10-4 4 4 4"/>';
const ROW_COPY_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${COPY_PATHS}</svg>`;

const CopyIcon = () => (
  <svg {...icon}>
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    <path d="M16 4h2a2 2 0 0 1 2 2v2M21 14H11" />
    <path d="m15 10-4 4 4 4" />
  </svg>
);
const CopyAllIcon = () => (
  <svg {...icon}>
    <path d="m12 2 9 5-9 5-9-5 9-5Z" />
    <path d="m3 12 9 5 9-5" />
    <path d="m3 17 9 5 9-5" />
  </svg>
);
const PasteIcon = () => (
  <svg {...icon}>
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
    <path d="M12 11v6M9 14l3 3 3-3" />
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
const plural = (n: number) => `${n} section${n === 1 ? "" : "s"}`;
const describe = (c: Clip) => (c.kind === "page" ? plural(c.items.length) : labelOf(c.items[0]?.type ?? "element"));

interface Actions {
  hasSelection: boolean;
  name: string;
  copied: Clip | null;
  sectionCount: number;
  copy: () => void;
  copyAll: () => void;
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
          <button type="button" onClick={a.copyAll} disabled={a.sectionCount === 0} title={a.sectionCount === 0 ? "This page has no sections" : `Copy all ${plural(a.sectionCount)} on this page`} aria-label="Copy all sections">
            <CopyAllIcon />
          </button>
          <button type="button" onClick={a.paste} disabled={!a.copied} title={a.copied ? `Paste ${describe(a.copied)}` : "Nothing copied yet"} aria-label="Paste">
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
  const copied = useSyncExternalStore(subscribeClipboard, getClipboard, () => null);
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
  const pageContent = appState.data.content as unknown as PuckItem[];

  // The row Copy buttons (added to the DOM below) read the latest page through a ref, so their listeners never go stale.
  const contentRef = useRef(pageContent);
  useEffect(() => {
    contentRef.current = pageContent;
  });

  const say = (text: string) => setToast({ text });

  const copy = () => {
    if (!item) return;
    setClipboard({ kind: "item", items: [item] });
    say(`${labelOf(item.type)} copied`);
  };

  const copyAll = () => {
    if (pageContent.length === 0) return;
    setClipboard({ kind: "page", items: pageContent });
    say(`${plural(pageContent.length)} copied`);
  };

  const paste = () => {
    if (!copied) return;
    const clones = copied.items.map((it) => cloneWithNewIds(it));
    let content: PuckItem[] | null;
    let index: number;
    let zone: string | undefined;
    if (copied.kind === "page") {
      // A whole page of sections goes in at the top level of this page (which may be another page than it came from).
      index = topLevelInsertIndex(pageContent, selector ? { zone: selector.zone ?? ROOT_ZONE, index: selector.index } : null);
      content = pageContent.slice();
      content.splice(index, 0, ...clones);
    } else {
      zone = selector?.zone;
      index = selector ? selector.index + 1 : pageContent.length;
      content = clones[0] ? insertIntoZone(pageContent, zone ?? ROOT_ZONE, index, clones[0]) : null;
    }
    if (!content) return say("Could not paste here");
    // One setData keeps the whole copy (nested elements and all their settings) as a single undo step.
    dispatch({ type: "setData", data: { content } as never, recordHistory: true });
    dispatch({ type: "setUi", ui: { itemSelector: { index, ...(zone ? { zone } : {}) } } });
    say(copied.kind === "page" ? `${plural(clones.length)} pasted` : `${labelOf((clones[0]?.type ?? "element"))} pasted`);
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

  // A Copy button on every Outline row, just before Puck's own Duplicate and Delete. Those are not overridable, so this
  // button is added to the row's DOM and follows the same reveal (row hovered). It copies that row's element
  // with everything inside it.
  useEffect(() => {
    const made = new Set<HTMLButtonElement>();
    const decorate = () => {
      document.querySelectorAll<HTMLElement>('[class*="Layer-content"]:not([data-bse-copy])').forEach((row) => {
        const id = row.closest("[data-puck-layer-tree-id]")?.getAttribute("data-puck-layer-tree-id");
        if (!id) return;
        row.setAttribute("data-bse-copy", "");
        const b = document.createElement("button");
        b.type = "button";
        b.className = "bse-row-copy";
        b.title = "Copy this section";
        b.setAttribute("aria-label", "Copy this section");
        b.innerHTML = ROW_COPY_SVG;
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          const it = findById(contentRef.current, id);
          if (!it) return;
          setClipboard({ kind: "item", items: [it] });
          setToast({ text: `${labelOf(it.type)} copied` });
        });
        row.appendChild(b);
        made.add(b);
      });
    };
    decorate();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const mo = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(decorate, 30);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      clearTimeout(timer);
      made.forEach((b) => {
        b.parentElement?.removeAttribute("data-bse-copy");
        b.remove();
      });
    };
  }, []);

  const nested = item ? countNested(item) : 0;
  const name = item ? labelOf(item.type) : "element";
  const actions: Actions = { hasSelection, name, copied, sectionCount: pageContent.length, copy, copyAll, paste, askDelete: () => setConfirming(true) };
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
            <PasteIcon /> Paste{copied ? ` ${describe(copied)}` : ""}
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
