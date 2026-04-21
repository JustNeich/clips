import type { Metadata } from "next";
import "./globals.css";
import { APP_BUILD_META_NAME, getAppBuildId } from "../lib/app-build";

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
  const appBuildId = getAppBuildId();
  return (
    <html lang="ru">
      <head>
        <meta name={APP_BUILD_META_NAME} content={appBuildId} />
      </head>
      <body>{children}</body>
    </html>
  );
}
