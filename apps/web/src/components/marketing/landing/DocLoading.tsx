import "./landing.css";

/** Route skeleton for the plain marketing pages: the page background, so nothing flashes while the page streams in. */
export function DocLoading() {
  return <div className="lp" aria-busy="true" style={{ minHeight: "100dvh" }} />;
}
