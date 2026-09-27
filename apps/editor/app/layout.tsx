import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { fontFaces } from "@readmeops/core";
import "./globals.css";

export const metadata: Metadata = {
  title: "readmeops",
  description: "Design your GitHub profile README cards, then add them to your profile in three steps. The cards live in your own repository.",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  colorScheme: "dark light",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en">
      <head>
        {/* The same embedded fonts the cards use, so the editor needs no font host. */}
        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: fontFaces(["sans-400", "sans-500", "sans-600", "code-400"]) }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
