import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { GoogleOAuthProvider } from '@react-oauth/google';
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import App from "./App";
import "./index.css";

// Import Firebase configuration
import "./lib/firebase";

// Import week utilities test runner (for browser console testing)
import "./lib/runWeekUtilsTests";

// Use the Google OAuth Client ID
const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <GoogleOAuthProvider clientId={clientId}>
      <ThemeProvider attribute="class" defaultTheme="light">
        <App />
      </ThemeProvider>
    </GoogleOAuthProvider>
  </QueryClientProvider>
);
