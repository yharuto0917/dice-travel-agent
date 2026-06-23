import type { Metadata, Viewport } from "next";
import { Geist_Mono, M_PLUS_Rounded_1c } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

// ミニチュア基調の丸ゴシック。日本語グリフはシステムの丸ゴシックへフォールバック。
const rounded = M_PLUS_Rounded_1c({
  variable: "--font-rounded",
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
  display: "swap",
  preload: false,
});

const mono = Geist_Mono({
  variable: "--font-mono-code",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ミニ旅ダイス | Dice Travel Agent",
  description:
    "サイコロで行き先を決めて、AI Agentがミニチュアの日本を旅するしおりを自動で作成します。",
  applicationName: "Dice Travel Agent",
};

export const viewport: Viewport = {
  themeColor: "#f7f0e2",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={`${rounded.variable} ${mono.variable} antialiased`}>
      <body className="bg-background text-foreground">
        <Providers>
          {/* Mobile-first: スマホ幅のアプリフレームを中央寄せ（PCではジオラマ上の端末風） */}
          <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
