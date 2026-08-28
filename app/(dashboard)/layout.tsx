import { EventProvider } from "@/lib/eventContext";
import Shell from "@/components/Shell";
import RequireAuth from "@/components/RequireAuth";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <EventProvider>
        <Shell>{children}</Shell>
      </EventProvider>
    </RequireAuth>
  );
}
