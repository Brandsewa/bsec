import React, { useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  Image as ImageIcon,
  MessageSquare,
  Play,
  Plus,
  Trash2,
  Video as VideoIcon,
} from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldLabel,
  Input,
  cn,
  toast,
} from "@bs/ui";
import type { MediaItem, MediaKind } from "@bs/contracts";
import { MediaPickerDialog } from "./media-picker-dialog.tsx";

export interface MediaRef {
  id?: string | undefined; // productMediaId
  mediaId: string;
  url?: string | undefined;
  thumbnailUrl?: string | null | undefined;
  kind?: MediaKind | undefined;
  alt?: string | null | undefined;
  filename?: string | null | undefined;
  position?: number | undefined;
  isPrimary?: boolean | undefined;
}

export interface MediaGalleryFieldProps {
  value: MediaRef[];
  onChange?: ((items: MediaRef[]) => void) | undefined;
  accept?: MediaKind[] | undefined;
  max?: number | undefined;
  disabled?: boolean | undefined;
  onReorder?: ((order: string[]) => Promise<void>) | undefined;
  onAttach?: ((mediaItem: MediaItem) => Promise<void>) | undefined;
  onDetach?: ((productMediaId: string) => Promise<void>) | undefined;
  onAltChange?: ((productMediaId: string, alt: string | null) => Promise<void>) | undefined;
  className?: string | undefined;
}

interface SortableGalleryTileProps {
  item: MediaRef;
  index: number;
  disabled?: boolean | undefined;
  onRemove: () => void;
  onEditAlt: () => void;
}

function SortableGalleryTile({
  item,
  index,
  disabled,
  onRemove,
  onEditAlt,
}: SortableGalleryTileProps) {
  const sortableId = item.id || item.mediaId || String(index);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: sortableId,
    disabled: disabled ?? false,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isPrimary = index === 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative aspect-square rounded-lg border bg-card overflow-hidden flex flex-col justify-between transition-shadow",
        isDragging && "z-50 opacity-80 shadow-lg ring-2 ring-primary",
        isPrimary && "ring-2 ring-primary/80 border-primary",
      )}
    >
      {/* Top Badges & Drag Handle */}
      <div className="absolute top-2 inset-x-2 z-10 flex items-center justify-between pointer-events-none">
        {isPrimary ? (
          <Badge className="bg-primary text-primary-foreground font-semibold text-[10px] px-1.5 py-0 shadow-xs pointer-events-auto">
            Primary
          </Badge>
        ) : (
          <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-background/80 backdrop-blur-xs text-foreground/80 pointer-events-auto shadow-xs">
            #{index + 1}
          </span>
        )}

        {!disabled && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="h-6 w-6 rounded bg-background/80 hover:bg-background text-foreground/70 hover:text-foreground flex items-center justify-center cursor-grab active:cursor-grabbing pointer-events-auto shadow-xs transition-colors"
            aria-label="Reorder media"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Media Preview */}
      <div className="relative w-full h-full bg-muted/30 flex items-center justify-center overflow-hidden">
        {item.kind === "video" ? (
          <div className="relative w-full h-full flex items-center justify-center bg-black/10">
            <VideoIcon className="h-10 w-10 text-purple-500 opacity-80" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-8 w-8 rounded-full bg-black/60 flex items-center justify-center text-white">
                <Play className="h-4 w-4 fill-white ml-0.5" />
              </div>
            </div>
            <Badge
              variant="outline"
              className="absolute bottom-2 left-2 text-[10px] bg-background/90 font-mono"
            >
              Video
            </Badge>
          </div>
        ) : (
          <img
            src={item.thumbnailUrl || item.url}
            alt={item.alt || item.filename || "Product media"}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        )}

        {/* Hover / Focus Overlay with Actions */}
        {!disabled && (
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-8 w-8 bg-background/90 hover:bg-background text-foreground shadow-sm"
              onClick={(e) => {
                e.stopPropagation();
                onEditAlt();
              }}
              title="Edit alt text"
              aria-label="Edit alt text"
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="h-8 w-8 shadow-sm"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              title="Remove from product"
              aria-label="Remove from product"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Alt text indicator banner if set */}
      {Boolean(item.alt) && (
        <div className="absolute bottom-0 inset-x-0 bg-background/90 backdrop-blur-xs px-2 py-0.5 border-t text-[10px] text-muted-foreground truncate font-mono">
          Alt: {item.alt}
        </div>
      )}
    </div>
  );
}

export function MediaGalleryField({
  value,
  onChange,
  accept = ["image", "video"],
  max = 20,
  disabled = false,
  onReorder,
  onAttach,
  onDetach,
  onAltChange,
  className,
}: MediaGalleryFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [altModalItem, setAltModalItem] = useState<MediaRef | null>(null);
  const [altInputValue, setAltInputValue] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = value.findIndex(
      (i) => (i.id || i.mediaId) === active.id,
    );
    const newIndex = value.findIndex(
      (i) => (i.id || i.mediaId) === over.id,
    );

    if (oldIndex === -1 || newIndex === -1) return;

    // Check primary-must-be-image rule:
    // If newIndex === 0, the item moving to position 0 MUST be an image!
    const targetItem = value[oldIndex];
    if (newIndex === 0 && targetItem?.kind === "video") {
      toast.error(
        "Primary media (first item) must be an image for listings, cart, and social cards.",
      );
      return;
    }

    const newItems = arrayMove(value, oldIndex, newIndex);

    // Call onReorder if provided
    if (onReorder) {
      const orderIds = newItems.map((i) => i.id).filter((id): id is string => Boolean(id));
      if (orderIds.length === newItems.length) {
        try {
          await onReorder(orderIds);
          toast.success("Gallery reordered");
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : "Failed to reorder media");
          return;
        }
      }
    }

    onChange?.(newItems);
  };

  const handlePickerSelect = async (selected: MediaItem[]) => {
    if (selected.length === 0) return;

    // Check if adding to empty gallery: first item cannot be video
    if (value.length === 0) {
      const firstIsVideo = selected[0]?.kind === "video";
      const hasAnyImage = selected.some((s) => s.kind === "image");
      if (firstIsVideo && !hasAnyImage) {
        toast.error("A product requires at least one image before adding a video.");
        return;
      }
    }

    // Attach items
    for (const item of selected) {
      if (value.some((v) => v.mediaId === item.id)) {
        continue; // already attached
      }

      if (onAttach) {
        try {
          await onAttach(item);
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : `Failed to attach ${item.filename}`);
        }
      } else {
        const newRef: MediaRef = {
          mediaId: item.id,
          url: item.url,
          thumbnailUrl: item.thumbnailUrl,
          kind: item.kind,
          alt: item.alt,
          filename: item.filename,
        };
        onChange?.([...value, newRef]);
      }
    }
  };

  const handleRemoveItem = async (item: MediaRef) => {
    if (onDetach && item.id) {
      try {
        await onDetach(item.id);
        toast.success("Media removed from product");
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to remove media");
        return;
      }
    }

    const remaining = value.filter((v) => (v.id || v.mediaId) !== (item.id || item.mediaId));
    onChange?.(remaining);
  };

  const handleOpenAltModal = (item: MediaRef) => {
    setAltModalItem(item);
    setAltInputValue(item.alt || "");
  };

  const handleSaveAlt = async () => {
    if (!altModalItem) return;
    const trimmed = altInputValue.trim() || null;

    if (onAltChange && altModalItem.id) {
      try {
        await onAltChange(altModalItem.id, trimmed);
        toast.success("Alt text saved");
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to update alt text");
        return;
      }
    }

    const updated = value.map((v) =>
      (v.id || v.mediaId) === (altModalItem.id || altModalItem.mediaId)
        ? { ...v, alt: trimmed }
        : v,
    );
    onChange?.(updated);
    setAltModalItem(null);
  };

  return (
    <div className={cn("space-y-4", className)}>
      {value.length === 0 ? (
        <div className="space-y-3">
          <EmptyState
            icon={ImageIcon}
            title="No images attached"
            description="Choose images or videos from your library or upload new files."
          />
          {!disabled && (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPickerOpen(true)}
              >
                <Plus className="mr-1.5 size-3.5" aria-hidden />
                Add media
              </Button>
            </div>
          )}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={value.map((i, idx) => i.id || i.mediaId || String(idx))}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {value.map((item, index) => (
                <SortableGalleryTile
                  key={item.id || item.mediaId || String(index)}
                  item={item}
                  index={index}
                  disabled={disabled}
                  onRemove={() => handleRemoveItem(item)}
                  onEditAlt={() => handleOpenAltModal(item)}
                />
              ))}

              {/* Add media button tile */}
              {!disabled && value.length < max && (
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="aspect-square rounded-lg border-2 border-dashed border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/10 transition-colors flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <div className="h-9 w-9 rounded-full bg-muted/50 flex items-center justify-center">
                    <Plus className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-medium">Add media</span>
                </button>
              )}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Alt Text Dialog */}
      <Dialog
        open={Boolean(altModalItem)}
        onOpenChange={(open) => !open && setAltModalItem(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit alt text override</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              Provide product-specific alternative text for screen readers and search engines.
              Leave blank to fall back to the library alt text or product title.
            </p>
            <Field>
              <FieldLabel>Alternative text</FieldLabel>
              <Input
                value={altInputValue}
                onChange={(e) => setAltInputValue(e.target.value)}
                placeholder="Describe this media for accessibility..."
              />
            </Field>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAltModalItem(null)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSaveAlt}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Media Picker Dialog */}
      <MediaPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        accept={accept}
        multiple={true}
        max={max - value.length}
        onSelect={handlePickerSelect}
        title="Add media to product"
      />
    </div>
  );
}
