import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import { AUTHOR, AUTHOR_URL, SITE_NAME, SITE_URL } from '@/lib/site';
import 'uplot/dist/uPlot.min.css';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Game Review — free Stockfish analysis for Chess.com & Lichess',
    template: '%s · Game Review',
  },
  description:
    'Review your Chess.com and Lichess games with Stockfish 17, right in your browser. Move-by-move classifications, accuracy, key moments and plain-English explanations — free and private.',
  applicationName: SITE_NAME,
  authors: [{ name: AUTHOR, url: AUTHOR_URL }],
  creator: AUTHOR,
  alternates: { canonical: '/' },
  keywords: ['chess', 'game review', 'stockfish', 'chess.com', 'lichess', 'analysis', 'accuracy'],
  openGraph: {
    title: SITE_NAME,
    description: 'Free Stockfish game review for Chess.com and Lichess games.',
    type: 'website',
    url: '/',
    siteName: SITE_NAME,
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: 'Free Stockfish game review for Chess.com and Lichess games.',
  },
  // Installable to the home screen: opens full-screen without browser bars.
  appleWebApp: { capable: true, title: 'Game Review', statusBarStyle: 'black-translucent' },
  icons: {
    icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#181818',
  colorScheme: 'dark',
  // Lets the layout use the whole screen (notch, home indicator) with safe-area padding.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={geist.variable}>
      <body>{children}</body>
    </html>
  );
}
