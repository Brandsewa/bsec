import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, Link as LinkIcon, List, ListOrdered, Redo2, Undo2 } from "lucide-react";
import { Button, Input, cn } from "@bs/ui";

function ToolButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
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
  const applyLink = () => {
    const url = href.trim();
    if (!url) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: /^(https?:|mailto:|tel:)/i.test(url) ? url : `https://${url}` }).run();
    setLinkOpen(false);
  };
  return (
    <div className="border-b border-border">
      <div className="flex flex-wrap items-center gap-0.5 p-1" role="toolbar" aria-label="Formatting">
        <ToolButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton
          label="Link"
          active={editor.isActive("link")}
          onClick={() => {
            setHref((editor.getAttributes("link")["href"] as string | undefined) ?? "");
            setLinkOpen(true);
          }}
        >
          <LinkIcon className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Bulleted list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 className="size-4" aria-hidden />
        </ToolButton>
      </div>
      {linkOpen ? (
        <div className="flex items-center gap-2 bg-muted/30 p-2">
          <Input
            autoFocus
            value={href}
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
              if (e.key === "Escape") setLinkOpen(false);
            }}
            placeholder="https://example.com"
            aria-label="Link address"
            className="h-8 text-sm"
          />
          <Button type="button" size="sm" onClick={applyLink}>
            {href.trim() ? "Apply" : "Remove link"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setLinkOpen(false)}>
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A small rich text editor for custom field values: bold, italic, links and lists. It produces HTML that the server
 * cleans again on save, so what is stored is never trusted from the browser.
 */
export default function RichFieldEditor({ value, onChange, label, disabled = false }: { value: string; onChange: (html: string) => void; label: string; disabled?: boolean }) {
  const changeRef = useRef(onChange);
  useEffect(() => {
    changeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [StarterKit.configure({ heading: false, blockquote: false, codeBlock: false, code: false, strike: false, underline: false, horizontalRule: false, link: { openOnClick: false, autolink: false } })],
    content: value,
    onUpdate: ({ editor: e }) => changeRef.current(e.isEmpty ? "" : e.getHTML()),
    editorProps: { attributes: { class: "focus:outline-none", "aria-label": label } },
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  if (!editor) return <div className="min-h-32 animate-pulse rounded-lg bg-muted/40" aria-hidden />;
  return (
    <div className="overflow-hidden rounded-md border border-input bg-card">
      <Toolbar editor={editor} />
      <div className="max-h-72 min-h-28 overflow-y-auto px-3 py-2 text-sm leading-6 [&_.ProseMirror]:min-h-24 [&_a]:text-primary [&_a]:underline [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
