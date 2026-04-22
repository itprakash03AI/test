/**
 * Admin Panel — QueryStudio Enterprise
 * Two-panel layout: left nav sidebar + right content area.
 * Only the active section loads data & polls.
 */
// @ts-nocheck
import React, { useState, useEffect, useCallback, Fragment } from 'react';
import {
  ActiveQueriesSection, SystemHealthSection, WorkerPoolSection,
  AppConfigSection, QueueConfigSection, SchedulerSection,
  UserManagementSection, UserActivitySection, StorageSection,
  CacheSection, AggCacheSection, AuditLogSection, AWSPortalSection,
  AgentsAdminSection,
} from './admin';
import {
  Box, Typography, Paper, Chip, Button, CircularProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TablePagination, TextField, InputAdornment, Divider, Alert, MenuItem,
  FormControl, InputLabel, Select,
  LinearProgress, Tooltip, Stack, IconButton, Dialog, DialogTitle,
  DialogContent, DialogActions, Collapse,
  List, ListItemButton, ListItemIcon, ListItemText,
  Switch, FormControlLabel, Drawer,
  useTheme,
} from '@mui/material';
import {
  CheckCircle as OkIcon,
  Error as ErrIcon,
  Refresh as RefreshIcon,
  Storage as StorageIcon,
  Security as AuditIcon,
  Memory as CacheIcon,
  MonitorHeart as HealthIcon,
  PlayCircleOutline as ActiveIcon,
  AccessTime as DurationIcon,
  HourglassTop as RunningIcon,
  Settings as SettingsIcon,
  Save as SaveIcon,
  Schedule as ScheduleIcon,
  Assessment as ActivityIcon,
  History as HistoryIcon,
  Hub as QueueIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  SwapHoriz as SwapHorizIcon,
  Edit as EditIconMui,
  Workspaces as WorkspacesIcon,
  PersonAdd as PersonAddIcon,
  GppGood as GppGoodIcon,
  VisibilityOff as VisibilityOffIcon,
  InfoOutlined as InfoOutlinedIcon,
} from '@mui/icons-material';
import { useNotifications } from '../context/NotificationContext';
import { getAuthHeader } from '../context/AuthContext';
import api from '../services/api';
import { safeFetch as authFetch, API_BASE_URL as API_BASE } from '../services/api/core';

// ── Formatters ──────────────────────────────────────────────────────────────
const fmtSize = (bytes: number) => {
  if (!bytes) return '0 B';
  const k = 1024, s = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${s[i]}`;
};
const fmtMb   = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
const fmtDate = (s: string)  => s ? new Date(s).toLocaleString() : '—';
const fmtDuration = (secs: number) => {
  if (secs < 60)   return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
};

// ── Stat card ───────────────────────────────────────────────────────────────
const StatCard = ({ label, value, sub = '', warn = false }) => (
  <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 120 }}>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography variant="h5" fontWeight={700}
      color={warn ? 'error.main' : 'text.primary'}>
      {value}
    </Typography>
    {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
  </Paper>
);

// ── Status chip ─────────────────────────────────────────────────────────────
const StatusChip = ({ ok, label = '' }) => (
  <Chip
    size="small"
    icon={ok
      ? <OkIcon  sx={{ fontSize: '14px !important' }} />
      : <ErrIcon sx={{ fontSize: '14px !important' }} />}
    label={label || (ok ? 'OK' : 'Error')}
    color={ok ? 'success' : 'error'}
    variant="outlined"
  />
);

// ── Live duration ticker ────────────────────────────────────────────────────
const LiveDuration = ({ seconds: initial, warn }) => {
  const [secs, setSecs] = useState(initial);
  useEffect(() => {
    setSecs(initial);
    const t = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [initial]);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <DurationIcon sx={{ fontSize: 14, color: warn ? 'error.main' : 'text.secondary' }} />
      <Typography variant="body2" fontWeight={warn ? 700 : 400}
        color={warn ? 'error.main' : 'text.primary'}>
        {fmtDuration(secs)}
      </Typography>
    </Box>
  );
};

// ── Admin sections definition ───────────────────────────────────────────────
type AdminSection =
  | 'activeQueries' | 'systemHealth' | 'workerPool'
  | 'appConfig' | 'scheduler' | 'queueConfig' | 'governance'
  | 'userManagement' | 'userActivity'
  | 'storage' | 'cache' | 'aggCache' | 'auditLog' | 'auditExplorer'
  | 'rlsPolicies' | 'connectionProfiles' | 'workspaces'
  | 'auditCompliance' | 'uiVisibility' | 'awsPortal'
  | 'reportCatalog' | 'businessPortal' | 'delivery'
  | 'cacheExplorer'
  | 'agents';

const ADMIN_SECTIONS: { group: string; items: { id: AdminSection; label: string; icon: React.ReactNode }[] }[] = [
  { group: 'MONITORING', items: [
    { id: 'activeQueries', label: 'Active Queries', icon: <ActiveIcon fontSize="small" /> },
    { id: 'systemHealth',  label: 'System Health',  icon: <HealthIcon fontSize="small" /> },
    { id: 'workerPool',    label: 'Worker Pool',    icon: <RunningIcon fontSize="small" /> },
  ]},
  { group: 'CONFIGURATION', items: [
    { id: 'appConfig',   label: 'App Config',    icon: <SettingsIcon fontSize="small" /> },
    { id: 'governance',  label: 'Governance',    icon: <GppGoodIcon fontSize="small" /> },
    { id: 'queueConfig', label: 'Queue Backend',  icon: <QueueIcon fontSize="small" /> },
    { id: 'scheduler',   label: 'Scheduler',     icon: <ScheduleIcon fontSize="small" /> },
  ]},
  { group: 'USERS', items: [
    { id: 'userManagement', label: 'User Management', icon: <AuditIcon fontSize="small" /> },
    { id: 'userActivity',   label: 'User Activity',   icon: <ActivityIcon fontSize="small" /> },
  ]},
  { group: 'SYSTEM', items: [
    { id: 'storage',         label: 'Storage',             icon: <StorageIcon fontSize="small" /> },
    { id: 'cache',           label: 'Cache',               icon: <CacheIcon fontSize="small" /> },
    { id: 'cacheExplorer',   label: 'Cache Explorer',      icon: <CacheIcon fontSize="small" /> },
    { id: 'aggCache',        label: 'Agg Cache',           icon: <CacheIcon fontSize="small" /> },
    { id: 'auditLog',        label: 'Audit Log',           icon: <HistoryIcon fontSize="small" /> },
    { id: 'auditExplorer',   label: 'Audit Explorer',      icon: <HistoryIcon fontSize="small" /> },
    { id: 'auditCompliance', label: 'Audit & Compliance',  icon: <GppGoodIcon fontSize="small" /> },
  ]},
  { group: 'REPORTING', items: [
    { id: 'reportCatalog',      label: 'Report Catalog',       icon: <SettingsIcon fontSize="small" /> },
    { id: 'businessPortal',     label: 'Business Portal',      icon: <SettingsIcon fontSize="small" /> },
    { id: 'delivery',           label: 'Delivery & Alerts',    icon: <SettingsIcon fontSize="small" /> },
    { id: 'rlsPolicies',        label: 'Row-Level Security',   icon: <AuditIcon fontSize="small" /> },
    { id: 'connectionProfiles', label: 'Connection Profiles',  icon: <SwapHorizIcon fontSize="small" /> },
    { id: 'workspaces',         label: 'Workspaces',           icon: <WorkspacesIcon fontSize="small" /> },
  ]},
  { group: 'INTEGRATIONS', items: [
    { id: 'awsPortal', label: 'AWS Portal', icon: <StorageIcon fontSize="small" /> },
    { id: 'agents', label: 'Self-Healing Agents', icon: <HealthIcon fontSize="small" /> },
  ]},
  { group: 'ACCESS CONTROL', items: [
    { id: 'uiVisibility', label: 'UI Visibility', icon: <VisibilityOffIcon fontSize="small" /> },
  ]},
];

// All sections are self-contained; polling is handled by each extracted component.
const POLL_CONFIG: Partial<Record<AdminSection, { keys: string[]; interval: number }>> = {};

// ── RLS Policies Section ─────────────────────────────────────────────────────

const RLSAdminSection: React.FC = () => {
  const [reports, setReports]         = useState<any[]>([]);
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [policies, setPolicies]       = useState<any[]>([]);
  const [loading, setLoading]         = useState(false);
  const [addOpen, setAddOpen]         = useState(false);
  const [form, setForm]               = useState({ column_name: '', operator: '=', value_template: '', description: '' });
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');

  useEffect(() => {
    api.listReports(false).then(r => setReports(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  const loadPolicies = useCallback(async (reportId: number) => {
    setLoading(true);
    try { const res = await api.listRLSPolicies(reportId); setPolicies(res.policies || []); }
    finally { setLoading(false); }
  }, []);

  const handleSelectReport = (r: any) => {
    setSelectedReport(r);
    loadPolicies(r.id);
    setAddOpen(false);
    setError('');
  };

  const handleCreate = async () => {
    if (!form.column_name || !form.value_template) { setError('Column and value template are required'); return; }
    setSaving(true); setError('');
    try {
      await api.createRLSPolicy(selectedReport.id, form);
      setForm({ column_name: '', operator: '=', value_template: '', description: '' });
      setAddOpen(false);
      loadPolicies(selectedReport.id);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (policyId: number) => {
    try { await api.deleteRLSPolicy(policyId); loadPolicies(selectedReport.id); }
    catch (e: any) { alert(e.message); }
  };

  const handleToggle = async (policy: any) => {
    try {
      await api.updateRLSPolicy(policy.id, { is_enabled: !policy.is_enabled });
      loadPolicies(selectedReport.id);
    } catch (e: any) { alert(e.message); }
  };

  const RLS_OPERATORS = ['=', '!=', 'IN', 'NOT IN', 'LIKE', '>', '<', '>=', '<='];

  return (
    <Box sx={{ display: 'flex', gap: 3, height: '100%' }}>
      {/* Report selector */}
      <Box sx={{ width: 260, flexShrink: 0 }}>
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Select Report</Typography>
        <Paper variant="outlined" sx={{ overflow: 'hidden', maxHeight: 600, overflowY: 'auto' }}>
          {reports.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>No reports found.</Typography>
          ) : reports.map((r: any) => (
            <Box key={r.id}
              onClick={() => handleSelectReport(r)}
              sx={{
                px: 2, py: 1.25, cursor: 'pointer', borderBottom: '1px solid', borderColor: 'divider',
                bgcolor: selectedReport?.id === r.id ? 'primary.50' : 'transparent',
                borderLeft: '3px solid',
                borderLeftColor: selectedReport?.id === r.id ? 'primary.main' : 'transparent',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Typography variant="body2" fontWeight={selectedReport?.id === r.id ? 600 : 400} noWrap>
                {r.name}
              </Typography>
            </Box>
          ))}
        </Paper>
      </Box>

      {/* Policy editor */}
      <Box sx={{ flex: 1 }}>
        {!selectedReport ? (
          <Typography variant="body2" color="text.secondary">Select a report to manage its RLS policies.</Typography>
        ) : (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
              <Typography variant="subtitle1" fontWeight={600}>{selectedReport.name}</Typography>
              <Chip label="Row-Level Security" size="small" color="warning" variant="outlined" sx={{ height: 20, fontSize: 10 }} />
              <Box sx={{ flex: 1 }} />
              <Button size="small" startIcon={<AddIcon />} variant="outlined" onClick={() => setAddOpen(v => !v)}>
                Add Policy
              </Button>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}

            <Collapse in={addOpen}>
              <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1.5 }}>New RLS Policy</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                  <TextField label="Column name" size="small" value={form.column_name}
                    onChange={e => setForm(f => ({ ...f, column_name: e.target.value }))} sx={{ flex: '1 1 160px' }} />
                  <FormControl size="small" sx={{ flex: '0 0 120px' }}>
                    <InputLabel>Operator</InputLabel>
                    <Select value={form.operator} label="Operator"
                      onChange={e => setForm(f => ({ ...f, operator: e.target.value }))}>
                      {RLS_OPERATORS.map(op => <MenuItem key={op} value={op}>{op}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <TextField label="Value template" size="small" value={form.value_template}
                    onChange={e => setForm(f => ({ ...f, value_template: e.target.value }))}
                    placeholder="{username} or fixed value"
                    helperText="Use {username}, {role} tokens"
                    sx={{ flex: '1 1 200px' }} />
                  <TextField label="Description (optional)" size="small" value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))} sx={{ flex: '1 1 200px' }} />
                </Box>
                <Box sx={{ mt: 1.5, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                  <Button size="small" onClick={() => setAddOpen(false)}>Cancel</Button>
                  <Button size="small" variant="contained" onClick={handleCreate} disabled={saving}>
                    {saving ? <CircularProgress size={14} /> : 'Create Policy'}
                  </Button>
                </Box>
              </Paper>
            </Collapse>

            {loading ? <CircularProgress size={20} /> : policies.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No RLS policies. This report shows all rows to all users.</Typography>
            ) : (
              <Paper variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Column</TableCell>
                      <TableCell>Operator</TableCell>
                      <TableCell>Value Template</TableCell>
                      <TableCell>Description</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {policies.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell><Typography variant="body2" fontFamily="monospace">{p.column_name}</Typography></TableCell>
                        <TableCell><Chip label={p.operator} size="small" variant="outlined" sx={{ height: 20, fontSize: 10 }} /></TableCell>
                        <TableCell><Typography variant="body2" fontFamily="monospace">{p.value_template}</Typography></TableCell>
                        <TableCell><Typography variant="caption" color="text.secondary">{p.description || '—'}</Typography></TableCell>
                        <TableCell>
                          <Chip
                            label={p.is_enabled ? 'Active' : 'Disabled'}
                            size="small" color={p.is_enabled ? 'success' : 'default'} variant="outlined"
                            sx={{ height: 20, fontSize: 10, cursor: 'pointer' }}
                            onClick={() => handleToggle(p)}
                          />
                        </TableCell>
                        <TableCell>
                          <Tooltip title="Delete policy">
                            <IconButton size="small" color="error" onClick={() => handleDelete(p.id)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            )}

            <Alert severity="info" sx={{ mt: 2 }} icon={false}>
              <Typography variant="caption">
                RLS policies inject WHERE clauses at query execution time.
                Use <code>{'{username}'}</code> and <code>{'{role}'}</code> tokens to filter by the current user's attributes.
              </Typography>
            </Alert>
          </>
        )}
      </Box>
    </Box>
  );
};

// ── Connection Profiles Section ───────────────────────────────────────────────

const ConnectionProfilesAdminSection: React.FC = () => {
  const [profiles, setProfiles]         = useState<any[]>([]);
  const [connections, setConnections]   = useState<any[]>([]);
  const [loading, setLoading]           = useState(false);
  const [profileDlgOpen, setProfileDlgOpen] = useState(false);
  const [profileForm, setProfileForm]   = useState({ name: '', description: '' });
  const [mappingProfile, setMappingProfile] = useState<any>(null);
  const [mappings, setMappings]         = useState<any[]>([]);
  const [mappingLoading, setMappingLoading] = useState(false);

  const SQL_TYPES = ['trino', 'starburst', 'snowflake', 'databricks', 'oracle'];

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.listConnectionProfiles(),
      api.listConnections(true),
    ]).then(([pr, cr]: any[]) => {
      setProfiles((pr?.profiles || pr) || []);
      setConnections((cr || []).filter((c: any) => SQL_TYPES.includes(c.connection_type)));
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleActivate = async (id: number) => {
    await api.activateConnectionProfile(id);
    load();
  };
  const handleDeactivate = async () => {
    await api.deactivateAllProfiles();
    load();
  };
  const handleDelete = async (id: number) => {
    await api.deleteConnectionProfile(id);
    load();
  };
  const handleCreate = async () => {
    if (!profileForm.name.trim()) return;
    await api.createConnectionProfile(profileForm);
    setProfileDlgOpen(false);
    setProfileForm({ name: '', description: '' });
    load();
  };
  const openMappings = async (profile: any) => {
    setMappingProfile(profile);
    setMappingLoading(true);
    try {
      const r: any = await api.getProfileMappings(profile.id);
      setMappings((r?.mappings || r) || []);
    } finally { setMappingLoading(false); }
  };
  const handleSaveMappings = async () => {
    await api.setProfileMappings(mappingProfile.id, mappings);
    setMappingProfile(null);
    load();
  };

  const connName = (id: number) => connections.find((c: any) => c.id === id)?.name || `ID ${id}`;

  return (
    <Box sx={{ display: 'flex', height: '100%', gap: 2, p: 2 }}>
      {/* Profile list */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>Connection Profiles</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button size="small" variant="outlined" onClick={handleDeactivate}>Clear Active</Button>
            <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setProfileDlgOpen(true)}>
              New Profile
            </Button>
          </Box>
        </Box>
        {loading ? <CircularProgress size={24} /> : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {profiles.length === 0 && (
                  <TableRow><TableCell colSpan={4} align="center"><Typography variant="caption" color="text.disabled">No profiles yet</Typography></TableCell></TableRow>
                )}
                {profiles.map((p: any) => (
                  <TableRow key={p.id} selected={p.is_active}>
                    <TableCell><Typography variant="body2" fontWeight={p.is_active ? 700 : 400}>{p.name}</Typography></TableCell>
                    <TableCell>
                      {p.is_active
                        ? <Chip label="ACTIVE" size="small" color="success" />
                        : <Chip label="inactive" size="small" variant="outlined" />}
                    </TableCell>
                    <TableCell><Typography variant="caption" color="text.secondary">{p.description || '—'}</Typography></TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit mappings">
                        <IconButton size="small" onClick={() => openMappings(p)}><EditIconMui fontSize="small" /></IconButton>
                      </Tooltip>
                      {!p.is_active && (
                        <Tooltip title="Activate this profile">
                          <IconButton size="small" color="primary" onClick={() => handleActivate(p.id)}>
                            <SwapHorizIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      <Tooltip title="Delete profile">
                        <IconButton size="small" color="error" onClick={() => handleDelete(p.id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        <Alert severity="info" sx={{ mt: 1, fontSize: 12 }}>
          When a profile is active, all report executions swap matched connections to their targets. Only one profile can be active at a time.
        </Alert>
      </Box>

      {/* New profile dialog */}
      <Dialog open={profileDlgOpen} onClose={() => setProfileDlgOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>New Connection Profile</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField label="Profile Name" size="small" fullWidth value={profileForm.name}
            onChange={e => setProfileForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Production, Development, Staging" />
          <TextField label="Description (optional)" size="small" fullWidth value={profileForm.description}
            onChange={e => setProfileForm(f => ({ ...f, description: e.target.value }))} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProfileDlgOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!profileForm.name.trim()}>Create</Button>
        </DialogActions>
      </Dialog>

      {/* Mapping editor dialog */}
      <Dialog open={!!mappingProfile} onClose={() => setMappingProfile(null)} maxWidth="md" fullWidth>
        <DialogTitle>Edit Mappings — {mappingProfile?.name}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Each row maps a source connection to a target. When this profile is active, any report using the source will instead use the target.
          </Typography>
          {mappingLoading ? <CircularProgress size={24} /> : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Source Connection</TableCell>
                    <TableCell>→</TableCell>
                    <TableCell>Target Connection</TableCell>
                    <TableCell>Description</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {mappings.map((m: any, idx: number) => (
                    <TableRow key={idx}>
                      <TableCell>
                        <FormControl size="small" fullWidth>
                          <Select value={m.source_connection_id || ''} onChange={e => setMappings(ms => ms.map((r, i) => i === idx ? { ...r, source_connection_id: Number(e.target.value) } : r))}>
                            {connections.map((c: any) => <MenuItem key={c.id} value={c.id}>{c.name} ({c.connection_type})</MenuItem>)}
                          </Select>
                        </FormControl>
                      </TableCell>
                      <TableCell>→</TableCell>
                      <TableCell>
                        <FormControl size="small" fullWidth>
                          <Select value={m.target_connection_id || ''} onChange={e => setMappings(ms => ms.map((r, i) => i === idx ? { ...r, target_connection_id: Number(e.target.value) } : r))}>
                            {connections.map((c: any) => <MenuItem key={c.id} value={c.id}>{c.name} ({c.connection_type})</MenuItem>)}
                          </Select>
                        </FormControl>
                      </TableCell>
                      <TableCell>
                        <TextField size="small" placeholder="optional note" value={m.description || ''}
                          onChange={e => setMappings(ms => ms.map((r, i) => i === idx ? { ...r, description: e.target.value } : r))} />
                      </TableCell>
                      <TableCell>
                        <IconButton size="small" color="error" onClick={() => setMappings(ms => ms.filter((_, i) => i !== idx))}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Button size="small" startIcon={<AddIcon />}
                        onClick={() => setMappings(ms => [...ms, { source_connection_id: '', target_connection_id: '', description: '' }])}>
                        Add Mapping
                      </Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMappingProfile(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveMappings}>Save Mappings</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

// ══ Workspaces Admin Section (Phase 25) ═════════════════════════════════════
const WorkspaceAdminSection: React.FC = () => {
  const [workspaces, setWorkspaces] = React.useState<any[]>([]);
  const [members, setMembers] = React.useState<any[]>([]);
  const [selectedWs, setSelectedWs] = React.useState<any | null>(null);
  const [newWsOpen, setNewWsOpen] = React.useState(false);
  const [memberOpen, setMemberOpen] = React.useState(false);
  const [newWsName, setNewWsName] = React.useState('');
  const [newWsDesc, setNewWsDesc] = React.useState('');
  const [newMember, setNewMember] = React.useState('');
  const [newMemberRole, setNewMemberRole] = React.useState('member');
  const { addNotification } = useNotifications();

  const loadWorkspaces = async () => {
    const data = await api.listWorkspaces().catch(() => ({ workspaces: [] }));
    setWorkspaces(data.workspaces || []);
  };

  React.useEffect(() => { loadWorkspaces(); }, []);

  const loadMembers = async (wsId: number) => {
    const data = await api.listWorkspaceMembers(wsId).catch(() => ({ members: [] }));
    setMembers(data.members || []);
  };

  const handleCreate = async () => {
    if (!newWsName.trim()) return;
    try {
      await api.createWorkspace({ name: newWsName.trim(), description: newWsDesc.trim() || null });
      setNewWsOpen(false); setNewWsName(''); setNewWsDesc('');
      loadWorkspaces();
    } catch (e: any) { addNotification(e.message || 'Failed to create workspace', 'error'); }
  };

  const handleDelete = async (wsId: number) => {
    if (!confirm('Delete this workspace?')) return;
    await api.deleteWorkspace(wsId).catch(() => {});
    loadWorkspaces();
    if (selectedWs?.id === wsId) { setSelectedWs(null); setMemberOpen(false); }
  };

  const handleOpenMembers = (ws: any) => {
    setSelectedWs(ws);
    loadMembers(ws.id);
    setMemberOpen(true);
  };

  const handleAddMember = async () => {
    if (!newMember.trim() || !selectedWs) return;
    try {
      await api.addWorkspaceMember(selectedWs.id, { username: newMember.trim(), role: newMemberRole });
      setNewMember(''); loadMembers(selectedWs.id);
    } catch (e: any) { addNotification(e.message || 'Failed to add member', 'error'); }
  };

  const handleRemoveMember = async (username: string) => {
    if (!selectedWs) return;
    await api.removeWorkspaceMember(selectedWs.id, username).catch(() => {});
    loadMembers(selectedWs.id);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">Workspaces</Typography>
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setNewWsOpen(true)}>
          New Workspace
        </Button>
      </Box>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Members</TableCell>
            <TableCell>Created By</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {workspaces.map(ws => (
            <TableRow key={ws.id} hover>
              <TableCell><Typography variant="body2" fontWeight={500}>{ws.name}</Typography>
                {ws.description && <Typography variant="caption" color="text.secondary">{ws.description}</Typography>}
              </TableCell>
              <TableCell>{ws.member_count ?? 0}</TableCell>
              <TableCell>{ws.created_by || '—'}</TableCell>
              <TableCell align="right">
                <Tooltip title="Manage members"><IconButton size="small" onClick={() => handleOpenMembers(ws)}><PersonAddIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="Delete workspace"><IconButton size="small" color="error" onClick={() => handleDelete(ws.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* New workspace dialog */}
      <Dialog open={newWsOpen} onClose={() => setNewWsOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>New Workspace</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
          <TextField label="Name" value={newWsName} onChange={e => setNewWsName(e.target.value)} size="small" autoFocus required />
          <TextField label="Description (optional)" value={newWsDesc} onChange={e => setNewWsDesc(e.target.value)} size="small" />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewWsOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!newWsName.trim()}>Create</Button>
        </DialogActions>
      </Dialog>

      {/* Members dialog */}
      <Dialog open={memberOpen} onClose={() => setMemberOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Members — {selectedWs?.name}</DialogTitle>
        <DialogContent>
          <Table size="small" sx={{ mb: 2 }}>
            <TableHead>
              <TableRow>
                <TableCell>Username</TableCell>
                <TableCell>Role</TableCell>
                <TableCell align="right">Remove</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {members.map(m => (
                <TableRow key={m.username}>
                  <TableCell>{m.username}</TableCell>
                  <TableCell><Chip label={m.role} size="small" color={m.role === 'owner' ? 'primary' : 'default'} /></TableCell>
                  <TableCell align="right">
                    {m.role !== 'owner' && (
                      <IconButton size="small" color="error" onClick={() => handleRemoveMember(m.username)}><DeleteIcon fontSize="small" /></IconButton>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField label="Username" value={newMember} onChange={e => setNewMember(e.target.value)} size="small" sx={{ flex: 1 }} />
            <Select value={newMemberRole} onChange={e => setNewMemberRole(e.target.value)} size="small" sx={{ minWidth: 110 }}>
              <MenuItem value="member">Member</MenuItem>
              <MenuItem value="admin">Admin</MenuItem>
              <MenuItem value="owner">Owner</MenuItem>
            </Select>
            <Button variant="outlined" size="small" onClick={handleAddMember} disabled={!newMember.trim()}>Add</Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMemberOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

// ── Report Catalog Config Section (Phase 58) ─────────────────────────────────

const ReportCatalogAdminSection: React.FC = () => {
  const [cfg, setCfg] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await api.getReportCatalogConfig();
        setCfg(data);
      } finally { setLoading(false); }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await api.setReportCatalogConfig(cfg);
      setCfg(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  };

  if (loading) return <Box sx={{ p: 3 }}><CircularProgress /></Box>;

  const toggles = [
    { key: 'enabled', label: 'Catalog Enabled' },
    { key: 'certification_enabled', label: 'Certification' },
    { key: 'template_gallery_enabled', label: 'Template Gallery' },
    { key: 'sharing_enabled', label: 'Report Sharing' },
    { key: 'embed_enabled', label: 'Report Embedding' },
  ];

  const numbers = [
    { key: 'max_shares_per_report', label: 'Max Shares per Report' },
    { key: 'max_embed_tokens_per_report', label: 'Max Embed Tokens per Report' },
    { key: 'share_default_expiry_hours', label: 'Share Default Expiry (hours)' },
    { key: 'embed_default_expiry_days', label: 'Embed Default Expiry (days)' },
    { key: 'embed_max_row_limit', label: 'Embed Max Row Limit' },
  ];

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Report Catalog Configuration</Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 3 }}>
        {toggles.map(t => (
          <Paper key={t.key} variant="outlined" sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <input type="checkbox" checked={!!cfg[t.key]}
              onChange={e => setCfg((prev: any) => ({ ...prev, [t.key]: e.target.checked }))} />
            <Typography variant="body2">{t.label}</Typography>
          </Paper>
        ))}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 3 }}>
        {numbers.map(n => (
          <TextField key={n.key} label={n.label} type="number" size="small"
            value={cfg[n.key] ?? ''} fullWidth
            onChange={e => setCfg((prev: any) => ({ ...prev, [n.key]: parseInt(e.target.value) || 0 }))} />
        ))}
      </Box>

      <TextField
        label="Template Categories (comma-separated)"
        size="small" fullWidth sx={{ mb: 3 }}
        value={(cfg.template_categories || []).join(', ')}
        onChange={e => setCfg((prev: any) => ({
          ...prev,
          template_categories: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean),
        }))}
      />

      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? <CircularProgress size={16} /> : saved ? 'Saved!' : 'Save Changes'}
        </Button>
      </Box>
    </Box>
  );
};

// ── Business Portal Config Section (Phase 59) ────────────────────────────────

const BusinessPortalAdminSection: React.FC = () => {
  const [cfg, setCfg] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await api.getBusinessPortalConfig();
        setCfg(data);
      } finally { setLoading(false); }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await api.setBusinessPortalConfig(cfg);
      setCfg(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  };

  if (loading) return <Box sx={{ p: 3 }}><CircularProgress /></Box>;

  const toggles = [
    { key: 'enabled', label: 'Portal Enabled' },
    { key: 'quick_actions_enabled', label: 'Quick Actions' },
    { key: 'kpi_cards_enabled', label: 'KPI Cards' },
  ];

  const numbers = [
    { key: 'recent_reports_limit', label: 'Recent Reports Limit' },
    { key: 'favorites_limit', label: 'Favorites Limit' },
    { key: 'certified_templates_limit', label: 'Certified Templates Limit' },
    { key: 'recent_activity_limit', label: 'Recent Activity Limit' },
  ];

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Business Portal Configuration</Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 3 }}>
        {toggles.map(t => (
          <Paper key={t.key} variant="outlined" sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <input type="checkbox" checked={!!cfg[t.key]}
              onChange={e => setCfg((prev: any) => ({ ...prev, [t.key]: e.target.checked }))} />
            <Typography variant="body2">{t.label}</Typography>
          </Paper>
        ))}
      </Box>

      <TextField
        label="Welcome Message" size="small" fullWidth sx={{ mb: 2 }}
        value={cfg.welcome_message || ''}
        onChange={e => setCfg((prev: any) => ({ ...prev, welcome_message: e.target.value }))}
      />
      <TextField
        label="Welcome Subtitle" size="small" fullWidth sx={{ mb: 3 }}
        value={cfg.welcome_subtitle || ''}
        onChange={e => setCfg((prev: any) => ({ ...prev, welcome_subtitle: e.target.value }))}
      />

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 3 }}>
        {numbers.map(n => (
          <TextField key={n.key} label={n.label} type="number" size="small"
            value={cfg[n.key] ?? ''} fullWidth
            onChange={e => setCfg((prev: any) => ({ ...prev, [n.key]: parseInt(e.target.value) || 0 }))} />
        ))}
      </Box>

      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? <CircularProgress size={16} /> : saved ? 'Saved!' : 'Save Changes'}
        </Button>
      </Box>
    </Box>
  );
};

// ── Delivery & Alerts Admin Section (Phase 60) ──────────────────────────────

const DeliveryAdminSection: React.FC = () => {
  const [cfg, setCfg] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await api.getDeliveryConfig();
        setCfg(data);
      } finally { setLoading(false); }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await api.setDeliveryConfig(cfg);
      setCfg(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  };

  if (loading) return <Box sx={{ p: 3 }}><CircularProgress /></Box>;

  const toggles = [
    { key: 'enabled', label: 'Delivery Enabled' },
  ];
  const numbers = [
    { key: 'max_subscriptions_per_user', label: 'Max Subscriptions per User' },
    { key: 'max_recipients_per_subscription', label: 'Max Recipients per Subscription' },
    { key: 'retry_max_attempts', label: 'Retry Max Attempts' },
    { key: 'retry_backoff_minutes', label: 'Retry Backoff (min)' },
    { key: 'delivery_history_retention_days', label: 'History Retention (days)' },
    { key: 'max_pdf_rows', label: 'Max PDF Rows' },
    { key: 'batch_size', label: 'Batch Size' },
    { key: 'check_interval_minutes', label: 'Check Interval (min)' },
  ];

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Delivery & Alerts Configuration</Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 3 }}>
        {toggles.map(t => (
          <Paper key={t.key} variant="outlined" sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <input type="checkbox" checked={!!cfg[t.key]}
              onChange={e => setCfg((prev: any) => ({ ...prev, [t.key]: e.target.checked }))} />
            <Typography variant="body2">{t.label}</Typography>
          </Paper>
        ))}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 3 }}>
        {numbers.map(n => (
          <TextField key={n.key} label={n.label} type="number" size="small"
            value={cfg[n.key] ?? ''} fullWidth
            onChange={e => setCfg((prev: any) => ({ ...prev, [n.key]: parseInt(e.target.value) || 0 }))} />
        ))}
      </Box>

      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? <CircularProgress size={16} /> : saved ? 'Saved!' : 'Save Changes'}
        </Button>
      </Box>
    </Box>
  );
};

// ── UI Component Visibility Section ───────────────────────────────────────────

const UIVisibilityAdminSection: React.FC = () => {
  const [matrix, setMatrix]     = useState<any[]>([]);
  const [components, setComponents] = useState<any[]>([]);
  const [roles, setRoles]       = useState<string[]>([]);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const auth = getAuthHeader();
      if (auth) headers['Authorization'] = auth;
      const res = await fetch(`${API_BASE}/api/admin/ui-visibility`, { headers });
      if (res.ok) {
        const d = await res.json();
        setMatrix(d.visibility || []);
        setComponents(d.components || []);
        // Phase 107-I: super_admin always sees everything — hide the column
        // from the matrix to avoid suggesting it's a per-component toggle.
        setRoles((d.roles || []).filter((r: string) => r !== 'super_admin'));
      } else {
        setError(`API error ${res.status}: ${res.statusText} — restart the backend to apply new model.`);
      }
    } catch (e: any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Build a mutable map: { componentKey_role: enabled }
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const map: Record<string, boolean> = {};
    for (const row of matrix) {
      map[`${row.component_key}__${row.role}`] = row.enabled;
    }
    setOverrides(map);
  }, [matrix]);

  const getValue = (key: string, role: string) => {
    const k = `${key}__${role}`;
    return k in overrides ? overrides[k] : true;
  };

  const toggle = (key: string, role: string) => {
    const k = `${key}__${role}`;
    setOverrides(prev => ({ ...prev, [k]: !(prev[k] ?? true) }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const auth = getAuthHeader();
      if (auth) headers['Authorization'] = auth;
      // Only send rows that differ from default (true) or are explicitly set
      const rules = [];
      for (const [k, v] of Object.entries(overrides)) {
        const [componentKey, role] = k.split('__');
        rules.push({ component_key: componentKey, role, enabled: v });
      }
      const res = await fetch(`${API_BASE}/api/admin/ui-visibility`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ rules }),
      });
      if (res.ok) { setSaved(true); }
    } finally {
      setSaving(false);
    }
  };

  // Group components by group
  const grouped: Record<string, any[]> = {};
  for (const [key, label, group] of components) {
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push({ key, label });
  }

  if (loading) return <Box sx={{ p: 3 }}><CircularProgress size={24} /></Box>;

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <VisibilityOffIcon color="action" />
        <Typography variant="h6" fontWeight={600}>UI Component Visibility</Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>Refresh</Button>
        <Button size="small" variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving || components.length === 0}>
          {saving ? 'Saving…' : 'Save Changes'}
        </Button>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {saved && <Alert severity="success" sx={{ mb: 2 }}>Visibility settings saved.</Alert>}

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Toggle which pages/features are accessible to each role. Admins always retain full access.
        Changes take effect on the user's next page load.
      </Typography>

      {Object.entries(grouped).map(([group, items]) => (
        <Box key={group} sx={{ mb: 3 }}>
          <Typography variant="overline" color="text.disabled" sx={{ letterSpacing: 1.2 }}>{group}</Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ mt: 0.5 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, width: 220 }}>Component</TableCell>
                  {roles.map(r => (
                    <TableCell key={r} align="center" sx={{ fontWeight: 600, textTransform: 'capitalize' }}>
                      {r}
                      {r === 'admin' && (
                        <Typography variant="caption" display="block" color="text.disabled">(always on)</Typography>
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map(({ key, label }) => (
                  <TableRow key={key} hover>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{label}</TableCell>
                    {roles.map(role => (
                      <TableCell key={role} align="center">
                        <Switch
                          size="small"
                          checked={role === 'admin' ? true : getValue(key, role)}
                          disabled={role === 'admin'}
                          onChange={() => toggle(key, role)}
                          color="primary"
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      ))}
    </Box>
  );
};

// ── Audit & Compliance Section ────────────────────────────────────────────────

const AuditComplianceAdminSection: React.FC = () => {
  const [tab, setTab] = useState(0);

  // Audit Log tab state
  const [auditRows, setAuditRows] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditUsername, setAuditUsername] = useState('');
  const [auditAction, setAuditAction] = useState('');
  const [auditResourceType, setAuditResourceType] = useState('');
  const [auditDateFrom, setAuditDateFrom] = useState('');
  const [auditDateTo, setAuditDateTo] = useState('');
  const [auditOffset, setAuditOffset] = useState(0);
  const PAGE_SIZE = 100;

  // Data Access tab state
  const [accessSummary, setAccessSummary] = useState<any[]>([]);
  const [accessLoading, setAccessLoading] = useState(false);

  // GDPR tab state
  const [gdprUsername, setGdprUsername] = useState('');
  const [gdprLoading, setGdprLoading] = useState(false);

  const loadAudit = useCallback(async (offset = 0) => {
    setAuditLoading(true);
    try {
      const rows = await (api as any).getAuditLogFiltered({
        username: auditUsername || undefined,
        action: auditAction || undefined,
        resource_type: auditResourceType || undefined,
        date_from: auditDateFrom || undefined,
        date_to: auditDateTo || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      setAuditRows(Array.isArray(rows) ? rows : []);
      setAuditOffset(offset);
    } finally { setAuditLoading(false); }
  }, [auditUsername, auditAction, auditResourceType, auditDateFrom, auditDateTo]);

  const loadAccessSummary = useCallback(async () => {
    setAccessLoading(true);
    try {
      const res = await (api as any).getDataAccessSummary();
      setAccessSummary(res?.summary || []);
    } finally { setAccessLoading(false); }
  }, []);

  useEffect(() => {
    if (tab === 0) loadAudit(0);
    if (tab === 1) loadAccessSummary();
  }, [tab]);

  const handleExportCSV = () => {
    const params = new URLSearchParams();
    if (auditUsername) params.set('username', auditUsername);
    if (auditAction) params.set('action', auditAction);
    if (auditResourceType) params.set('resource_type', auditResourceType);
    if (auditDateFrom) params.set('date_from', auditDateFrom);
    if (auditDateTo) params.set('date_to', auditDateTo);
    const base = API_BASE.replace(/\/$/, '');
    const url = `${base}/api/admin/audit-log/export?${params.toString()}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = 'audit_log.csv';
    a.click();
  };

  const handleGdprExport = async () => {
    if (!gdprUsername.trim()) return;
    setGdprLoading(true);
    try { await (api as any).generateSubjectExport(gdprUsername.trim()); }
    finally { setGdprLoading(false); }
  };

  return (
    <Box>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        {['Audit Log', 'Data Access', 'GDPR Export'].map((label, i) => (
          <Button key={label} variant={tab === i ? 'contained' : 'text'} size="small"
            sx={{ mr: 1, mb: 1 }} onClick={() => setTab(i)}>
            {label}
          </Button>
        ))}
      </Box>

      {/* Tab 0: Audit Log */}
      {tab === 0 && (
        <Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2, alignItems: 'flex-end' }}>
            <TextField size="small" label="Username" value={auditUsername} onChange={e => setAuditUsername(e.target.value)} sx={{ width: 140 }} />
            <TextField size="small" label="Action" value={auditAction} onChange={e => setAuditAction(e.target.value)} sx={{ width: 140 }} />
            <TextField size="small" label="Resource Type" value={auditResourceType} onChange={e => setAuditResourceType(e.target.value)} sx={{ width: 140 }} />
            <TextField size="small" label="From (YYYY-MM-DD)" value={auditDateFrom} onChange={e => setAuditDateFrom(e.target.value)} sx={{ width: 160 }} />
            <TextField size="small" label="To (YYYY-MM-DD)" value={auditDateTo} onChange={e => setAuditDateTo(e.target.value)} sx={{ width: 160 }} />
            <Button variant="contained" size="small" onClick={() => loadAudit(0)} disabled={auditLoading}>Search</Button>
            <Button variant="outlined" size="small" onClick={handleExportCSV}>Export CSV</Button>
          </Box>
          {auditLoading ? <CircularProgress size={20} /> : (
            <Box sx={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {['Timestamp', 'Username', 'Action', 'Resource Type', 'Resource ID', 'IP Address'].map(h => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '2px solid rgba(0,0,0,0.12)', background: 'rgba(0,0,0,0.04)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {auditRows.map((r, i) => (
                    <tr key={r.id ?? i} style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                      <td style={{ padding: '4px 10px', whiteSpace: 'nowrap' }}>{r.timestamp ? new Date(r.timestamp).toLocaleString() : '—'}</td>
                      <td style={{ padding: '4px 10px' }}>{r.username}</td>
                      <td style={{ padding: '4px 10px' }}>{r.action}</td>
                      <td style={{ padding: '4px 10px' }}>{r.resource_type || '—'}</td>
                      <td style={{ padding: '4px 10px' }}>{r.resource_id || '—'}</td>
                      <td style={{ padding: '4px 10px' }}>{r.ip_address || '—'}</td>
                    </tr>
                  ))}
                  {auditRows.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: 16, textAlign: 'center', color: '#888' }}>No entries found</td></tr>
                  )}
                </tbody>
              </table>
              <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                <Button size="small" disabled={auditOffset === 0} onClick={() => loadAudit(Math.max(0, auditOffset - PAGE_SIZE))}>Previous</Button>
                <Button size="small" disabled={auditRows.length < PAGE_SIZE} onClick={() => loadAudit(auditOffset + PAGE_SIZE)}>Next</Button>
              </Box>
            </Box>
          )}
        </Box>
      )}

      {/* Tab 1: Data Access Summary */}
      {tab === 1 && (
        <Box>
          {accessLoading ? <CircularProgress size={20} /> : (
            <Box sx={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {['Username', 'Total Executions', 'Total Rows', 'Last Active', 'Exports'].map(h => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '2px solid rgba(0,0,0,0.12)', background: 'rgba(0,0,0,0.04)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {accessSummary.map((r, i) => (
                    <tr key={r.username ?? i} style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                      <td style={{ padding: '4px 10px', fontWeight: 600 }}>{r.username}</td>
                      <td style={{ padding: '4px 10px' }}>{(r.total_executions || 0).toLocaleString()}</td>
                      <td style={{ padding: '4px 10px' }}>{(r.total_rows || 0).toLocaleString()}</td>
                      <td style={{ padding: '4px 10px', whiteSpace: 'nowrap' }}>{r.last_active ? new Date(r.last_active).toLocaleString() : '—'}</td>
                      <td style={{ padding: '4px 10px' }}>{r.export_count || 0}</td>
                    </tr>
                  ))}
                  {accessSummary.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', color: '#888' }}>No data</td></tr>
                  )}
                </tbody>
              </table>
            </Box>
          )}
        </Box>
      )}

      {/* Tab 2: GDPR Export */}
      {tab === 2 && (
        <Box sx={{ maxWidth: 480 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Generate a ZIP archive containing all data QueryStudio holds for a specific user (saved queries, executions, downloads, schedules, and audit log).
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField
              size="small" label="Username" value={gdprUsername}
              onChange={e => setGdprUsername(e.target.value)}
              sx={{ flex: 1 }}
            />
            <Button
              variant="contained" size="small" startIcon={gdprLoading ? <CircularProgress size={14} color="inherit" /> : <GppGoodIcon />}
              onClick={handleGdprExport} disabled={!gdprUsername.trim() || gdprLoading}
            >
              Generate ZIP
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
};

// ══ Governance Admin Section (Phase 102-L) ═════════════════════════════════
const GovernanceAdminSection: React.FC = () => {
  const [cfg, setCfg]       = useState<any>(null);
  const [draft, setDraft]   = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/admin/governance/config');
      if (res.ok) {
        const d = await res.json();
        setCfg(d);
        setDraft({ ...d });
      } else {
        setError(`Failed to load governance config (${res.status})`);
      }
    } catch (e: any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (k: string, v: any) => {
    setDraft((d: any) => ({ ...d, [k]: v }));
    setSaved(false);
  };

  const dirty = cfg && draft && Object.keys(draft).some(k => draft[k] !== cfg[k]);

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    setError(null);
    try {
      // Send only changed keys
      const diff: Record<string, any> = {};
      for (const k of Object.keys(draft)) {
        if (draft[k] !== cfg[k]) diff[k] = draft[k];
      }
      const res = await authFetch('/api/admin/governance/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(diff),
      });
      if (res.ok) {
        setSaved(true);
        await load();
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.detail || `Save failed (${res.status})`);
      }
    } catch (e: any) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const reset = () => { if (cfg) { setDraft({ ...cfg }); setSaved(false); } };

  if (loading) return <Box sx={{ p: 3 }}><CircularProgress size={24} /></Box>;
  if (!draft) return <Alert severity="error">{error || 'Failed to load'}</Alert>;

  const roles = ['admin', 'analyst', 'viewer'];

  // Helper for numeric input
  const NumInput = ({ k, label, helperText, min = 0, max = 100000 }: any) => (
    <TextField
      size="small"
      label={label}
      type="number"
      value={draft[k] ?? 0}
      onChange={e => set(k, parseInt(e.target.value) || 0)}
      inputProps={{ min, max }}
      helperText={helperText}
      sx={{ minWidth: 160 }}
    />
  );

  // Export format checkboxes (formats as CSV string)
  const EXPORT_FORMATS = ['csv', 'excel', 'json', 'pdf'];
  const toggleFormat = (role: string, fmt: string) => {
    const key = `export_formats_${role}`;
    const current = (draft[key] || '').split(',').map((s: string) => s.trim()).filter(Boolean);
    const next = current.includes(fmt) ? current.filter((f: string) => f !== fmt) : [...current, fmt];
    set(key, next.join(','));
  };
  const hasFormat = (role: string, fmt: string) => {
    const val = draft[`export_formats_${role}`] || '';
    return val.split(',').map((s: string) => s.trim()).includes(fmt);
  };

  return (
    <Box sx={{ p: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <GppGoodIcon color="action" />
        <Typography variant="h6" fontWeight={600}>Admin Governance</Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={reset} disabled={!dirty || saving}>Reset</Button>
        <Button size="small" variant="contained" startIcon={<SaveIcon />}
                onClick={save} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save Changes'}
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {saved && !dirty && <Alert severity="success" sx={{ mb: 2 }}>Governance config saved.</Alert>}

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Per-role rate limits, daily quotas, export controls, and resource caps. When disabled, all
        limits are bypassed (backwards-compatible mode).
      </Typography>

      {/* Master switch */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <FormControlLabel
          control={<Switch checked={!!draft.enabled}
                           onChange={e => set('enabled', e.target.checked)}
                           color="primary" />}
          label={<Typography fontWeight={600}>Governance enforcement enabled</Typography>}
        />
        <Typography variant="caption" display="block" color="text.secondary" sx={{ ml: 5 }}>
          Master switch — when off, no rate-limits / quotas / ACLs are enforced.
        </Typography>
      </Paper>

      {/* Rate limits (per-minute) */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>Rate Limits (queries per minute)</Typography>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          {roles.map(r => (
            <NumInput key={r} k={`rate_limit_${r}`} label={`${r} / min`}
                      helperText="0 = blocked" min={0} max={10000} />
          ))}
        </Stack>
      </Paper>

      {/* Daily quotas */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>Daily Query Quotas</Typography>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          {roles.map(r => (
            <NumInput key={r} k={`daily_quota_${r}`} label={`${r} / day`}
                      helperText="0 = unlimited" min={0} max={100000} />
          ))}
        </Stack>
      </Paper>

      {/* Export controls */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>Export Controls</Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Role</TableCell>
                {EXPORT_FORMATS.map(f => (
                  <TableCell key={f} align="center" sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.7rem' }}>
                    {f}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {roles.map(r => (
                <TableRow key={r} hover>
                  <TableCell sx={{ textTransform: 'capitalize', fontWeight: 500 }}>{r}</TableCell>
                  {EXPORT_FORMATS.map(f => (
                    <TableCell key={f} align="center">
                      <Switch size="small" checked={hasFormat(r, f)}
                              onChange={() => toggleFormat(r, f)} color="primary" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <Stack direction="row" spacing={2} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
          <NumInput k="export_rate_limit_per_minute" label="Export rate limit/min"
                    helperText="All roles" min={1} max={1000} />
          <NumInput k="export_max_file_size_mb" label="Max file size (MB)"
                    helperText="Per-export cap" min={1} max={10000} />
        </Stack>
      </Paper>

      {/* Resource quotas */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>Per-User Resource Quotas</Typography>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          <NumInput k="max_connections_per_user" label="Max connections"
                    helperText="Per user" min={1} max={1000} />
          <NumInput k="max_schedules_per_user" label="Max schedules"
                    helperText="Per user" min={1} max={1000} />
          <NumInput k="max_published_views_per_user" label="Max published views"
                    helperText="Per user" min={1} max={1000} />
        </Stack>
      </Paper>

      {/* Misc */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>Advanced</Typography>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          <NumInput k="audit_log_max_results" label="Audit log max results"
                    helperText="Per query" min={10} max={10000} />
          <NumInput k="daily_quota_cache_ttl_seconds" label="Quota cache TTL (sec)"
                    helperText="In-proc cache" min={1} max={3600} />
        </Stack>
      </Paper>
    </Box>
  );
};

// ══ Audit Explorer Admin Section (Phase 102-M) ══════════════════════════════
const AuditExplorerAdminSection: React.FC = () => {
  const [days, setDays]               = useState(7);
  const [username, setUsername]       = useState<string>('');
  const [summary, setSummary]         = useState<any[]>([]);
  const [distinct, setDistinct]       = useState<{ usernames: string[]; actions: string[]; resource_types: string[] }>({ usernames: [], actions: [], resource_types: [] });
  const [detailed, setDetailed]       = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = `?days=${days}${username ? `&username=${encodeURIComponent(username)}` : ''}`;
      const [sRes, dRes, stRes] = await Promise.all([
        authFetch(`/api/admin/audit-log/action-summary${qs}`),
        authFetch(`/api/admin/audit-log/distinct-values?days=${Math.max(days, 30)}`),
        authFetch(`/api/admin/usage-stats/detailed?days=${Math.min(days, 90)}`),
      ]);
      if (sRes.ok)  setSummary((await sRes.json()).summary || []);
      if (dRes.ok)  setDistinct(await dRes.json());
      if (stRes.ok) setDetailed((await stRes.json()).rows || []);
      if (!sRes.ok) setError(`Action summary failed (${sRes.status})`);
    } catch (e: any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [days, username]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = () => {
    const header = 'action,count,last_seen';
    const rows = summary.map(r => `${r.action},${r.count},${r.last_seen || ''}`);
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `audit-summary-${days}d.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const maxCount = Math.max(1, ...summary.map((r: any) => r.count || 0));

  return (
    <Box sx={{ p: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <HistoryIcon color="action" />
        <Typography variant="h6" fontWeight={600}>Audit Explorer</Typography>
        <Box sx={{ flex: 1 }} />
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Days</InputLabel>
          <Select value={days} label="Days" onChange={e => setDays(Number(e.target.value))}>
            {[1, 7, 14, 30, 60, 90].map(d => <MenuItem key={d} value={d}>{d} days</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>User</InputLabel>
          <Select value={username} label="User" onChange={e => setUsername(String(e.target.value))}>
            <MenuItem value="">All users</MenuItem>
            {distinct.usernames.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
          </Select>
        </FormControl>
        <Button size="small" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>Refresh</Button>
        <Button size="small" variant="outlined" onClick={exportCsv} disabled={summary.length === 0}>
          Export CSV
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {/* Action summary bar chart */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
          Action Summary (last {days} days{username ? ` · ${username}` : ''})
        </Typography>
        {summary.length === 0 ? (
          <Typography variant="caption" color="text.disabled">No audit events in range</Typography>
        ) : (
          <Box>
            {summary.slice(0, 20).map((r: any) => (
              <Box key={r.action} sx={{ mb: 0.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                  <Typography variant="caption" sx={{ fontFamily: 'monospace', minWidth: 200 }}>
                    {r.action}
                  </Typography>
                  <Box sx={{ flex: 1, height: 16, bgcolor: 'action.hover', borderRadius: 0.5, position: 'relative' }}>
                    <Box sx={{
                      position: 'absolute', top: 0, left: 0, bottom: 0,
                      width: `${(r.count / maxCount * 100).toFixed(1)}%`,
                      bgcolor: 'primary.main', borderRadius: 0.5,
                    }} />
                  </Box>
                  <Typography variant="caption" fontWeight={700} sx={{ minWidth: 60, textAlign: 'right' }}>
                    {r.count}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Paper>

      {/* Detailed per-user/per-day table */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
          Per-User Daily Executions (last {Math.min(days, 90)} days)
        </Typography>
        {detailed.length === 0 ? (
          <Typography variant="caption" color="text.disabled">No execution data</Typography>
        ) : (
          <TableContainer sx={{ maxHeight: 400 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>User</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>Executions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {detailed.map((r, i) => (
                  <TableRow key={i} hover>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{r.date}</TableCell>
                    <TableCell>{r.username}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>{r.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Box>
  );
};

// ══ Cache Explorer Admin Section (Phase 104-M) ══════════════════════════════
const CacheExplorerAdminSection: React.FC = () => {
  const { addNotification } = useNotifications();
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [connFilter, setConnFilter] = useState('');
  const [tableFilter, setTableFilter] = useState('');
  const [selected, setSelected] = useState<any | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailEntry, setDetailEntry] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (connFilter) params.append('connection_id', connFilter);
      if (tableFilter) params.append('table', tableFilter);
      const r = await authFetch(`/api/admin/cache/entries?${params}`);
      const data = await r.json();
      setEntries(data.entries || []);
    } catch (e) {
      addNotification('Failed to load cache entries', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openDetail = async (entry: any) => {
    setDrawerOpen(true);
    setDetailEntry(null);
    setDetailLoading(true);
    try {
      const r = await authFetch(`/api/admin/cache/entries/${entry.cache_key}`);
      setDetailEntry(await r.json());
    } catch {
      setDetailEntry(entry);
    } finally {
      setDetailLoading(false);
    }
  };

  const evict = async (cacheKey: string) => {
    try {
      await authFetch(`/api/admin/cache/entries/${cacheKey}`, { method: 'DELETE' });
      addNotification('Cache entry evicted', 'success');
      setDrawerOpen(false);
      load();
    } catch {
      addNotification('Eviction failed', 'error');
    }
  };

  const stalenessColor = (s: string) => {
    if (s === 'fresh') return 'success';
    if (s === 'stale') return 'error';
    if (s === 'legacy') return 'default';
    return 'warning';
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Cache Explorer</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        View, inspect, and evict query result cache entries. Cache fingerprints track partition
        snapshots for automatic staleness detection.
      </Typography>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        <TextField size="small" label="Connection ID" value={connFilter}
          onChange={e => setConnFilter(e.target.value)} sx={{ width: 160 }} />
        <TextField size="small" label="Table name" value={tableFilter}
          onChange={e => setTableFilter(e.target.value)} sx={{ width: 200 }} />
        <Button variant="outlined" size="small" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
        <Typography variant="caption" color="text.secondary">
          {entries.length} entries
        </Typography>
      </Stack>

      <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 500 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Key</TableCell>
              <TableCell>Connection</TableCell>
              <TableCell>Tables</TableCell>
              <TableCell>Cached</TableCell>
              <TableCell>Size</TableCell>
              <TableCell>Hits</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {entries.map(e => (
              <TableRow key={e.cache_key} hover>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>
                  {e.cache_key.slice(0, 12)}…
                </TableCell>
                <TableCell>{e.connection_name || e.connection_id || '—'}</TableCell>
                <TableCell>{(e.tables || []).join(', ') || '—'}</TableCell>
                <TableCell>
                  {e.age_seconds != null ? `${Math.round(e.age_seconds / 60)}m ago` : '—'}
                </TableCell>
                <TableCell>{e.size_mb} MB</TableCell>
                <TableCell>{e.hit_count}</TableCell>
                <TableCell>
                  <Chip size="small" label={e.staleness || 'unknown'}
                    color={stalenessColor(e.staleness) as any} />
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5}>
                    <IconButton size="small" title="View details" onClick={() => openDetail(e)}>
                      <InfoOutlinedIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" title="Evict" onClick={() => evict(e.cache_key)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
            {!loading && entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                    No cache entries found.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}
        PaperProps={{ sx: { width: 480, p: 2 } }}>
        {detailLoading ? (
          <Typography>Loading…</Typography>
        ) : detailEntry ? (
          <Box>
            <Typography variant="h6" gutterBottom>Cache Entry Detail</Typography>
            <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {detailEntry.cache_key}
            </Typography>
            <Divider sx={{ my: 1.5 }} />
            <Stack spacing={0.5}>
              <Typography variant="body2"><strong>Cached at:</strong> {detailEntry.created_at || '—'}</Typography>
              <Typography variant="body2"><strong>Expires at:</strong> {detailEntry.expires_at || '—'}</Typography>
              <Typography variant="body2"><strong>Size:</strong> {Math.round((detailEntry.file_size_bytes || 0) / 1048576 * 100) / 100} MB</Typography>
              <Typography variant="body2"><strong>Rows:</strong> {detailEntry.row_count?.toLocaleString() || '—'}</Typography>
              <Typography variant="body2"><strong>Hits:</strong> {detailEntry.hit_count || 0}</Typography>
            </Stack>

            {(detailEntry.source_tables_json || []).length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" gutterBottom>Tables</Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Table</TableCell>
                        <TableCell>Format</TableCell>
                        <TableCell>Snapshot / Hash</TableCell>
                        <TableCell>Files</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(detailEntry.source_tables_json || []).map((t: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell>{t.table_name}</TableCell>
                          <TableCell>{t.format}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: 10 }}>
                            {t.snapshot_id || (t.file_list_hash ? t.file_list_hash.slice(0, 12) + '…' : '—')}
                          </TableCell>
                          <TableCell>{t.file_count ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}

            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" gutterBottom>Staleness</Typography>
              <Chip size="small" label={detailEntry.staleness || 'unknown'}
                color={stalenessColor(detailEntry.staleness || 'unknown') as any} />
              {detailEntry.staleness_detail && (
                <Typography variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>
                  {detailEntry.staleness_detail}
                </Typography>
              )}
            </Box>

            <Stack direction="row" spacing={1} sx={{ mt: 3 }}>
              <Button variant="outlined" color="error" size="small"
                onClick={() => evict(detailEntry.cache_key)}>
                Evict
              </Button>
              <Button variant="text" size="small" onClick={() => setDrawerOpen(false)}>
                Close
              </Button>
            </Stack>
          </Box>
        ) : null}
      </Drawer>
    </Box>
  );
};

// ══ Main component ══════════════════════════════════════════════════════════
const AdminPage = () => {
  const { addNotification } = useNotifications();
  const theme = useTheme();

  // ── Active section ──
  const [activeSection, setActiveSection] = useState<AdminSection>('activeQueries');

  const [activeQ,     setActiveQ]     = useState<any[]>([]);
  const [loading,     setLoading]     = useState({
    activeQ: true,
  });

  const setOne = (k: string, v: boolean) =>
    setLoading(prev => ({ ...prev, [k]: v }));

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadSection = useCallback(async (section: string) => {
    setOne(section, true);
    try {
      switch (section) {
        case 'activeQ': {
          const d = await authFetch(`${API_BASE}/api/admin/active-queries`).then(r => r.json());
          setActiveQ(Array.isArray(d) ? d : []);
          break;
        }
      }
    } catch (err: any) {
      // section-specific error handling handled by extracted components
    }
    setOne(section, false);
  }, []); // eslint-disable-line

  // ── Fetch active query count for nav badge (initial + 30s poll) ───────────
  useEffect(() => {
    loadSection('activeQ');
    const t = setInterval(() => loadSection('activeQ'), 30_000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line

  // ── Derived ──────────────────────────────────────────────────────────────
  const totalActive  = activeQ.length;

  // ── Renderer map ──
  const RENDERERS: Record<AdminSection, () => React.ReactNode> = {
    activeQueries:  () => <ActiveQueriesSection addNotification={addNotification} />,
    systemHealth:   () => <SystemHealthSection addNotification={addNotification} />,
    workerPool:     () => <WorkerPoolSection addNotification={addNotification} />,
    appConfig:      () => <AppConfigSection addNotification={addNotification} />,
    queueConfig:    () => <QueueConfigSection addNotification={addNotification} />,
    scheduler:      () => <SchedulerSection addNotification={addNotification} />,
    userManagement: () => <UserManagementSection addNotification={addNotification} />,
    userActivity:   () => <UserActivitySection />,
    storage:        () => <StorageSection addNotification={addNotification} />,
    cache:          () => <CacheSection addNotification={addNotification} />,
    aggCache:       () => <AggCacheSection addNotification={addNotification} />,
    auditLog:       () => <AuditLogSection />,
    governance:         () => <GovernanceAdminSection />,
    auditExplorer:      () => <AuditExplorerAdminSection />,
    cacheExplorer:      () => <CacheExplorerAdminSection />,
    rlsPolicies:        () => <RLSAdminSection />,
    connectionProfiles: () => <ConnectionProfilesAdminSection />,
    workspaces:         () => <WorkspaceAdminSection />,
    auditCompliance:    () => <AuditComplianceAdminSection />,
    uiVisibility:       () => <UIVisibilityAdminSection />,
    reportCatalog:      () => <ReportCatalogAdminSection />,
    businessPortal:     () => <BusinessPortalAdminSection />,
    delivery:           () => <DeliveryAdminSection />,
    awsPortal:          () => <AWSPortalSection addNotification={addNotification} />,
    agents:             () => <AgentsAdminSection addNotification={addNotification} />,
  };

  // Find current section label
  const currentLabel = ADMIN_SECTIONS.flatMap(g => g.items).find(i => i.id === activeSection)?.label ?? '';

  // ══════════════════════════════════════════════════════════════════════════
  // ── Render ────────────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <Box sx={{ display: 'flex', height: 'calc(100vh - 64px)' }}>

      {/* ── Left nav sidebar ── */}
      <Box sx={{
        width: 220,
        flexShrink: 0,
        borderRight: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        overflowY: 'auto',
        py: 1,
      }}>
        {/* Mini header */}
        <Box sx={{ px: 2, py: 1.5, mb: 0.5 }}>
          <Typography variant="subtitle2" fontWeight={700}>Admin Panel</Typography>
        </Box>
        <Divider />

        {ADMIN_SECTIONS.map(group => (
          <Fragment key={group.group}>
            <Typography
              variant="overline"
              sx={{
                px: 2, pt: 2, pb: 0.5, display: 'block',
                color: 'text.disabled', fontSize: '0.6rem', letterSpacing: 1.2,
              }}
            >
              {group.group}
            </Typography>
            <List disablePadding>
              {group.items.map(item => (
                <ListItemButton
                  key={item.id}
                  selected={activeSection === item.id}
                  onClick={() => setActiveSection(item.id)}
                  sx={{
                    minHeight: 38,
                    px: 2,
                    py: 0.25,
                    '&.Mui-selected': {
                      bgcolor: 'action.selected',
                      borderRight: 3,
                      borderColor: 'primary.main',
                    },
                  }}
                >
                  <ListItemIcon sx={{
                    minWidth: 30,
                    color: activeSection === item.id ? 'primary.main' : 'text.secondary',
                  }}>
                    {item.icon}
                  </ListItemIcon>
                  <ListItemText
                    primary={item.label}
                    primaryTypographyProps={{
                      fontSize: '0.82rem',
                      fontWeight: activeSection === item.id ? 600 : 400,
                    }}
                  />
                  {/* Badge for active queries count */}
                  {item.id === 'activeQueries' && totalActive > 0 && (
                    <Chip size="small" label={totalActive} color="error"
                      sx={{ height: 18, fontSize: 10, fontWeight: 700, ml: 0.5 }} />
                  )}
                </ListItemButton>
              ))}
            </List>
          </Fragment>
        ))}
      </Box>

      {/* ── Right content panel ── */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
        {/* Content header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2.5 }}>
          <Typography variant="h5" fontWeight={700}>{currentLabel}</Typography>
        </Box>

        {/* Active section content */}
        {RENDERERS[activeSection]?.()}
      </Box>

    </Box>
  );
};

export default AdminPage;
