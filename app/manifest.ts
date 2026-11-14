import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Game Review',
    short_name: 'Game Review',
    description: 'Free Stockfish game review for your Chess.com and Lichess games.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#302e2b',
    theme_color: '#302e2b',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
