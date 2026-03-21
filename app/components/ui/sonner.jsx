"use client";

import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      closeButton
      expand
      position="top-right"
      richColors
      theme="light"
    />
  );
}
