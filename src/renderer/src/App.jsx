import { Navigate, Route, Routes, HashRouter } from "react-router-dom";
import { useThemeSync } from "./lib/theme";
import { AppShell } from "./components/shell/AppShell";
import { AccountsPage } from "./pages/accounts/AccountsPage";
import { CalendarPage } from "./pages/calendar/CalendarPage";
import { ContentPage } from "./pages/content/ContentPage";
import { DashboardPage } from "./pages/dashboard/DashboardPage";
import { InboxPage } from "./pages/inbox/InboxPage";
import { SettingsPage } from "./pages/settings/SettingsPage";
import { StudioPage } from "./pages/studio/StudioPage";
import { WorkspacesPage } from "./pages/workspaces/WorkspacesPage";
import { SeriesPage } from "./pages/series/SeriesPage";
import { PlanPage } from "./pages/plan/PlanPage";
import { AnalyticsPage } from "./pages/analytics/AnalyticsPage";
import { GuidePage } from "./pages/guide/GuidePage";
import { FilmPage } from "./pages/film/FilmPage";
import { AuthGate } from "./pages/auth/AuthGate";
import { BillingPage } from "./pages/billing/BillingPage";
import { FeatureGate } from "./components/FeatureGate";

export function App() {
  useThemeSync();
  return (
    <AuthGate>
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index={true} element={<DashboardPage />} />
            <Route path="workspaces" element={<WorkspacesPage />} />
            <Route path="accounts" element={<AccountsPage />} />
            <Route path="plan" element={<PlanPage />} />
            <Route path="content" element={<ContentPage />} />
            <Route
              path="series"
              element={
                <FeatureGate feature="SERIES">
                  <SeriesPage />
                </FeatureGate>
              }
            />
            <Route
              path="studio"
              element={
                <FeatureGate feature="STUDIO">
                  <StudioPage />
                </FeatureGate>
              }
            />
            <Route
              path="film"
              element={
                <FeatureGate feature="FILM">
                  <FilmPage />
                </FeatureGate>
              }
            />
            <Route
              path="film/:id"
              element={
                <FeatureGate feature="FILM">
                  <FilmPage />
                </FeatureGate>
              }
            />
            <Route
              path="calendar"
              element={
                <FeatureGate feature="CALENDAR">
                  <CalendarPage />
                </FeatureGate>
              }
            />
            <Route
              path="inbox"
              element={
                <FeatureGate feature="INBOX">
                  <InboxPage />
                </FeatureGate>
              }
            />
            <Route
              path="analytics"
              element={
                <FeatureGate feature="ANALYTICS">
                  <AnalyticsPage />
                </FeatureGate>
              }
            />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="billing" element={<BillingPage />} />
            <Route path="guide" element={<GuidePage />} />
            <Route path="*" element={<Navigate to="/" replace={true} />} />
          </Route>
        </Routes>
      </HashRouter>
    </AuthGate>
  );
}
