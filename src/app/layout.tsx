import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ECamScanner — Free Document Scanner',
  description: 'Scan dokumen gratis, tanpa watermark, langsung dari browser. PDF & JPG export.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ECamScanner',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#2563eb',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body className="max-w-md mx-auto" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
