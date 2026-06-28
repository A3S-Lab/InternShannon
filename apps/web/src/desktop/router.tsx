import ChatLayout from "@/desktop/layouts/chat/ChatLayout";
import GeneralError from "@/desktop/pages/errors/general-error";
import MaintenanceError from "@/desktop/pages/errors/maintenance-error";
import NotFoundError from "@/desktop/pages/errors/not-found-error";
import RouteErrorPage from "@/desktop/pages/errors/route-error";
import UnauthorisedError from "@/desktop/pages/errors/unauthorised-error";
import { Loader2 } from "lucide-react";
import { createHashRouter } from "react-router-dom";

function RouteHydrateFallback() {
  return (
    <div className="flex h-full min-h-screen items-center justify-center bg-[#f7f9fc]">
      <div className="flex items-center gap-2 rounded-full border border-border-light bg-white px-3 py-2 text-xs text-muted-foreground shadow-sm">
        <Loader2 className="size-4 animate-spin text-primary" />
        正在加载书小安
      </div>
    </div>
  );
}

const router = createHashRouter([
  {
    path: "/",
    element: <ChatLayout />,
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <RouteHydrateFallback />,
    children: [
      {
        index: true,
        lazy: async () => ({
          Component: (await import("./pages/agent/AgentPage")).default,
        }),
      },
      {
        path: "knowledge",
        lazy: async () => ({
          Component: (await import("./pages/knowledge/KnowledgePage")).default,
        }),
      },
      {
        path: "settings",
        lazy: async () => ({
          Component: (await import("./pages/settings/SettingsPage")).default,
        }),
      },
      {
        path: "skills",
        lazy: async () => ({
          Component: (await import("./pages/agent/SkillsPage")).default,
        }),
      },
      {
        path: "agent/:agentId/config",
        lazy: async () => ({
          Component: (await import("./pages/agent/SkillsPage")).default,
        }),
      },
    ],
  },
  { path: "/500", Component: GeneralError },
  { path: "/404", Component: NotFoundError },
  { path: "/503", Component: MaintenanceError },
  { path: "/401", Component: UnauthorisedError },
  { path: "*", Component: NotFoundError },
]);

export default router;
