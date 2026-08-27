import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/shared/providers/theme-provider";
import { ToastProvider } from "@/shared/components/ui/toast";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "CampusNav — Google Maps for Colleges",
  description:
    "Digital Twin based Indoor + Outdoor Campus Navigation Platform. Real-time, multi-floor navigation.",
  metadataBase: new URL("http://localhost:3000"),
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9fafd" },
    { media: "(prefers-color-scheme: dark)", color: "#090b14" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
              if (typeof window !== 'undefined') {
                window.addEventListener('error', function(e) {
                  if (e.message && (
                    e.message.indexOf('Could not establish connection') !== -1 ||
                    e.message.indexOf('Receiving end does not exist') !== -1 ||
                    e.message.indexOf('message channel closed') !== -1
                  )) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                  }
                });
                window.addEventListener('unhandledrejection', function(e) {
                  var reason = e.reason && (e.reason.message || String(e.reason));
                  if (reason && (
                    reason.indexOf('Could not establish connection') !== -1 ||
                    reason.indexOf('Receiving end does not exist') !== -1 ||
                    reason.indexOf('message channel closed') !== -1
                  )) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                  }
                });
              }
            })();`,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
