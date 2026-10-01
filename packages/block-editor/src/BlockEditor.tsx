import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Puck } from "@puckeditor/core";
import "@puckeditor/core/puck.css";
import "@bs/blocks/blocks.css";
import { documentToPuck, puckToDocument, type BlockInstance, type PuckData } from "@bs/blocks";
import { buildPuckConfig, type EditorPageKind } from "./config.tsx";
import { useFontLink } from "./fonts.ts";
import { HostContext, RenderDataContext, type BlockEditorHost, type EditorRenderData } from "./context.tsx";
import { dataSignature } from "./signature.ts";

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
}

const VIEWPORTS = [
  { width: 375, height: 720, label: "Mobile" },
  { width: 768, height: 900, label: "Tablet" },
  { width: 1280, height: 900, label: "Desktop" },
];

const button = { border: "1px solid #ccc", background: "#fff", borderRadius: 6, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" } as const;

export function BlockEditor({ title, initialBlocks: initialFromProps, host, themeVars, onSaveDraft, onPublish, onExit, previewHref, publishLabel, pageKind, fontsHref, onBlocksChange, externalDirty, height, storeName }: BlockEditorProps) {
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
    if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) return;
    onExit();
  };

  return (
    <HostContext.Provider value={host}>
      <RenderDataContext.Provider value={{ ...renderData, storeName }}>
        <div style={{ height: height ?? "100vh" }}>
          <Puck
            config={config}
            data={initialData as never}
            viewports={VIEWPORTS}
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
            overrides={
              {
                headerActions: ({ children }: { children: React.ReactNode }) => (
                  <>
                    {status ? (
                      <span role="status" style={{ fontSize: 12, color: status.kind === "error" ? "#b00020" : "#0b6b42", maxWidth: 360 }}>
                        {status.text}
                      </span>
                    ) : dirty || externalDirty ? (
                      <span style={{ fontSize: 12, color: "#b26a00" }}>Unsaved changes</span>
                    ) : null}
                    <button type="button" style={button} onClick={exit} disabled={busy}>
                      Exit
                    </button>
                    <button type="button" style={button} disabled={busy || !(dirty || externalDirty)} onClick={() => void run(() => onSaveDraft(blocksRef.current), "Draft saved")}>
                      Save draft
                    </button>
                    {previewHref ? (
                      <button
                        type="button"
                        style={button}
                        disabled={busy}
                        onClick={async () => {
                          const ok = !dirty || (await run(() => onSaveDraft(blocksRef.current), "Draft saved"));
                          if (ok) window.open(previewHref, "_blank", "noopener");
                        }}
                      >
                        Preview on store
                      </button>
                    ) : null}
                    {publishLabel ? <span style={{ fontSize: 12, color: "#666" }}>{publishLabel}</span> : null}
                    {children}
                  </>
                ),
              } as never
            }
          />
        </div>
      </RenderDataContext.Provider>
    </HostContext.Provider>
  );
}
