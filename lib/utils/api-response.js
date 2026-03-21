import { NextResponse } from "next/server";

export function successResponse(data, status = 200) {
  return NextResponse.json(
    {
      success: true,
      data,
    },
    { status },
  );
}

export function errorResponse({ status, errorCode, message, details = {} }) {
  return NextResponse.json(
    {
      success: false,
      errorCode,
      message,
      details,
    },
    { status },
  );
}

