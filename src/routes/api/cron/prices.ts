import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/cron/prices")({
  server: {
    handlers: {
      GET: async () => {
        const { sweepDueItems } = await import("@/lib/monitor.server");
        const result = await sweepDueItems();
        return Response.json(result);
      },
    },
  },
});
