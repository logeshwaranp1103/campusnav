import { PageHeader } from "@/features/admin/components/page-header";
import { Card, CardDescription, CardTitle } from "@/shared/components/ui/card";
import { destinations } from "@/shared/data/campus";
import { AnalyticsCharts } from "@/features/admin/components/analytics-charts";

export default function Page() {
  const top = destinations.slice(0, 6);

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Search, navigation and destination trends."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Sessions today", "1,248"],
          ["Successful routes", "97.4%"],
          ["Avg. route time", "3m 12s"],
          ["Failed searches", "18"],
        ].map(([label, v]) => (
          <Card key={label}>
            <div className="text-xs text-[rgb(var(--muted-fg))]">{label}</div>
            <div className="mt-1 text-2xl font-semibold">{v}</div>
          </Card>
        ))}
      </div>

      <AnalyticsCharts />

      <Card className="mt-6">
        <CardTitle>Top destinations</CardTitle>
        <CardDescription>By navigation requests this week.</CardDescription>
        <div className="mt-4 space-y-3">
          {top.map((d, i) => (
            <div key={d.id}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span>{d.name}</span>
                <span className="text-[rgb(var(--muted-fg))]">
                  Category: {d.category}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[rgb(var(--muted))]">
                <div
                  className="h-full rounded-full bg-[rgb(var(--primary))]"
                  style={{ width: `${100 - i * 15}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
