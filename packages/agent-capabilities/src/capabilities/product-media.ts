import { z } from "zod";
import { attachProductMedia, detachProductMedia, reorderProductMedia, updateProductMedia, writeAgentAudit } from "@bs/domain";
import { CapabilityError } from "../errors.ts";
import { defineCapability, type CapabilityEnv } from "../types.ts";
import { Id } from "./products.ts";
import { loadProduct, shapeProduct } from "./product-shape.ts";

const imagesOf = async (env: CapabilityEnv, productId: string) => shapeProduct(env, await loadProduct(env, productId)).images;

export const addProductImageCap = defineCapability({
  name: "add_product_image",
  title: "Add an image to a product",
  description: "Attaches an image from the media library to a product (it goes last; the first image is the main one). Find library images with list_media. Optional alt text helps search engines and accessibility.",
  resource: "products",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: false },
  input: z.object({ productId: Id, mediaId: Id.describe("The library image id from list_media."), alt: z.string().max(200).optional() }),
  async handler(env, input) {
    await attachProductMedia(env.rt, env.session.ctx, { productId: input.productId, mediaId: input.mediaId, ...(input.alt ? { alt: input.alt } : {}) });
    const images = await imagesOf(env, input.productId);
    await writeAgentAudit(env.rt, env.session, { action: "product.image_added", targetType: "product", targetId: input.productId, after: { mediaId: input.mediaId } });
    return { productId: input.productId, images };
  },
});

export const updateProductImageCap = defineCapability({
  name: "update_product_image",
  title: "Change an image's alt text",
  description: "Sets or clears the alt text of one product image. Image ids (productMediaId) come from get_product.",
  resource: "products",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({ productId: Id, productMediaId: Id, alt: z.string().max(200).nullable() }),
  async handler(env, input) {
    await updateProductMedia(env.rt, env.session.ctx, { id: input.productId, productMediaId: input.productMediaId, alt: input.alt });
    await writeAgentAudit(env.rt, env.session, { action: "product.image_updated", targetType: "product", targetId: input.productId, after: { productMediaId: input.productMediaId, alt: input.alt } });
    return { productId: input.productId, images: await imagesOf(env, input.productId) };
  },
});

export const reorderProductImagesCap = defineCapability({
  name: "reorder_product_images",
  title: "Reorder a product's images",
  description: "Sets the order of the product's images. Pass every productMediaId of the product in the new order; the first becomes the main image.",
  resource: "products",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({ productId: Id, order: z.array(Id).min(1).max(50) }),
  async handler(env, input) {
    const current = await imagesOf(env, input.productId);
    const have = new Set(current.map((i) => i.productMediaId));
    if (input.order.length !== have.size || !input.order.every((id) => have.has(id))) throw new CapabilityError("invalid_input", "Pass every image of the product exactly once. Get the ids from get_product.");
    await reorderProductMedia(env.rt, env.session.ctx, { id: input.productId, order: input.order });
    const images = await imagesOf(env, input.productId);
    await writeAgentAudit(env.rt, env.session, { action: "product.images_reordered", targetType: "product", targetId: input.productId, before: { order: current.map((i) => i.productMediaId) }, after: { order: input.order } });
    return { productId: input.productId, images };
  },
});

export const removeProductImageCap = defineCapability({
  name: "remove_product_image",
  title: "Remove an image from a product",
  description: "Takes one image off a product. The file stays in the media library and can be attached again. Image ids (productMediaId) come from get_product.",
  resource: "products",
  action: "delete",
  kind: "write",
  annotations: { readOnly: false, destructive: true, idempotent: false },
  input: z.object({ productId: Id, productMediaId: Id }),
  async handler(env, input) {
    await detachProductMedia(env.rt, env.session.ctx, { productId: input.productId, productMediaId: input.productMediaId });
    await writeAgentAudit(env.rt, env.session, { action: "product.image_removed", targetType: "product", targetId: input.productId, before: { productMediaId: input.productMediaId } });
    return { productId: input.productId, images: await imagesOf(env, input.productId) };
  },
});

export const mediaCapabilities = [addProductImageCap, updateProductImageCap, reorderProductImagesCap, removeProductImageCap];
