import { shortestPath } from "@/features/navigation/services/graph";
import { campusStore } from "@/shared/lib/campus-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Server-Sent Events stream — emits progressive location updates
// as if the user is walking the route.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") ?? "n-gate";
  const to = searchParams.get("to");
  
  // Look up by destination id to find the linked node, else treat `to` as a node id directly
  const dest = to ? campusStore.getWorkingData().destinations.find((d) => d.id === to) : null;
  const endNodeId = dest?.nodeId ?? to ?? "";
  const route = endNodeId ? shortestPath(from, endNodeId) : null;

  const encoder = new TextEncoder();

  if (!to || !route) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify({ message: "No route available" })}\n\n`)
        );
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      send("route", route);

      let step = 0;
      const total = route.nodes.length;
      const interval = setInterval(() => {
        if (step >= total) {
          send("arrived", { at: route.nodes[total - 1] });
          clearInterval(interval);
          controller.close();
          return;
        }
        const cur = route.nodes[step];
        const remainingDist = route.edges
          .slice(step)
          .reduce((s, e) => s + e.distance, 0);
        send("position", {
          index: step,
          node: cur,
          remainingDistance: remainingDist,
          remainingSec: Math.round(remainingDist / 1.3),
          progress: total > 1 ? step / (total - 1) : 1,
        });
        step++;
      }, 1200);

      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
