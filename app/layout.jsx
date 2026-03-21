import { IBM_Plex_Sans, Space_Grotesk } from "next/font/google";

import "./globals.css";
import { Toaster } from "./components/ui/sonner";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "700"],
});

export const metadata = {
  title: "Pulse Solutions",
  description: "Document ingestion, embeddings, and semantic search dashboard.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={`${sans.variable} ${display.variable} min-h-screen overflow-x-hidden`}
      >
        <div className="dashboard-shell min-h-screen">{children}</div>
        <Toaster />
      </body>
    </html>
  );
}
