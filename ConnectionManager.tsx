import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, IconButton, Chip, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, MenuItem, Alert, CircularProgress, Tooltip, Stack,
  Divider, InputAdornment, FormHelperText, Collapse, FormControlLabel, Switch,
  Snackbar, Accordion, AccordionSummary, AccordionDetails,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  PlayArrow as TestIcon,
  Storage as StorageIcon,
  Folder as FolderIcon,
  CloudQueue as CloudIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  Refresh as RefreshIcon,
  Terminal as SqlIcon,
  Visibility as VisibleIcon,
  VisibilityOff as HiddenIcon,
  Search as DiscoverIcon,
  TableChart as TableIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  People as SharedIcon,
  CloudUpload as UploadIcon,
  InsertDriveFile as FileIcon,
  Close as CloseIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import api from '../services/api';
import { API_BASE_URL } from '../services/api/core';

// ── Connection type metadata ──────────────────────────────────────────────────
const CONN_TYPE_META: Record<string, { label: string; icon: React.ReactElement; color: string }> = {
  s3:         { label: 'AWS S3 Bucket',   icon: <CloudIcon fontSize="small" />,  color: '#f59e0b' },
  local:      { label: 'Local Folder',    icon: <FolderIcon fontSize="small" />, color: '#6366f1' },
  upload:     { label: 'Upload Files',    icon: <UploadIcon fontSize="small" />, color: '#10b981' },
  trino:      { label: 'Trino',           icon: <SqlIcon fontSize="small" />,    color: '#3b82f6' },
  starburst:  { label: 'Starburst',       icon: <SqlIcon fontSize="small" />,    color: '#f97316' },
  snowflake:  { label: 'Snowflake',       icon: <SqlIcon fontSize="small" />,    color: '#22d3ee' },
  databricks: { label: 'Databricks SQL',  icon: <SqlIcon fontSize="small" />,    color: '#ef4444' },
  oracle:     { label: 'Oracle Database', icon: <SqlIcon fontSize="small" />,    color: '#c2410c' },
  rest_api:   { label: 'REST API',        icon: <CloudIcon fontSize="small" />,  color: '#8b5cf6' },
};

const SQL_TYPES = ['trino', 'starburst', 'snowflake', 'databricks', 'oracle'];
const REST_API_TYPES = ['rest_api'];

// Bucket name and ARN validation regexes (Phase 78P)
const S3_BUCKET_AWS_RE    = /^[a-z0-9]([a-z0-9\-]{1,61}[a-z0-9])?$/;
const S3_BUCKET_ONPREM_RE = /^[a-zA-Z0-9][a-zA-Z0-9\-_\.]{0,253}[a-zA-Z0-9]$/;
const IAM_ARN_RE          = /^arn:(aws|aws-cn|aws-us-gov):iam::\d{12}:role\/[\w+=,.@\-\/]{1,256}$/;

const EMPTY_CONFIGS = {
  s3:         { bucket_name: '', region_name: 'us-east-1', auth_mode: 'keys', aws_access_key_id: '', aws_secret_access_key: '', aws_session_token: '', aws_profile: '', role_arn: '', role_session_name: 'parquet-engine', external_id: '', endpoint_url: '', path_style: false, ssl_verify: true, iceberg_warehouse_path: '', root_prefix: '', registered_tables: [] as any[] },
  local:      { base_path: '' },
  upload:     { base_path: '' },
  trino:      { host: '', port: 443, user: '', auth_type: 'basic', password: '', token: '', catalog: '', schema: '', http_scheme: 'https', verify_ssl: true },
  starburst:  { host: '', port: 443, user: '', auth_type: 'basic', password: '', token: '', catalog: '', schema: '', http_scheme: 'https', verify_ssl: true },
  snowflake:  { account: '', user: '', auth_type: 'password', password: '', private_key: '', private_key_passphrase: '', token: '', warehouse: '', database: '', schema: '', role: '' },
  databricks: { server_hostname: '', http_path: '', access_token: '', catalog: '', schema: '' },
  oracle:     { host: '', port: 1521, service_name: '', sid: '', dsn: '', user: '', password: '', wallet_location: '', wallet_password: '' },
  rest_api:   { base_url: '', auth_type: 'bearer', token: '', username: '', password: '', api_key_name: '', api_key_value: '', api_key_location: 'header', client_id: '', client_secret: '', token_url: '', default_headers: '{}', timeout_seconds: 30, verify_ssl: true, rate_limit_rps: 10 },
};

const AWS_REGIONS = [
  { value: 'us-east-1',      label: 'US East (N. Virginia)' },
  { value: 'us-east-2',      label: 'US East (Ohio)' },
  { value: 'us-west-1',      label: 'US West (N. California)' },
  { value: 'us-west-2',      label: 'US West (Oregon)' },
  { value: 'eu-west-1',      label: 'EU (Ireland)' },
  { value: 'eu-central-1',   label: 'EU (Frankfurt)' },
  { value: 'ap-south-1',     label: 'Asia Pacific (Mumbai)' },
  { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
  { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
];

// ── Password field with show/hide toggle ─────────────────────────────────────
const PasswordField = ({ label, value, onChange, required = false, placeholder = '', helperText = '' }: {
  label: string; value: string; onChange: (v: string) => void;
  required?: boolean; placeholder?: string; helperText?: string;
}) => {
  const [show, setShow] = useState(false);
  return (
    <TextField
      label={label}
      fullWidth
      size="small"
      type={show ? 'text' : 'password'}
      value={value}
      onChange={e => onChange(e.target.value)}
      required={required}
      placeholder={placeholder}
      helperText={helperText}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <IconButton size="small" onClick={() => setShow(v => !v)} edge="end">
              {show ? <HiddenIcon sx={{ fontSize: 18 }} /> : <VisibleIcon sx={{ fontSize: 18 }} />}
            </IconButton>
          </InputAdornment>
        ),
      }}
    />
  );
};

// ── Section header ─────────────────────────────────────────────────────────────
const SectionLabel = ({ children }) => (
  <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5, mt: 0.5 }}>
    {children}
  </Typography>
);

// ── System Account Selector (Phase 87) ────────────────────────────────────────
const SystemAccountSelector = ({ value, accountType, onChange }: {
  value: number | undefined; accountType: string; onChange: (id: number) => void;
}) => {
  const [accounts, setAccounts] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setLoading(true);
    api.get(`/api/admin/system-accounts?account_type=${accountType}`)
      .then((res: any) => setAccounts(res.accounts || []))
      .catch(() => setAccounts([]))
      .finally(() => setLoading(false));
  }, [accountType]);

  if (loading) return <CircularProgress size={20} />;
  if (accounts.length === 0) {
    return (
      <Alert severity="warning" sx={{ fontSize: 12 }}>
        No system accounts configured for type "{accountType}". Ask an admin to create one
        under Admin &rarr; System Accounts.
      </Alert>
    );
  }

  return (
    <TextField
      select label="System Account" fullWidth size="small"
      value={value || ''}
      onChange={e => onChange(Number(e.target.value))}
      helperText="Select the system/service account to use for credential fetching"
    >
      {accounts.map((a: any) => (
        <MenuItem key={a.id} value={a.id}>
          {a.name} ({a.username}) {a.last_status === 'failed' ? ' — FAILED' : ''}
        </MenuItem>
      ))}
    </TextField>
  );
};

// ── S3 Config Form ─────────────────────────────────────────────────────────────
const S3_AUTH_MODES = [
  { value: 'portal',      label: 'Auto (Portal SSO)',              desc: 'Automatically fetch temporary AWS credentials from the corporate portal using your AD login or a system account.' },
  { value: 'iam_role',    label: 'IAM Role / Instance Profile',  desc: 'Server uses its attached IAM role or environment credential chain (EC2, ECS, EKS, env vars). No keys needed.' },
  { value: 'profile',     label: 'AWS SSO / Named Profile',       desc: 'Use a named profile from ~/.aws/config, including SSO profiles created via "aws configure sso".' },
  { value: 'assume_role', label: 'Assume Role (STS)',             desc: 'Assume a specific IAM role via STS. Useful for cross-account access. Optionally start from a named profile.' },
  { value: 'keys',        label: 'Access Key + Secret',           desc: 'Long-term static credentials. Not recommended for production — use IAM Role or SSO where possible.' },
];

/** Parse common S3 URL formats to extract bucket name and region. */
const parseS3Url = (url: string): { bucket?: string; region?: string } => {
  if (!url) return {};
  try {
    // s3://bucket-name/optional-key
    const s3Uri = url.match(/^s3:\/\/([^/]+)/i);
    if (s3Uri) return { bucket: s3Uri[1] };

    // AWS Console: /s3/buckets/bucket-name?region=us-east-1
    const console1 = url.match(/\/s3\/buckets\/([^/?#]+).*[?&]region=([^&#]+)/i);
    if (console1) return { bucket: console1[1], region: console1[2] };
    const console2 = url.match(/\/s3\/buckets\/([^/?#]+)/i);
    if (console2) return { bucket: console2[1] };

    // Virtual-hosted: https://bucket.s3.region.amazonaws.com
    const vh1 = url.match(/^https?:\/\/([^.]+)\.s3\.([a-z0-9-]+)\.amazonaws\.com/i);
    if (vh1) return { bucket: vh1[1], region: vh1[2] };

    // Virtual-hosted: https://bucket.s3.amazonaws.com
    const vh2 = url.match(/^https?:\/\/([^.]+)\.s3\.amazonaws\.com/i);
    if (vh2) return { bucket: vh2[1] };

    // Path-style: https://s3.region.amazonaws.com/bucket
    const path1 = url.match(/^https?:\/\/s3\.([a-z0-9-]+)\.amazonaws\.com\/([^/?#]+)/i);
    if (path1) return { bucket: path1[2], region: path1[1] };

    // Path-style: https://s3.amazonaws.com/bucket
    const path2 = url.match(/^https?:\/\/s3\.amazonaws\.com\/([^/?#]+)/i);
    if (path2) return { bucket: path2[1] };
  } catch { /**/ }
  return {};
};

const S3Form = ({ config, onChange }) => {
  const mode = config.auth_mode || 'keys';
  const [urlInput, setUrlInput] = React.useState('');

  const handleUrlPaste = (url: string) => {
    setUrlInput(url);
    const { bucket, region } = parseS3Url(url);
    if (bucket) onChange('bucket_name', bucket);
    if (region) onChange('region_name', region);
  };

  return (
    <Stack spacing={2}>
      <SectionLabel>Quick Setup — Paste S3 URL</SectionLabel>
      <TextField
        label="Paste AWS Console or S3 URL (optional)"
        fullWidth size="small"
        value={urlInput}
        onChange={e => handleUrlPaste(e.target.value)}
        placeholder="https://s3.console.aws.amazon.com/s3/buckets/my-bucket?region=us-east-1"
        helperText="Paste any S3 URL to auto-fill bucket name and region below"
        InputProps={{ startAdornment: <InputAdornment position="start">🔗</InputAdornment> }}
      />

      <SectionLabel>Bucket Configuration</SectionLabel>
      <TextField
        label="Bucket Name" fullWidth required size="small"
        value={config.bucket_name || ''}
        onChange={e => onChange('bucket_name', e.target.value)}
        placeholder="my-parquet-bucket"
      />
      <TextField
        select label="AWS Region" fullWidth size="small"
        value={config.region_name || 'us-east-1'}
        onChange={e => onChange('region_name', e.target.value)}
      >
        {AWS_REGIONS.map(r => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
      </TextField>

      <TextField
        label="Root Prefix (optional)" fullWidth size="small"
        value={config.root_prefix || ''}
        onChange={e => onChange('root_prefix', e.target.value)}
        placeholder="data/production/"
        helperText="Scope file browsing to this S3 prefix only. Leave blank to browse the entire bucket."
      />

      <SectionLabel>Authentication Method</SectionLabel>
      <TextField
        select label="Auth Mode" fullWidth size="small"
        value={mode}
        onChange={e => onChange('auth_mode', e.target.value)}
      >
        {S3_AUTH_MODES.map(m => (
          <MenuItem key={m.value} value={m.value}>
            <Box>
              <Typography variant="body2">{m.label}</Typography>
              <Typography variant="caption" color="text.secondary">{m.desc}</Typography>
            </Box>
          </MenuItem>
        ))}
      </TextField>

      {/* Portal SSO: auto-fetch from corporate AWS portal (3-step: JWT → role lookup → STS creds) */}
      {mode === 'portal' && (
        <>
          <Alert severity="info" sx={{ fontSize: 12 }}>
            Uses admin-configured AWS Portal settings (Admin → AWS Portal Config).
            Each user authenticates with their AD credentials — temporary AWS credentials
            are fetched automatically and refresh on expiry. No connection-level portal
            fields are required unless you need to override the global settings.
          </Alert>
          <Accordion variant="outlined" sx={{ mt: 1 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="caption" color="text.secondary">
                Override global portal settings (optional)
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <TextField
                label="Portal Base URL" fullWidth size="small"
                value={config.portal_base_url || ''}
                onChange={e => onChange('portal_base_url', e.target.value)}
                placeholder="Inherited from admin config"
                helperText="Override global portal URL"
              />
              <TextField
                label="AWS Account ID" fullWidth size="small"
                value={config.portal_account_id || ''}
                onChange={e => onChange('portal_account_id', e.target.value)}
                placeholder="Inherited from admin config"
                helperText="Override global account ID"
              />
              <TextField
                label="Proxy URL" fullWidth size="small"
                value={config.proxy_url || ''}
                onChange={e => onChange('proxy_url', e.target.value)}
                placeholder="Inherited from admin config"
                helperText="Override global proxy URL"
              />
              <TextField
                label="Portal Username (System Account)" fullWidth size="small"
                value={config.portal_username || ''}
                onChange={e => onChange('portal_username', e.target.value)}
                placeholder="e.g. svc_querystudio"
                helperText="AD system account for this connection — used by published API and scheduled jobs. Overrides global service account."
              />
              <TextField
                label="Portal Password" fullWidth size="small"
                type="password"
                value={config.portal_password || ''}
                onChange={e => onChange('portal_password', e.target.value)}
                placeholder={config.portal_password === '***' ? '(saved — leave blank to keep)' : ''}
                helperText="Leave blank to use the global service account (Admin → AWS Portal Config)."
              />
            </AccordionDetails>
          </Accordion>
        </>
      )}

      {/* IAM Role: nothing extra needed */}
      {mode === 'iam_role' && (
        <Alert severity="info" sx={{ fontSize: 12 }}>
          The server will use its IAM instance profile, ECS/EKS task role, or
          <code> AWS_ACCESS_KEY_ID</code> / <code>AWS_SECRET_ACCESS_KEY</code> environment variables automatically.
          No credentials need to be stored here.
        </Alert>
      )}

      {/* SSO / Named Profile */}
      {(mode === 'profile' || mode === 'assume_role') && (
        <TextField
          label={mode === 'assume_role' ? 'Source AWS Profile (optional)' : 'AWS Profile Name'}
          fullWidth size="small"
          value={config.aws_profile || ''}
          onChange={e => onChange('aws_profile', e.target.value)}
          placeholder="default"
          helperText={mode === 'profile'
            ? 'Profile name from ~/.aws/config. Run "aws sso login --profile <name>" before connecting.'
            : 'Leave blank to use the default credential chain as the source identity.'}
        />
      )}

      {/* AssumeRole fields */}
      {mode === 'assume_role' && (
        <>
          <TextField
            label="Role ARN" fullWidth required size="small"
            value={config.role_arn || ''}
            onChange={e => onChange('role_arn', e.target.value)}
            placeholder="arn:aws:iam::123456789012:role/MyRole"
            helperText="Format: arn:aws:iam::123456789012:role/MyRole"
          />
          <TextField
            label="External ID (optional)" fullWidth size="small"
            value={config.external_id || ''}
            onChange={e => onChange('external_id', e.target.value)}
            placeholder="supplied by the role owner for cross-account access"
          />
          <TextField
            label="Session Name" fullWidth size="small"
            value={config.role_session_name || 'parquet-engine'}
            onChange={e => onChange('role_session_name', e.target.value)}
          />
        </>
      )}

      {/* Static Keys */}
      {mode === 'keys' && (
        <>
          <PasswordField
            label="AWS Secret Access Key"
            value={config.aws_secret_access_key || ''}
            onChange={v => onChange('aws_secret_access_key', v)}
          />
          <TextField
            label="AWS Access Key ID" fullWidth size="small"
            value={config.aws_access_key_id || ''}
            onChange={e => onChange('aws_access_key_id', e.target.value)}
            placeholder="Your access key ID"
          />
          <PasswordField
            label="Session Token (optional)"
            value={config.aws_session_token || ''}
            onChange={v => onChange('aws_session_token', v)}
            placeholder="FQoGZXIvYXdzEBcaD..."
            helperText="Only needed for temporary credentials (AWS SSO, sts get-session-token, assumed role). Leave blank for long-term access keys."
          />
        </>
      )}

      <SectionLabel>Advanced</SectionLabel>
      <TextField
        select label="SSL Certificate Verification" fullWidth size="small"
        value={config.ssl_verify === false ? 'false' : (typeof config.ssl_verify === 'string' && config.ssl_verify !== 'true') ? 'ca_bundle' : 'true'}
        onChange={e => {
          if (e.target.value === 'false') onChange('ssl_verify', false);
          else if (e.target.value === 'ca_bundle') onChange('ssl_verify', '');
          else onChange('ssl_verify', true);
        }}
        helperText="If connecting fails with a certificate error, place your org's CA bundle at backend/certs/tls_bundle.pem (auto-detected) or choose 'Disabled' as a quick workaround."
      >
        <MenuItem value="true">Enabled — auto-use backend/certs/tls_bundle.pem if present</MenuItem>
        <MenuItem value="ca_bundle">Custom CA Bundle — provide explicit path to PEM file</MenuItem>
        <MenuItem value="false">Disabled — skip SSL verification (not recommended)</MenuItem>
      </TextField>
      {typeof config.ssl_verify === 'string' && config.ssl_verify !== 'true' && config.ssl_verify !== 'false' && (
        <TextField
          label="CA Bundle Path (PEM file)" fullWidth size="small"
          value={config.ssl_verify}
          onChange={e => onChange('ssl_verify', e.target.value)}
          placeholder="/etc/ssl/certs/my-org-ca.pem"
          helperText="Absolute server path to your CA bundle (.pem). Tip: placing it at backend/certs/tls_bundle.pem is picked up automatically without specifying a path."
        />
      )}
      <TextField
        label="Custom Endpoint URL" fullWidth size="small"
        value={config.endpoint_url || ''}
        onChange={e => onChange('endpoint_url', e.target.value)}
        placeholder="https://s3.custom-endpoint.com"
        helperText="For S3-compatible storage (MinIO, Ceph, NetApp, etc.). Leave blank for AWS."
      />
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={!!config.path_style}
            onChange={e => onChange('path_style', e.target.checked)}
          />
        }
        label={
          <Box>
            <Typography variant="body2">Force path-style URLs</Typography>
            <Typography variant="caption" color="text.secondary">
              Required for NetApp StorageGRID, NetApp ONTAP S3, MinIO, and Ceph when using HTTPS.
              AWS S3 does not need this.
            </Typography>
          </Box>
        }
        sx={{ alignItems: 'flex-start', mt: 0.5 }}
      />

      <SectionLabel>Apache Iceberg (optional)</SectionLabel>
      <TextField
        label="Iceberg Warehouse Path" fullWidth size="small"
        value={config.iceberg_warehouse_path || ''}
        onChange={e => onChange('iceberg_warehouse_path', e.target.value)}
        placeholder="warehouse/my_database/"
        helperText="S3 prefix where Iceberg table directories are stored. Leave blank to browse plain Parquet files."
      />
    </Stack>
  );
};

// Wrapper that passes registered_tables from S3Form into RegisteredTablesEditor
// Used inside the dialog — receives the full config + onChange + connectionId
const S3FormWithTables = ({ config, onChange, connectionId }: {
  config: Record<string, any>;
  onChange: (key: string, value: any) => void;
  connectionId?: string | null;
}) => (
  <>
    <S3Form config={config} onChange={onChange} />
    <Divider sx={{ my: 1 }} />
    <RegisteredTablesEditor
      tables={config.registered_tables || []}
      onChange={(tables) => onChange('registered_tables', tables)}
      connectionId={connectionId}
    />
  </>
);

// ── Local Folder Form ─────────────────────────────────────────────────────────
const LocalForm = ({ config, onChange }) => (
  <Stack spacing={2}>
    <TextField
      label="Folder Path" fullWidth required size="small"
      value={config.base_path || ''}
      onChange={e => onChange('base_path', e.target.value)}
      placeholder="/data/parquet or C:\Data\Parquet"
      helperText="Absolute path to the folder containing .parquet files"
    />
  </Stack>
);

// ── Upload Files Form ─────────────────────────────────────────────────────────
const MAX_FILE_SIZE = 1 * 1024 * 1024 * 1024; // 1 GB
const ALLOWED_EXTENSIONS = ['.parquet', '.csv', '.txt', '.json', '.tsv'];

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const UploadForm = ({ pendingFiles, setPendingFiles, uploadedFiles, onDeleteUploaded, connectionId }: {
  pendingFiles: File[];
  setPendingFiles: (files: File[]) => void;
  uploadedFiles: { filename: string; size_bytes: number }[];
  onDeleteUploaded: (filename: string) => void;
  connectionId: string | null;
}) => {
  const [dragOver, setDragOver] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const validateAndAddFiles = (newFiles: FileList | File[]) => {
    const valid: File[] = [];
    const errors: string[] = [];
    Array.from(newFiles).forEach(f => {
      const ext = '.' + f.name.split('.').pop()?.toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        errors.push(`${f.name}: unsupported format. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
      } else if (f.size > MAX_FILE_SIZE) {
        errors.push(`${f.name}: exceeds 1 GB limit (${formatFileSize(f.size)})`);
      } else if (pendingFiles.some(p => p.name === f.name) || uploadedFiles.some(u => u.filename === f.name)) {
        errors.push(`${f.name}: already added`);
      } else {
        valid.push(f);
      }
    });
    if (errors.length) alert(errors.join('\n'));
    if (valid.length) setPendingFiles([...pendingFiles, ...valid]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) validateAndAddFiles(e.dataTransfer.files);
  };

  const removePending = (name: string) => {
    setPendingFiles(pendingFiles.filter(f => f.name !== name));
  };

  return (
    <Stack spacing={2}>
      {/* Drop zone */}
      <Box
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        sx={{
          border: '2px dashed',
          borderColor: dragOver ? '#10b981' : '#cbd5e1',
          borderRadius: 2,
          p: 3,
          textAlign: 'center',
          cursor: 'pointer',
          bgcolor: dragOver ? '#ecfdf5' : '#f8fafc',
          transition: 'all 0.2s',
          '&:hover': { borderColor: '#10b981', bgcolor: '#ecfdf5' },
        }}
      >
        <UploadIcon sx={{ fontSize: 40, color: dragOver ? '#10b981' : '#94a3b8', mb: 1 }} />
        <Typography variant="body2" color="text.secondary">
          Drag & drop files here, or <strong>click to browse</strong>
        </Typography>
        <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5, display: 'block' }}>
          Max 1 GB per file — {ALLOWED_EXTENSIONS.join(', ')}
        </Typography>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ALLOWED_EXTENSIONS.join(',')}
          style={{ display: 'none' }}
          onChange={e => { if (e.target.files?.length) validateAndAddFiles(e.target.files); e.target.value = ''; }}
        />
      </Box>

      {/* Pending files (not yet uploaded) */}
      {pendingFiles.length > 0 && (
        <Box>
          <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
            Ready to upload ({pendingFiles.length} file{pendingFiles.length > 1 ? 's' : ''})
          </Typography>
          {pendingFiles.map(f => (
            <Box key={f.name} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, px: 1, bgcolor: '#f0fdf4', borderRadius: 1, mb: 0.5 }}>
              <FileIcon sx={{ fontSize: 18, color: '#10b981' }} />
              <Typography variant="body2" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">{formatFileSize(f.size)}</Typography>
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); removePending(f.name); }}>
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}

      {/* Already uploaded files (on server) */}
      {uploadedFiles.length > 0 && (
        <Box>
          <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
            Uploaded ({uploadedFiles.length} file{uploadedFiles.length > 1 ? 's' : ''})
          </Typography>
          {uploadedFiles.map(f => (
            <Box key={f.filename} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, px: 1, bgcolor: '#f1f5f9', borderRadius: 1, mb: 0.5 }}>
              <SuccessIcon sx={{ fontSize: 18, color: '#10b981' }} />
              <Typography variant="body2" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.filename}
              </Typography>
              <Typography variant="caption" color="text.secondary">{formatFileSize(f.size_bytes)}</Typography>
              <IconButton size="small" onClick={() => onDeleteUploaded(f.filename)}>
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}

      {pendingFiles.length === 0 && uploadedFiles.length === 0 && (
        <Alert severity="info" sx={{ py: 0.5 }}>
          Select files to upload. Files will be stored on the server and available for querying.
        </Alert>
      )}
    </Stack>
  );
};

// ── Trino / Starburst Config Form ─────────────────────────────────────────────
const TrinoForm = ({ config, onChange, connType }) => {
  const authType = config.auth_type || 'basic';
  return (
    <Stack spacing={2}>
      <SectionLabel>Connection</SectionLabel>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          label="Host" required size="small" sx={{ flex: 1 }}
          value={config.host || ''}
          onChange={e => onChange('host', e.target.value)}
          placeholder={connType === 'starburst' ? 'galaxy.starburstdata.com' : 'trino.company.com'}
        />
        <TextField
          label="Port" required size="small" type="number" sx={{ width: 120 }}
          value={config.port ?? 443}
          onChange={e => onChange('port', Number(e.target.value))}
        />
      </Box>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          select label="HTTP Scheme" size="small" sx={{ width: 120 }}
          value={config.http_scheme || 'https'}
          onChange={e => onChange('http_scheme', e.target.value)}
        >
          <MenuItem value="https">HTTPS</MenuItem>
          <MenuItem value="http">HTTP</MenuItem>
        </TextField>
        <TextField
          select label="Verify SSL" size="small" sx={{ width: 130 }}
          value={config.verify_ssl === false ? 'false' : 'true'}
          onChange={e => onChange('verify_ssl', e.target.value === 'true')}
        >
          <MenuItem value="true">Yes (secure)</MenuItem>
          <MenuItem value="false">No (skip)</MenuItem>
        </TextField>
      </Box>

      <SectionLabel>Authentication</SectionLabel>
      <TextField
        label="Username" required size="small" fullWidth
        value={config.user || ''}
        onChange={e => onChange('user', e.target.value)}
        placeholder="admin"
      />
      <TextField
        select label="Auth Type" size="small" fullWidth
        value={authType}
        onChange={e => onChange('auth_type', e.target.value)}
      >
        <MenuItem value="none">None</MenuItem>
        <MenuItem value="basic">Basic (username + password)</MenuItem>
        <MenuItem value="jwt">JWT Token</MenuItem>
        <MenuItem value="kerberos">Kerberos</MenuItem>
        <MenuItem value="oauth2">OAuth2</MenuItem>
      </TextField>
      {authType === 'basic' && (
        <PasswordField
          label="Password" required
          value={config.password || ''}
          onChange={v => onChange('password', v)}
        />
      )}
      {authType === 'jwt' && (
        <PasswordField
          label="JWT Token" required
          value={config.token || ''}
          onChange={v => onChange('token', v)}
          placeholder="eyJhbGciOiJSUzI1NiJ9..."
        />
      )}
      {authType === 'kerberos' && (
        <Alert severity="info" sx={{ py: 0.5, fontSize: 13 }}>
          Kerberos auth uses the host principal from the server. Ensure kinit is configured in the runtime environment.
        </Alert>
      )}
      {authType === 'oauth2' && (
        <PasswordField
          label="OAuth2 Token" required
          value={config.token || ''}
          onChange={v => onChange('token', v)}
        />
      )}

      <SectionLabel>Default Catalog / Schema (optional)</SectionLabel>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          label="Default Catalog" size="small" sx={{ flex: 1 }}
          value={config.catalog || ''}
          onChange={e => onChange('catalog', e.target.value)}
          placeholder="hive"
        />
        <TextField
          label="Default Schema" size="small" sx={{ flex: 1 }}
          value={config.schema || ''}
          onChange={e => onChange('schema', e.target.value)}
          placeholder="default"
        />
      </Box>
    </Stack>
  );
};

// ── Snowflake Config Form ─────────────────────────────────────────────────────
const SnowflakeForm = ({ config, onChange }) => {
  const authType = config.auth_type || 'password';
  return (
    <Stack spacing={2}>
      <SectionLabel>Account</SectionLabel>
      <TextField
        label="Account Identifier" required size="small" fullWidth
        value={config.account || ''}
        onChange={e => onChange('account', e.target.value)}
        placeholder="xy12345.us-east-1"
        helperText="From Snowflake URL: https://<account>.snowflakecomputing.com"
      />
      <TextField
        label="Username" required size="small" fullWidth
        value={config.user || ''}
        onChange={e => onChange('user', e.target.value)}
        placeholder="JOHN.DOE@company.com"
      />

      <SectionLabel>Authentication</SectionLabel>
      <TextField
        select label="Auth Type" size="small" fullWidth
        value={authType}
        onChange={e => onChange('auth_type', e.target.value)}
      >
        <MenuItem value="sso_portal">Auto (Portal SSO)</MenuItem>
        <MenuItem value="password">Password</MenuItem>
        <MenuItem value="key_pair">Key Pair (RSA)</MenuItem>
        <MenuItem value="oauth">OAuth Token</MenuItem>
      </TextField>
      {authType === 'sso_portal' && (
        <>
          <Alert severity="info" sx={{ fontSize: 12 }}>
            Snowflake credentials are resolved via the portal SSO.
            Enter the service account username and password below.
          </Alert>
          <TextField
            label="Service Account Username" fullWidth required size="small"
            value={config.sso_username || ''}
            onChange={e => onChange('sso_username', e.target.value)}
            placeholder="SF_SVC_USER"
          />
          <PasswordField
            label="Service Account Password" required
            value={config.sso_password || ''}
            onChange={v => onChange('sso_password', v)}
          />
        </>
      )}
      {authType === 'password' && (
        <PasswordField
          label="Password" required
          value={config.password || ''}
          onChange={v => onChange('password', v)}
        />
      )}
      {authType === 'key_pair' && (
        <>
          <TextField
            label="Private Key (PEM)" fullWidth size="small" multiline rows={5}
            value={config.private_key || ''}
            onChange={e => onChange('private_key', e.target.value)}
            placeholder={'-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----'}
            inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 } }}
            helperText="Paste the full PEM content of your RSA private key"
          />
          <PasswordField
            label="Key Passphrase (if encrypted)"
            value={config.private_key_passphrase || ''}
            onChange={v => onChange('private_key_passphrase', v)}
          />
        </>
      )}
      {authType === 'oauth' && (
        <PasswordField
          label="OAuth Token" required
          value={config.token || ''}
          onChange={v => onChange('token', v)}
        />
      )}

      <SectionLabel>Warehouse & Database (optional)</SectionLabel>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          label="Warehouse" size="small" sx={{ flex: 1 }}
          value={config.warehouse || ''}
          onChange={e => onChange('warehouse', e.target.value)}
          placeholder="COMPUTE_WH"
        />
        <TextField
          label="Role" size="small" sx={{ flex: 1 }}
          value={config.role || ''}
          onChange={e => onChange('role', e.target.value)}
          placeholder="SYSADMIN"
        />
      </Box>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          label="Database" size="small" sx={{ flex: 1 }}
          value={config.database || ''}
          onChange={e => onChange('database', e.target.value)}
          placeholder="MY_DATABASE"
        />
        <TextField
          label="Default Schema" size="small" sx={{ flex: 1 }}
          value={config.schema || ''}
          onChange={e => onChange('schema', e.target.value)}
          placeholder="PUBLIC"
        />
      </Box>
    </Stack>
  );
};

// ── Databricks Config Form ────────────────────────────────────────────────────
const DatabricksForm = ({ config, onChange }) => (
  <Stack spacing={2}>
    <SectionLabel>SQL Warehouse</SectionLabel>
    <TextField
      label="Server Hostname" required size="small" fullWidth
      value={config.server_hostname || ''}
      onChange={e => onChange('server_hostname', e.target.value)}
      placeholder="adb-1234567890123456.12.azuredatabricks.net"
      helperText="Found in: SQL Warehouse → Connection Details → Server hostname"
    />
    <TextField
      label="HTTP Path" required size="small" fullWidth
      value={config.http_path || ''}
      onChange={e => onChange('http_path', e.target.value)}
      placeholder="/sql/1.0/warehouses/abc123def456"
      helperText="Found in: SQL Warehouse → Connection Details → HTTP path"
    />
    <SectionLabel>Authentication</SectionLabel>
    <PasswordField
      label="Personal Access Token" required
      value={config.access_token || ''}
      onChange={v => onChange('access_token', v)}
      placeholder="dapiXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
      helperText="Generate at: Settings → Developer → Access tokens"
    />
    <SectionLabel>Catalog / Schema (optional)</SectionLabel>
    <Box sx={{ display: 'flex', gap: 1 }}>
      <TextField
        label="Default Catalog" size="small" sx={{ flex: 1 }}
        value={config.catalog || ''}
        onChange={e => onChange('catalog', e.target.value)}
        placeholder="main"
        helperText="Leave blank for legacy hive_metastore"
      />
      <TextField
        label="Default Schema" size="small" sx={{ flex: 1 }}
        value={config.schema || ''}
        onChange={e => onChange('schema', e.target.value)}
        placeholder="default"
      />
    </Box>
  </Stack>
);

const OracleForm = ({ config, onChange }) => (
  <Stack spacing={2}>
    <SectionLabel>Connection</SectionLabel>
    <Box sx={{ display: 'flex', gap: 1 }}>
      <TextField
        label="Host" size="small" sx={{ flex: 2 }}
        value={config.host || ''}
        onChange={e => onChange('host', e.target.value)}
        placeholder="oracle.example.com"
        helperText="Leave blank if using DSN"
      />
      <TextField
        label="Port" size="small" type="number" sx={{ flex: 1 }}
        value={config.port || 1521}
        onChange={e => onChange('port', e.target.value)}
      />
    </Box>
    <Box sx={{ display: 'flex', gap: 1 }}>
      <TextField
        label="Service Name" size="small" sx={{ flex: 1 }}
        value={config.service_name || ''}
        onChange={e => onChange('service_name', e.target.value)}
        placeholder="ORCL or pdb1.example.com"
        helperText="Preferred over SID"
      />
      <TextField
        label="SID (legacy)" size="small" sx={{ flex: 1 }}
        value={config.sid || ''}
        onChange={e => onChange('sid', e.target.value)}
        placeholder="ORCL"
      />
    </Box>
    <TextField
      label="DSN Override" size="small" fullWidth
      value={config.dsn || ''}
      onChange={e => onChange('dsn', e.target.value)}
      placeholder="Leave blank to build from host / port / service name"
      helperText="Full Oracle DSN (overrides host/port/service if set)"
    />
    <SectionLabel>Authentication</SectionLabel>
    <TextField
      label="Username" required size="small" fullWidth
      value={config.user || ''}
      onChange={e => onChange('user', e.target.value)}
    />
    <PasswordField
      label="Password" required
      value={config.password || ''}
      onChange={v => onChange('password', v)}
    />
    <SectionLabel>Wallet / mTLS (Autonomous DB — optional)</SectionLabel>
    <TextField
      label="Wallet Location" size="small" fullWidth
      value={config.wallet_location || ''}
      onChange={e => onChange('wallet_location', e.target.value)}
      placeholder="/path/to/wallet"
    />
    <PasswordField
      label="Wallet Password"
      value={config.wallet_password || ''}
      onChange={v => onChange('wallet_password', v)}
    />
  </Stack>
);

// ── REST API form ────────────────────────────────────────────────────────────
const RestApiForm = ({ config, onChange }) => {
  const authType = config.auth_type || 'bearer';
  return (
    <Stack spacing={2}>
      <SectionLabel>Endpoint</SectionLabel>
      <TextField
        label="Base URL" required size="small" fullWidth
        value={config.base_url || ''}
        onChange={e => onChange('base_url', e.target.value)}
        placeholder="https://api.example.com/v2"
      />
      <SectionLabel>Authentication</SectionLabel>
      <TextField
        label="Auth Type" select size="small" fullWidth
        value={authType}
        onChange={e => onChange('auth_type', e.target.value)}
      >
        {['none', 'basic', 'bearer', 'api_key', 'oauth2_client_credentials'].map(o => (
          <MenuItem key={o} value={o}>{o === 'oauth2_client_credentials' ? 'OAuth2 Client Credentials' : o.charAt(0).toUpperCase() + o.slice(1).replace('_', ' ')}</MenuItem>
        ))}
      </TextField>
      {authType === 'bearer' && (
        <PasswordField label="Bearer Token" value={config.token || ''} onChange={v => onChange('token', v)} />
      )}
      {authType === 'basic' && (<>
        <TextField label="Username" size="small" fullWidth value={config.username || ''} onChange={e => onChange('username', e.target.value)} />
        <PasswordField label="Password" value={config.password || ''} onChange={v => onChange('password', v)} />
      </>)}
      {authType === 'api_key' && (<>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField label="Key Name" size="small" sx={{ flex: 2 }} value={config.api_key_name || ''} onChange={e => onChange('api_key_name', e.target.value)} placeholder="X-API-Key" />
          <TextField label="Location" select size="small" sx={{ flex: 1 }} value={config.api_key_location || 'header'} onChange={e => onChange('api_key_location', e.target.value)}>
            <MenuItem value="header">Header</MenuItem>
            <MenuItem value="query">Query Param</MenuItem>
          </TextField>
        </Box>
        <PasswordField label="API Key Value" value={config.api_key_value || ''} onChange={v => onChange('api_key_value', v)} />
      </>)}
      {authType === 'oauth2_client_credentials' && (<>
        <TextField label="Token URL" size="small" fullWidth value={config.token_url || ''} onChange={e => onChange('token_url', e.target.value)} placeholder="https://auth.example.com/oauth/token" />
        <TextField label="Client ID" size="small" fullWidth value={config.client_id || ''} onChange={e => onChange('client_id', e.target.value)} />
        <PasswordField label="Client Secret" value={config.client_secret || ''} onChange={v => onChange('client_secret', v)} />
      </>)}
      <SectionLabel>Options</SectionLabel>
      <TextField
        label="Default Headers (JSON)" size="small" fullWidth multiline rows={2}
        value={config.default_headers || '{}'}
        onChange={e => onChange('default_headers', e.target.value)}
        placeholder='{"Accept": "application/json"}'
      />
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField label="Timeout (sec)" size="small" type="number" sx={{ flex: 1 }} value={config.timeout_seconds ?? 30} onChange={e => onChange('timeout_seconds', Number(e.target.value))} />
        <TextField label="Rate Limit (req/sec)" size="small" type="number" sx={{ flex: 1 }} value={config.rate_limit_rps ?? 10} onChange={e => onChange('rate_limit_rps', Number(e.target.value))} helperText="0 = unlimited" />
      </Box>
      <FormControlLabel
        control={<Switch checked={config.verify_ssl !== false} onChange={e => onChange('verify_ssl', e.target.checked)} size="small" />}
        label="Verify SSL"
      />
    </Stack>
  );
};

// ── Connection type display chip ──────────────────────────────────────────────
const TypeChip = ({ type }) => {
  const meta = CONN_TYPE_META[type] || { label: type, icon: <StorageIcon fontSize="small" />, color: '#888' };
  return (
    <Chip
      icon={React.cloneElement(meta.icon, { style: { color: 'white', fontSize: 14 } })}
      label={meta.label}
      size="small"
      variant="filled"
      sx={{ bgcolor: meta.color, color: 'white', fontWeight: 600, '& .MuiChip-icon': { color: 'white' } }}
    />
  );
};

// ── Connection detail summary ─────────────────────────────────────────────────
const connDetail = (conn) => {
  const c = conn.config || {};
  switch (conn.connection_type) {
    case 's3':         return `s3://${c.bucket_name || '—'}  ·  ${c.region_name || '—'}`;
    case 'local':      return c.base_path || '—';
    case 'upload':     return 'Uploaded files';
    case 'trino':
    case 'starburst':  return `${c.http_scheme || 'https'}://${c.host || '—'}:${c.port || ''}  ·  ${c.user || '—'}`;
    case 'snowflake':  return `${c.account || '—'}.snowflakecomputing.com  ·  ${c.user || '—'}`;
    case 'databricks': return `${c.server_hostname || '—'}  ·  ${c.http_path || '—'}`;
    default:           return '—';
  }
};

// ── Registered Tables Editor ─────────────────────────────────────────────────
const FORMAT_COLORS: Record<string, string> = { iceberg: '#16a34a', parquet: '#3b82f6', csv: '#f97316' };

const RegisteredTablesEditor = ({ tables, onChange, connectionId }: {
  tables: any[];
  onChange: (tables: any[]) => void;
  connectionId?: string | null;
}) => {
  const [showAdd, setShowAdd] = useState(false);
  const [newTable, setNewTable] = useState({ name: '', s3_prefix: '', format: 'parquet', description: '' });
  const [addError, setAddError] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [candidates, setCandidates] = useState<any[] | null>(null);
  const [discoverError, setDiscoverError] = useState('');
  const [refreshingSchemas, setRefreshingSchemas] = useState(false);

  // Folder browser state
  const [showBrowser, setShowBrowser] = useState(false);
  const [browserPath, setBrowserPath] = useState<string[]>([]);  // breadcrumb path segments
  const [browserFolders, setBrowserFolders] = useState<any[]>([]);
  const [browserFileSummary, setBrowserFileSummary] = useState<any>({});
  const [browserIsIceberg, setBrowserIsIceberg] = useState(false);
  const [browserHivePartitioned, setBrowserHivePartitioned] = useState(false);
  const [browserHiveKeys, setBrowserHiveKeys] = useState<string[]>([]);
  const [browserLoading, setBrowserLoading] = useState(false);

  const handleAdd = async () => {
    if (!newTable.name.trim()) { setAddError('Table name is required'); return; }
    if (!newTable.s3_prefix.trim()) { setAddError('S3 prefix is required'); return; }
    if (tables.some(t => t.name.toLowerCase() === newTable.name.trim().toLowerCase())) { setAddError('Table name already exists'); return; }
    if (!['iceberg', 'parquet', 'csv'].includes(newTable.format)) { setAddError('Invalid format'); return; }
    // For Iceberg tables, validate the prefix has actual metadata before accepting
    if (newTable.format === 'iceberg' && connectionId) {
      try {
        const result = await api.browseFolders(connectionId, newTable.s3_prefix.trim());
        if (!result.is_iceberg) {
          setAddError(
            'This folder is not an Iceberg table root. Navigate deeper to the folder ' +
            'that contains both data/ and metadata/ subfolders.'
          );
          return;
        }
      } catch (_) { /* skip validation if browse fails */ }
    }
    onChange([...tables, { ...newTable, name: newTable.name.trim(), s3_prefix: newTable.s3_prefix.trim() }]);
    setNewTable({ name: '', s3_prefix: '', format: 'parquet', description: '' });
    setAddError('');
    setShowAdd(false);
    setShowBrowser(false);
  };

  const handleRemove = (name: string) => {
    onChange(tables.filter(t => t.name !== name));
  };

  const handleDiscover = async (prefix?: string) => {
    if (!connectionId) return;
    setDiscovering(true);
    setCandidates(null);
    setDiscoverError('');
    try {
      const result = await api.discoverTables(connectionId, prefix || undefined);
      const existingNames = new Set(tables.map(t => t.name));
      const found = (result.candidates || []).filter((c: any) => !existingNames.has(c.name));
      setCandidates(found);
      if (found.length === 0) {
        setDiscoverError(prefix
          ? `No tables found under "${prefix}". Navigate deeper or try a different folder.`
          : 'No tables detected. Try "Browse & Register" to navigate to a specific catalog/schema first.');
      }
    } catch (e: any) {
      setCandidates([]);
      const msg = typeof e === 'string' ? e : (e?.message || e?.detail || JSON.stringify(e));
      setDiscoverError(`Discovery failed: ${msg}`);
    }
    setDiscovering(false);
  };

  const handleRegisterCandidate = (candidate: any) => {
    if (tables.some(t => t.name === candidate.name)) return;
    onChange([...tables, candidate]);
    setCandidates(prev => prev?.filter(c => c.name !== candidate.name) || null);
  };

  const handleRefreshAllSchemas = async () => {
    if (!connectionId || tables.length === 0) return;
    setRefreshingSchemas(true);
    try {
      await api.refreshAllSchemas(connectionId);
    } catch { /* silent */ }
    setRefreshingSchemas(false);
  };

  // ── Folder browser ──────────────────────────────────────────────
  const browseFolder = async (prefix: string) => {
    if (!connectionId) return;
    setBrowserLoading(true);
    try {
      const result = await api.browseFolders(connectionId, prefix);
      setBrowserFolders(result.folders || []);
      setBrowserFileSummary(result.file_summary || {});
      setBrowserIsIceberg(result.is_iceberg || false);
      setBrowserHivePartitioned(result.hive_partitioned || false);
      setBrowserHiveKeys(result.hive_partition_keys || []);
    } catch {
      setBrowserFolders([]);
      setBrowserFileSummary({});
    }
    setBrowserLoading(false);
  };

  const openBrowser = () => {
    setShowBrowser(true);
    setShowAdd(true);
    setBrowserPath([]);
    browseFolder('');
  };

  const navigateTo = (folderPrefix: string, folderName: string) => {
    setBrowserPath(prev => [...prev, folderName]);
    browseFolder(folderPrefix);
  };

  const navigateBreadcrumb = (index: number) => {
    // Navigate to a breadcrumb position (-1 = root)
    const newPath = index < 0 ? [] : browserPath.slice(0, index + 1);
    setBrowserPath(newPath);
    browseFolder(newPath.join('/') ? newPath.join('/') + '/' : '');
  };

  const selectCurrentFolder = () => {
    const prefix = browserPath.join('/') ? browserPath.join('/') + '/' : '';
    const name = browserPath.length > 0 ? browserPath[browserPath.length - 1] : '';
    const fmt = browserIsIceberg ? 'iceberg' : (browserHivePartitioned || browserFileSummary.parquet > 0 ? 'parquet' : (browserFileSummary.csv > 0 ? 'csv' : 'parquet'));
    setNewTable(prev => ({
      ...prev,
      s3_prefix: prefix,
      format: fmt,
      name: prev.name || name,
    }));
    setShowBrowser(false);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <TableIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
          <SectionLabel>Registered Tables</SectionLabel>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {connectionId && tables.length > 0 && (
            <Button size="small" startIcon={refreshingSchemas ? <CircularProgress size={14} /> : <RefreshIcon sx={{ fontSize: 14 }} />}
              onClick={handleRefreshAllSchemas} disabled={refreshingSchemas} sx={{ textTransform: 'none', fontSize: 12 }}>
              Refresh Schemas
            </Button>
          )}
          {connectionId && (
            <Button size="small" startIcon={discovering ? <CircularProgress size={14} /> : <DiscoverIcon />}
              onClick={() => handleDiscover()} disabled={discovering} sx={{ textTransform: 'none', fontSize: 12 }}>
              Auto-Discover
            </Button>
          )}
          {connectionId && (
            <Button size="small" startIcon={<FolderIcon sx={{ fontSize: 14 }} />}
              onClick={openBrowser} sx={{ textTransform: 'none', fontSize: 12 }}>
              Browse & Register
            </Button>
          )}
          <Button size="small" startIcon={<AddIcon />} onClick={() => { setShowAdd(!showAdd); setShowBrowser(false); }}
            sx={{ textTransform: 'none', fontSize: 12 }}>
            Manual
          </Button>
        </Box>
      </Box>

      {/* Existing tables */}
      {tables.length > 0 && (
        <Box sx={{ mb: 1 }}>
          {tables.map(t => (
            <Box key={t.name} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, px: 1, borderRadius: 1,
              '&:hover': { bgcolor: 'action.hover' } }}>
              <Chip label={t.format} size="small"
                sx={{ bgcolor: FORMAT_COLORS[t.format] || '#888', color: 'white', fontWeight: 600, fontSize: 10, height: 20, minWidth: 56 }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600} noWrap>{t.name}</Typography>
                <Typography variant="caption" color="text.secondary" noWrap>{t.s3_prefix}</Typography>
              </Box>
              <IconButton size="small" onClick={() => handleRemove(t.name)} sx={{ opacity: 0.5, '&:hover': { opacity: 1 } }}>
                <DeleteIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}

      {tables.length === 0 && !showAdd && !candidates && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 1, mb: 1 }}>
          No tables registered yet. Click <strong>Browse & Register</strong> to navigate to your catalog/schema folder and discover tables, or <strong>Auto-Discover</strong> to scan from root.
        </Typography>
      )}

      {/* Auto-discover results */}
      {candidates !== null && (
        <Box sx={{ mb: 1, p: 1, bgcolor: 'grey.50', borderRadius: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="caption" fontWeight={600}>
              Discovered Tables ({candidates.length})
            </Typography>
            {candidates.length > 1 && (
              <Button size="small" variant="contained" color="primary"
                sx={{ textTransform: 'none', fontSize: 11 }}
                onClick={() => {
                  const existingNames = new Set(tables.map(t => t.name));
                  const toAdd = candidates.filter(c => !existingNames.has(c.name));
                  if (toAdd.length > 0) {
                    onChange([...tables, ...toAdd]);
                    setCandidates([]);
                  }
                }}>
                Register All ({candidates.length})
              </Button>
            )}
          </Box>
          {candidates.length === 0 && discoverError ? (
            <Typography variant="caption" color="text.secondary">{discoverError}</Typography>
          ) : (
            <Box sx={{ maxHeight: 250, overflowY: 'auto' }}>
              {candidates.map(c => (
                <Box key={c.name} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                  <Chip label={c.format} size="small"
                    sx={{ bgcolor: FORMAT_COLORS[c.format] || '#888', color: 'white', fontWeight: 600, fontSize: 10, height: 20, minWidth: 56 }} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>{c.name}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {c.description || c.s3_prefix}
                    </Typography>
                  </Box>
                  <Button size="small" variant="outlined"
                    sx={{ textTransform: 'none', fontSize: 11, minWidth: 70 }}
                    onClick={() => handleRegisterCandidate(c)}>
                    Register
                  </Button>
                </Box>
              ))}
            </Box>
          )}
          <Button size="small" onClick={() => { setCandidates(null); setDiscoverError(''); }}
            sx={{ mt: 0.5, textTransform: 'none', fontSize: 11 }}>
            Close
          </Button>
        </Box>
      )}

      {/* S3 Folder Browser */}
      <Collapse in={showBrowser && showAdd}>
        <Box sx={{ p: 1, mb: 1, bgcolor: '#f8fafc', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
          <Typography variant="caption" fontWeight={700} sx={{ display: 'block', mb: 0.5 }}>
            Browse S3 Folders
          </Typography>

          {/* Breadcrumb */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, mb: 0.5, flexWrap: 'wrap' }}>
            <Button size="small" onClick={() => navigateBreadcrumb(-1)}
              sx={{ textTransform: 'none', fontSize: 11, minWidth: 0, px: 0.5, fontWeight: browserPath.length === 0 ? 700 : 400 }}>
              / (root)
            </Button>
            {browserPath.map((seg, i) => (
              <React.Fragment key={i}>
                <Typography variant="caption" color="text.disabled">/</Typography>
                <Button size="small" onClick={() => navigateBreadcrumb(i)}
                  sx={{ textTransform: 'none', fontSize: 11, minWidth: 0, px: 0.5,
                    fontWeight: i === browserPath.length - 1 ? 700 : 400 }}>
                  {seg}
                </Button>
              </React.Fragment>
            ))}
            {browserLoading && <CircularProgress size={12} sx={{ ml: 0.5 }} />}
          </Box>

          {/* Detected format badge */}
          {(browserIsIceberg || browserHivePartitioned || browserFileSummary.parquet > 0 || browserFileSummary.csv > 0) && (
            <Box sx={{ display: 'flex', gap: 0.5, mb: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
              {browserIsIceberg && (
                <Chip label="Iceberg table detected" size="small"
                  sx={{ bgcolor: FORMAT_COLORS.iceberg, color: 'white', fontWeight: 600, fontSize: 10, height: 20 }} />
              )}
              {browserHivePartitioned && !browserIsIceberg && (
                <Chip label={`Hive-partitioned Parquet (${browserHiveKeys.join(', ')})`} size="small"
                  sx={{ bgcolor: '#8b5cf6', color: 'white', fontWeight: 600, fontSize: 10, height: 20 }} />
              )}
              {browserFileSummary.parquet > 0 && !browserIsIceberg && !browserHivePartitioned && (
                <Chip label={`${browserFileSummary.parquet} parquet files`} size="small"
                  sx={{ bgcolor: FORMAT_COLORS.parquet, color: 'white', fontWeight: 600, fontSize: 10, height: 20 }} />
              )}
              {browserFileSummary.csv > 0 && !browserIsIceberg && !browserHivePartitioned && (
                <Chip label={`${browserFileSummary.csv} CSV files`} size="small"
                  sx={{ bgcolor: FORMAT_COLORS.csv, color: 'white', fontWeight: 600, fontSize: 10, height: 20 }} />
              )}
              <Button size="small" variant="contained" color="success"
                onClick={selectCurrentFolder}
                sx={{ textTransform: 'none', fontSize: 11, ml: 'auto' }}>
                Select this folder
              </Button>
            </Box>
          )}

          {/* Discover from current folder */}
          {browserPath.length > 0 && !browserIsIceberg && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, px: 0.5 }}>
              <Button size="small" variant="outlined" color="primary"
                startIcon={discovering ? <CircularProgress size={12} /> : <DiscoverIcon sx={{ fontSize: 14 }} />}
                disabled={discovering}
                onClick={() => handleDiscover(browserPath.join('/') + '/')}
                sx={{ textTransform: 'none', fontSize: 11 }}>
                {discovering ? 'Scanning...' : 'Discover tables here'}
              </Button>
              <Typography variant="caption" color="text.secondary">
                Scan this folder for Iceberg/Parquet tables
              </Typography>
            </Box>
          )}

          {/* Folder list */}
          <Box sx={{ maxHeight: 200, overflowY: 'auto' }}>
            {browserFolders.length === 0 && !browserLoading && (
              <Typography variant="caption" color="text.secondary" sx={{ pl: 1 }}>
                No subfolders found.
              </Typography>
            )}
            {browserFolders.map(f => (
              <Box key={f.prefix}
                onClick={() => navigateTo(f.prefix, f.name)}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: 0.4, px: 0.75, cursor: 'pointer',
                  borderRadius: 0.5, '&:hover': { bgcolor: 'action.hover' } }}>
                <FolderIcon sx={{ fontSize: 16, color: '#f59e0b' }} />
                <Typography variant="body2" sx={{ fontSize: 13 }}>{f.name}/</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </Collapse>

      {/* Add form */}
      <Collapse in={showAdd}>
        <Box sx={{ p: 1.5, bgcolor: 'grey.50', borderRadius: 1, mb: 1 }}>
          {addError && <Alert severity="error" sx={{ mb: 1, py: 0 }}>{addError}</Alert>}
          <Stack spacing={1.5}>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField label="Table Name" size="small" sx={{ flex: 1 }}
                value={newTable.name} onChange={e => { setNewTable(p => ({ ...p, name: e.target.value })); setAddError(''); }}
                placeholder="sales" />
              <TextField select label="Format" size="small" sx={{ width: 120 }}
                value={newTable.format} onChange={e => setNewTable(p => ({ ...p, format: e.target.value }))}>
                <MenuItem value="parquet">Parquet</MenuItem>
                <MenuItem value="iceberg">Iceberg</MenuItem>
                <MenuItem value="csv">CSV</MenuItem>
              </TextField>
            </Box>
            <TextField label="S3 Prefix" size="small" fullWidth
              value={newTable.s3_prefix} onChange={e => { setNewTable(p => ({ ...p, s3_prefix: e.target.value })); setAddError(''); }}
              placeholder="warehouse/db/sales/"
              helperText={connectionId ? 'Use "Browse & Register" above to pick a folder, or type the path manually' : 'Path to table root within the bucket'}
            />
            <TextField label="Description (optional)" size="small" fullWidth
              value={newTable.description} onChange={e => setNewTable(p => ({ ...p, description: e.target.value }))}
              placeholder="Daily sales transactions" />
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              <Button size="small" onClick={() => { setShowAdd(false); setShowBrowser(false); setAddError(''); }}>Cancel</Button>
              <Button size="small" variant="contained" onClick={handleAdd}>Add Table</Button>
            </Box>
          </Stack>
        </Box>
      </Collapse>
    </Box>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// Main component
// ══════════════════════════════════════════════════════════════════════════════
const ConnectionManager = () => {
  const [connections, setConnections] = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [form, setForm]             = useState<{ name: string; connection_type: string; config: Record<string, any>; is_shared?: boolean }>({ name: '', connection_type: 's3', config: { ...EMPTY_CONFIGS.s3 }, is_shared: false });
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState('');

  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting]       = useState(null);   // null | 'dialog' | conn.id

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'warning' | 'error' }>({ open: false, message: '', severity: 'success' });

  // Upload connection state
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<{ filename: string; size_bytes: number }[]>([]);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [unusedUploads, setUnusedUploads] = useState<{ id: number; name: string; file_count: number; total_size_bytes: number }[]>([]);
  const [uploadEnabled, setUploadEnabled] = useState(false);

  const loadConnections = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listConnections();
      setConnections((data as any[]) || []);
    } catch { /* silent */ }
    setLoading(false);
    // Check for unused upload connections
    try {
      const status = await api.getUploadConnectionsStatus();
      const unused = (status?.upload_connections || []).filter((c: any) => !c.is_used && c.file_count > 0);
      setUnusedUploads(unused);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadConnections(); }, [loadConnections]);

  // Check if upload connections are enabled (container/OpenShift mode)
  useEffect(() => {
    fetch(`${API_BASE_URL}/auth/config`).then(r => r.json()).then(cfg => {
      setUploadEnabled(cfg?.upload_enabled === true);
    }).catch(() => {});
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm({ name: '', connection_type: 's3', config: { ...EMPTY_CONFIGS.s3 }, is_shared: false });
    setTestResult(null);
    setFormError('');
    setPendingFiles([]);
    setUploadedFiles([]);
    setUploadProgress(null);
    setDialogOpen(true);
  };

  const openEdit = async (conn) => {
    setEditingId(conn.id);
    const empty = EMPTY_CONFIGS[conn.connection_type] || {};
    setForm({ name: conn.name, connection_type: conn.connection_type, config: { ...empty, ...conn.config }, is_shared: conn.is_shared || false });
    setTestResult(null);
    setFormError('');
    setPendingFiles([]);
    setUploadProgress(null);
    // Load existing uploaded files for upload connections
    if (conn.connection_type === 'upload') {
      try {
        const res = await api.listUploadedFiles(conn.id);
        setUploadedFiles(res?.files || []);
      } catch { setUploadedFiles([]); }
    } else {
      setUploadedFiles([]);
    }
    setDialogOpen(true);
  };

  const handleTypeChange = (newType) => {
    setForm(prev => ({ ...prev, connection_type: newType, config: { ...(EMPTY_CONFIGS[newType] || {}) } }));
    setTestResult(null);
    setFormError('');
    setPendingFiles([]);
    setUploadedFiles([]);
  };

  const handleDeleteUploadedFile = async (filename: string) => {
    if (!editingId) return;
    try {
      await api.deleteUploadedFile(editingId, filename);
      setUploadedFiles(prev => prev.filter(f => f.filename !== filename));
    } catch (e: any) {
      setFormError(e?.message || 'Failed to delete file');
    }
  };

  const updateConfig = (key, value) => {
    setForm(prev => ({ ...prev, config: { ...prev.config, [key]: value } }));
    setTestResult(null);
  };

  const validateForm = () => {
    const { connection_type: ct, config: c } = form;
    if (!form.name.trim()) return 'Connection name is required';
    if (ct === 's3'    && !c.bucket_name?.trim())    return 'Bucket name is required';
    if (ct === 's3' && c.bucket_name?.trim()) {
      const isOnPrem = !!c.path_style;
      const re = isOnPrem ? S3_BUCKET_ONPREM_RE : S3_BUCKET_AWS_RE;
      if (!re.test(c.bucket_name.trim())) {
        return isOnPrem
          ? 'Invalid S3 bucket name. On-prem bucket names must start and end with alphanumeric characters.'
          : 'Invalid S3 bucket name. AWS bucket names must be 3-63 lowercase alphanumeric/hyphen characters.';
      }
    }
    if (ct === 's3' && c.auth_mode === 'assume_role' && c.role_arn?.trim()) {
      if (!IAM_ARN_RE.test(c.role_arn.trim())) {
        return 'Invalid Role ARN format. Expected: arn:aws:iam::123456789012:role/MyRole';
      }
    }
    if (ct === 'local' && !c.base_path?.trim())      return 'Folder path is required';
    if (ct === 'upload' && pendingFiles.length === 0 && uploadedFiles.length === 0) return 'Please select at least one file to upload';
    if ((ct === 'trino' || ct === 'starburst') && !c.host?.trim()) return 'Host is required';
    if ((ct === 'trino' || ct === 'starburst') && !c.user?.trim()) return 'Username is required';
    if (ct === 'snowflake'  && !c.account?.trim())  return 'Account identifier is required';
    if (ct === 'snowflake'  && !c.user?.trim())     return 'Username is required';
    if (ct === 'databricks' && !c.server_hostname?.trim()) return 'Server hostname is required';
    if (ct === 'databricks' && !c.http_path?.trim())       return 'HTTP path is required';
    if (ct === 'databricks' && !c.access_token?.trim())    return 'Access token is required';
    if (ct === 'oracle'     && !c.user?.trim())            return 'Username is required';
    if (ct === 'oracle'     && !c.password?.trim())        return 'Password is required';
    if (ct === 'oracle'     && !c.dsn?.trim() && !c.service_name?.trim() && !c.sid?.trim())
      return 'Provide at least one of: DSN, Service Name, or SID';
    if (ct === 'rest_api'   && !c.base_url?.trim())        return 'Base URL is required';
    return null;
  };

  const handleTestInDialog = async () => {
    const err = validateForm();
    if (err) { setFormError(err); return; }
    setTesting('dialog');
    setTestResult(null);
    setFormError('');
    try {
      const r = await api.testConnection({ connection_type: form.connection_type, config: form.config, ...(editingId ? { connection_id: Number(editingId) } : {}) });
      setTestResult(r);
    } catch (e: any) {
      setTestResult({ success: false, message: typeof e === 'string' ? e : (e?.message || 'Connection test failed') });
    }
    setTesting(null);
  };

  const handleSave = async () => {
    const err = validateForm();
    if (err) { setFormError(err); return; }
    setSaving(true);
    setFormError('');
    try {
      let connId = editingId;
      if (editingId) {
        await api.updateConnection(editingId, form);
      } else {
        const created = await api.createConnection(form);
        connId = created?.id;
      }

      // Upload pending files for upload-type connections
      if (form.connection_type === 'upload' && pendingFiles.length > 0 && connId) {
        setUploadProgress(`Uploading ${pendingFiles.length} file(s)...`);
        try {
          const result = await api.uploadConnectionFiles(String(connId), pendingFiles);
          if (result.errors?.length) {
            setFormError(`Some files failed: ${result.errors.join('; ')}`);
            setSaving(false);
            setUploadProgress(null);
            loadConnections();
            return;
          }
        } catch (e: any) {
          setFormError(typeof e === 'string' ? e : (e?.message || 'File upload failed'));
          setSaving(false);
          setUploadProgress(null);
          return;
        }
        setUploadProgress(null);
      }

      setDialogOpen(false);
      loadConnections();
    } catch (e: any) {
      setFormError(typeof e === 'string' ? e : (e?.message || 'Failed to save connection'));
    }
    setSaving(false);
  };

  const handleTestSaved = async (conn) => {
    setTesting(conn.id);
    try {
      // POST /api/connections/{id}/test handles all types (S3, local, SQL)
      // and updates last_test_status in DB so the status chip reflects the result
      await api.testSavedConnection(conn.id);
      loadConnections();
    } catch { loadConnections(); }
    setTesting(null);
  };

  const [refreshing, setRefreshing] = React.useState<string | null>(null);
  const handleRefreshCredentials = async (conn) => {
    setRefreshing(conn.id);
    try {
      const res = await api.refreshConnectionCredentials(conn.id);
      if (res?.status === 'ok') {
        setSnack({ open: true, message: 'Credentials refreshed successfully', severity: 'success' });
      } else {
        setSnack({ open: true, message: res?.message || 'Refresh failed', severity: 'warning' });
      }
    } catch {
      setSnack({ open: true, message: 'Failed to refresh credentials', severity: 'error' });
    }
    setRefreshing(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try { await api.deleteConnection(deleteTarget.id); loadConnections(); } catch { /* empty */ }
    setDeleteTarget(null);
  };

  const { connection_type: ct } = form;
  const isSqlType = SQL_TYPES.includes(ct);

  return (
    <Box sx={{ p: 3, maxWidth: 1300, mx: 'auto' }}>

      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>Connection Manager</Typography>
          <Typography variant="subtitle2" color="text.secondary">
            Manage data source connections: S3, Local, Upload, Trino/Starburst, Snowflake, Databricks
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadConnections}>Refresh</Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New Connection</Button>
        </Box>
      </Box>

      {/* Unused upload connections warning */}
      {unusedUploads.length > 0 && (
        <Alert
          severity="warning"
          icon={<WarningIcon />}
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={async () => {
              if (!window.confirm(`Delete ${unusedUploads.length} unused upload connection(s) and their files?\n\n${unusedUploads.map(u => `• ${u.name} (${u.file_count} files)`).join('\n')}`)) return;
              for (const u of unusedUploads) {
                try { await api.deleteConnection(String(u.id)); } catch { /* silent */ }
              }
              loadConnections();
            }}>
              Clean Up
            </Button>
          }
        >
          <strong>{unusedUploads.length} uploaded connection{unusedUploads.length > 1 ? 's' : ''} not used by any query</strong>
          {' — '}
          {unusedUploads.map(u => u.name).join(', ')}
          {' '}({formatFileSize(unusedUploads.reduce((a, u) => a + u.total_size_bytes, 0))} on disk).
          Consider cleaning up to free space.
        </Alert>
      )}

      {/* Connection list */}
      {loading ? (
        <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>
      ) : connections.length === 0 ? (
        <Paper sx={{ p: 6, textAlign: 'center' }}>
          <StorageIcon sx={{ fontSize: 56, color: 'text.secondary', mb: 2, opacity: 0.4 }} />
          <Typography variant="h6" gutterBottom>No connections yet</Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            Create your first connection to query data from S3, local files, or SQL warehouses.
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>Create Connection</Button>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
                <TableCell>Name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Details</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Last Tested</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {connections.map(conn => (
                <TableRow key={conn.id} hover sx={{ '&:last-child td': { border: 0 } }}>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <Typography fontWeight={600} variant="body2">{conn.name}</Typography>
                      {conn.is_shared && (
                        <Chip icon={<SharedIcon sx={{ fontSize: 14 }} />} label="Shared" size="small"
                          color="info" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell><TypeChip type={conn.connection_type} /></TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary"
                      sx={{ fontFamily: 'monospace', fontSize: 12, maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {connDetail(conn)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {conn.last_test_status === 'success' ? (
                      <Chip icon={<SuccessIcon />} label="Connected" size="small" color="success" variant="outlined" />
                    ) : conn.last_test_status === 'failed' ? (
                      <Tooltip title={conn.last_test_message || ''}>
                        <Chip icon={<ErrorIcon />} label="Failed" size="small" color="error" variant="outlined" />
                      </Tooltip>
                    ) : (
                      <Chip label="Untested" size="small" variant="outlined" />
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {conn.last_tested_at ? new Date(conn.last_tested_at).toLocaleString() : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Test Connection">
                      <IconButton size="small" onClick={() => handleTestSaved(conn)} disabled={testing === conn.id}>
                        {testing === conn.id ? <CircularProgress size={16} /> : <TestIcon />}
                      </IconButton>
                    </Tooltip>
                    {conn.connection_type === 's3' && (
                      <Tooltip title="Refresh Credentials">
                        <IconButton size="small" onClick={() => handleRefreshCredentials(conn)} disabled={refreshing === conn.id}>
                          {refreshing === conn.id ? <CircularProgress size={16} /> : <RefreshIcon sx={{ fontSize: 18 }} />}
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => openEdit(conn)}>
                        <EditIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton size="small" color="error" onClick={() => setDeleteTarget(conn)}>
                        <DeleteIcon />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* ── Create / Edit Dialog ── */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth
        PaperProps={{ sx: { maxHeight: '90vh' } }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {React.cloneElement(CONN_TYPE_META[ct]?.icon || <StorageIcon />, { sx: { color: CONN_TYPE_META[ct]?.color || '#64748b' } })}
            <span>{editingId ? 'Edit Connection' : 'New Connection'}</span>
          </Box>
        </DialogTitle>

        <DialogContent dividers sx={{ overflowY: 'auto' }}>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}

          <Stack spacing={2} sx={{ mt: 0.5 }}>

            {/* Name + Sharing */}
            <TextField
              label="Connection Name" fullWidth required size="small"
              value={form.name}
              onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Prod Starburst"
            />
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={form.is_shared || false}
                  onChange={e => setForm(prev => ({ ...prev, is_shared: e.target.checked }))}
                />
              }
              label={
                <Typography variant="body2" color="text.secondary">
                  Shared — visible to all users
                </Typography>
              }
            />

            {/* Type selector */}
            <TextField
              select label="Connection Type" fullWidth size="small"
              value={ct}
              onChange={e => handleTypeChange(e.target.value)}
            >
              <MenuItem value="s3">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CloudIcon fontSize="small" sx={{ color: '#f59e0b' }} /> AWS S3 Bucket
                </Box>
              </MenuItem>
              <MenuItem value="local">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <FolderIcon fontSize="small" sx={{ color: '#6366f1' }} /> Local Folder
                </Box>
              </MenuItem>
              {uploadEnabled && (
                <MenuItem value="upload">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <UploadIcon fontSize="small" sx={{ color: '#10b981' }} /> Upload Files
                  </Box>
                </MenuItem>
              )}
              <Divider />
              <MenuItem disabled sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 }}>
                SQL Warehouses
              </MenuItem>
              {['trino', 'starburst', 'snowflake', 'databricks', 'oracle'].map(t => (
                <MenuItem key={t} value={t}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <SqlIcon fontSize="small" sx={{ color: CONN_TYPE_META[t]?.color }} />
                    {CONN_TYPE_META[t]?.label}
                  </Box>
                </MenuItem>
              ))}
              <Divider />
              <MenuItem disabled sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 }}>
                APIs
              </MenuItem>
              <MenuItem value="rest_api">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CloudIcon fontSize="small" sx={{ color: '#8b5cf6' }} />
                  REST API
                </Box>
              </MenuItem>
            </TextField>

            <Divider />

            {/* Config form per type */}
            {ct === 's3'        && <S3FormWithTables config={form.config} onChange={updateConfig} connectionId={editingId} />}
            {ct === 'local'     && <LocalForm    config={form.config} onChange={updateConfig} />}
            {ct === 'upload'    && <UploadForm
              pendingFiles={pendingFiles}
              setPendingFiles={setPendingFiles}
              uploadedFiles={uploadedFiles}
              onDeleteUploaded={handleDeleteUploadedFile}
              connectionId={editingId}
            />}
            {(ct === 'trino' || ct === 'starburst')
                                && <TrinoForm    config={form.config} onChange={updateConfig} connType={ct} />}
            {ct === 'snowflake' && <SnowflakeForm config={form.config} onChange={updateConfig} />}
            {ct === 'databricks'&& <DatabricksForm config={form.config} onChange={updateConfig} />}
            {ct === 'oracle'    && <OracleForm     config={form.config} onChange={updateConfig} />}
            {ct === 'rest_api'  && <RestApiForm    config={form.config} onChange={updateConfig} />}

          </Stack>

          {/* Test result */}
          {testResult && (
            <Alert severity={testResult.success ? 'success' : 'error'} sx={{ mt: 2 }}>
              {testResult.message}
            </Alert>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
          <Button
            variant="outlined"
            onClick={handleTestInDialog}
            disabled={testing === 'dialog'}
            startIcon={testing === 'dialog' ? <CircularProgress size={16} /> : <TestIcon />}
          >
            Test Connection
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {uploadProgress || (saving ? 'Saving…' : (editingId ? 'Update' : 'Create'))}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete Confirmation ── */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Connection</DialogTitle>
        <DialogContent>
          <Typography>
            Delete <strong>{deleteTarget?.name}</strong>? Saved queries using this connection may stop working.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleDelete}>Delete</Button>
        </DialogActions>
      </Dialog>

      {/* ── Snackbar for refresh credentials feedback ── */}
      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))} variant="filled" sx={{ width: '100%' }}>
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default ConnectionManager;
