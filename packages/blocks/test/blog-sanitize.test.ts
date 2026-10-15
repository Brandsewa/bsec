import { describe, expect, it } from "vitest";
import { sanitizeBlogHtml } from "../src/sanitize.ts";

const ID = "0199a0a3-0000-7000-8000-0000000000aa";
const map = new Map([[ID, { src: "https://media.example/x.jpg", width: 10, height: 20 }]]);

describe("sanitizeBlogHtml", () => {
  it("keeps formatting and drops dangerous markup", () => {
    const out = sanitizeBlogHtml(`<h1>T</h1><p onclick="a()" style="x:y">Hi <b>you</b><script>1</script></p><iframe src="https://e.example"></iframe><a href="javascript:x()">no</a>`, map);
    expect(out).toBe("<h2>T</h2><p>Hi <b>you</b></p><a>no</a>");
  });
  it("rebuilds image src from the resolved media and drops unknown images", () => {
    const out = sanitizeBlogHtml(`<img data-media-id="${ID}" src="https://evil.example/a.png" alt="A"><img src="https://evil.example/b.png"><img data-media-id="0199a0a3-0000-7000-8000-0000000000bb" src="https://evil.example/c.png">`, map);
    expect(out).toBe(`<img src="https://media.example/x.jpg" data-media-id="${ID}" loading="lazy" alt="A" width="10" height="20" />`);
  });
  it("marks external links nofollow and leaves internal ones alone", () => {
    const out = sanitizeBlogHtml(`<a href="https://x.example/p" target="_blank">e</a><a href="/products/a">i</a>`, map);
    expect(out).toBe(`<a href="https://x.example/p" rel="noopener nofollow">e</a><a href="/products/a">i</a>`);
  });
});
