import GlassesViewer from "./GlassesViewer";
import AIChatbot from "./AIChatbot";
import { Analytics } from "@vercel/analytics/react";

export default function App() {
  return (
    <>
      <GlassesViewer />
      <AIChatbot />
      <Analytics />
    </>
  );
}