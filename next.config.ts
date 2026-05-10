import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  reactStrictMode: true,
  // Next 16 dev blokuje cross-origin requesty do `_next/*` (HMR + chunki klienckie).
  // Bez tego wejście przez `127.0.0.1` zamiast `localhost` powoduje, że klienckie
  // bundle nie ładują się, komponenty 'use client' nie hydratują, a formularze
  // robią natywny submit (m.in. wyciekając hasło do URL przy GET).
  // LAN IP (`192.168.1.184`) dodany dla testów mobilnych — DHCP może zmienić,
  // zaktualizuj w tandemie z NEXT_PUBLIC_SUPABASE_URL w .env.local.
  allowedDevOrigins: ['127.0.0.1', 'localhost', '192.168.1.184'],
  turbopack: {
    resolveAlias: {
      canvas: './empty.js'
    }
  }
};

export default withNextIntl(config);
