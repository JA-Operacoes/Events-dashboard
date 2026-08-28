import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/serverAuth";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json(null, { status: 401 });
  return NextResponse.json(session);
}
