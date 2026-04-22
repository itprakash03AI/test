import React, { useState, useEffect, lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box, Drawer, List, ListItem, ListItemButton, ListItemIcon, ListItemText,
  Typography, IconButton, Divider, Tooltip, AppBar, Toolbar, Chip, Menu, MenuItem,
  Badge, Button, Dialog, DialogTitle, DialogContent,
  Table, TableBody, TableCell, TableRow, useMediaQuery, useTheme,
  Fab, Paper, Popover,
} from '@mui/material';
import {
  MenuOpen as MenuOpenIcon,
  Menu as MenuIcon,
  Cable as ConnectionsIcon,
  Build as BuildIcon,
  Bookmark as BookmarkIcon,
  Assessment as AssessmentIcon,
  History as HistoryIcon,
  Download as DownloadIcon,
  BoltOutlined as BoltIcon,
  Wifi as WifiIcon,
  WifiOff as WifiOffIcon,
  Terminal as SqlIcon,
  ListAlt as ExecLogIcon,
  Schedule as ScheduleIcon,
  FindInPage as FilePreviewIcon,
  HelpOutline as HelpIcon,
  AccountCircle as AccountIcon,
  Logout as LogoutIcon,
  Dashboard as DashboardIcon,
  HourglassTop as RunningIcon,
  AdminPanelSettings as AdminIcon,
  Notifications as NotificationsIcon,
  Storage as StorageIcon,
  TableChart as TableChartIcon,
  Delete as DeleteIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
  Palette as PaletteIcon,
  Keyboard as KeyboardIcon,
  AutoStories as CatalogIcon,
  MenuBook as GlossaryIcon,
  InsertChart as BizReportIcon,
  SwapHoriz as ConnectorsIcon,
  Workspaces as WorkspaceIcon,
  AccountTree as LineageIcon,
  Schema as DatasetIcon,
  AutoAwesome as NLFabIcon,
  Stars as StarsIcon,
  Close as CloseIcon,
  Home as HomeIcon,
  Publish as PublishIcon,
  VpnKey as ApiKeyIcon,
  RssFeed as RssFeedIcon,
  ManageAccounts as ManageAccountsIcon,
  Explore as ExploreIcon,
} from '@mui/icons-material';
const GlobalAssistantPanel = lazy(() => import('./GlobalAssistantPanel'));
import { useWebSocket } from '../context/WebSocketContext';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { useThemeMode } from '../context/ThemeContext';
import { PALETTES, PaletteId } from '../theme';
import { useAppSettings } from '../context/AppSettingsContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { useComponentVisible } from '../context/UIVisibilityContext';
import { useTour } from '../context/TourContext';
import NotificationDrawer from './NotificationDrawer';

const DRAWER_WIDTH = 260;
const DRAWER_COLLAPSED = 64;

const navSections = [
  {
    label: '',
    items: [
      { text: 'Home',              icon: <HomeIcon />,        path: '/',                  componentKey: 'business_portal' },
    ],
  },
  {
    label: 'DATA SOURCES',
    items: [
      { text: 'Connections',       icon: <ConnectionsIcon />, path: '/connections',       componentKey: 'connections' },
      { text: 'Data Catalog',      icon: <StorageIcon />,     path: '/catalog',            componentKey: 'data_catalog' },
      { text: 'Materialized Views',icon: <TableChartIcon />,  path: '/materialized-views',componentKey: 'materialized_views' },
      { text: 'Local Tables',      icon: <TableChartIcon />,  path: '/local-tables',      componentKey: 'local_tables' },
      { text: 'Data Lineage',      icon: <LineageIcon />,     path: '/lineage',            componentKey: 'lineage' },
      { text: 'Semantic Layer',    icon: <DatasetIcon />,    path: '/datasets',           componentKey: 'semantic_layer' },
      { text: 'Glossary',          icon: <GlossaryIcon />,   path: '/glossary',           componentKey: 'glossary' },
      { text: 'Federation Views',  icon: <TableChartIcon />, path: '/federation-views',  componentKey: 'federation_views' },
      { text: 'Data Quality',      icon: <AssessmentIcon />, path: '/data-quality',       componentKey: 'data_quality' },
    ],
  },
  {
    label: 'QUERY',
    items: [
      { text: 'Query Builder',     icon: <BuildIcon />,       path: '/query-builder',     componentKey: 'query_builder' },
      { text: 'SQL Query',         icon: <SqlIcon />,         path: '/sql',               componentKey: 'sql_editor' },
      { text: 'Saved Queries',     icon: <BookmarkIcon />,    path: '/saved-queries',     componentKey: 'saved_queries' },
      { text: 'Dashboards',        icon: <DashboardIcon />,   path: '/dashboards',        componentKey: 'dashboards' },
      { text: 'Reports',           icon: <BizReportIcon />,   path: '/business-reports',  componentKey: 'business_reports' },
      { text: 'Report Catalog',    icon: <CatalogIcon />,     path: '/report-catalog',    componentKey: 'report_catalog' },
      { text: 'Report Connectors', icon: <ConnectorsIcon />,  path: '/report-connectors', componentKey: 'report_connectors' },
    ],
  },
  {
    label: 'AUTOMATION',
    items: [
      { text: 'Schedules', icon: <ScheduleIcon />, path: '/schedules', componentKey: 'schedules' },
      { text: 'Feed Files', icon: <RssFeedIcon />, path: '/feeds', componentKey: 'feeds' },
    ],
  },
  {
    label: 'HISTORY',
    items: [
      { text: 'Executions',   icon: <HistoryIcon />,     path: '/executions',  componentKey: 'executions' },
      { text: 'Exports',      icon: <DownloadIcon />,    path: '/downloads',   componentKey: 'downloads' },
      { text: 'File Preview', icon: <FilePreviewIcon />, path: '/file-preview' },
    ],
  },
  {
    label: 'ADMIN',
    items: [
      { text: 'Published Views', icon: <PublishIcon />, path: '/published-views', componentKey: 'published_views' },
      { text: 'API Keys', icon: <ApiKeyIcon />, path: '/api-keys', componentKey: 'api_keys' },
      { text: 'API Explorer', icon: <ExploreIcon />, path: '/api-explorer',    componentKey: 'api_explorer' },
      { text: 'System Accounts', icon: <ManageAccountsIcon />, path: '/system-accounts' },
      { text: 'Admin Panel', icon: <AdminIcon />, path: '/admin', componentKey: 'admin' },
    ],
  },
  {
    label: 'SUPPORT',
    items: [
      { text: 'User Guide & FAQ', icon: <HelpIcon />, path: '__help__' },
    ],
  },
];

const isActive = (itemPath: string, currentPath: string) => {
  if (itemPath === '__help__') return false;
  if (itemPath === '/') return currentPath === '/' || currentPath === '/portal';
  return currentPath.startsWith(itemPath);
};

const PAGE_TITLES = {
  '/':              'Home',
  '/query-builder': 'Query Builder',
  '/connections':   'Connections',
  '/saved-queries': 'Saved Queries',
  '/reports':       'Reports',
  '/executions':    'Execution History',
  '/downloads':     'Exports & Downloads',
  '/sql':            'SQL Query',
  '/report-manager': 'Parametric Reports',
  '/schedules':      'Scheduled Downloads',
  '/file-preview':   'File Preview',
  '/dashboards':     'Dashboards',
  '/admin':          'Admin Panel',
  '/materialized-views': 'Materialized Views',
  '/local-tables':    'Local Tables',
  '/report-catalog':     'Report Catalog',
  '/report-connectors':  'Report Connectors',
  '/lineage':            'Data Lineage',
  '/datasets':           'Semantic Layer',
  '/glossary':           'Business Glossary',
  '/datasets/:id/query': 'Dataset Query',
  '/published-views':    'Published Views',
  '/api-keys':           'API Keys',
  '/feeds':              'Feed Files',
  '/federation-views':   'Federation Views',
  '/data-quality':       'Data Quality',
  '/catalog':            'Data Catalog',
  '/api-explorer':       'API Explorer',
};

const Layout = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useTheme();
  const isCompact = useMediaQuery('(max-width:1280px)');
  const isNarrow  = useMediaQuery('(max-width:1024px)');
  const { isConnected } = useWebSocket();
  const { user, authEnabled, logout } = useAuth();
  const { runningCount, execLogs, unreadLogCount, unreadNotifCount, refreshUnreadCount, markLogsRead, clearLogs } = useNotifications();
  const { mode, palette, toggleTheme, setPalette } = useThemeMode();
  const [paletteAnchor, setPaletteAnchor] = useState<null | HTMLElement>(null);
  const appSettings = useAppSettings();
  const { activeWorkspaceId, setActiveWorkspace } = useWorkspace();
  const [wsMenuAnchor, setWsMenuAnchor] = useState<null | HTMLElement>(null);
  const [userMenuAnchor, setUserMenuAnchor] = useState<null | HTMLElement>(null);
  const [logDrawerOpen, setLogDrawerOpen] = useState(false);
  const [notifDrawerOpen, setNotifDrawerOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [nlFabOpen, setNlFabOpen] = useState(false);
  const chatbotVisible = useComponentVisible('chatbot');
  const { startTour, availableTours } = useTour();
  const [helpMenuAnchor, setHelpMenuAnchor] = useState<null | HTMLElement>(null);
  const [open, setOpen] = useState(() => {
    const saved = localStorage.getItem('sidebarOpen');
    return saved !== null ? saved === 'true' : true;
  });

  // Auto-collapse sidebar on laptops / small screens
  useEffect(() => {
    if (isCompact && open) setOpen(false);
    if (!isCompact && !open) {
      const saved = localStorage.getItem('sidebarOpen');
      if (saved === 'true') setOpen(true);
    }
  }, [isCompact]);

  useEffect(() => {
    localStorage.setItem('sidebarOpen', String(open));
  }, [open]);

  // ? key → show keyboard shortcuts dialog
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen(v => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const drawerWidth = open ? DRAWER_WIDTH : DRAWER_COLLAPSED;

  // Current page title
  const currentTitle = Object.entries(PAGE_TITLES).find(
    ([path]) => (path === '/' ? location.pathname === '/' : location.pathname.startsWith(path))
  )?.[1] ?? 'QueryStudio';

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>

      {/* ══ Sidebar ═════════════════════════════════════════════════════════ */}
      <Drawer
        variant={isNarrow ? 'temporary' : 'permanent'}
        open={isNarrow ? open : undefined}
        onClose={isNarrow ? () => setOpen(false) : undefined}
        sx={{
          width: isNarrow ? 0 : drawerWidth,
          flexShrink: 0,
          transition: 'width 0.2s ease',
          '& .MuiDrawer-paper': {
            width: isNarrow ? DRAWER_WIDTH : drawerWidth,
            overflowX: 'hidden',
            transition: isNarrow ? undefined : 'width 0.2s ease',
            borderRight: '1px solid',
            borderColor: 'divider',
          },
        }}
      >
        {/* Brand */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: open ? 2 : 0,
            py: 1.75,
            justifyContent: open ? 'flex-start' : 'center',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <BoltIcon color="primary" sx={{ fontSize: 26, flexShrink: 0 }} />
          {open && (
            <Box>
              <Typography
                variant="subtitle1"
                sx={{ fontWeight: 700, color: 'primary.main', lineHeight: 1.2 }}
              >
                QueryStudio
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Enterprise Data Platform
              </Typography>
            </Box>
          )}
        </Box>

        {/* Collapse toggle */}
        <Box sx={{ display: 'flex', justifyContent: open ? 'flex-end' : 'center', px: 1, py: 0.5 }}>
          <IconButton size="small" onClick={() => setOpen(v => !v)}>
            {open ? <MenuOpenIcon fontSize="small" /> : <MenuIcon fontSize="small" />}
          </IconButton>
        </Box>

        {/* Nav sections */}
        <Box component="nav" role="navigation" aria-label="Main navigation" data-tour="sidebar" sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {navSections.map((section, si) => (
            <React.Fragment key={si}>
              {open && (
                <Typography
                  variant="overline"
                  sx={{
                    px: 2, pt: si > 0 ? 2 : 1, pb: 0.5, display: 'block',
                    color: 'text.disabled', fontSize: '0.62rem', letterSpacing: 1.2,
                  }}
                >
                  {section.label}
                </Typography>
              )}
              {!open && si > 0 && <Divider sx={{ my: 1, mx: 1 }} />}
              <List disablePadding>
                {section.items.filter(item => {
                  const roleAccess: Record<string, string[]> = {
                    admin:   ['/', '/connections', '/materialized-views', '/local-tables', '/lineage', '/catalog', '/datasets', '/federation-views', '/data-quality', '/query-builder', '/sql', '/saved-queries', '/dashboards', '/business-reports', '/report-catalog', '/report-connectors', '/schedules', '/feeds', '/executions', '/downloads', '/file-preview', '/published-views', '/api-keys', '/api-explorer', '/system-accounts', '/admin', '__help__'],
                    analyst: ['/', '/connections', '/materialized-views', '/local-tables', '/lineage', '/catalog', '/federation-views', '/data-quality', '/query-builder', '/sql', '/saved-queries', '/dashboards', '/business-reports', '/report-catalog', '/report-connectors', '/schedules', '/feeds', '/executions', '/downloads', '/file-preview', '/published-views', '/api-explorer', '__help__'],
                    viewer:  ['/', '/saved-queries', '/dashboards', '/business-reports', '/report-catalog', '/executions', '/downloads', '/file-preview', '/catalog', '__help__'],
                  };
                  const userRole = (user as any)?.role || 'viewer';
                  // Phase 107-I: super_admin sees every nav item (same allowlist as admin).
                  if (userRole !== 'super_admin' && !(roleAccess[userRole]?.includes(item.path) ?? false)) return false;
                  // Admin-controlled visibility: hide if explicitly disabled
                  if ((item as any).componentKey) {
                    const vis = appSettings.component_visibility;
                    if (vis && Object.prototype.hasOwnProperty.call(vis, (item as any).componentKey)) {
                      if (vis[(item as any).componentKey] === false) return false;
                    }
                  }
                  return true;
                }).map((item) => {
                  const active = isActive(item.path, location.pathname);
                  // Phase 100: data-tour attributes for guided tour targeting
                  const tourMap: Record<string, string> = {
                    '/': 'home', '/query-builder': 'query-builder', '/business-reports': 'reports-nav',
                    '/data-quality': 'dq-nav', '/published-views': 'pv-nav', '__help__': 'help-menu',
                  };
                  const tourAttr = tourMap[item.path];
                  const button = (
                    <ListItem key={item.text} disablePadding {...(tourAttr ? { 'data-tour': tourAttr } : {})}>
                      <ListItemButton
                        selected={active}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => item.path === '__help__' ? window.open('/user_guide.html', '_blank') : navigate(item.path)}
                        sx={{
                          minHeight: 44,
                          justifyContent: open ? 'initial' : 'center',
                          px: open ? 2 : 1,
                        }}
                      >
                        <ListItemIcon
                          sx={{
                            minWidth: 0,
                            mr: open ? 1.5 : 0,
                            justifyContent: 'center',
                            color: active ? 'primary.main' : 'text.secondary',
                          }}
                        >
                          {item.icon}
                        </ListItemIcon>
                        {open && (
                          <ListItemText
                            primary={item.text}
                            primaryTypographyProps={{
                              fontSize: '0.875rem',
                              fontWeight: active ? 600 : 400,
                              color: active ? 'primary.main' : 'text.primary',
                            }}
                          />
                        )}
                      </ListItemButton>
                    </ListItem>
                  );
                  return open ? button : (
                    <Tooltip key={item.text} title={item.text} placement="right" arrow>
                      {button}
                    </Tooltip>
                  );
                })}
              </List>
            </React.Fragment>
          ))}
        </Box>

        {/* Footer: connection status */}
        <Box sx={{ p: open ? 2 : 1, borderTop: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: open ? 'space-between' : 'center', gap: 1 }}>
          {open ? (
            <>
              <Typography variant="caption" color="text.disabled">v2.0 · Enterprise Edition</Typography>
              <Chip
                size="small"
                icon={isConnected ? <WifiIcon sx={{ fontSize: '12px !important' }} /> : <WifiOffIcon sx={{ fontSize: '12px !important' }} />}
                label={isConnected ? 'Live' : 'Offline'}
                color={isConnected ? 'success' : 'default'}
                variant="outlined"
                sx={{ height: 20, fontSize: 11 }}
              />
            </>
          ) : (
            <Tooltip title={isConnected ? 'Live' : 'Disconnected'} placement="right">
              {isConnected
                ? <WifiIcon sx={{ fontSize: 18, color: 'success.main' }} />
                : <WifiOffIcon sx={{ fontSize: 18, color: 'text.disabled' }} />
              }
            </Tooltip>
          )}
        </Box>
      </Drawer>

      {/* ══ Main area ═══════════════════════════════════════════════════════ */}
      <Box
        component="main"
        role="main"
        sx={{
          flexGrow: 1,
          backgroundColor: 'background.default',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Top AppBar */}
        <AppBar
          position="static"
          elevation={0}
          sx={{
            color: 'white',
          }}
        >
          <Toolbar variant="dense" sx={{ minHeight: 52 }}>
            {/* Hamburger for narrow screens or collapsed sidebar */}
            {(isNarrow || !open) && (
              <IconButton size="small" onClick={() => setOpen(v => !v)} sx={{ color: 'white', mr: 1 }}>
                <MenuIcon fontSize="small" />
              </IconButton>
            )}
            <Typography variant="h6" sx={{ fontWeight: 700, flex: 1, fontSize: { xs: '1rem', sm: '1.25rem' } }}>
              {currentTitle}
            </Typography>

            {user && !isNarrow && (
              <Typography variant="body2" sx={{ ml: 2, fontWeight: 500, opacity: 0.9 }}>
                Welcome, {user.display_name || user.username}
              </Typography>
            )}

            {/* Workspace switcher */}
            {appSettings.workspaces && appSettings.workspaces.length > 0 && (
              <>
                <Tooltip title="Switch workspace" placement="bottom">
                  <Chip
                    icon={<WorkspaceIcon sx={{ fontSize: '14px !important' }} />}
                    label={appSettings.workspaces.find(w => w.id === activeWorkspaceId)?.name || 'Global'}
                    size="small"
                    onClick={e => setWsMenuAnchor(e.currentTarget)}
                    sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white', ml: 1, cursor: 'pointer', '&:hover': { bgcolor: 'rgba(255,255,255,0.3)' } }}
                  />
                </Tooltip>
                <Menu
                  anchorEl={wsMenuAnchor}
                  open={Boolean(wsMenuAnchor)}
                  onClose={() => setWsMenuAnchor(null)}
                  transformOrigin={{ horizontal: 'right', vertical: 'top' }}
                  anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
                >
                  <MenuItem disabled sx={{ opacity: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 0.5 }}>WORKSPACE</Typography>
                  </MenuItem>
                  <MenuItem onClick={() => { setActiveWorkspace(null); setWsMenuAnchor(null); }}
                    selected={activeWorkspaceId === null}>
                    Global (all)
                  </MenuItem>
                  {appSettings.workspaces.map(ws => (
                    <MenuItem key={ws.id} selected={ws.id === activeWorkspaceId}
                      onClick={() => { setActiveWorkspace(ws.id); setWsMenuAnchor(null); }}>
                      {ws.name}
                    </MenuItem>
                  ))}
                  <Divider />
                  <MenuItem onClick={() => { setWsMenuAnchor(null); navigate('/admin'); }}>
                    Manage Workspaces...
                  </MenuItem>
                </Menu>
              </>
            )}

            {/* Running queries indicator — visible from any page */}
            {runningCount > 0 && (
              <Tooltip title="Queries running in background — click to view executions" placement="bottom">
                <Chip
                  icon={<RunningIcon sx={{ fontSize: '14px !important', animation: 'spin 1.4s linear infinite', '@keyframes spin': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } } }} />}
                  label={`${runningCount} running`}
                  size="small"
                  onClick={() => navigate('/executions')}
                  sx={{
                    bgcolor: 'rgba(255,255,255,0.2)',
                    color: 'white',
                    fontWeight: 600,
                    mr: 1,
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.3)' },
                  }}
                />
              </Tooltip>
            )}

            {/* Persistent notification bell */}
            <Tooltip title={unreadNotifCount > 0 ? `${unreadNotifCount} unread notifications` : 'Notifications'} placement="bottom">
              <IconButton
                size="small"
                onClick={() => setNotifDrawerOpen(true)}
                sx={{ color: 'white', ml: 1 }}
              >
                <Badge badgeContent={unreadNotifCount} color="error" max={99}
                  sx={{ '& .MuiBadge-badge': { fontSize: 10, minWidth: 16, height: 16 } }}>
                  <NotificationsIcon fontSize="small" />
                </Badge>
              </IconButton>
            </Tooltip>

            {/* Execution logs icon */}
            <Tooltip title={unreadLogCount > 0 ? `${unreadLogCount} new log entries` : 'Execution logs'} placement="bottom">
              <IconButton
                size="small"
                onClick={() => { setLogDrawerOpen(true); markLogsRead(); }}
                sx={{ color: 'white', ml: 1 }}
              >
                <Badge badgeContent={unreadLogCount} color="warning" max={99}
                  sx={{ '& .MuiBadge-badge': { fontSize: 10, minWidth: 16, height: 16 } }}>
                  <ExecLogIcon fontSize="small" />
                </Badge>
              </IconButton>
            </Tooltip>

            <Tooltip title={mode === 'light' ? 'Dark mode' : 'Light mode'} placement="bottom">
              <IconButton size="small" onClick={toggleTheme} sx={{ color: 'white', ml: 1 }}>
                {mode === 'light' ? <DarkModeIcon fontSize="small" /> : <LightModeIcon fontSize="small" />}
              </IconButton>
            </Tooltip>

            {/* Palette picker */}
            <Tooltip title="Theme colour" placement="bottom">
              <IconButton size="small" onClick={e => setPaletteAnchor(e.currentTarget)}
                sx={{ color: 'white', ml: 0.5 }}>
                <PaletteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Popover
              open={Boolean(paletteAnchor)}
              anchorEl={paletteAnchor}
              onClose={() => setPaletteAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              PaperProps={{ sx: { p: 1.5, borderRadius: 2 } }}
            >
              <Typography variant="caption" color="text.secondary"
                sx={{ display: 'block', mb: 1, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', fontSize: '0.68rem' }}>
                Accent colour
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                {(Object.entries(PALETTES) as [PaletteId, typeof PALETTES[PaletteId]][]).map(([id, def]) => (
                  <Tooltip key={id} title={def.name} placement="bottom">
                    <Box
                      onClick={() => { setPalette(id); setPaletteAnchor(null); }}
                      sx={{
                        width: 32, height: 32, borderRadius: '50%',
                        bgcolor: def.main,
                        cursor: 'pointer',
                        border: palette === id ? `3px solid ${def.dark}` : '3px solid transparent',
                        boxShadow: palette === id
                          ? `0 0 0 2px white, 0 0 0 4px ${def.main}`
                          : '0 1px 3px rgba(0,0,0,0.2)',
                        transition: 'box-shadow 0.15s, transform 0.1s',
                        '&:hover': { transform: 'scale(1.15)', boxShadow: `0 0 0 2px white, 0 0 0 4px ${def.main}` },
                      }}
                    />
                  </Tooltip>
                ))}
              </Box>
            </Popover>
            <Tooltip title="Help & Tours" placement="bottom">
              <IconButton
                data-tour="help-menu"
                size="small"
                onClick={e => setHelpMenuAnchor(e.currentTarget)}
                sx={{ color: 'white', ml: 1 }}
              >
                <HelpIcon />
              </IconButton>
            </Tooltip>
            <Menu
              anchorEl={helpMenuAnchor}
              open={Boolean(helpMenuAnchor)}
              onClose={() => setHelpMenuAnchor(null)}
              transformOrigin={{ horizontal: 'right', vertical: 'top' }}
              anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            >
              <MenuItem onClick={() => { window.open('/user_guide.html', '_blank'); setHelpMenuAnchor(null); }}>
                User Guide & FAQ
              </MenuItem>
              <Divider />
              {availableTours.map(tour => (
                <MenuItem key={tour.id} onClick={() => { startTour(tour.id); setHelpMenuAnchor(null); }}>
                  Tour: {tour.name}
                </MenuItem>
              ))}
            </Menu>
            {authEnabled && user && (
              <>
                <Tooltip title={`${user.display_name || user.username} (${((user as any)?.role || 'viewer').charAt(0).toUpperCase() + ((user as any)?.role || 'viewer').slice(1)})`} placement="bottom">
                  <IconButton
                    size="small"
                    onClick={e => setUserMenuAnchor(e.currentTarget)}
                    sx={{ color: 'white', ml: 1 }}
                  >
                    <AccountIcon />
                  </IconButton>
                </Tooltip>
                <Menu
                  anchorEl={userMenuAnchor}
                  open={Boolean(userMenuAnchor)}
                  onClose={() => setUserMenuAnchor(null)}
                  transformOrigin={{ horizontal: 'right', vertical: 'top' }}
                  anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
                >
                  <MenuItem disabled sx={{ opacity: 1 }}>
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {user.display_name || user.username}
                      </Typography>
                      <Typography variant="caption" color="primary">
                        {((user as any)?.role || 'viewer').charAt(0).toUpperCase() + ((user as any)?.role || 'viewer').slice(1)}
                      </Typography>
                    </Box>
                  </MenuItem>
                  <Divider />
                  <MenuItem onClick={() => { setUserMenuAnchor(null); logout(); }}>
                    <LogoutIcon fontSize="small" sx={{ mr: 1 }} />
                    Sign Out
                  </MenuItem>
                </Menu>
              </>
            )}
          </Toolbar>
        </AppBar>

        {/* Page content */}
        <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {children}
        </Box>

        {/* Footer */}
        <Box sx={{
          px: 2, py: 0.5,
          borderTop: 1, borderColor: 'divider',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          bgcolor: 'background.paper',
          flexShrink: 0,
        }}>
          <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10, letterSpacing: 0.3 }}>
            Powered by <strong style={{ fontWeight: 700 }}>Output Gateway</strong>
          </Typography>
        </Box>
      </Box>

      {/* Execution logs sidebar drawer */}
      <Drawer
        anchor="right"
        open={logDrawerOpen}
        onClose={() => setLogDrawerOpen(false)}
        PaperProps={{ sx: { width: { xs: '100%', sm: 380 }, maxWidth: '100vw' } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover' }}>
          <ExecLogIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />
          <Typography variant="subtitle2" sx={{ flex: 1, fontWeight: 700 }}>Execution Logs</Typography>
          {execLogs.length > 0 && (
            <Tooltip title="Clear all logs">
              <IconButton size="small" onClick={clearLogs}><DeleteIcon fontSize="small" /></IconButton>
            </Tooltip>
          )}
        </Box>
        <Box sx={{ flex: 1, overflow: 'auto', px: 1.5, py: 1 }}>
          {execLogs.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
              No execution logs yet. Logs appear here as queries run.
            </Typography>
          ) : (
            execLogs.slice().reverse().map((log, i) => {
              const isError = log.message.startsWith('[ERROR]');
              const isCompleted = log.message.startsWith('[COMPLETED]');
              const isCancelled = log.message.startsWith('[CANCELLED]');
              const isStatus = isError || isCompleted || isCancelled;
              const statusColor = isError ? '#dc2626' : isCompleted ? '#16a34a' : isCancelled ? '#d97706' : '#334155';
              const statusBg = isError ? '#fef2f2' : isCompleted ? '#f0fdf4' : isCancelled ? '#fffbeb' : 'transparent';
              const statusBorder = isError ? '#fecaca' : isCompleted ? '#bbf7d0' : isCancelled ? '#fde68a' : '#f1f5f9';
              return (
                <Box key={i} sx={{
                  display: 'flex', gap: 1, py: isStatus ? 0.75 : 0.5, px: isStatus ? 1 : 0,
                  borderBottom: `1px solid ${i < execLogs.length - 1 ? statusBorder : 'transparent'}`,
                  bgcolor: statusBg, borderRadius: isStatus ? 1 : 0,
                  mb: isStatus ? 0.5 : 0,
                  '&:hover': { bgcolor: isError ? '#fee2e2' : isCompleted ? '#dcfce7' : isCancelled ? '#fef3c7' : '#f8fafc' },
                }}>
                  <Typography sx={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', whiteSpace: 'nowrap', mt: '2px', minWidth: 64 }}>
                    {new Date(log.ts).toLocaleTimeString()}
                  </Typography>
                  <Typography sx={{
                    fontSize: 12, fontFamily: 'monospace', lineHeight: 1.5, wordBreak: 'break-word',
                    color: statusColor, fontWeight: isStatus ? 600 : 400,
                  }}>
                    {log.message}
                  </Typography>
                </Box>
              );
            })
          )}
        </Box>
      </Drawer>

      {/* Persistent notification drawer */}
      <NotificationDrawer
        open={notifDrawerOpen}
        onClose={() => setNotifDrawerOpen(false)}
        onUnreadCountChange={refreshUnreadCount}
      />

      {/* ── Global Assistant FAB ── visible on every page (admin can disable via component visibility) */}
      {chatbotVisible && <Box sx={{ position: 'fixed', bottom: 20, right: 24, zIndex: 1400, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
        {nlFabOpen && (
          <Paper
            elevation={12}
            sx={{
              width: 370,
              height: 540,
              borderRadius: 2.5,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              border: '1.5px solid',
              borderColor: 'primary.main',
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            }}
          >
            <Suspense fallback={<Box sx={{ p: 2, textAlign: 'center' }}><Typography variant="caption" color="text.secondary">Loading assistant...</Typography></Box>}>
              <GlobalAssistantPanel onClose={() => setNlFabOpen(false)} />
            </Suspense>
          </Paper>
        )}
        <Tooltip title={nlFabOpen ? 'Close Assistant' : 'Open QueryStudio Assistant'} placement="left">
          <Fab
            size="medium"
            onClick={() => setNlFabOpen(v => !v)}
            sx={{
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
              '&:hover': {
                bgcolor: 'primary.dark',
                boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
              },
              '@keyframes fabPulse': {
                '0%':   { boxShadow: '0 4px 20px rgba(0,0,0,0.25)' },
                '50%':  { boxShadow: '0 4px 28px rgba(0,0,0,0.4)' },
                '100%': { boxShadow: '0 4px 20px rgba(0,0,0,0.25)' },
              },
              animation: nlFabOpen ? 'none' : 'fabPulse 2.4s ease-in-out infinite',
            }}
          >
            {nlFabOpen ? (
              <CloseIcon />
            ) : (
              /* Stacked: AutoAwesome (white) + small gold Stars overlay */
              <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <NLFabIcon sx={{ fontSize: 22, color: '#fff' }} />
                <StarsIcon sx={{
                  fontSize: 11,
                  color: '#FFD700',
                  position: 'absolute',
                  top: -4,
                  right: -5,
                  filter: 'drop-shadow(0 0 2px rgba(255,215,0,0.8))',
                }} />
              </Box>
            )}
          </Fab>
        </Tooltip>
      </Box>}

      {/* Keyboard shortcuts dialog */}
      <Dialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <KeyboardIcon fontSize="small" /> Keyboard Shortcuts
        </DialogTitle>
        <DialogContent dividers>
          <Table size="small">
            <TableBody>
              {[
                ['Ctrl + Enter', 'Execute query'],
                ['Ctrl + S', 'Save query'],
                ['Ctrl + Shift + E', 'Toggle SQL preview'],
                ['Escape', 'Close dialog / panel'],
                ['?', 'Show this help'],
              ].map(([key, desc]) => (
                <TableRow key={key}>
                  <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap', width: 160 }}>{key}</TableCell>
                  <TableCell>{desc}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default Layout;
