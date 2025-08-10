import { MonthlyCalendarView } from "@/components/dashboard/MonthlyCalendarView";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function Calendar() {
  return (
    <ProtectedRoute>
      <div className="container mx-auto py-8 px-4">
        <MonthlyCalendarView />
      </div>
    </ProtectedRoute>
  );
}