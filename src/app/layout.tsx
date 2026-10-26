import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GEG Deliverables",
  description: "Chat assistant that reads a deliverables register and checks a folder of filenames.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
