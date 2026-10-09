'use client';

import { Languages } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useI18n, type Locale } from '@/lib/i18n';

const LABELS: Record<Locale, string> = { th: 'ไทย', en: 'English' };

export function LocaleToggle() {
  const { locale, setLocale } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label="Language">
          <Languages className="size-4" />
          <span className="sr-only">{LABELS[locale]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(Object.keys(LABELS) as Locale[]).map((code) => (
          <DropdownMenuItem key={code} onSelect={() => setLocale(code)}>
            {LABELS[code]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}