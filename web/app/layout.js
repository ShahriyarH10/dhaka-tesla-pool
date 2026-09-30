import './globals.css';
import { AuthProvider } from '../lib/auth';

export const metadata = {
  title: 'Dhaka Tesla Pool',
  description: 'Share a seat. Split the fare. Survive Dhaka traffic.',
};

export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
