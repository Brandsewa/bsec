import React, { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { PageSkeleton, ThemeProvider } from "@bs/ui";
import { fetchPlatformMe, type PlatformUser } from "./lib/auth.ts";
import { createAppRouter } from "./router.tsx";
import "./index.css";

const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE || "development",
  });
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err: unknown) => {
      if ((err as { code?: string } | null)?.code === "UNAUTHORIZED" && window.location.pathname !== "/login") {
        window.location.assign("/login");
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  const [user, setUser] = useState<PlatformUser | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    fetchPlatformMe()
      .then((me) => setUser(me))
      .catch(() => setUser(null))
      .finally(() => setBootstrapping(false));
  }, []);

  if (bootstrapping) {
    return <PageSkeleton />;
  }

  const router = createAppRouter({
    queryClient,
    user,
    setUser,
  });

  return (
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("#root missing");

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
