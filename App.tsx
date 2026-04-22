import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { ThemeContextProvider } from './context/ThemeContext';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import Layout from './components/Layout';
import LoginPage from './components/LoginPage';
import QueryTabManager from './components/QueryTabManager';
import SavedQueries from './components/SavedQueries';
import Downloads from './components/Downloads';
import ExecutionHistory from './components/ExecutionHistory';
import ReportPage from './components/ReportPage';
import ConnectionManager from './components/ConnectionManager';
// Phase 111: ReportsManagerPage removed — /report-manager now redirects to /business-reports
import ReportConnectorsPage from './components/ReportConnectorsPage';
import FilePreviewPage from './components/FilePreviewPage';
import DashboardPage from './components/DashboardPage';
import SharedQueryPage from './components/SharedQueryPage';
import SharedDashboardPage from './components/SharedDashboardPage';
import EmbeddedReportPage from './components/EmbeddedReportPage';
import SharedBusinessReportPage from './components/SharedBusinessReportPage';
import EmbeddedBusinessReportPage from './components/EmbeddedBusinessReportPage';
import ErrorBoundary from './components/ErrorBoundary';

// Lazy-loaded heavy pages — split into separate chunks to reduce initial bundle size
const AdminPage = lazy(() => import('./components/AdminPage'));
const SystemAccountsPage = lazy(() => import('./components/SystemAccountsPage'));
const LineagePage = lazy(() => import('./components/LineagePage'));
const ReportCatalogPage = lazy(() => import('./components/ReportCatalogPage'));
const DatasetManagerPage = lazy(() => import('./components/DatasetManagerPage'));
const DatasetQueryPanel = lazy(() => import('./components/DatasetQueryPanel'));
const BusinessGlossary = lazy(() => import('./components/BusinessGlossary'));
const BusinessReportBuilder = lazy(() => import('./components/BusinessReportBuilder'));
const BusinessReportViewer = lazy(() => import('./components/BusinessReportViewer'));
const PivotReportBuilder = lazy(() => import('./components/PivotReportBuilder'));
const PivotReportViewer = lazy(() => import('./components/PivotReportViewer'));
const ReportsListPage = lazy(() => import('./components/ReportsListPage'));
const UnifiedReportBuilder = lazy(() => import('./components/UnifiedReportBuilder'));
const UnifiedReportViewer = lazy(() => import('./components/UnifiedReportViewer'));
const BusinessPortalPage = lazy(() => import('./components/BusinessPortalPage'));
const SqlQueryPage = lazy(() => import('./components/SqlQueryPage'));
const SchedulesPage = lazy(() => import('./components/SchedulesPage'));
const MaterializedViewsPage = lazy(() => import('./components/MaterializedViewsPage'));
const LocalTablesPage = lazy(() => import('./components/LocalTablesPage'));
const PublishedViewsPage = lazy(() => import('./components/PublishedViewsPage'));
const ApiKeysPage = lazy(() => import('./components/ApiKeysPage'));
const FeedConfigsPage = lazy(() => import('./components/FeedConfigsPage'));
const FederationViewsPage = lazy(() => import('./components/FederationViewsPage'));
const MetadataCatalogPage = lazy(() => import('./components/MetadataCatalogPage'));
const ApiExplorerPage = lazy(() => import('./components/ApiExplorerPage'));
const DataQualityPage = lazy(() => import('./components/DataQualityPage'));
import { WebSocketProvider } from './context/WebSocketContext';
import { NotificationProvider } from './context/NotificationContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppSettingsProvider } from './context/AppSettingsContext';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { AssistantContextProvider } from './context/AssistantContext';
import { UIVisibilityProvider, useComponentVisible } from './context/UIVisibilityContext';
import { TourProvider } from './context/TourContext';
import GuidedTour from './components/GuidedTour';
import NotificationCenter from './components/NotificationCenter';
import './App.css';

// Shown to logged-in AD users who lack the required role
const AccessDenied = () => {
  const { user, logout } = useAuth();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: 2 }}>
      <LockOutlinedIcon sx={{ fontSize: 56, color: 'text.disabled' }} />
      <Typography variant="h5" fontWeight={600}>Access Denied</Typography>
      <Typography color="text.secondary">
        Your account (<strong>{user?.display_name || user?.username}</strong>) does not have permission to access QueryStudio.
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Contact your administrator to be added to an authorised AD group.
      </Typography>
      <Button variant="outlined" onClick={logout}>Sign Out</Button>
    </Box>
  );
};

// Role guard — restricts route access based on RBAC role
const RoleGuard = ({ roles, children }: { roles: string[], children: React.ReactNode }) => {
  const { user, authEnabled } = useAuth();
  if (!authEnabled) return <>{children}</>;
  const role = (user as any)?.role || 'viewer';
  // Phase 107-I: super_admin bypasses all role-based route guards.
  if (role === 'super_admin') return <>{children}</>;
  if (!roles.includes(role)) return <AccessDenied />;
  return <>{children}</>;
};

// Component visibility guard — hides routes disabled by admin for the current role
const ComponentDisabledGuard = ({ componentKey, children }: { componentKey: string, children: React.ReactNode }) => {
  const visible = useComponentVisible(componentKey);
  if (!visible) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 2 }}>
        <LockOutlinedIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
        <Typography variant="h6" color="text.secondary">This feature is not available for your role.</Typography>
      </Box>
    );
  }
  return <>{children}</>;
};

// Phase 111: redirect helper that preserves :id param in the URL
const RedirectWithId = ({ basePath }: { basePath: string }) => {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={id ? `${basePath}/${id}` : basePath} replace />;
};

const AppRoutes = () => {
  const { authEnabled, user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  // Auth enabled but not logged in → login screen
  if (authEnabled && !user) {
    return <LoginPage />;
  }

  return (
    <AppSettingsProvider>
    <UIVisibilityProvider>
    <TourProvider>
    <AssistantContextProvider>
    <WorkspaceProvider>
    <WebSocketProvider>
      <NotificationProvider>
        <Layout>
          <GuidedTour />
          <NotificationCenter />
          <ErrorBoundary resetKey={location.pathname}>
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}><CircularProgress /></Box>}>
              <Routes>
                <Route path="/connections"       element={<RoleGuard roles={['admin','analyst']}><ComponentDisabledGuard componentKey="connections"><ConnectionManager /></ComponentDisabledGuard></RoleGuard>} />
                <Route path="/materialized-views" element={<RoleGuard roles={['admin','analyst']}><ComponentDisabledGuard componentKey="materialized_views"><MaterializedViewsPage /></ComponentDisabledGuard></RoleGuard>} />
                <Route path="/local-tables"       element={<RoleGuard roles={['admin','analyst']}><ComponentDisabledGuard componentKey="local_tables"><LocalTablesPage /></ComponentDisabledGuard></RoleGuard>} />
                <Route path="/lineage"            element={<RoleGuard roles={['admin','analyst']}><ComponentDisabledGuard componentKey="lineage"><LineagePage /></ComponentDisabledGuard></RoleGuard>} />
                <Route path="/datasets"          element={<RoleGuard roles={['admin']}><ComponentDisabledGuard componentKey="semantic_layer"><DatasetManagerPage /></ComponentDisabledGuard></RoleGuard>} />
                <Route path="/glossary"          element={<ComponentDisabledGuard componentKey="glossary"><BusinessGlossary /></ComponentDisabledGuard>} />
                <Route path="/datasets/:id/query" element={<ComponentDisabledGuard componentKey="federation"><DatasetQueryPanel /></ComponentDisabledGuard>} />
                {/* Phase 111 — Unified Reports (all report types under one URL) */}
                <Route path="/business-reports"        element={<ComponentDisabledGuard componentKey="business_reports"><ReportsListPage /></ComponentDisabledGuard>} />
                <Route path="/business-reports/new"    element={<ComponentDisabledGuard componentKey="business_reports"><UnifiedReportBuilder /></ComponentDisabledGuard>} />
                <Route path="/business-reports/:id"    element={<ComponentDisabledGuard componentKey="business_reports"><UnifiedReportViewer /></ComponentDisabledGuard>} />
                <Route path="/business-reports/:id/edit" element={<ComponentDisabledGuard componentKey="business_reports"><UnifiedReportBuilder /></ComponentDisabledGuard>} />
                {/* Phase 111 — Legacy pivot routes redirect to unified (preserving :id) */}
                <Route path="/pivot-reports/new"      element={<Navigate to="/business-reports/new" replace />} />
                <Route path="/pivot-reports/:id"      element={<RedirectWithId basePath="/business-reports" />} />
                <Route path="/pivot-reports/:id/edit" element={<RedirectWithId basePath="/business-reports" />} />
                <Route path="/"                  element={<ComponentDisabledGuard componentKey="business_portal"><BusinessPortalPage /></ComponentDisabledGuard>} />
                <Route path="/query-builder"     element={<RoleGuard roles={['admin','analyst']}><ComponentDisabledGuard componentKey="query_builder"><QueryTabManager /></ComponentDisabledGuard></RoleGuard>} />
                {/* Phase 111 — /reports list redirects to unified; /reports/:id still works for legacy bookmarks */}
                <Route path="/reports"           element={<Navigate to="/business-reports" replace />} />
                <Route path="/reports/:reportId" element={<ComponentDisabledGuard componentKey="reports"><ReportPage /></ComponentDisabledGuard>} />
                <Route path="/saved-queries"     element={<ComponentDisabledGuard componentKey="saved_queries"><SavedQueries /></ComponentDisabledGuard>} />
                <Route path="/executions"        element={<ComponentDisabledGuard componentKey="executions"><ExecutionHistory /></ComponentDisabledGuard>} />
                <Route path="/downloads"         element={<ComponentDisabledGuard componentKey="downloads"><Downloads /></ComponentDisabledGuard>} />
                <Route path="/sql"               element={<RoleGuard roles={['admin','analyst']}><ComponentDisabledGuard componentKey="sql_editor"><SqlQueryPage /></ComponentDisabledGuard></RoleGuard>} />
                {/* Phase 111 — Parametric Reports Manager redirects to unified Reports list */}
                <Route path="/report-manager"    element={<Navigate to="/business-reports" replace />} />
                <Route path="/report-catalog"    element={<ComponentDisabledGuard componentKey="report_catalog"><ReportCatalogPage /></ComponentDisabledGuard>} />
                <Route path="/report-connectors" element={<RoleGuard roles={['admin','analyst']}><ComponentDisabledGuard componentKey="report_connectors"><ReportConnectorsPage /></ComponentDisabledGuard></RoleGuard>} />
                <Route path="/schedules"         element={<RoleGuard roles={['admin','analyst']}><ComponentDisabledGuard componentKey="schedules"><SchedulesPage /></ComponentDisabledGuard></RoleGuard>} />
                <Route path="/file-preview"      element={<FilePreviewPage />} />
                <Route path="/dashboards"        element={<ComponentDisabledGuard componentKey="dashboards"><DashboardPage /></ComponentDisabledGuard>} />
                <Route path="/admin"             element={<RoleGuard roles={['admin']}><ComponentDisabledGuard componentKey="admin"><AdminPage /></ComponentDisabledGuard></RoleGuard>} />
                <Route path="/system-accounts"  element={<RoleGuard roles={['admin']}><SystemAccountsPage /></RoleGuard>} />
                <Route path="/published-views"  element={<RoleGuard roles={['admin','analyst']}><ComponentDisabledGuard componentKey="published_views"><PublishedViewsPage /></ComponentDisabledGuard></RoleGuard>} />
                <Route path="/api-keys"         element={<RoleGuard roles={['admin']}><ComponentDisabledGuard componentKey="api_keys"><ApiKeysPage /></ComponentDisabledGuard></RoleGuard>} />
                <Route path="/feeds"           element={<RoleGuard roles={['admin','analyst']}><ComponentDisabledGuard componentKey="feeds"><FeedConfigsPage /></ComponentDisabledGuard></RoleGuard>} />
                <Route path="/federation-views" element={<RoleGuard roles={['admin','analyst']}><ComponentDisabledGuard componentKey="federation_views"><FederationViewsPage /></ComponentDisabledGuard></RoleGuard>} />
                <Route path="/catalog"        element={<ComponentDisabledGuard componentKey="data_catalog"><MetadataCatalogPage /></ComponentDisabledGuard>} />
                <Route path="/api-explorer"  element={<RoleGuard roles={['admin','analyst']}><ComponentDisabledGuard componentKey="api_explorer"><ApiExplorerPage /></ComponentDisabledGuard></RoleGuard>} />
                <Route path="/data-quality" element={<RoleGuard roles={['admin','analyst']}><ComponentDisabledGuard componentKey="data_quality"><DataQualityPage /></ComponentDisabledGuard></RoleGuard>} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </Layout>
      </NotificationProvider>
    </WebSocketProvider>
    </WorkspaceProvider>
    </AssistantContextProvider>
    </TourProvider>
    </UIVisibilityProvider>
    </AppSettingsProvider>
  );
};

function App() {
  return (
    <ThemeContextProvider>
      <Router>
        {/* Public routes — no auth required */}
        <Routes>
          <Route path="/shared/:token" element={<SharedQueryPage />} />
          <Route path="/shared-dashboard/:token" element={<SharedDashboardPage />} />
          <Route path="/shared-business-report/:token" element={<SharedBusinessReportPage />} />
          <Route path="/embed/:token" element={<EmbeddedReportPage />} />
          <Route path="/embedded-business-report/:token" element={<EmbeddedBusinessReportPage />} />
          <Route path="/*" element={
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          } />
        </Routes>
      </Router>
    </ThemeContextProvider>
  );
}

export default App;
