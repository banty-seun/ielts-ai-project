import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export interface QuotaErrorAlertProps {
  visible: boolean;
}

/**
 * Component that displays a user-friendly message when Firebase quota limits are hit
 */
export function QuotaErrorAlert({ visible }: QuotaErrorAlertProps) {
  if (!visible) return null;
  
  return (
    <Alert variant="destructive" className="mb-4">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>API Usage Limit Reached</AlertTitle>
      <AlertDescription>
        Our service is currently experiencing high demand and has reached the Firebase API usage limits.
        Some features may be temporarily unavailable. Please try again in a few minutes.
      </AlertDescription>
    </Alert>
  );
}