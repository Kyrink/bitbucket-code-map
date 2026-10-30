import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'Code map',
  description:
    'Explore Bitbucket repositories and source code with private, evidence-based code maps.',
  robots: { index: false, follow: false },
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
