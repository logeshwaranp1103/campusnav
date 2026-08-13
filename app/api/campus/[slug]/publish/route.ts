import { NextResponse } from "next/server";
import { campusStore } from "@/shared/lib/campus-store";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const result = campusStore.publish();

  return NextResponse.json({
    success: true,
    slug,
    version: result.version,
    publishedAt: new Date().toISOString(),
    publishedGraph: campusStore.getPublishedData(),
  });

}
