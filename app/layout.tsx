import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CivicBrain 360',
  description: 'Persistent civic complaints and project accountability platform'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
