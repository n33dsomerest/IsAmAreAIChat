import type { Metadata } from 'next';
import { Geist, Geist_Mono, Noto_Sans_Thai } from 'next/font/google';

import { TooltipProvider } from '@/components/ui/tooltip';

import { ThemeProvider } from '@/components/theme-provider';
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
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
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
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}