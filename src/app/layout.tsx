import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'Product Enricher — BigCommerce',
  description:
    'Drop in documents, spec sheets, and product photos. AI matches them to your BigCommerce catalog and queues the changes for review.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-full font-sans antialiased">{children}</body>
    </html>
  );
}
