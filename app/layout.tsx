import type { Metadata } from "next"
import { Inter, Geist_Mono } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"
import "./globals.css"
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-code" })
export const metadata: Metadata = {
  title: "Agora payments",
  description:
    "Payments for your business, team, and agents. Test mode is enabled.",
  robots: { index: false, follow: false },
}
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>
        {children}
        <Toaster position="bottom-right" />
      </body>
    </html>
  )
}
