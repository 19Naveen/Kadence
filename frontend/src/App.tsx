import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/shared/AppShell";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { PublicOnlyRoute } from "./components/auth/PublicOnlyRoute";
import { PageLoading } from "./components/shared/PageLoading";

// Pages are split per route so the first load only pays for what it shows.
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));

const LandingPage = page(() => import("./features/landing/LandingPage"), "LandingPage");
const SigninPage = page(() => import("./features/auth/SigninPage"), "SigninPage");
const SignupPage = page(() => import("./features/auth/SignupPage"), "SignupPage");
const OnboardingPage = page(() => import("./features/onboarding/OnboardingPage"), "OnboardingPage");
const HomePage = page(() => import("./features/home/HomePage"), "HomePage");
const DataImportPage = page(() => import("./features/data-import/DataImportPage"), "DataImportPage");
const DataTransformPage = page(() => import("./features/data-transform/DataTransformPage"), "DataTransformPage");
const QueryStudioPage = page(() => import("./features/query-studio/QueryStudioPage"), "QueryStudioPage");
const EDADashboardsPage = page(() => import("./features/eda-dashboards/EDADashboardsPage"), "EDADashboardsPage");
const AutoMLLabPage = page(() => import("./features/automl-lab/AutoMLLabPage"), "AutoMLLabPage");
const MLTrainingPage = page(() => import("./features/ml-training/MLTrainingPage"), "MLTrainingPage");
const MLPredictionPage = page(() => import("./features/ml-prediction/MLPredictionPage"), "MLPredictionPage");
const WorkspaceSettingsPage = page(() => import("./features/workspace/WorkspaceSettingsPage"), "WorkspaceSettingsPage");
const AboutPage = page(() => import("./features/about/AboutPage"), "AboutPage");

export function App() {
  return (
    <Suspense fallback={<PageLoading fullScreen />}>
      <Routes>
        {/* Public */}
        <Route path="/" element={<LandingPage />} />

        {/* Auth — redirect to /app if already signed in */}
        <Route path="/signin" element={<PublicOnlyRoute><SigninPage /></PublicOnlyRoute>} />
        <Route path="/signup" element={<PublicOnlyRoute><SignupPage /></PublicOnlyRoute>} />
        <Route path="/auth" element={<Navigate to="/signin" replace />} />

        {/* Onboarding — protected but no AppShell */}
        <Route path="/onboarding" element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>} />

        {/* Protected app routes */}
        <Route path="/app" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
          <Route index element={<HomePage />} />
          <Route path="data-import" element={<DataImportPage />} />
          <Route path="data-transform" element={<DataTransformPage />} />
          <Route path="query-studio" element={<QueryStudioPage />} />
          <Route path="eda-dashboards" element={<EDADashboardsPage />} />
          <Route path="automl-lab" element={<AutoMLLabPage />} />
          <Route path="ml-training" element={<MLTrainingPage />} />
          <Route path="ml-prediction" element={<MLPredictionPage />} />
          <Route path="workspace-settings" element={<WorkspaceSettingsPage />} />
          <Route path="about" element={<AboutPage />} />
          {/* Unknown app URL → home, not the public landing page */}
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
