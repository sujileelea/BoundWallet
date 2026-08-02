import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Envelope — AI가 속아도 봉투 밖으로는 한 푼도 나가지 않는다",
  description: "예산 봉투 안에서만 자율 결제하는 AI 에이전트 데모",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
