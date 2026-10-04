import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Puck, blocksPlugin, outlinePlugin } from "@puckeditor/core";
import "@puckeditor/core/puck.css";
import "@bs/blocks/blocks.css";
import { documentToPuck, puckToDocument, type BlockInstance, type PuckData } from "@bs/blocks";
import { buildPuckConfig, type EditorPageKind } from "./config.tsx";
import { useFontLink } from "./fonts.ts";
import { HostContext, RenderDataContext, type BlockEditorHost, type EditorRenderData } from "./context.tsx";
import { dataSignature } from "./signature.ts";
import { ThemeSettingsPanel, type ThemeTokens } from "./ThemeSettings.tsx";
import { EDITOR_VIEWPORTS } from "./viewports.ts";
import { EditorHeader, EditorHeaderContext, type EditorHeaderState } from "./EditorHeader.tsx";

export interface BlockEditorProps {
  title: string;
  initialBlocks: BlockInstance[];
  host: BlockEditorHost;
  /** --bs-* CSS variables of the store's theme, so the canvas matches the storefront. */
  themeVars?: Record<string, string> | undefined;
  onSaveDraft: (blocks: BlockInstance[]) => Promise<void>;
  onPublish: (blocks: BlockInstance[]) => Promise<void>;
  onExit: () => void;
  /** Storefront URL that shows the saved draft (opened after saving). */
  previewHref?: string | undefined;
  /**
   * Preview in another browser tab through a link the host creates (for example a temporary share link). The
   * editor saves the draft first, opens the tab straight away (so pop-up blockers allow it), then sends the tab to
   * the returned URL. Takes precedence over previewHref.
   */
  onPreview?: (() => Promise<string | undefined>) | undefined;
  publishLabel?: string | undefined;
  /** Limits the block picker to what suits this page (header, footer, product, ...). */
  pageKind?: EditorPageKind | undefined;
  /** Google Fonts stylesheet for the theme's fonts, so the canvas shows the real typefaces. */
  fontsHref?: string | null | undefined;
  /** Called with the latest blocks on every edit, so a host with several pages can keep them all. */
  onBlocksChange?: ((blocks: BlockInstance[]) => void) | undefined;
  /** The host has unsaved work outside this canvas (other pages); keeps Save draft enabled. */
  externalDirty?: boolean | undefined;
  /** Shown in the header and footer blocks on the canvas. */
  storeName?: string | undefined;
  /** CSS height of the editor (default the full viewport). */
  height?: string | undefined;
  /**
   * Global theme settings. When given, the sidebar gets a "Theme settings" tab (colours, fonts, corners, buttons)
   * that edits the theme's tokens from any page; the host owns the tokens and recomputes themeVars/fontsHref.
   */
  themeTokens?: ThemeTokens | undefined;
  onThemeTokensChange?: ((tokens: ThemeTokens) => void) | undefined;
  /** Read-only theme tab (the user may not change the theme), with an optional line explaining when changes apply. */
  themeSettingsDisabled?: boolean | undefined;
  themeSettingsNote?: string | undefined;
  /** Label of the back/exit button in the toolbar (default "Exit"). */
  exitLabel?: string | undefined;
  /** A page switcher in the toolbar for hosts that edit several pages in one workspace. */
  pages?: { value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void } | undefined;
}

/**
 * Preview widths, listed largest first (Desktop, Tablet, Mobile) with matching icons. They sit on the
 * common device breakpoints and on the correct side of the stylesheet's own (blocks.css and the theme's
 * heading sizes: tablet from 768px, desktop from 1024px), so each preview applies the rules a real
 * device of that class would: 1280px laptop/desktop, 768px portrait tablet, 375px phone.
 */
const VIEWPORTS = EDITOR_VIEWPORTS.map(({ width, height, label, icon }) => ({ width, height, label, icon }));
const DEFAULT_VIEWPORT = { width: EDITOR_VIEWPORTS[0].width, height: EDITOR_VIEWPORTS[0].height };

interface ThemePanelState {
  tokens: ThemeTokens;
  onChange: (tokens: ThemeTokens) => void;
  disabled?: boolean | undefined;
  note?: string | undefined;
}
const ThemePanelContext = createContext<ThemePanelState | null>(null);

/**
 * The plugin's render function must keep the same identity between edits: Puck treats a new function as a new
 * component and remounts it, which reset the panel (its open section) on every change. The live values travel
 * through context instead.
 */
function ThemePanelFromContext() {
  const state = useContext(ThemePanelContext);
  return state ? <ThemeSettingsPanel tokens={state.tokens} onChange={state.onChange} disabled={state.disabled} note={state.note} /> : <></>;
}

function ThemeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="13.5" cy="6.5" r="1.5" />
      <circle cx="17.5" cy="10.5" r="1.5" />
      <circle cx="8.5" cy="7.5" r="1.5" />
      <circle cx="6.5" cy="12.5" r="1.5" />
      <path d="M12 22a10 10 0 1 1 10-10c0 2.5-2 3.5-4 3.5h-2a2 2 0 0 0-1.5 3.3A2 2 0 0 1 12 22z" />
    </svg>
  );
}


export function BlockEditor({ title, initialBlocks: initialFromProps, host, themeVars, onSaveDraft, onPublish, onExit, previewHref, onPreview, publishLabel, pageKind, fontsHref, onBlocksChange, externalDirty, height, storeName, themeTokens, onThemeTokensChange, themeSettingsDisabled, themeSettingsNote, exitLabel, pages }: BlockEditorProps) {
  useFontLink(fontsHref);
  // The canvas owns the document once mounted: a refetch after saving must not reset it.
  const [initialBlocks] = useState(initialFromProps);
  const blocksRef = useRef<BlockInstance[]>(initialBlocks);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [renderData, setRenderData] = useState<EditorRenderData>({ data: {}, media: {} });
  const [sig, setSig] = useState(() => dataSignature(initialBlocks));

  const config = useMemo(() => buildPuckConfig({ themeVars: themeVars ?? {}, ...(pageKind ? { pageKind } : {}) }), [themeVars, pageKind]);
  // The theme tab is a Puck sidebar plugin in the same rail as Blocks and Outline, listed first (on top).
  const themeEnabled = Boolean(themeTokens && onThemeTokensChange);
  const plugins = useMemo(
    () =>
      themeEnabled
        ? [
            {
              name: "theme-settings",
              label: "Theme",
              icon: <ThemeIcon />,
              render: ThemePanelFromContext,
            },
            blocksPlugin(),
            outlinePlugin(),
          ]
        : undefined,
    [themeEnabled],
  );
  const themePanel = useMemo<ThemePanelState | null>(
    () => (themeTokens && onThemeTokensChange ? { tokens: themeTokens, onChange: onThemeTokensChange, disabled: themeSettingsDisabled, note: themeSettingsNote } : null),
    [themeTokens, onThemeTokensChange, themeSettingsDisabled, themeSettingsNote],
  );
  const initialData = useMemo(() => documentToPuck({ version: 1, blocks: initialBlocks }), [initialBlocks]);

  // Refresh store data (products, images) only when what the widgets show actually changes.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      host
        .loadRenderData(blocksRef.current)
        .then((r) => {
          if (!cancelled) setRenderData(r as EditorRenderData);
        })
        .catch(() => {
          /* the canvas just keeps its previous data */
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sig, host]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const run = useCallback(async (fn: () => Promise<void>, okText: string) => {
    setBusy(true);
    setStatus(null);
    try {
      await fn();
      setDirty(false);
      setStatus({ kind: "ok", text: okText });
      return true;
    } catch (e) {
      setStatus({ kind: "error", text: e instanceof Error ? e.message : "Something went wrong" });
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const exit = () => {
    if ((dirty || externalDirty) && !window.confirm("You have unsaved changes. Leave without saving?")) return;
    onExit();
  };

  const save = useCallback(() => void run(() => onSaveDraft(blocksRef.current), "Draft saved"), [run, onSaveDraft]);
  const publish = useCallback(() => void run(() => onPublish(blocksRef.current), "Published"), [run, onPublish]);
  const preview = useCallback(async () => {
    if (onPreview) {
      const win = window.open("", "_blank");
      if (win) win.opener = null;
      const needsSave = dirty || Boolean(externalDirty);
      const saved = !needsSave || (await run(() => onSaveDraft(blocksRef.current), "Draft saved"));
      if (!saved) {
        win?.close();
        return;
      }
      try {
        const url = await onPreview();
        if (url && win) {
          win.location.href = url;
          setStatus({ kind: "ok", text: "Preview opened in a new tab" });
        } else {
          win?.close();
        }
      } catch (e) {
        win?.close();
        setStatus({ kind: "error", text: e instanceof Error ? e.message : "Could not create the preview" });
      }
      return;
    }
    const ok = !dirty || (await run(() => onSaveDraft(blocksRef.current), "Draft saved"));
    if (ok && previewHref) window.open(previewHref, "_blank", "noopener");
  }, [dirty, externalDirty, run, onSaveDraft, onPreview, previewHref]);
  const headerState: EditorHeaderState = {
    backLabel: exitLabel ?? "Exit",
    onBack: exit,
    pages,
    title,
    busy,
    dirty: dirty || Boolean(externalDirty),
    status,
    note: publishLabel,
    onSaveDraft: save,
    onPublish: publish,
    onPreview: previewHref || onPreview ? () => void preview() : undefined,
  };

  return (
    <HostContext.Provider value={host}>
      <ThemePanelContext.Provider value={themePanel}>
      <EditorHeaderContext.Provider value={headerState}>
      <RenderDataContext.Provider value={{ ...renderData, storeName }}>
        <div style={{ height: height ?? "100vh" }}>
          <Puck
            config={config}
            data={initialData as never}
            viewports={[...VIEWPORTS]}
            ui={{
              // Open on the Desktop preview, scaled to fit the editor, rather than at whatever width the pane happens to be.
              viewports: { current: DEFAULT_VIEWPORT, controlsVisible: true, options: [...VIEWPORTS] },
              ...(plugins ? { plugin: { current: "blocks" } } : {}),
            }}
            {...(plugins ? { plugins } : {})}
            headerTitle={title}
            onChange={(d) => {
              const blocks = puckToDocument(d as unknown as PuckData).blocks;
              blocksRef.current = blocks;
              onBlocksChange?.(blocks);
              setDirty(true);
              setSig(dataSignature(blocks));
            }}
            onPublish={() => {
              void run(() => onPublish(blocksRef.current), "Published");
            }}
            overrides={{ header: EditorHeader } as never}
          />
        </div>
      </RenderDataContext.Provider>
      </EditorHeaderContext.Provider>
      </ThemePanelContext.Provider>
    </HostContext.Provider>
  );
}
