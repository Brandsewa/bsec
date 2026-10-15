import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Heading2,
  Heading3,
  Heading4,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { Button, Input, cn } from "@bs/ui";
import { MediaPickerDialog } from "../media/media-picker-dialog.tsx";

/** Keeps the media library id on inline pictures: the server rebuilds the address from it and ignores the submitted `src` (ADR-033). */
const BlogImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      mediaId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-media-id"),
        renderHTML: (attrs: Record<string, unknown>) => (attrs["mediaId"] ? { "data-media-id": String(attrs["mediaId"]) } : {}),
      },
    };
  },
});

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

function Toolbar({ editor, onPickImage }: { editor: Editor; onPickImage: () => void }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const openLink = () => {
    setHref((editor.getAttributes("link")["href"] as string | undefined) ?? "");
    setLinkOpen(true);
  };
  const applyLink = () => {
    const url = href.trim();
    if (!url) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: /^(https?:|mailto:|tel:|\/)/i.test(url) ? url : `https://${url}` }).run();
    setLinkOpen(false);
  };
  return (
    <div className="border-b border-border">
      <div className="flex flex-wrap items-center gap-0.5 p-1.5" role="toolbar" aria-label="Formatting">
        <ToolButton label="Heading 2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Heading 3" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          <Heading3 className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Heading 4" active={editor.isActive("heading", { level: 4 })} onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}>
          <Heading4 className="size-4" aria-hidden />
        </ToolButton>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <ToolButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon className="size-4" aria-hidden />
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
        <ToolButton label="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Divider" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          <Minus className="size-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Insert image" onClick={onPickImage}>
          <ImageIcon className="size-4" aria-hidden />
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
            placeholder="https://example.com or /products/handle"
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
      )}
    </div>
  );
}

export interface BlogEditorProps {
  /** Initial HTML. The editor owns the content afterwards; change `resetKey` to load a different document. */
  initialHtml: string;
  resetKey: string;
  onChange: (html: string) => void;
  disabled?: boolean;
}

/** Rich text for a blog post body (ADR-033). Output is HTML; the server sanitises it on save and on preview. */
export default function BlogEditor({ initialHtml, resetKey, onChange, disabled = false }: BlogEditorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const changeRef = useRef(onChange);
  useEffect(() => {
    changeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3, 4] }, link: { openOnClick: false, autolink: true } }),
      BlogImage,
      Placeholder.configure({ placeholder: "Start writing your post..." }),
    ],
    content: initialHtml,
    onUpdate: ({ editor: e }) => changeRef.current(e.isEmpty ? "" : e.getHTML()),
    editorProps: { attributes: { class: "blog-editor-body focus:outline-none", "aria-label": "Post content" } },
  });

  // Load another document (for example after the post finished loading) without remounting the editor.
  const loaded = useRef(resetKey);
  useEffect(() => {
    if (!editor || loaded.current === resetKey) return;
    loaded.current = resetKey;
    editor.commands.setContent(initialHtml, { emitUpdate: false });
  }, [editor, resetKey, initialHtml]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  if (!editor) return <div className="min-h-[360px] animate-pulse rounded-lg bg-muted/40" aria-hidden />;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <Toolbar editor={editor} onPickImage={() => setPickerOpen(true)} />
      <div
        className={cn(
          "max-h-[70vh] min-h-[360px] overflow-y-auto px-4 py-3 text-[15px] leading-7",
          "[&_.ProseMirror]:min-h-[330px]",
          "[&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-5 [&_h3]:text-lg [&_h3]:font-semibold [&_h4]:mt-4 [&_h4]:font-semibold",
          "[&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6",
          "[&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
          "[&_a]:text-primary [&_a]:underline [&_hr]:my-6 [&_hr]:border-border [&_img]:my-4 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg",
          "[&_p.is-editor-empty:first-child::before]:pointer-events-none [&_p.is-editor-empty:first-child::before]:float-left [&_p.is-editor-empty:first-child::before]:h-0 [&_p.is-editor-empty:first-child::before]:text-muted-foreground [&_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
        )}
      >
        <EditorContent editor={editor} />
      </div>
      <MediaPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        accept={["image"]}
        title="Insert image"
        onSelect={(items) => {
          const m = items[0];
          if (m?.url) {
            editor
              .chain()
              .focus()
              .setImage({ src: m.url, alt: m.alt ?? "", mediaId: m.id } as { src: string; alt: string })
              .run();
          }
          setPickerOpen(false);
        }}
      />
    </div>
  );
}
