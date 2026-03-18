import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Загрузчик Reels / Shorts",
  description: "Загрузка публичных reels и shorts в mp4",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg"
  }
};

type RootLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
