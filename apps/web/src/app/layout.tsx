import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Outfit, Source_Sans_3 } from "next/font/google";
import { DemoBanner } from "@/demo/DemoBanner";
import { DemoDataProvider } from "@/demo/DemoDataProvider";
import "./globals.css";

const display = Outfit({ subsets: ["latin"], variable: "--font-display", weight: ["500", "600", "700"] });
const body = Source_Sans_3({ subsets: ["latin"], variable: "--font-body", weight: ["400", "600", "700"] });

export const metadata: Metadata = {
  title: "Turnos — Hospital Eva Perón",
  description: "Turnos del Hospital Eva Perón, Ente Descentralizado Dr. Saintout, Benito Juárez",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR" className={`${display.variable} ${body.variable}`}>
      <body>
        <DemoDataProvider>
          <DemoBanner />
          {children}
        </DemoDataProvider>
      </body>
    </html>
  );
}
