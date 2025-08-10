import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { FirebaseAuthProvider } from "@/contexts/FirebaseAuthContext";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import Auth from "@/pages/auth";
import Login from "@/pages/login";
import VerifyEmail from "@/pages/verify-email";
import VerifySuccess from "@/pages/verify-success";
import VerifyHandler from "@/pages/verify-handler";
import Onboarding from "@/pages/onboarding";
import Dashboard from "@/pages/dashboard";
import Calendar from "@/pages/calendar";
import Practice from "@/pages/practice";
import DebugPage from "@/pages/debug";
import DebugToken from "@/pages/debug-token";
import ErrorTest from "@/pages/error-test";
import { useMemo } from "react";

const AuthRedirect = () => {
  return <Redirect to="/auth" />;
};

// Pre-define protected components to avoid recreating them on each render
const ProtectedPractice = () => (
  <ProtectedRoute requireOnboarding={true}>
    <Practice />
  </ProtectedRoute>
);

const ProtectedDashboard = () => (
  <ProtectedRoute requireOnboarding={true}>
    <Dashboard />
  </ProtectedRoute>
);

const ProtectedCalendar = () => (
  <ProtectedRoute requireOnboarding={true}>
    <Calendar />
  </ProtectedRoute>
);

const ProtectedOnboarding = () => (
  <ProtectedRoute requireOnboarding={false}>
    <Onboarding />
  </ProtectedRoute>
);

const ProtectedDebugToken = () => (
  <ProtectedRoute requireOnboarding={false}>
    <DebugToken />
  </ProtectedRoute>
);

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/auth" component={Auth} />
      <Route path="/login" component={Login} />
      <Route path="/dashboard" component={ProtectedDashboard} />
      <Route path="/dashboard/calendar" component={ProtectedCalendar} />
      <Route path="/practice/:week/:day" component={ProtectedPractice} />
      <Route path="/verify-email" component={VerifyEmail} />
      <Route path="/verify-success" component={VerifySuccess} />
      <Route path="/verify-handler" component={VerifyHandler} />
      <Route path="/onboarding" component={ProtectedOnboarding} />
      {/* Debug routes */}
      <Route path="/debug" component={DebugPage} />
      <Route path="/debug-token" component={ProtectedDebugToken} />
      <Route path="/error-test" component={ErrorTest} />
      {/* Fallback to 404 */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID || ""}>
        <FirebaseAuthProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </FirebaseAuthProvider>
      </GoogleOAuthProvider>
    </QueryClientProvider>
  );
}

export default App;
