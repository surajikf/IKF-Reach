import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const response = NextResponse.redirect(new URL("/", url));
  
  response.cookies.delete("ikf_auth");
  
  return response;
}
