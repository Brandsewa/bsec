import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Heading2, Heading3, Italic, Link as LinkIcon, List, ListOrdered, Minus, Redo2, Undo2 } from "lucide-react";
import { Button, Input, cn } from "@bs/ui";
import type { PolicyBlock } from "@bs/contracts";
import { docToPolicyBlocks, normalizePolicyHref, policyBlocksToDoc, type RichNode } from "../lib/policy-rich-text.ts";

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("size-8 p-0", active && "bg-muted text-foreground")}
      aria-label={label}
      aria-pressed={active ?? false}
      title={label}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  const openLink = () => {
    setHref((editor.getAttributes("link")["href"] as string | undefined) ?? "");
    setLinkError(null);
    setLinkOpen(true);
  };
  const applyLink = () => {
    if (!href.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setLinkOpen(false);
      return;
    }
    const safe = normalizePolicyHref(href);
    if (!safe) {
      setLinkError("Use an https:// web address, a mailto: address or a tel: number.");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: safe }).run();
    setLinkOpen(false);
  };

  return (
    <div className="border-b border-border">
      <div className="flex flex-wrap items-center gap-0.5 p-1.5" role="toolbar" aria-label="Formatting">
        <ToolButton label="Heading" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Subheading" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          <Heading3 className="size-4" aria-hidden />
        </ToolButton>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <ToolButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Link" active={editor.isActive("link")} onClick={openLink}>
          <LinkIcon className="size-4" aria-hidden />
        </ToolButton>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <ToolButton label="Bulleted list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Divider" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          <Minus className="size-4" aria-hidden />
        </ToolButton>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <ToolButton label="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 className="size-4" aria-hidden />
        </ToolButton>
      </div>
      {linkOpen && (
        <div className="grid gap-1 bg-muted/30 p-2">
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={href}
              onChange={(e) => {
                setHref(e.target.value);
                setLinkError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyLink();
                }
                if (e.key === "Escape") setLinkOpen(false);
              }}
              placeholder="https://example.com"
              aria-label="Link address"
              aria-invalid={linkError ? true : undefined}
              className="h-8 text-sm"
            />
            <Button type="button" size="sm" onClick={applyLink}>
              {href.trim() ? "Apply" : "Remove link"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setLinkOpen(false)}>
              Cancel
            </Button>
          </div>
          {linkError ? <p className="text-xs text-destructive">{linkError}</p> : null}
        </div>
      )}
    </div>
  );
}

export interface PolicyRichEditorProps {
  /** The stored blocks to start from. The editor owns the content afterwards; change `resetKey` to load different blocks. */
  initialBlocks: readonly PolicyBlock[];
  resetKey: string | number;
  onChange: (blocks: PolicyBlock[]) => void;
  disabled?: boolean;
}

/**
 * One rich text editor per policy (owner request 2026-10-17). It reads and writes the same validated block format
 * as before (ADR-010), so versions, preview, publish and the storefront are unchanged and no raw HTML is stored.
 */
export default function PolicyRichEditor({ initialBlocks, resetKey, onChange, disabled = false }: PolicyRichEditorProps) {
  const changeRef = useRef(onChange);
  useEffect(() => {
    changeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        blockquote: false,
        codeBlock: false,
        code: false,
        strike: false,
        underline: false,
        link: { openOnClick: false, autolink: false },
      }),
      Placeholder.configure({ placeholder: "Write your policy here..." }),
    ],
    content: policyBlocksToDoc(initialBlocks),
    onUpdate: ({ editor: e }) => changeRef.current(docToPolicyBlocks(e.getJSON() as RichNode)),
    editorProps: { attributes: { class: "focus:outline-none", "aria-label": "Policy content" } },
  });

  const loaded = useRef(resetKey);
  useEffect(() => {
    if (!editor || loaded.current === resetKey) return;
    loaded.current = resetKey;
    editor.commands.setContent(policyBlocksToDoc(initialBlocks), { emitUpdate: false });
  }, [editor, resetKey, initialBlocks]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  if (!editor) return <div className="min-h-[360px] animate-pulse rounded-lg bg-muted/40" aria-hidden />;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <Toolbar editor={editor} />
      <div
        className={cn(
          "max-h-[70vh] min-h-[360px] overflow-y-auto px-4 py-3 text-[15px] leading-7",
          "[&_.ProseMirror]:min-h-[330px]",
          "[&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-5 [&_h3]:text-lg [&_h3]:font-semibold",
          "[&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6",
          "[&_a]:text-primary [&_a]:underline [&_hr]:my-6 [&_hr]:border-border",
          "[&_p.is-editor-empty:first-child::before]:pointer-events-none [&_p.is-editor-empty:first-child::before]:float-left [&_p.is-editor-empty:first-child::before]:h-0 [&_p.is-editor-empty:first-child::before]:text-muted-foreground [&_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
        )}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
