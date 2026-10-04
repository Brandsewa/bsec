import React from "react";

export default function PreviewLoading() {
  return (
    <div aria-busy="true" style={{ minHeight: "100dvh", background: "#fafafa" }}>
      <div style={{ height: 36, background: "#18181b" }} />
      <div style={{ height: 56, background: "#fff", borderBottom: "1px solid #e4e4e7" }} />
      <div className="store-skeleton" style={{ height: 320, margin: "24px auto", maxWidth: 1200 }} />
    </div>
  );
}
