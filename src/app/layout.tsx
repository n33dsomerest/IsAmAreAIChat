import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, Noto_Sans_Thai } from 'next/font/google';

import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';

import { ServiceWorkerRegistrar } from '@/components/service-worker-registrar';
import { ThemeProvider } from '@/components/theme-provider';
import { I18nProvider } from '@/lib/i18n';
import { SITE } from '@/lib/site-config';

import './globals.css';

const sans = Geist({
  variable: '--font-latin-sans',
  subsets: ['latin'],
});

const mono = Geist_Mono({
  variable: '--font-latin-mono',
  subsets: ['latin'],
});

// Thai glyphs fall outside Geist's Latin subset, so pair an explicit Thai face
// and list it ahead of the Latin stack.
const thai = Noto_Sans_Thai({
  variable: '--font-thai',
  subsets: ['thai'],
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: {
    default: `${SITE.name} — ${SITE.taglineTh}`,
    template: `%s · ${SITE.name}`,
  },
  description: `${SITE.taglineTh} / ${SITE.taglineEn}`,
  applicationName: SITE.name,
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: SITE.name, statusBarStyle: 'default' },
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
  openGraph: {
    type: 'website',
    siteName: SITE.name,
    title: `${SITE.name} — ${SITE.taglineTh}`,
    description: `${SITE.taglineTh} / ${SITE.taglineEn}`,
    locale: 'th_TH',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      // Set by the i18n provider once the stored preference resolves; the
      // server render has to commit to one value to avoid a hydration mismatch.
      lang="th"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable} ${thai.variable} h-full`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
<I18nProvider>
            <ServiceWorkerRegistrar />
            {/* Nothing renders a toast without this. Every failure path in the app
                calls toast.error and then gives up; without the Toaster mounted
                here they all failed silently — an upload that errored just looked
                like a button that did nothing. */}
            <Toaster />
            <TooltipProvider>{children}</TooltipProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}