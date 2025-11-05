export const dynamic = "force-static";

import "./globals.css";
import type { Metadata } from "next";
import { ReactNode, Suspense } from "react";

export const metadata: Metadata = {
  title: "Target Locker",
  description: "Lock targets for tomorrow and get reminders",
  manifest: "/manifest.webmanifest",
  themeColor: "#111827",
};

function ClientBoot() {
  // This is a tiny client component to register the service worker
  // and prepare Notification permission state.
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @next/next/no-sync-scripts
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `
          (function(){
            if ('serviceWorker' in navigator) {
              window.addEventListener('load', function(){
                navigator.serviceWorker.register('/sw.js').catch(()=>{});
              });
            }
          })();
        `,
      }}
    />
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <div className="mx-auto max-w-2xl p-6">
          <header className="mb-8 flex items-center justify-between">
            <h1 className="text-2xl font-bold">Target Locker</h1>
            <a
              className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
              href="/"
            >
              Home
            </a>
          </header>
          <main>{children}</main>
          <footer className="mt-12 text-center text-xs text-gray-500">
            Built for daily focus. Notifications work while the page is open.
          </footer>
        </div>
        <Suspense>
          <ClientBoot />
        </Suspense>
      </body>
    </html>
  );
}
