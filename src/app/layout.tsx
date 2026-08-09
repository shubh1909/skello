import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";

import "./globals.css";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";

// `--font-inter`, not `--font-sans`. The old name shadowed Tailwind's own
// `--font-sans`, so globals.css carried a self-referential
// `--font-sans: var(--font-sans)` that only worked because next/font redefined
// it at the <html> scope. globals.css now maps --font-sans → var(--font-inter).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Kept for `font-mono` — phone numbers, ids and provider message ids rely on it.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Skelo — Modern CRM for B2B Teams",
  description:
    "Skelo is a high-performance, multi-tenant CRM built for ambitious B2B teams. Capture leads, automate outreach, and close faster.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Applies the stored theme to <html> before first paint. It lives here,
            in a Server Component, on purpose: rendered from a client component
            (which is what next-themes did) React 19 warns that the script never
            executes — and it would be right. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="min-h-full bg-background text-foreground">
        <ThemeProvider>
          {children}
          {/* No `richColors`: it makes sonner apply its OWN red/green/amber
              palette, overriding the --popover/--border vars that
              components/ui/sonner.tsx wires up — so toasts were the one surface
              that ignored the brand entirely. */}
          <Toaster position="top-right" closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
