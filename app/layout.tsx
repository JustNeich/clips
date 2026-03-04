import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reels / Shorts Downloader",
  description: "Download public reels and shorts to mp4"
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
