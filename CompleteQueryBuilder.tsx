import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { alpha } from '@mui/material/styles';
import { useNotifications } from '../context/NotificationContext';
import { useWebSocket } from '../context/WebSocketContext';
import { useAppSettings } from '../context/AppSettingsContext';
import { useAssistantContext } from '../context/AssistantContext';
import api, { ApiError } from '../services/api';
import DataGridViewer from './DataGridViewer';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  SidebarFileItem, TableSelectorModal, JoinBuilderModal,
  StreamingColumnSelectorDialog, ColumnSelectorModal, AggregationBuilderModal,
  FilterBuilderModal, HavingBuilderModal, ComputedColumnBuilderModal,
  CaseExpressionBuilderModal, WindowFunctionBuilderModal, SaveQueryModal,
  _normalizeJoin, _emptyJoin, JOIN_TYPE_COLORS,
} from './query-builder';
import BulkPartitionActions from './query-builder/BulkPartitionActions';
import useQueryBuilderModals from '../hooks/useQueryBuilderModals';
import {
  Box, Typography, Button, ButtonGroup, Paper, Card, CardContent,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem,
  Checkbox, FormControlLabel, Chip, IconButton, Tooltip, Menu,
  CircularProgress, LinearProgress, Alert, Stack, List, ListItem,
  ListItemButton, ListItemText, ListItemIcon, Divider, InputAdornment, Collapse,
  Autocomplete, useMediaQuery, FormControl, InputLabel, Select,
} from '@mui/material';
import {
  TableChart as TableIcon, Link as JoinIcon, ViewColumn as ColumnIcon,
  FilterAlt as FilterIcon, PlayArrow as PlayIcon, Save as SaveIcon,
  Code as CodeIcon, Close as CloseIcon, Add as AddIcon, Delete as DeleteIcon,
  Edit as EditIcon, Warning as WarningIcon, OpenInNew as OpenInNewIcon,
  Search as SearchIcon, ChevronLeft as CollapseIcon, ChevronRight as ExpandIcon,
  FolderOpen as FolderIcon, TableRows as TableRowsIcon, Refresh as RefreshIcon,
  Functions as AggIcon, Calculate as ComputedIcon, AccountTree as WindowIcon,
  CallSplit as CaseIcon, ViewList as FlatViewIcon, AccountTreeOutlined as TreeViewIcon,
  Cached as CachedIcon, CloudOff as CloudOffIcon, CloudSync as CloudSyncIcon,
  ExpandMore as ExpandMoreIcon, ExpandLess as ExpandLessIcon,
  Stream as StreamIcon,
  CloudDownload as CloudDownloadIcon,
  Storage as StorageIcon,
  Star as StarIcon,
  StarBorder as StarBorderIcon,
  Preview as PreviewIcon,
  Assessment as AssessmentIcon,
  ContentCopy as ContentCopyIcon,
  MoreVert as MoreVertIcon,
  CloudUpload as PublishApiIcon,
} from '@mui/icons-material';
import PublishViewDialog from './PublishViewDialog';


const SIDEBAR_W = 248;
const fmtSecs = (s: number) => {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), sec = s % 60;
  return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
};

const _timeAgo = (iso: string | undefined): string => {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const formatCount = (n: number) => {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
};

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B';
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
};

// Phase 86: parameter definition for SQL mode
interface ParamDef86 {
  name: string;
  type: 'string' | 'integer' | 'float' | 'boolean' | 'date';
  required: boolean;
  default: string | null;
  description: string;
}

interface QueryBuilderProps {
  tabId?: string;
  isActive?: boolean;
  initialSnapshot?: any;
  onSnapshotChange?: (snapshot: any) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onNameChange?: (name: string) => void;
}

const CompleteQueryBuilder = ({
  tabId,
  isActive = true,
  initialSnapshot,
  onSnapshotChange,
  onDirtyChange,
  onNameChange,
}: QueryBuilderProps = {}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const appSettings = useAppSettings();

  // Connection state
  const [connections, setConnections] = useState([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState(null);

  // Core state
  const [allFiles, setAllFiles] = useState([]);
  const [selectedTables, setSelectedTables] = useState([]);
  const [tableSchemas, setTableSchemas] = useState({});

  // Excel sheet picker state (for NFS .xlsx files in query builder)
  const [sheetPickerFile, setSheetPickerFile] = useState<any>(null);
  const [sheetPickerSheets, setSheetPickerSheets] = useState<string[]>([]);
  const [sheetPickerSelected, setSheetPickerSelected] = useState('');
  const [sheetPickerLoading, setSheetPickerLoading] = useState(false);

  // Sidebar state
  const isCompactScreen = useMediaQuery('(max-width:1280px)');
  const [sidebarOpen, setSidebarOpen] = useState(!isCompactScreen);
  const [sidebarView, setSidebarView] = useState<'flat' | 'tree'>('flat');
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [tableTypeFilter, setTableTypeFilter] = useState<'all' | 'registered' | 'materialized' | 'local' | 'federation'>('all');
  const [expandedFolders, setExpandedFolders] = useState({});
  const [loadedFolders, setLoadedFolders] = useState<Set<string>>(new Set());
  const [loadingFolder, setLoadingFolder] = useState<string | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  // Excel worksheet tree expansion
  const [expandedExcelFiles, setExpandedExcelFiles] = useState<Record<string, boolean>>({});
  const [excelFileSheets, setExcelFileSheets] = useState<Record<string, string[]>>({});
  const [excelLoadingFile, setExcelLoadingFile] = useState<string | null>(null);

  // Query building
  const [joins, setJoins] = useState([]);
  const [selectedColumns, setSelectedColumns] = useState([]);
  const [filters, setFilters] = useState([]);
  const [orderBy, setOrderBy] = useState([]);
  const [limit, setLimit] = useState<number | null>(1000);

  // Modals (hook manages 11 open/close booleans)
  const {
    showTableSelector, setShowTableSelector,
    showJoinBuilder, setShowJoinBuilder,
    showColumnSelector, setShowColumnSelector,
    showFilterBuilder, setShowFilterBuilder,
    showSaveDialog, setShowSaveDialog,
    showAggBuilder, setShowAggBuilder,
    showHavingBuilder, setShowHavingBuilder,
    showComputedBuilder, setShowComputedBuilder,
    showCaseBuilder, setShowCaseBuilder,
    showWindowBuilder, setShowWindowBuilder,
    showPreview, setShowPreview,
  } = useQueryBuilderModals();
  const [aggregations, setAggregations] = useState([]);  // [{column, function, alias, distinct}]
  // Advanced SQL features
  const [distinct, setDistinct] = useState(false);
  const [filterLogic, setFilterLogic] = useState('AND');
  const [having, setHaving] = useState<any[]>([]);
  const [computedColumns, setComputedColumns] = useState<any[]>([]);
  const [caseExpressions, setCaseExpressions] = useState<any[]>([]);
  const [columnAliases, setColumnAliases] = useState<Record<string, string>>({});
  const [windowFunctions, setWindowFunctions] = useState<any[]>([]);
  // Table context menu + preview/profile/favorites (Phase 1 UX)
  const [tableContextMenu, setTableContextMenu] = useState<{ anchorPosition: { top: number; left: number }; item: any } | null>(null);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [profileData, setProfileData] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [tableFavorites, setTableFavorites] = useState<Set<string>>(new Set());

  // Execution
  const [executing, setExecuting] = useState(false);
  const [executionId, setExecutionId] = useState(null);
  const [progress, setProgress] = useState(null);
  const [elapsed, setElapsed] = useState(0);         // seconds since execute
  const [etaSeconds, setEtaSeconds] = useState(null); // historical p75
  const execStartRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const executeQueryRef = useRef<() => void>(() => {});
  const handleProgressRef = useRef<(msg: any) => void>(() => {});
  const [sqlPreview, setSqlPreview] = useState('');

  // Cache strategy: auto = serve from cache; bypass = always fresh; refresh = fresh + update cache
  const [cacheStrategy, setCacheStrategy] = useState<'auto' | 'bypass' | 'refresh'>('auto');
  const [cacheMenuAnchor, setCacheMenuAnchor] = useState<null | HTMLElement>(null);

  // Cost estimate
  const [costEstimate, setCostEstimate] = useState<{ estimated_rows: number; estimated_files: number } | null>(null);
  const [estimating, setEstimating] = useState(false);
  const estimateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // SQL editor mode
  const [queryMode, setQueryMode] = useState<'visual' | 'sql'>('visual');
  const [rawSql, setRawSql] = useState('');
  const [sqlLoading, setSqlLoading] = useState(false);

  // Phase 86: Parameter panel for SQL mode
  const [detectedParams, setDetectedParams] = useState<ParamDef86[]>([]);
  const [paramTestValues, setParamTestValues] = useState<Record<string, string>>({});

  // Results viewer
  const [showResults, setShowResults] = useState(false);
  const [resultsExecutionId, setResultsExecutionId] = useState(null);
  const [isStale, setIsStale] = useState(false);
  const [fileStats, setFileStats] = useState<any>(null);  // file scan metadata from WS

  // Streaming source — enables DataGridViewer to paginate directly from S3
  const [enableStreaming, setEnableStreaming] = useState(false);
  const [streamBgDownload, setStreamBgDownload] = useState(true); // when true, also runs full S3→local download alongside streaming
  const [streamingSource, setStreamingSource] = useState<{ queryConfig?: any; rawSql?: string; connectionId: number; columns?: string[] } | null>(null);
  const [resultKey] = useState(0);

  // Streaming column selection — two-phase flow: discover columns → user picks → stream
  const [streamSchemaLoading, setStreamSchemaLoading] = useState(false);
  const [streamSchema, setStreamSchema] = useState<{
    columns: Array<{ name: string; type: string; empty: boolean }>;
    estimated_rows: number;
  } | null>(null);
  const [streamColSelectorOpen, setStreamColSelectorOpen] = useState(false);
  const [streamSelectedCols, setStreamSelectedCols] = useState<string[]>([]);
  const [pendingStreamSource, setPendingStreamSource] = useState<any>(null);
  const [deferredExecutePayload, setDeferredExecutePayload] = useState<any>(null); // holds payload when waiting for column selection before download

  // Edit mode — set when navigated from SavedQueries with loadQuery state
  const [editingQueryId, setEditingQueryId] = useState(null);
  const [editingQueryName, setEditingQueryName] = useState('');
  // Phase 85C-2: Publish as API dialog state
  const [publishApiDialogOpen, setPublishApiDialogOpen] = useState(false);

  // Registered tables (enterprise table registry)
  const [registeredTables, setRegisteredTables] = useState<any[]>([]);
  const [regTableSchemas, setRegTableSchemas] = useState<Record<string, any>>({});
  const [loadingRegSchema, setLoadingRegSchema] = useState<string | null>(null);

  // Materialized views (pre-downloaded S3 data)
  const [materializedViews, setMaterializedViews] = useState<any[]>([]);

  // Local tables (uploaded/imported tables — not connection-specific)
  const [localTables, setLocalTables] = useState<any[]>([]);
  // Phase 97: Materialized federation views (cross-connection, shown in sidebar)
  const [federationViews, setFederationViews] = useState<any[]>([]);

  // Partition selector for Iceberg registered tables
  const [partitionData, setPartitionData] = useState<Record<string, any>>({});  // tableName → {partition_columns, values, file_counts}
  const [selectedPartitions, setSelectedPartitions] = useState<Record<string, Record<string, string[]>>>({});  // tableName → {colName → [selectedValues]}
  const [loadingPartitions, setLoadingPartitions] = useState<Set<string>>(new Set());
  const [refiningPartitions, setRefiningPartitions] = useState<Set<string>>(new Set());  // tables with background full-scan in progress
  const [refreshingPartitions, setRefreshingPartitions] = useState<Set<string>>(new Set());  // tables with manual refresh in progress
  const [refreshingAllPartitions, setRefreshingAllPartitions] = useState(false);
  const [expandedPartitionPanels, setExpandedPartitionPanels] = useState<Set<string>>(new Set()); // which tables have expanded partition panels

  // Iceberg table state (S3 connections with iceberg_warehouse_path)
  const [icebergTables, setIcebergTables] = useState([]);
  const [expandedIcebergTables, setExpandedIcebergTables] = useState({});
  const [icebergTableFiles, setIcebergTableFiles] = useState({});  // prefix → file[]
  const [icebergLoading, setIcebergLoading] = useState(false);
  const [icebergLoadingTable, setIcebergLoadingTable] = useState(null);

  // Cross-connection Union / Join (parquet files from a second connection)
  const [showCrossConn, setShowCrossConn] = useState(false);
  const [crossConnId, setCrossConnId] = useState(null);
  const [crossConnFiles, setCrossConnFiles] = useState([]);
  const [crossConnFile, setCrossConnFile] = useState(null);
  const [crossConnMode, setCrossConnMode] = useState('union'); // 'union' | 'join'
  const [crossJoinLeftOn, setCrossJoinLeftOn] = useState<string[]>([]);
  const [crossJoinRightOn, setCrossJoinRightOn] = useState<string[]>([]);
  const [crossJoinHow, setCrossJoinHow] = useState('inner');
  const [crossConnLoading, setCrossConnLoading] = useState(false);
  const [crossConnColumns, setCrossConnColumns] = useState<string[]>([]);
  const [crossConnSchemaLoading, setCrossConnSchemaLoading] = useState(false);
  // Secondary partition filter state
  const [crossConnPartitionData, setCrossConnPartitionData] = useState<any>(null);
  const [crossConnSelectedPartitions, setCrossConnSelectedPartitions] = useState<Record<string, string[]>>({});
  // Phase 124-D: Secondary raw SQL for cross-connection SQL mode
  const [secondaryRawSql, setSecondaryRawSql] = useState('');
  // Phase 85B: cross-conn join preview dialog
  const [crossJoinPreviewOpen, setCrossJoinPreviewOpen] = useState(false);
  const [crossJoinPreviewLoading, setCrossJoinPreviewLoading] = useState(false);
  const [crossJoinPreviewRows, setCrossJoinPreviewRows] = useState<any[]>([]);
  const [crossJoinPreviewCols, setCrossJoinPreviewCols] = useState<string[]>([]);
  const [crossJoinPreviewError, setCrossJoinPreviewError] = useState('');

  const { addNotification } = useNotifications();
  const { lastMessage } = useWebSocket();
  const { setAssistantCtx } = useAssistantContext();

  useEffect(() => {
    loadConnections();
    // loadFiles is triggered by the [selectedConnectionId] effect — no need here
  }, []);

  // Apply admin-configured defaults (only for new queries, not when editing saved)
  const _settingsApplied = useRef(false);
  useEffect(() => {
    if (!appSettings.loaded || _settingsApplied.current) return;
    if (editingQueryId) return; // don't override saved query state
    _settingsApplied.current = true;
    setLimit(appSettings.limits.default_query_limit);
    setEnableStreaming(appSettings.limits.streaming_default_on);
    setStreamBgDownload(appSettings.limits.stream_bg_download_default);
  }, [appSettings.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Global keyboard shortcuts — only active tab handles them
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  // Auto-clear result data after 5 minutes of inactivity to free memory.
  // Query config (tables, filters, SQL, connection) stays intact — user just re-executes.
  const IDLE_CLEAR_MS = 5 * 60 * 1000;
  const resultsClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const executingRef = useRef(executing);
  executingRef.current = executing;

  useEffect(() => {
    if (isActive) {
      // Tab became active — cancel any pending cleanup
      if (resultsClearTimerRef.current) {
        clearTimeout(resultsClearTimerRef.current);
        resultsClearTimerRef.current = null;
      }
      return;
    }
    // Tab went inactive — schedule marking as stale (frees DOM/memory but keeps executionId)
    resultsClearTimerRef.current = setTimeout(() => {
      if (!executingRef.current) {
        setIsStale(true);       // Mark stale — but KEEP the executionId
        setShowResults(false);  // Unmount DataGridViewer to free memory
      }
      resultsClearTimerRef.current = null;
    }, IDLE_CLEAR_MS);
    return () => {
      if (resultsClearTimerRef.current) {
        clearTimeout(resultsClearTimerRef.current);
        resultsClearTimerRef.current = null;
      }
    };
  }, [isActive]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isActiveRef.current) return; // only the visible tab handles shortcuts
      // Ctrl+Enter → execute query
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        executeQueryRef.current();
      }
      // Ctrl+S → save query
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && !e.shiftKey) {
        e.preventDefault();
        setShowSaveDialog(true);
      }
      // Ctrl+Shift+E → toggle SQL preview
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'E' || e.key === 'e')) {
        e.preventDefault();
        setShowPreview(v => !v);
      }
      // Escape → close any open modal
      if (e.key === 'Escape') {
        setShowSaveDialog(false);
        setShowPreview(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Restore state from tab snapshot on mount (tabbed mode)
  // Since tabs stay mounted (display: none), this only runs once when a tab is first created
  const _restoringFromSnapshot = useRef(false);
  const _partitionFetchedForConn = useRef<number | null>(null);

  useEffect(() => {
    if (!tabId || !initialSnapshot) return;
    _restoringFromSnapshot.current = true;
    if (initialSnapshot.connectionId) setSelectedConnectionId(initialSnapshot.connectionId);
    if (initialSnapshot.editingQueryId) setEditingQueryId(initialSnapshot.editingQueryId);
    if (initialSnapshot.editingQueryName) setEditingQueryName(initialSnapshot.editingQueryName);
    if (initialSnapshot.queryMode) setQueryMode(initialSnapshot.queryMode);
    if (initialSnapshot.rawSql) setRawSql(initialSnapshot.rawSql);
    if (initialSnapshot.enableStreaming !== undefined) setEnableStreaming(initialSnapshot.enableStreaming);
    if (initialSnapshot.streamBgDownload !== undefined) setStreamBgDownload(initialSnapshot.streamBgDownload);
    if (initialSnapshot.resultsExecutionId) {
      setResultsExecutionId(initialSnapshot.resultsExecutionId);
      if (isActiveRef.current) {
        setShowResults(true);     // Active tab: fetch immediately
      } else {
        setIsStale(true);         // Inactive tab: defer until user clicks "Load Results"
        setShowResults(false);
      }
    }
    // Don't restore streamingSource on reload — S3 streaming sessions are ephemeral.
    // If the stream completed, resultsExecutionId handles it.
    // if (initialSnapshot.streamingSource) setStreamingSource(initialSnapshot.streamingSource);
    // Reconstruct visual query state from queryConfig
    const qc = initialSnapshot.queryConfig;
    if (qc) {
      if (qc.files?.length > 0) {
        // Collect ALL table paths: primary files + any joined tables (right_file)
        const allPaths = new Set<string>(qc.files);
        if (qc.joins?.length > 0) {
          for (const j of qc.joins) {
            if (j.left_file) allPaths.add(j.left_file);
            if (j.right_file) allPaths.add(j.right_file);
          }
        }
        setSelectedTables(Array.from(allPaths).map((path: string) => {
          const stripped = path.replace('__registered__:', '').replace('__materialized__:', '').replace('__local__:', '').replace('__federation__:', '');
          return {
            path, name: stripped.split('/').pop()?.replace(/\.[^.]+$/, '') || stripped,
            folder: stripped.includes('/') ? stripped.substring(0, stripped.lastIndexOf('/')) : '',
          };
        }));
      }
      if (qc.joins?.length > 0) setJoins(qc.joins.map((j: any, i: number) => {
        const leftOnArr = Array.isArray(j.left_on) ? j.left_on : [j.left_on].filter(Boolean);
        const rightOnArr = Array.isArray(j.right_on) ? j.right_on : [j.right_on].filter(Boolean);
        const conditions = leftOnArr.map((l: string, ci: number) => ({
          leftColumn: l || '', rightColumn: rightOnArr[ci] || '',
        }));
        return {
          id: Date.now() + i, leftTable: j.left_file, rightTable: j.right_file,
          conditions: conditions.length > 0 ? conditions : [{ leftColumn: '', rightColumn: '' }],
          joinType: j.how || 'inner',
          rightSuffix: j.right_suffix || '',
          rightColumnAliases: j.right_column_aliases || {},
        };
      }));
      if (qc.columns?.length > 0) setSelectedColumns(qc.columns.map((col: string) => { const p = col.split('.'); return p.length === 2 ? { tableName: p[0], columnName: p[1] } : { tableName: '', columnName: col }; }));
      // BF-72: Skip partition-derived filters on restore — they'll re-derive from selectedPartitions
      const userFilters = (qc.filters || []).filter((f: any) => !f._partition);
      if (userFilters.length > 0) setFilters(userFilters.map((f: any, i: number) => { const b: any = { id: Date.now() + i, column: f.column, operator: f.operator }; if (f.operator === 'between' && Array.isArray(f.value)) { b.value_low = f.value[0]; b.value_high = f.value[1]; b.value = ''; } else { b.value = Array.isArray(f.value) ? f.value.join(', ') : (f.value ?? ''); } return b; }));
      if (qc.order_by?.length > 0) setOrderBy(qc.order_by.map((o: any) => ({ column: o.column, direction: o.direction || 'asc' })));
      if (qc.limit !== undefined) setLimit(qc.limit || null);
      if (qc.aggregations?.length > 0) setAggregations(qc.aggregations.map((a: any) => ({ column: a.column, function: a.function, alias: a.alias || '', distinct: a.distinct || false })));
      if (qc.distinct) setDistinct(true);
      if (qc.filter_logic) setFilterLogic(qc.filter_logic);
      if (qc.having?.length > 0) setHaving(qc.having);
      if (qc.computed_columns?.length > 0) setComputedColumns(qc.computed_columns);
      if (qc.case_expressions?.length > 0) setCaseExpressions(qc.case_expressions);
      if (qc.column_aliases) setColumnAliases(qc.column_aliases);
      if (qc.window_functions?.length > 0) setWindowFunctions(qc.window_functions);
    }
    // BF-45: Restore cross-connection state from snapshot
    const cc = initialSnapshot.crossConn;
    if (cc) {
      setShowCrossConn(true);
      if (cc.crossConnId) setCrossConnId(cc.crossConnId);
      if (cc.crossConnFile) setCrossConnFile(cc.crossConnFile);
      if (cc.crossConnMode) setCrossConnMode(cc.crossConnMode);
      if (cc.crossJoinHow) setCrossJoinHow(cc.crossJoinHow);
      if (cc.crossJoinLeftOn?.length) setCrossJoinLeftOn(cc.crossJoinLeftOn);
      if (cc.crossJoinRightOn?.length) setCrossJoinRightOn(cc.crossJoinRightOn);
      if (cc.crossConnSelectedPartitions) setCrossConnSelectedPartitions(cc.crossConnSelectedPartitions);
      if (cc.crossConnPartitionData) setCrossConnPartitionData(cc.crossConnPartitionData);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load saved query into builder when navigated from SavedQueries (standalone mode only)
  useEffect(() => {
    if (tabId) return; // Tab manager handles loadQuery interception
    const loadQuery = location.state?.loadQuery;
    if (!loadQuery) return;
    const qc = loadQuery.query_config || {};

    setEditingQueryId(loadQuery.id);
    setEditingQueryName(loadQuery.name || '');

    // Restore the connection so file browser and schema loading work
    if (qc.connection_id) {
      setSelectedConnectionId(qc.connection_id);
    }

    // Reconstruct selectedTables from files array in query_config
    if (qc.files && qc.files.length > 0) {
      const tables = qc.files.map(path => ({
        path,
        name: path.split('/').pop().replace(/\.[^.]+$/, ''),
        folder: path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '',
      }));
      setSelectedTables(tables);
    }

    // Reconstruct joins
    if (qc.joins && qc.joins.length > 0) {
      setJoins(qc.joins.map((j, i) => ({
        id: Date.now() + i,
        leftTable:   j.left_file,
        rightTable:  j.right_file,
        leftColumn:  Array.isArray(j.left_on)  ? j.left_on[0]  : j.left_on,
        rightColumn: Array.isArray(j.right_on) ? j.right_on[0] : j.right_on,
        joinType:    j.how || 'inner',
      })));
    }

    // Reconstruct columns
    if (qc.columns && qc.columns.length > 0) {
      setSelectedColumns(qc.columns.map(col => {
        const parts = col.split('.');
        return parts.length === 2
          ? { tableName: parts[0], columnName: parts[1] }
          : { tableName: '', columnName: col };
      }));
    }

    // Reconstruct filters (BF-72: skip partition-derived filters — they re-derive from partition selector)
    const savedUserFilters = (qc.filters || []).filter((f: any) => !f._partition);
    if (savedUserFilters.length > 0) {
      setFilters(savedUserFilters.map((f, i) => {
        const base: any = { id: Date.now() + i, column: f.column, operator: f.operator };
        if (f.operator === 'between' && Array.isArray(f.value)) {
          base.value_low = f.value[0]; base.value_high = f.value[1]; base.value = '';
        } else {
          base.value = Array.isArray(f.value) ? f.value.join(', ') : (f.value ?? '');
        }
        return base;
      }));
    }

    // Reconstruct order by
    if (qc.order_by && qc.order_by.length > 0) {
      setOrderBy(qc.order_by.map(o => ({ column: o.column, direction: o.direction || 'asc' })));
    }

    if (qc.limit !== undefined) setLimit(qc.limit || null);

    // Reconstruct aggregations
    if (qc.aggregations?.length > 0) {
      setAggregations(qc.aggregations.map((a: any) => ({
        column: a.column, function: a.function,
        alias: a.alias || '', distinct: a.distinct || false,
      })));
    }
    // Reconstruct advanced SQL features
    if (qc.distinct) setDistinct(true);
    if (qc.filter_logic) setFilterLogic(qc.filter_logic);
    if (qc.having?.length > 0) setHaving(qc.having);
    if (qc.computed_columns?.length > 0) setComputedColumns(qc.computed_columns);
    if (qc.case_expressions?.length > 0) setCaseExpressions(qc.case_expressions);
    if (qc.column_aliases) setColumnAliases(qc.column_aliases);
    if (qc.window_functions?.length > 0) setWindowFunctions(qc.window_functions);

    // Phase 86: Restore param_definitions from saved query
    if (loadQuery.param_definitions?.length > 0) {
      setDetectedParams(loadQuery.param_definitions.map((p: any) => ({
        name: p.name || '',
        type: p.type || 'string',
        required: p.required !== false,
        default: p.default ?? null,
        description: p.description || '',
      })));
    }

    addNotification({ type: 'info', title: 'Query Loaded', message: `Editing "${loadQuery.name}"` });

    // Clear the router state so a refresh doesn't re-apply
    navigate('/', { replace: true, state: {} });
  }, [location.state?.loadQuery]);

  // Phase 88b: Catalog pre-load — check sessionStorage for a catalogLoad request
  useEffect(() => {
    const raw = sessionStorage.getItem('catalogLoad');
    if (!raw) return;
    sessionStorage.removeItem('catalogLoad');
    try {
      const { connectionId, tablePath, tableName, partitionFilters } = JSON.parse(raw);
      if (connectionId && tablePath) {
        setSelectedConnectionId(connectionId);
        // Give the connection effect time to load registered tables before adding the table
        setTimeout(() => {
          setSelectedTables([{ path: tablePath, name: tableName || tablePath }]);
          // Apply partition filters if provided (from PartitionQueryDialog in Phase 88b)
          if (partitionFilters && Array.isArray(partitionFilters) && partitionFilters.length > 0) {
            // selectedPartitions shape: Record<tableName, Record<colName, string[]>>
            // tableName here is the bare name (without __registered__: prefix)
            const bareTableName = String(tableName || tablePath).replace('__registered__:', '');
            const colMap: Record<string, string[]> = {};
            for (const pf of partitionFilters as Array<{ column: string; values: string[] }>) {
              if (pf.column && Array.isArray(pf.values) && pf.values.length > 0) {
                colMap[pf.column] = pf.values;
              }
            }
            if (Object.keys(colMap).length > 0) {
              setSelectedPartitions(prev => ({
                ...prev,
                [bareTableName]: { ...(prev[bareTableName] || {}), ...colMap },
              }));
            }
          }
        }, 800);
      }
    } catch { /* ignore malformed payload */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 86: Auto-detect {{param}} placeholders in SQL editor and sync detectedParams
  useEffect(() => {
    if (queryMode !== 'sql') return;
    const matches = [...new Set((rawSql || '').match(/\{\{(\w+)\}\}/g)?.map(m => m.slice(2, -2)) ?? [])];
    setDetectedParams(prev => {
      // Preserve existing type/required/default settings for params already in the list
      return matches.map(name => prev.find(p => p.name === name) ?? {
        name,
        type: 'string' as const,
        required: true,
        default: null,
        description: '',
      });
    });
  }, [rawSql, queryMode]);

  // Reload file list when connection changes
  useEffect(() => {
    // When restoring from a snapshot, only consume the flag once we have the actual
    // connection value (not the initial null render). This prevents the first-render
    // effect from eating the flag before the real connection value arrives.
    if (_restoringFromSnapshot.current) {
      if (!selectedConnectionId) return; // still waiting for the snapshot connectionId
      _restoringFromSnapshot.current = false;
      // Load files/sidebar but preserve restored query state (tables, results, etc.)
      loadFiles();
      const conn = connections.find(c => c.id === selectedConnectionId);
      if (conn?.config?.registered_tables?.length > 0) {
        setRegisteredTables(conn.config.registered_tables);
      }
      // Load materialized views for this connection
      if (conn?.connection_type === 's3') {
        api.listMaterializedViews(selectedConnectionId).then(mvs =>
          setMaterializedViews((mvs || []).filter((m: any) => m.status === 'ready'))
        ).catch(() => setMaterializedViews([]));
      }
      const warehousePath = conn?.config?.iceberg_warehouse_path;
      if (conn?.connection_type === 's3' && warehousePath) {
        loadIcebergTablesForConn(selectedConnectionId, warehousePath);
      }
      // Load local tables (not connection-specific — always available)
      api.listLocalTables().then((lts: any[]) => setLocalTables((lts || []).filter((lt: any) => lt.status === 'ready'))).catch(() => {});
      // Phase 97: Load materialized federation views
      api.listMaterializedFederationViews().then((fvs: any[]) => setFederationViews(fvs || [])).catch(() => {});
      return;
    }
    // Normal connection change — reset query state and clear results
    setResultsExecutionId(null);
    setStreamingSource(null);
    setShowResults(false);
    setIsStale(false);
    setSelectedTables([]);
    setTableSchemas({});
    setSidebarSearch('');
    // Reset all query-building state so old column/table refs don't leak into new connection
    setJoins([]);
    setSelectedColumns([]);
    setFilters([]);
    setOrderBy([]);
    setAggregations([]);
    setDistinct(false);
    setFilterLogic('AND');
    setHaving([]);
    setComputedColumns([]);
    setCaseExpressions([]);
    setColumnAliases({});
    setWindowFunctions([]);
    setRegisteredTables([]);
    setRegTableSchemas({});
    setPartitionData({});
    setSelectedPartitions({});
    setIcebergTables([]);
    setIcebergTableFiles({});
    setExpandedIcebergTables({});
    setLoadedFolders(new Set());
    setExpandedFolders({});
    setExpandedExcelFiles({});
    setExcelFileSheets({});
    setExcelLoadingFile(null);
    setMaterializedViews([]);
    setLocalTables([]);
    // BF-44: Reset cross-conn state — old secondary config and join keys
    // reference the previous primary connection's columns
    setShowCrossConn(false);
    setCrossConnId(null);
    setCrossConnFiles([]);
    setCrossConnFile(null);
    setCrossConnMode('union');
    setCrossJoinLeftOn([]);
    setCrossJoinRightOn([]);
    setCrossJoinHow('inner');
    setCrossConnColumns([]);
    setCrossConnPartitionData(null);
    setCrossConnSelectedPartitions({});
    setSecondaryRawSql('');
    loadFiles();
    // Load registered tables + Iceberg tables + Materialized views for this connection
    const conn = connections.find(c => c.id === selectedConnectionId);
    if (conn?.config?.registered_tables?.length > 0) {
      setRegisteredTables(conn.config.registered_tables);
    }
    if (conn?.connection_type === 's3') {
      api.listMaterializedViews(selectedConnectionId).then(mvs =>
        setMaterializedViews((mvs || []).filter((m: any) => m.status === 'ready'))
      ).catch(() => setMaterializedViews([]));
    }
    const warehousePath = conn?.config?.iceberg_warehouse_path;
    if (conn?.connection_type === 's3' && warehousePath) {
      loadIcebergTablesForConn(selectedConnectionId, warehousePath);
    }
    // Load local tables (not connection-specific — always available)
    api.listLocalTables().then((lts: any[]) => setLocalTables((lts || []).filter((lt: any) => lt.status === 'ready'))).catch(() => {});
    // Phase 97: Load materialized federation views
    api.listMaterializedFederationViews().then((fvs: any[]) => setFederationViews(fvs || [])).catch(() => {});
  }, [selectedConnectionId]);

  // ── Auto-load partition data for all partitioned registered tables on connection change ──
  useEffect(() => {
    if (!selectedConnectionId || registeredTables.length === 0) return;
    // Skip re-fetch if we already loaded partitions for this connection
    if (_partitionFetchedForConn.current === selectedConnectionId) return;
    _partitionFetchedForConn.current = selectedConnectionId;

    const connId = String(selectedConnectionId);
    const capturedConnId = selectedConnectionId; // stale-guard
    const partitionedTbls = registeredTables.filter((rt: any) => rt.format === 'iceberg' || rt.format === 'parquet');
    if (partitionedTbls.length === 0) return;
    // Pre-fetch partitions for all Iceberg + hive-partitioned Parquet tables
    partitionedTbls.forEach((rt: any) => {
      setLoadingPartitions(prev => new Set(prev).add(rt.name));
      api.getRegisteredTablePartitions(connId, rt.name)
        .then((pd: any) => {
          // Stale-guard: discard if connection changed while fetching
          if (_partitionFetchedForConn.current !== capturedConnId) return;
          if (pd?.partition_columns?.length > 0) {
            setPartitionData(prev => ({ ...prev, [rt.name]: pd }));
            setExpandedPartitionPanels(prev => new Set(prev).add(rt.name));
            // Kick off background full-scan refinement if fast_path
            if (pd.fast_path) {
              setRefiningPartitions(prev => new Set(prev).add(rt.name));
              api.getRegisteredTablePartitions(connId, rt.name, true)
                .then((fullData: any) => {
                  if (_partitionFetchedForConn.current !== capturedConnId) return;
                  setPartitionData(prev => prev[rt.name] ? { ...prev, [rt.name]: fullData } : prev);
                })
                .catch(() => {})
                .finally(() => setRefiningPartitions(prev => { const n = new Set(prev); n.delete(rt.name); return n; }));
            }
          }
        })
        .catch((e: any) => {
          if (_partitionFetchedForConn.current !== capturedConnId) return;
          const tableName = rt.name;
          addNotification({ type: 'warning', title: 'Partition Load Warning',
            message: `Could not load partition values for "${tableName}". Filters may not work correctly. ${String(e)}` });
        })
        .finally(() => setLoadingPartitions(prev => { const n = new Set(prev); n.delete(rt.name); return n; }));
    });
  }, [selectedConnectionId, registeredTables]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep GlobalAssistantPanel context in sync with query builder connection
  useEffect(() => {
    const conn = (connections as any[]).find((c: any) => c.id === selectedConnectionId);
    setAssistantCtx({
      connectionId: selectedConnectionId ?? undefined,
      connectionType: conn?.connection_type || 'duckdb',
      pageName: 'query-builder',
    });
  }, [selectedConnectionId, connections]);

  // When connections load AFTER snapshot restoration already consumed the flag,
  // populate connection-dependent state (registeredTables, MVs, iceberg tables).
  // Without this, the sidebar stays empty because connections was [] during restoration.
  useEffect(() => {
    if (!selectedConnectionId || connections.length === 0) return;
    const conn = connections.find(c => c.id === selectedConnectionId);
    if (!conn) return;
    // Only fill if still empty (don't override a normal connection-change flow)
    if (registeredTables.length === 0 && conn.config?.registered_tables?.length > 0) {
      setRegisteredTables(conn.config.registered_tables);
    }
    if (materializedViews.length === 0 && conn.connection_type === 's3') {
      api.listMaterializedViews(selectedConnectionId).then(mvs =>
        setMaterializedViews((mvs || []).filter((m: any) => m.status === 'ready'))
      ).catch(() => {});
    }
    const warehousePath = conn.config?.iceberg_warehouse_path;
    if (icebergTables.length === 0 && conn.connection_type === 's3' && warehousePath) {
      loadIcebergTablesForConn(selectedConnectionId, warehousePath);
    }
  }, [connections, selectedConnectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load favorites when connection changes
  useEffect(() => {
    api.listTableFavorites(selectedConnectionId || undefined).then((res: any) => {
      const favSet = new Set<string>((res?.favorites || []).map((f: any) => f.table_path));
      setTableFavorites(favSet);
    }).catch(() => {});
  }, [selectedConnectionId]);

  useEffect(() => {
    if (selectedTables.length > 0) loadSchemas();
  // Also re-run when registeredTables populates so that partition data for already-
  // selected tables is fetched even if loadSchemas fired before connections loaded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTables, registeredTables.length]);

  useEffect(() => {
    generateSQLPreview();
  }, [selectedTables, joins, selectedColumns, filters, orderBy, limit, aggregations,
      distinct, filterLogic, having, computedColumns, caseExpressions, columnAliases, windowFunctions,
      selectedPartitions, partitionData,
      showCrossConn, crossConnId, crossConnFile, crossConnMode, crossJoinHow,
      crossJoinLeftOn, crossJoinRightOn, crossConnSelectedPartitions]);

  // Collect partition source-column names across all selected tables so the
  // DataGridViewer can auto-pin them and push them to the front of the grid.
  const activePartitionColumns = useMemo(() => {
    const cols: string[] = [];
    for (const table of selectedTables) {
      const tName = table.path?.startsWith('__registered__:')
        ? table.path.replace('__registered__:', '')
        : null;
      if (!tName) continue;
      const pdata = partitionData[tName];
      for (const pc of (pdata?.partition_columns || [])) {
        const colName = pc.source_column || pc.name;
        if (colName && !cols.includes(colName)) cols.push(colName);
      }
    }
    return cols;
  }, [selectedTables, partitionData]);

  useEffect(() => {
    if (lastMessage && lastMessage.execution_id === executionId) {
      handleProgressRef.current(lastMessage);
    }
  }, [lastMessage, executionId]);

  const loadConnections = async () => {
    try {
      const conns = await api.listConnections(true);
      setConnections(conns || []);
    } catch (e: any) {
      addNotification({ type: 'error', title: 'Failed to load connections', message: (e as Error).message });
    }
  };

  const loadFiles = async (folder = '') => {
    // Only show full spinner for root load; folder expansions use per-folder state
    if (!folder) setFilesLoading(true);
    try {
      const data = selectedConnectionId
        ? await api.listConnectionFiles(selectedConnectionId, folder)
        : await api.listFiles();
      // Normalize: backend may return File[] (old) or {items: File[], truncated: boolean} (new)
      const items: any[] = Array.isArray(data) ? data : (data?.items || []);
      const truncated: boolean = !Array.isArray(data) && !!data?.truncated;

      // Cap display at 500 items (78U)
      const displayItems = items.slice(0, 500);

      // Warn on mixed parquet + CSV (78V)
      if (!folder) {
        const hasParquet = items.some((f: any) => f.name?.toLowerCase().endsWith('.parquet'));
        const hasCsv = items.some((f: any) => f.name?.toLowerCase().endsWith('.csv'));
        if (hasParquet && hasCsv) {
          addNotification({ type: 'warning', title: 'Mixed file types', message: 'Mixed file types detected: only .parquet files will be queried. CSV files are ignored.' });
        }
      }

      // Notify if results were truncated (78U)
      if (truncated || items.length > 500) {
        addNotification({ type: 'info', title: 'Results truncated', message: 'Only the first 500 items shown. Navigate into a subfolder or use search.' });
      }

      const loaded = displayItems;
      if (!folder) {
        // Root load — replace everything
        setAllFiles(loaded);
        setExpandedFolders({});
        if (loaded.length > 0) setSidebarOpen(true);
      } else {
        // Subfolder load — append new items (avoid duplicates by key)
        setAllFiles(prev => {
          const existing = new Set(prev.map((f: any) => f.key || f.path));
          const newItems = loaded.filter((f: any) => !existing.has(f.key || f.path));
          return [...prev, ...newItems];
        });
      }
    } catch (_err) {
      const error = _err as any;
      const isTokenExpired = error instanceof ApiError && error.errorCode === 'TOKEN_EXPIRED';
      addNotification({
        type: 'error',
        title: isTokenExpired ? 'Session Token Expired' : 'Error loading files',
        message: error.message,
        ...(isTokenExpired ? { action: { label: 'Update Connection', href: '/connections' } } : {}),
      });
    } finally {
      if (!folder) setFilesLoading(false);
    }
  };

  const loadSchemas = async () => {
    // Tables that need full schema fetch (not yet cached)
    // Also re-include registered tables whose schema is cached but partition data is
    // still missing AND we now have registeredTables metadata (which tells us if the
    // table is partitioned).  This handles the race where snapshot restoration runs
    // loadSchemas() before connections/registeredTables are available.
    const toFetch = selectedTables.filter(t => {
      if (!tableSchemas[t.path]) return true; // schema not cached yet
      if (t.path.startsWith('__registered__:')) {
        const tblName = t.path.replace('__registered__:', '');
        const rt = registeredTables.find((r: any) => r.name === tblName);
        if (rt && (rt.format === 'iceberg' || rt.format === 'parquet') && !partitionData[tblName]) {
          return true; // schema cached but partitions missing; registeredTables now available
        }
      }
      return false;
    });
    if (toFetch.length === 0) return;

    // Set loading indicators for all registered+partition tables upfront
    const regTables = toFetch.filter(t => t.path.startsWith('__registered__:'));
    if (regTables.length > 0) {
      setLoadingRegSchema(regTables[0].path.replace('__registered__:', ''));
      const needingPartitions = regTables
        .map(t => t.path.replace('__registered__:', ''))
        .filter(name => {
          const rt = registeredTables.find(r => r.name === name);
          return (rt?.format === 'iceberg' || rt?.format === 'parquet') && !partitionData[name];
        });
      if (needingPartitions.length > 0) {
        setLoadingPartitions(prev => {
          const n = new Set(prev);
          needingPartitions.forEach(name => n.add(name));
          return n;
        });
      }
    }

    // Fire all schema fetches in parallel
    type SchemaResult = { path: string; columns: any[]; pdata?: any; partitionSpec?: any[]; tableName?: string; needPartitions?: boolean };
    const results = await Promise.allSettled<SchemaResult>(
      toFetch.map(async (table) => {
        if (table.path.startsWith('__registered__:')) {
          const tableName = table.path.replace('__registered__:', '');
          if (!selectedConnectionId) throw new Error('No connection selected');
          const connId = String(selectedConnectionId);
          const rt = registeredTables.find(r => r.name === tableName);
          const isPartitioned = rt?.format === 'iceberg' || rt?.format === 'parquet';
          const needPartitions = isPartitioned && !partitionData[tableName];

          const schemaPromise = api.getRegisteredTableSchema(connId, tableName);
          const partitionPromise = needPartitions
            ? api.getRegisteredTablePartitions(connId, tableName).catch((pe: any) => {
                addNotification({ type: 'error', title: 'Partition Error', message: `Could not load partitions for ${tableName}: ${(pe as Error).message}` });
                return null;
              })
            : Promise.resolve(null);

          const [schema, pdata] = await Promise.all([schemaPromise, partitionPromise]);
          return {
            path: table.path,
            columns: (schema.columns || []).slice().sort((a: any, b: any) => a.name.localeCompare(b.name)),
            pdata,
            partitionSpec: schema.partition_spec,
            tableName,
            needPartitions,
          };
        } else if (table.path.startsWith('__federation__:')) {
          // Phase 97: Federation view schema from cached schema
          const fvName = table.path.replace('__federation__:', '');
          const fv = federationViews.find((f: any) => f.name === fvName);
          if (!fv) return { path: table.path, columns: [] };
          const schema = await api.getFederationViewSchema(fv.id);
          return { path: table.path, columns: (schema.columns || []).slice().sort((a: any, b: any) => a.name.localeCompare(b.name)) };
        } else if (table.path.startsWith('__materialized__:')) {
          const mvName = table.path.replace('__materialized__:', '');
          const mv = materializedViews.find(m => m.name === mvName);
          if (!mv) return { path: table.path, columns: [] };
          const schema = await api.getMaterializedViewSchema(mv.id);
          return { path: table.path, columns: (schema.columns || []).slice().sort((a: any, b: any) => a.name.localeCompare(b.name)) };
        } else if (table.path.startsWith('__local__:')) {
          const ltName = table.path.replace('__local__:', '');
          const lt = localTables.find((l: any) => l.name === ltName);
          if (!lt) return { path: table.path, columns: [] };
          const schema = await api.getLocalTableSchema(lt.id);
          return { path: table.path, columns: (schema.columns || []).slice().sort((a: any, b: any) => a.name.localeCompare(b.name)) };
        } else {
          // S3 file or local file
          const schemaPath = (table as any).key || table.path;
          const schema = selectedConnectionId
            ? await api.getConnectionFileSchema(selectedConnectionId, schemaPath)
            : await api.getFileSchema(table.path);
          return { path: table.path, columns: (schema.columns || []).slice().sort((a: any, b: any) => a.name.localeCompare(b.name)) };
        }
      })
    );

    // Process results — update schemas and partition state
    const newSchemas: Record<string, any> = {};
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { path, columns, pdata, partitionSpec, tableName, needPartitions } = result.value;
        newSchemas[path] = columns;

        if (tableName) {
          // Clear per-table loading indicators
          setLoadingRegSchema(prev => prev === tableName ? null : prev);
          if (needPartitions) {
            setLoadingPartitions(prev => { const n = new Set(prev); n.delete(tableName); return n; });
          }
          // Store partition data and kick off background full scan if needed
          if (pdata && ((partitionSpec && partitionSpec.length > 0) || (pdata.partition_columns && pdata.partition_columns.length > 0))) {
            setPartitionData(prev => ({ ...prev, [tableName]: pdata }));
            setExpandedPartitionPanels(prev => new Set(prev).add(tableName));
            if (pdata.fast_path && selectedConnectionId) {
              const _tName = tableName;
              const connId = String(selectedConnectionId);
              setRefiningPartitions(prev => new Set(prev).add(_tName));
              api.getRegisteredTablePartitions(connId, _tName, true)
                .then((fullData: any) => {
                  setPartitionData(prev => { if (prev[_tName]) return { ...prev, [_tName]: fullData }; return prev; });
                })
                .catch((e: any) => {
                  addNotification({ type: 'warning', title: 'Partition Load Warning',
                    message: `Could not load partition values for "${_tName}". Filters may not work correctly. ${String(e)}` });
                })
                .finally(() => {
                  setRefiningPartitions(prev => { const n = new Set(prev); n.delete(_tName); return n; });
                });
            }
          }
        }
      } else {
        // Fetch failed — clear loading indicator and notify
        const err = result.reason as Error;
        addNotification({ type: 'error', title: 'Schema Error', message: err.message });
        // Clear any registered-table loading state (best-effort)
        setLoadingRegSchema(null);
      }
    }

    setTableSchemas(prev => ({ ...prev, ...newSchemas }));
  };

  // Load registered tables (and S3 files fallback) for the secondary cross-connection
  const loadCrossConnFiles = async (connId) => {
    if (!connId) { setCrossConnFiles([]); setCrossConnFile(null); return; }
    setCrossConnLoading(true);
    try {
      // Try registered tables first
      const resp = await api.listRegisteredTables(String(connId));
      const regTables = Array.isArray(resp) ? resp : (resp?.tables || []);
      let tableFiles = regTables.map((t: any) => ({
        name: t.name,
        path: `__registered__:${t.name}`,
        folder: t.format || 'registered',
        format: t.format,
      }));

      // Fallback: browse S3/local files if no registered tables
      if (tableFiles.length === 0) {
        try {
          const filesResp = await api.listConnectionFiles(String(connId));
          const files = Array.isArray(filesResp) ? filesResp : (filesResp?.files || filesResp?.entries || []);
          tableFiles = files
            .filter((f: any) => f.type === 'file' || f.name?.match?.(/\.(parquet|csv|txt)$/i))
            .map((f: any) => ({
              name: f.name || f.key || f.path,
              path: f.path || f.key || f.name,
              folder: f.folder || '',
              format: f.name?.endsWith('.csv') ? 'csv' : 'parquet',
            }));
          // Also include folders as potential table sources
          const folders = files
            .filter((f: any) => f.type === 'folder' || f.type === 'prefix')
            .map((f: any) => ({
              name: f.name || f.prefix || f.path,
              path: f.path || f.prefix || f.name,
              folder: 'folder',
              format: 'parquet',
            }));
          tableFiles = [...tableFiles, ...folders];
        } catch {
          // S3 file listing failed — leave empty
        }
      }
      setCrossConnFiles(tableFiles);
      setCrossConnFile(null);
    } catch {
      setCrossConnFiles([]);
    } finally {
      setCrossConnLoading(false);
    }
  };

  // Phase 85B: Preview the cross-connection join result (LIMIT 5)
  const handleCrossJoinPreview = useCallback(async () => {
    if (!crossConnId || !crossConnFile || !selectedConnectionId) return;
    setCrossJoinPreviewLoading(true);
    setCrossJoinPreviewError('');
    setCrossJoinPreviewRows([]);
    setCrossJoinPreviewCols([]);
    setCrossJoinPreviewOpen(true);
    try {
      const primaryFile = selectedTables[0]?.path || selectedTables[0]?.name || '';
      const secName = crossConnFile.startsWith('__registered__:')
        ? crossConnFile.replace('__registered__:', '')
        : crossConnFile;
      const payload: any = {
        connection_id: selectedConnectionId,
        files: selectedTables.map(t => t.path || t.name),
        joins: [],
        filters: [],
        columns: [],
        limit: 5,
        combine_mode: crossConnMode,
        cross_connection_id: crossConnId,
        cross_file: crossConnFile,
        cross_join_how: crossJoinHow,
        cross_join_left_on: crossJoinLeftOn,
        cross_join_right_on: crossJoinRightOn,
      };
      const res = await api.executeQuery({ ...payload, output_format: 'json' });
      // Poll until done
      let execId = res?.execution_id;
      if (execId) {
        let attempts = 0;
        while (attempts < 15) {
          await new Promise(r => setTimeout(r, 800));
          const status = await api.getExecutionStatus(execId);
          if (status?.status === 'completed' || status?.result) {
            const rows = status?.result?.rows || status?.rows || [];
            const cols = status?.result?.columns || status?.columns || [];
            setCrossJoinPreviewRows(rows.slice(0, 5));
            setCrossJoinPreviewCols(cols);
            break;
          }
          if (status?.status === 'failed') {
            setCrossJoinPreviewError(status?.error || 'Preview failed');
            break;
          }
          attempts++;
        }
      }
    } catch (e: any) {
      setCrossJoinPreviewError(e.message || 'Preview failed');
    } finally {
      setCrossJoinPreviewLoading(false);
    }
  }, [crossConnId, crossConnFile, selectedConnectionId, selectedTables, crossConnMode, crossJoinHow, crossJoinLeftOn, crossJoinRightOn]);

  // Fetch secondary table schema + partitions when cross-conn file changes
  useEffect(() => {
    if (!crossConnId || !crossConnFile) {
      setCrossConnColumns([]); setCrossConnPartitionData(null);
      setCrossConnSelectedPartitions({}); return;
    }
    let cancelled = false;
    const isRegistered = crossConnFile.startsWith('__registered__:');
    const tableName = isRegistered
      ? crossConnFile.replace('__registered__:', '')
      : crossConnFile;
    const connId = String(crossConnId);
    setCrossConnSchemaLoading(true);

    // Registered tables → registered table API (schema + partitions)
    // Raw files (local/S3) → connection file schema API (no partitions)
    const schemaP = isRegistered
      ? api.getRegisteredTableSchema(connId, tableName)
      : api.getConnectionFileSchema(connId, tableName);
    const partP = isRegistered
      ? api.getRegisteredTablePartitions(connId, tableName).catch(() => null)
      : Promise.resolve(null);  // raw files have no partition metadata

    Promise.all([schemaP, partP])
      .then(([schema, partitions]) => {
        if (cancelled) return;
        const cols = (schema?.columns || []).map((c: any) => c.name || c);
        setCrossConnColumns(cols.sort());
        if (partitions?.partition_columns?.length > 0) {
          setCrossConnPartitionData(partitions);
        } else {
          setCrossConnPartitionData(null);
        }
      })
      .catch(() => { if (!cancelled) { setCrossConnColumns([]); setCrossConnPartitionData(null); } })
      .finally(() => { if (!cancelled) setCrossConnSchemaLoading(false); });
    return () => { cancelled = true; };
  }, [crossConnId, crossConnFile]);

  // Derive primary table columns for join key dropdown
  const primaryColumns = useMemo(() => {
    const firstTable = selectedTables[0]?.path;
    if (!firstTable || !tableSchemas[firstTable]) return [] as string[];
    return (tableSchemas[firstTable] as any[]).map((c: any) => c.name || c).sort();
  }, [selectedTables, tableSchemas]);

  // Smart column matching: columns that exist in BOTH primary and secondary (likely join keys)
  const suggestedJoinKeys = useMemo(() => {
    if (!primaryColumns.length || !crossConnColumns.length) return { primary: [] as string[], secondary: [] as string[] };
    const priLower = new Map(primaryColumns.map(c => [c.toLowerCase(), c]));
    const matched: { primary: string[]; secondary: string[] } = { primary: [], secondary: [] };
    for (const sc of crossConnColumns) {
      const priMatch = priLower.get(sc.toLowerCase());
      if (priMatch) { matched.primary.push(priMatch); matched.secondary.push(sc); }
    }
    return matched;
  }, [primaryColumns, crossConnColumns]);

  // Sort options: suggested (matching) columns first, then rest alphabetically
  const sortedPrimaryColumns = useMemo(() => {
    const suggested = new Set(suggestedJoinKeys.primary.map(c => c.toLowerCase()));
    return [...primaryColumns].sort((a, b) => {
      const aS = suggested.has(a.toLowerCase()) ? 0 : 1;
      const bS = suggested.has(b.toLowerCase()) ? 0 : 1;
      return aS !== bS ? aS - bS : a.localeCompare(b);
    });
  }, [primaryColumns, suggestedJoinKeys]);

  const sortedSecondaryColumns = useMemo(() => {
    const suggested = new Set(suggestedJoinKeys.secondary.map(c => c.toLowerCase()));
    return [...crossConnColumns].sort((a, b) => {
      const aS = suggested.has(a.toLowerCase()) ? 0 : 1;
      const bS = suggested.has(b.toLowerCase()) ? 0 : 1;
      return aS !== bS ? aS - bS : a.localeCompare(b);
    });
  }, [crossConnColumns, suggestedJoinKeys]);

  const loadIcebergTablesForConn = async (connId, warehousePath: string) => {
    setIcebergLoading(true);
    try {
      const result = await api.listIcebergTables(String(connId), warehousePath);
      setIcebergTables(result.tables || []);
    } catch (_err) {
      setIcebergTables([]);
    } finally {
      setIcebergLoading(false);
    }
  };

  const loadIcebergTableFiles = async (table) => {
    if (icebergTableFiles[table.prefix] !== undefined) return; // already loaded or loading
    setIcebergLoadingTable(table.prefix);
    // Mark as loading (empty array placeholder avoids double-fetch)
    setIcebergTableFiles(prev => ({ ...prev, [table.prefix]: null }));
    try {
      const result = await api.listIcebergFiles(String(selectedConnectionId), table.prefix);
      setIcebergTableFiles(prev => ({ ...prev, [table.prefix]: result.files || [] }));
    } catch (_err) {
      setIcebergTableFiles(prev => ({ ...prev, [table.prefix]: [] }));
    } finally {
      setIcebergLoadingTable(null);
    }
  };

  const handleProgress = (message: any) => {
    if (message.type === 'execution_progress') {
      setProgress({
        rows: message.data?.total_rows || 0,
        chunks: message.data?.chunks_processed || 0,
        status: message.data?.status || 'processing',
      });
      if (message.data?.status === 'completed') {
        if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
        const finalElapsed = execStartRef.current ? Math.floor((Date.now() - execStartRef.current) / 1000) : 0;
        if (streamingSource) {
          // Streaming active: just update progress, defer transition to execution_completed
          // (which also carries file_stats for the file info popover)
          setProgress({ rows: message.data.total_rows || 0, status: 'completed', elapsed: finalElapsed });
          return;
        }
        setExecuting(false);
        setProgress({ rows: message.data.total_rows || 0, status: 'completed', elapsed: finalElapsed });
        setResultsExecutionId(executionId);
        setShowResults(true);
        setIsStale(false);
        setStreamingSource(null);
      }
    } else if (message.type === 'execution_completed') {
      if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
      const finalElapsed = execStartRef.current ? Math.floor((Date.now() - execStartRef.current) / 1000) : 0;
      setExecuting(false);
      setProgress({
        rows: message.stats?.total_rows || 0,
        status: 'completed',
        elapsed: finalElapsed,
        stale_warning: message.stale_warning || null,
      });
      setResultsExecutionId(executionId);
      setShowResults(true);
      setIsStale(false);
      setFileStats(message.file_stats || null);
      // Notify user when transitioning from streaming to full server results
      if (streamingSource) {
        addNotification({ type: 'success', title: 'Full Results Ready', message: 'Background download complete — switching to server data' });
      }
      setStreamingSource(null);
    } else if (message.type === 'execution_failed') {
      if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
      setExecuting(false);
      setStreamingSource(null);  // clear streaming so error is visible
      const isTokenExpired = message.error_code === 'TOKEN_EXPIRED';
      setProgress({
        status: 'failed',
        error: message.error,
        ...(isTokenExpired ? { errorCode: 'TOKEN_EXPIRED' } : {}),
      });
      if (isTokenExpired) {
        addNotification({ type: 'error', title: 'Session Token Expired', message: message.error,
                          action: { label: 'Update Connection', href: '/connections' } });
      }
    } else if (message.type === 'execution_cancelled') {
      setStreamingSource(null);
    }
  };
  handleProgressRef.current = handleProgress;

  const generateSQLPreview = () => {
    if (selectedTables.length === 0) {
      setSqlPreview('');
      setShowPreview(false);
      return;
    }
    const OP_MAP: Record<string, string> = {
      eq: '=', ne: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=',
      in: 'IN', not_in: 'NOT IN', contains: 'LIKE', not_contains: 'NOT LIKE',
      between: 'BETWEEN', is_null: 'IS NULL', is_not_null: 'IS NOT NULL',
    };

    let sql = distinct ? 'SELECT DISTINCT\n' : 'SELECT\n';
    const selectParts: string[] = [];

    if (aggregations.length > 0) {
      const aggColSet = new Set(aggregations.map((a: any) => a.column));
      const groupCols = selectedColumns.filter(c => !aggColSet.has(c.columnName));
      groupCols.forEach(c => {
        const alias = columnAliases[c.columnName];
        selectParts.push(`  ${c.columnName}${alias ? ` AS ${alias}` : ''}`);
      });
      aggregations.forEach((a: any) => {
        const alias = a.alias || `${a.function.toLowerCase()}_${a.column}`;
        const dkw = a.distinct ? 'DISTINCT ' : '';
        selectParts.push(`  ${a.function}(${dkw}${a.column}) AS ${alias}`);
      });
    } else {
      if (selectedColumns.length > 0) {
        selectedColumns.forEach(c => {
          const alias = columnAliases[c.columnName];
          selectParts.push(`  ${c.tableName}.${c.columnName}${alias ? ` AS ${alias}` : ''}`);
        });
      } else {
        // Check if any selected table has more columns than auto-project threshold
        const _autoProjectLimit = appSettings.limits.col_auto_project || 50;
        const totalCols = selectedTables.reduce((sum, t) => {
          const sch = tableSchemas[t.path] || [];
          return sum + sch.length;
        }, 0);
        if (totalCols > _autoProjectLimit) {
          selectParts.push(`  *  -- ${totalCols} cols: first ${_autoProjectLimit} auto-selected for performance`);
        } else {
          selectParts.push('  *');
        }
      }
    }
    // Computed columns
    computedColumns.forEach((cc: any) => selectParts.push(`  (${cc.expression}) AS ${cc.alias}`));
    // CASE WHEN
    caseExpressions.forEach((ce: any) => {
      let c = 'CASE';
      (ce.when_clauses || []).forEach((w: any) => {
        const op = OP_MAP[w.when_operator] || '=';
        if (['is_null', 'is_not_null'].includes(w.when_operator)) {
          c += ` WHEN ${w.when_column} ${op} THEN '${w.then_value}'`;
        } else {
          c += ` WHEN ${w.when_column} ${op} '${w.when_value}' THEN '${w.then_value}'`;
        }
      });
      if (ce.else_value) c += ` ELSE '${ce.else_value}'`;
      c += ` END AS ${ce.alias}`;
      selectParts.push(`  ${c}`);
    });
    // Window functions
    windowFunctions.forEach((wf: any) => {
      const fn = wf.function;
      const parts: string[] = [];
      if (wf.partition_by?.length) parts.push(`PARTITION BY ${wf.partition_by.join(', ')}`);
      if (wf.order_by?.length) parts.push(`ORDER BY ${wf.order_by.map((o: any) => `${o.column} ${(o.direction || 'ASC').toUpperCase()}`).join(', ')}`);
      const over = `OVER (${parts.join(' ')})`;
      if (['ROW_NUMBER', 'RANK', 'DENSE_RANK'].includes(fn)) {
        selectParts.push(`  ${fn}() ${over} AS ${wf.alias}`);
      } else if (['LAG', 'LEAD'].includes(fn)) {
        selectParts.push(`  ${fn}(${wf.column || ''}, ${wf.offset || 1}) ${over} AS ${wf.alias}`);
      } else {
        selectParts.push(`  ${fn}(${wf.column || '*'}) ${over} AS ${wf.alias}`);
      }
    });

    sql += selectParts.join(',\n');
    // For registered tables, show quoted table name; for files, show file name
    const tblRef = (t: any) => t.path?.startsWith('__registered__:') ? `"${t.name}"` : t.name;
    if (joins.length > 0) {
      sql += `\n\nFROM ${tblRef(selectedTables[0])}`;
      joins.forEach(j => {
        const nj = _normalizeJoin(j);
        const rt = selectedTables.find(t => t.path === nj.rightTable);
        const onClauses = nj.conditions
          .filter((c: any) => c.leftColumn && c.rightColumn)
          .map((c: any) => `${c.leftColumn} = ${c.rightColumn}`)
          .join(' AND ');
        sql += `\n${nj.joinType.toUpperCase()} JOIN ${rt ? tblRef(rt) : '?'}\n  ON ${onClauses || '???'}`;
      });
    } else if (selectedTables.length > 1) {
      sql += '\n\nFROM (\n' + selectedTables.map(t => `  SELECT * FROM ${tblRef(t)}`).join('\n  UNION ALL\n') + '\n)';
    } else {
      sql += `\n\nFROM ${tblRef(selectedTables[0])}`;
    }

    // WHERE — user filters + partition filters (deduplicated across tables)
    const partFilterClauses: string[] = [];
    const _seenPartCols = new Set<string>();
    for (const table of selectedTables) {
      if (!table.path.startsWith('__registered__:')) continue;
      const tName = table.path.replace('__registered__:', '');
      const pdata = partitionData[tName];
      const selParts = selectedPartitions[tName];
      if (!pdata || !selParts) continue;
      for (const pc of (pdata.partition_columns || [])) {
        const colName = pc.source_column || pc.name;
        if (!colName || _seenPartCols.has(colName)) continue;  // skip undefined or duplicate
        _seenPartCols.add(colName);
        const vals = selParts[pc.name] || [];
        if (vals.length === 1 && vals[0] != null) {
          partFilterClauses.push(`${colName} = '${vals[0]}'`);
        } else if (vals.length > 1) {
          partFilterClauses.push(`${colName} IN (${vals.filter(v => v != null).map(v => `'${v}'`).join(', ')})`);
        }
      }
    }
    const allWhereClauses: string[] = [
      ...filters
        .filter(f => f.column)  // skip incomplete filter rows
        .map((f, i) => {
          const op = OP_MAP[f.operator] || '=';
          let valStr = '';
          if (['is_null', 'is_not_null'].includes(f.operator)) valStr = '';
          else if (f.operator === 'between') valStr = `${f.value_low || ''} AND ${f.value_high || ''}`;
          else if (['in', 'not_in'].includes(f.operator)) valStr = `(${f.value})`;
          else if (['contains', 'not_contains'].includes(f.operator)) valStr = `'%${f.value}%'`;
          else valStr = String(f.value ?? '');
          return `${f.column} ${op} ${valStr}`;
        }),
      ...partFilterClauses,
    ];
    if (allWhereClauses.length > 0) {
      sql += '\n\nWHERE\n';
      sql += allWhereClauses.map((clause, i) =>
        `  ${i > 0 ? `${filterLogic} ` : ''}${clause}`
      ).join('\n');
    }

    // GROUP BY
    if (aggregations.length > 0) {
      const aggColSet = new Set(aggregations.map((a: any) => a.column));
      const groupCols = selectedColumns.filter(c => !aggColSet.has(c.columnName)).map(c => c.columnName);
      if (groupCols.length > 0) {
        sql += '\n\nGROUP BY\n';
        sql += groupCols.map(c => `  ${c}`).join(',\n');
      }
    }

    // HAVING
    if (having.length > 0) {
      sql += '\n\nHAVING\n';
      sql += having.map((h: any, i: number) => {
        const op = OP_MAP[h.operator] || '=';
        const fn = h.function ? `${h.function}(${h.column})` : h.column;
        return `  ${i > 0 ? 'AND ' : ''}${fn} ${op} ${h.value}`;
      }).join('\n');
    }

    if (orderBy.length > 0) {
      sql += '\n\nORDER BY\n';
      sql += orderBy.map(o => `  ${o.column} ${o.direction.toUpperCase()}`).join(',\n');
    }
    if (limit !== null && limit > 0) {
      sql += `\n\nLIMIT ${limit}`;
    }
    sql += ';';

    // Cross-connection annotation
    if (showCrossConn && crossConnId && crossConnFile) {
      const secName = crossConnFile.startsWith('__registered__:')
        ? crossConnFile.replace('__registered__:', '')
        : crossConnFile;
      sql += '\n\n-- ══ Cross-Source ' + crossConnMode.toUpperCase() + ' ══';
      sql += `\n-- Secondary: ${secName} (connection #${crossConnId})`;
      if (crossConnMode === 'join') {
        const lk = crossJoinLeftOn.length ? crossJoinLeftOn.join(', ') : '?';
        const rk = crossJoinRightOn.length ? crossJoinRightOn.join(', ') : '?';
        sql += `\n-- ${crossJoinHow.toUpperCase()} JOIN ON primary(${lk}) = secondary(${rk})`;
      }
      const secPartCount = Object.values(crossConnSelectedPartitions).filter(v => v.length > 0).length;
      if (secPartCount > 0) {
        sql += `\n-- Secondary filters: ${secPartCount} partition column(s) selected`;
      }
    }

    setSqlPreview(sql);
  };

  // ── Excel worksheet tree helpers ──────────────────────────────────────────
  const isExcelFile = (file: any) => /\.(xlsx|xls)$/i.test(file.path || file.name || '');

  const loadExcelSheets = async (file: any) => {
    const key = file.path || file.key;
    if (excelFileSheets[key]) return; // already loaded
    setExcelLoadingFile(key);
    try {
      const data = selectedConnectionId
        ? await api.listConnectionExcelSheets(String(selectedConnectionId), key)
        : await api.listExcelSheetsByPath(key);
      const sheets: string[] = data?.sheets || data || [];
      setExcelFileSheets(prev => ({ ...prev, [key]: sheets }));
    } catch {
      // If sheet listing fails, show empty (user can still select file directly)
      setExcelFileSheets(prev => ({ ...prev, [key]: [] }));
    } finally {
      setExcelLoadingFile(null);
    }
  };

  const toggleAllSheets = (file: any, sheets: string[]) => {
    const key = file.path || file.key;
    const sheetPaths = sheets.map(s => `${key}::${s}`);
    const allSelected = sheetPaths.every(sp => selectedTables.some(t => t.path === sp));
    if (allSelected) {
      // Deselect all sheets from this file
      setSelectedTables(prev => prev.filter(t => !sheetPaths.includes(t.path)));
      // Remove joins referencing these sheet paths
      setJoins(prev => prev.filter(j => {
        const nj = _normalizeJoin(j);
        return !sheetPaths.includes(nj.leftTable) && !sheetPaths.includes(nj.rightTable);
      }));
    } else {
      // Select all unselected sheets
      const existing = new Set(selectedTables.map(t => t.path));
      const parentBase = (file.name || '').replace(/\.(xlsx|xls)$/i, '');
      const toAdd = sheetPaths
        .filter(sp => !existing.has(sp))
        .map(sp => ({
          ...file,
          path: sp,
          name: `${parentBase} :: ${sp.split('::').pop() || sp}`,
        }));
      setSelectedTables(prev => [...prev, ...toAdd]);
    }
  };

  const toggleTable = (file) => {
    const exists = selectedTables.find(t => t.path === file.path);
    if (exists) {
      const newTables = selectedTables.filter(t => t.path !== file.path);
      setSelectedTables(newTables);
      // Remove any joins that reference the deselected table so the SQL preview resets cleanly
      setJoins(prev => prev.filter(j => {
        const nj = _normalizeJoin(j);
        return nj.leftTable !== file.path && nj.rightTable !== file.path;
      }));
      // Clean up partition state for deselected registered tables
      if (file.path.startsWith('__registered__:')) {
        const tName = file.path.replace('__registered__:', '');
        // Clear user's filter selections but keep partition data cached (avoids re-fetch on reselect)
        setSelectedPartitions(prev => { const n = { ...prev }; delete n[tName]; return n; });
        setRefiningPartitions(prev => { const n = new Set(prev); n.delete(tName); return n; });
        setRefreshingPartitions(prev => { const n = new Set(prev); n.delete(tName); return n; });
      }
      // Clear stale results when all tables are removed — avoids needing a page refresh
      if (newTables.length === 0) {
        setResultsExecutionId(null);
        setStreamingSource(null);
        setShowResults(false);
        setIsStale(false);
      }
    } else {
      // Intercept Excel files — tree view uses expand/collapse, flat view uses modal
      const ext = (file.path || '').split('.').pop()?.toLowerCase();
      if (ext === 'xlsx' || ext === 'xls') {
        if (sidebarView === 'tree') {
          // Tree view: expand/collapse the Excel file to show sheets as children
          const key = file.path || file.key;
          setExpandedExcelFiles(prev => ({ ...prev, [key]: !prev[key] }));
          if (!excelFileSheets[key]) loadExcelSheets(file);
          return;
        }
        // Flat view: show sheet picker modal
        setSheetPickerFile(file);
        setSheetPickerSheets([]);
        setSheetPickerSelected('');
        setSheetPickerLoading(true);
        const sheetPromise = selectedConnectionId
          ? api.listConnectionExcelSheets(String(selectedConnectionId), file.path).then(d => d?.sheets || d || [])
          : api.listExcelSheetsByPath(file.path);
        sheetPromise.then(sheets => {
          setSheetPickerSheets(sheets);
          if (sheets.length === 0) {
            // No sheets found — show error
            addNotification({ type: 'warning', title: 'Excel File', message: `No worksheets found in ${file.name || 'file'}` });
            setSheetPickerFile(null);
          } else if (sheets.length === 1) {
            // Single sheet — add with ::SheetName convention
            const parentBase = (file.name || '').replace(/\.(xlsx|xls)$/i, '');
            const sheetFile = {
              ...file,
              path: `${file.path}::${sheets[0]}`,
              name: `${parentBase} :: ${sheets[0]}`,
            };
            setSelectedTables(prev => [...prev, sheetFile]);
            setSheetPickerFile(null);
          } else {
            setSheetPickerSelected(sheets[0]);
          }
        }).catch(() => {
          addNotification({ type: 'error', title: 'Excel File', message: `Could not read worksheets from ${file.name || 'file'}` });
          setSheetPickerFile(null);
        }).finally(() => setSheetPickerLoading(false));
        return;
      }
      setSelectedTables([...selectedTables, file]);
    }
  };

  const confirmSheetSelection = () => {
    if (!sheetPickerFile) return;
    const parentBase = (sheetPickerFile.name || '').replace(/\.(xlsx|xls)$/i, '');
    const sheetFile = {
      ...sheetPickerFile,
      path: `${sheetPickerFile.path}::${sheetPickerSelected}`,
      name: `${parentBase} :: ${sheetPickerSelected}`,
    };
    setSelectedTables(prev => [...prev, sheetFile]);
    setSheetPickerFile(null);
    setSheetPickerSheets([]);
    setSheetPickerSelected('');
  };

  const buildQueryConfigObject = () => {
    if (selectedTables.length === 0) return { files: [], joins: [], columns: [], filters: [] };
    const queryFiles = joins.length > 0
      ? [selectedTables[0].path]
      : selectedTables.map(t => t.path);

    // ── Table alias mapping for JOIN queries ─────────────────────────────
    // Backend aliases: primary table = t0, join[0].right = t1, join[1].right = t2, …
    // Without this, all columns default to t0.col which breaks when columns
    // belong to a joined table (e.g. t1."gbp_currency_amount").
    const _stripPrefix = (p: string) =>
      p.replace('__registered__:', '').replace('__materialized__:', '').replace('__local__:', '').replace('__federation__:', '');
    const hasJoins = joins.length > 0;
    const tableAliasMap: Record<string, string> = {};
    if (hasJoins) {
      const primaryName = selectedTables[0]?.name || _stripPrefix(selectedTables[0]?.path || '');
      if (primaryName) tableAliasMap[primaryName] = 't0';
      joins.forEach((j: any, idx: number) => {
        const nj = _normalizeJoin(j);
        const rtName = _stripPrefix(nj.rightTable || '');
        if (rtName) tableAliasMap[rtName] = `t${idx + 1}`;
      });
    }
    // Look up which table owns a bare column name (first match wins — primary table preferred)
    const _findColTable = (colName: string): string => {
      for (const table of selectedTables) {
        const schema = tableSchemas[table.path] || [];
        if ((schema as any[]).some((c: any) => c.name === colName)) {
          return table.name || _stripPrefix(table.path || '');
        }
      }
      return '';
    };
    // Qualify a column with its TABLE NAME (not alias) for JOIN queries.
    // Backend translates tableName.col → tN.col before SQL generation.
    // Using table names ensures snapshot/saved-query restore works correctly
    // (t0/t1 aliases are ephemeral; table names are stable identifiers).
    const _qcol = (colName: string, tableName?: string): string => {
      if (!hasJoins) return colName;
      if (tableName) {
        return tableAliasMap[tableName] ? `${tableName}.${colName}` : colName;
      }
      const ownerTable = _findColTable(colName);
      return ownerTable ? `${ownerTable}.${colName}` : colName;
    };

    // After snapshot/saved-query restore, aggregation columns may be qualified
    // ("fact_table_ext.code") while selectedColumns store bare names ("code").
    // Normalize to bare names for the exclusion check.
    const aggColNames = new Set(aggregations.map((a: any) => {
      const parts = a.column.split('.');
      return parts.length === 2 ? parts[1] : a.column;
    }));
    const groupByCols = selectedColumns
      .filter(c => !aggColNames.has(c.columnName))
      .map(c => _qcol(c.columnName, c.tableName));
    const qc: any = {
      files: queryFiles,
      joins: joins.map((j: any) => {
        const nj = _normalizeJoin(j);
        return {
          left_file: nj.leftTable, right_file: nj.rightTable,
          left_on: nj.conditions.map((c: any) => c.leftColumn).filter(Boolean),
          right_on: nj.conditions.map((c: any) => c.rightColumn).filter(Boolean),
          how: nj.joinType,
          right_suffix: nj.rightSuffix || undefined,
          right_column_aliases: Object.keys(nj.rightColumnAliases || {}).length > 0 ? nj.rightColumnAliases : undefined,
        };
      }).filter((j: any) => j.left_on.length > 0 && j.right_on.length > 0),
      columns: selectedColumns.map(c => _qcol(c.columnName, c.tableName)),
      filters: [
        // User-defined filters
        ...filters.map(f => {
          const base: any = { column: _qcol(f.column), operator: f.operator };
          if (f.operator === 'between') base.value = [f.value_low, f.value_high];
          else if (['is_null', 'is_not_null'].includes(f.operator)) base.value = null;
          else if (['in', 'not_in'].includes(f.operator)) base.value = String(f.value).split(',').map((v: string) => v.trim());
          else base.value = f.value;
          return base;
        }),
        // Auto-injected partition filters from partition selector (deduplicated across tables)
        // Tagged with _partition:true so tab restore skips them (they'll re-derive from selectedPartitions)
        ...(() => {
          const partFilters: any[] = [];
          const seenPartCols = new Set<string>();
          for (const table of selectedTables) {
            if (!table.path.startsWith('__registered__:')) continue;
            const tName = table.path.replace('__registered__:', '');
            const pdata = partitionData[tName];
            const selParts = selectedPartitions[tName];
            if (!pdata || !selParts) continue;
            for (const pc of (pdata.partition_columns || [])) {
              const colName = pc.source_column || pc.name;
              // Qualify with table name (not alias) — backend translates later
              const qualCol = hasJoins ? `${tName}.${colName}` : colName;
              if (!colName || seenPartCols.has(qualCol)) continue;  // skip undefined or per-table duplicate
              seenPartCols.add(qualCol);
              const vals = (selParts[pc.name] || []).filter(v => v != null);
              if (vals.length === 1) {
                partFilters.push({ column: qualCol, operator: 'eq', value: vals[0], _partition: true });
              } else if (vals.length > 1) {
                partFilters.push({ column: qualCol, operator: 'in', value: vals, _partition: true });
              }
            }
          }
          return partFilters;
        })(),
      ],
      order_by: orderBy.map(o => ({ column: _qcol(o.column), direction: o.direction })),
      limit,
    };
    if (distinct) qc.distinct = true;
    if (filterLogic !== 'AND') qc.filter_logic = filterLogic;
    if (Object.keys(columnAliases).length > 0) qc.column_aliases = columnAliases;
    if (aggregations.length > 0) {
      qc.group_by = groupByCols;
      qc.aggregations = aggregations.map((a: any) => ({
        column: _qcol(a.column), function: a.function,
        alias: a.alias || `${a.function.toLowerCase()}_${a.column}`,
        ...(a.distinct ? { distinct: true } : {}),
      }));
    }
    if (having.length > 0) {
      qc.having = having.map((h: any) => ({ ...h, column: _qcol(h.column) }));
    }
    if (computedColumns.length > 0) qc.computed_columns = computedColumns;
    if (caseExpressions.length > 0) qc.case_expressions = caseExpressions;
    if (windowFunctions.length > 0) qc.window_functions = windowFunctions;
    if (selectedConnectionId) qc.connection_id = selectedConnectionId;
    return qc;
  };

  // ── Tab snapshot: serialize state for tab persistence ─────────────────
  const buildSnapshot = useCallback(() => ({
    connectionId: selectedConnectionId,
    queryConfig: selectedTables.length > 0 ? buildQueryConfigObject() : null,
    queryMode,
    rawSql,
    enableStreaming,
    streamBgDownload,
    editingQueryId,
    editingQueryName,
    resultsExecutionId,
    streamingSource,
    // BF-45: persist cross-connection state across tab switches
    crossConn: showCrossConn ? {
      crossConnId,
      crossConnFile,
      crossConnMode,
      crossJoinHow,
      crossJoinLeftOn,
      crossJoinRightOn,
      crossConnSelectedPartitions,
      crossConnPartitionData,  // BF-51: persist partition metadata for cascading
    } : undefined,
  }), [selectedConnectionId, selectedTables, queryMode, rawSql, enableStreaming,
       streamBgDownload, editingQueryId, editingQueryName, resultsExecutionId, streamingSource,
       joins, selectedColumns, filters, orderBy, limit, aggregations, distinct, filterLogic,
       having, computedColumns, caseExpressions, columnAliases, windowFunctions,
       selectedPartitions, partitionData,
       showCrossConn, crossConnId, crossConnFile, crossConnMode, crossJoinHow,
       crossJoinLeftOn, crossJoinRightOn, crossConnSelectedPartitions, crossConnPartitionData]);

  // Export snapshot on every state change — keeps sessionStorage up to date
  // (tabs stay mounted so unmount-only export wouldn't work for persistence)
  useEffect(() => {
    if (!tabId || !onSnapshotChange) return;
    onSnapshotChange(buildSnapshot());
  }, [tabId, buildSnapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dirty tracking — notify tab manager when query state changes
  useEffect(() => {
    if (!tabId || !onDirtyChange) return;
    const hasTables = selectedTables.length > 0;
    const hasSql = rawSql.trim().length > 0;
    onDirtyChange(hasTables || hasSql);
  }, [selectedTables, rawSql, filters, joins, selectedColumns, aggregations, orderBy]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchToSqlMode = async () => {
    setQueryMode('sql');
    if (selectedTables.length === 0) {
      setRawSql('-- Select a table from the sidebar first');
      return;
    }
    setSqlLoading(true);
    try {
      const response = await api.previewSql({
        query_config: buildQueryConfigObject(),
        ...(selectedConnectionId ? { connection_id: selectedConnectionId } : {}),
      });
      setRawSql(response.sql);
    } catch {
      setRawSql(sqlPreview || '-- Could not generate SQL');
    } finally {
      setSqlLoading(false);
    }
  };

  // ── Cost estimate — debounced auto-trigger ───────────────────────────────
  useEffect(() => {
    if (queryMode === 'sql' || selectedTables.length === 0) {
      setCostEstimate(null);
      return;
    }
    if (estimateTimerRef.current) clearTimeout(estimateTimerRef.current);
    estimateTimerRef.current = setTimeout(async () => {
      setEstimating(true);
      try {
        const cfg = buildQueryConfigObject();
        const est = await api.estimateQuery(cfg, selectedConnectionId || undefined);
        if (est) setCostEstimate(est);
      } catch { /* ignore */ }
      finally { setEstimating(false); }
    }, 800);
    return () => { if (estimateTimerRef.current) clearTimeout(estimateTimerRef.current); };
  }, [selectedTables, filters, selectedPartitions, selectedConnectionId, queryMode]);

  // ── Phase 96: Query guardrails — compute warnings ─────────────────────────
  const guardrailWarnings = useMemo(() => {
    const qg = appSettings.query_guardrails;
    if (!qg?.enabled || queryMode === 'sql') return { warnings: [] as string[], blocked: false, blockedReason: '' };
    const warnings: string[] = [];
    let blocked = false;
    let blockedReason = '';

    // File count from selected tables
    const fileCount = selectedTables.length;

    // Hard block: too many files
    if (qg.max_files_block && fileCount > qg.max_files_block) {
      blocked = true;
      blockedReason = `Too many files selected (${fileCount} > ${qg.max_files_block} max)`;
    }
    // Soft warn: many files
    else if (qg.max_files_warn && fileCount > qg.max_files_warn) {
      warnings.push(`${fileCount} files selected (warning threshold: ${qg.max_files_warn})`);
    }

    // Partition filter check
    const hasPartitionFilter = selectedTables.some(t => {
      if (!t.path?.startsWith('__registered__:')) return false;
      const tName = t.path.replace('__registered__:', '');
      const selParts = selectedPartitions[tName];
      return selParts && Object.values(selParts).some((vals: any) => vals?.length > 0);
    });
    const hasPartitionedTable = selectedTables.some(t => {
      if (!t.path?.startsWith('__registered__:')) return false;
      const tName = t.path.replace('__registered__:', '');
      const pdata = partitionData[tName];
      return pdata?.partition_columns?.length > 0;
    });

    if (hasPartitionedTable && !hasPartitionFilter) {
      if (qg.require_partition_filter) {
        blocked = true;
        blockedReason = 'Partition filter required — select at least one partition value';
      } else if (qg.warn_no_partition) {
        warnings.push('No partition filter — query may scan all data');
      }
    }

    // No LIMIT warning
    if (qg.warn_no_limit && fileCount > 0 && (limit === null || limit === 0 || limit === undefined)) {
      warnings.push(`No LIMIT set — consider adding LIMIT ${qg.default_limit_suggestion?.toLocaleString()}`);
    }

    // Row estimate from costEstimate
    if (costEstimate?.estimated_rows) {
      const estRows = costEstimate.estimated_rows;
      if (qg.max_rows_block && estRows > qg.max_rows_block) {
        blocked = true;
        blockedReason = `Estimated ${estRows.toLocaleString()} rows exceeds max ${qg.max_rows_block.toLocaleString()}`;
      } else if (qg.max_rows_warn && estRows > qg.max_rows_warn) {
        warnings.push(`Estimated ${estRows.toLocaleString()} rows (warning: ${qg.max_rows_warn.toLocaleString()})`);
      }
    }

    return { warnings, blocked, blockedReason };
  }, [appSettings.query_guardrails, selectedTables, selectedPartitions, partitionData, limit, costEstimate, queryMode]);

  const executeQuery = async () => {
    if (queryMode === 'sql') {
      if (!rawSql.trim()) {
        addNotification({ type: 'warning', title: 'Empty SQL', message: 'Enter a SQL query to execute' });
        return;
      }
    } else if (selectedTables.length === 0) {
      addNotification({ type: 'warning', title: 'No Tables', message: 'Select at least one table' });
      return;
    }
    // Phase 96: Guardrail hard block
    if (guardrailWarnings.blocked) {
      addNotification({ type: 'error', title: 'Query Blocked', message: guardrailWarnings.blockedReason });
      return;
    }
    // Phase 96: Guardrail soft warnings — confirm
    if (guardrailWarnings.warnings.length > 0) {
      const confirmed = window.confirm(
        `⚠️ Query Guardrail Warnings:\n\n${guardrailWarnings.warnings.map(w => `• ${w}`).join('\n')}\n\nContinue anyway?`
      );
      if (!confirmed) return;
    }
    const hasLargeTable = selectedTables.some(t => t.num_rows > 1000000);
    if (queryMode !== 'sql' && hasLargeTable && joins.length > 0 && (limit === null || limit > 10000)) {
      const totalRows = selectedTables.reduce((acc, t) => acc * (t.num_rows || 1), 1);
      const confirmed = window.confirm(
        `⚠️ WARNING: Large Join Detected!\n\nTables: ${selectedTables.map(t => `${t.name} (${t.num_rows?.toLocaleString()} rows)`).join(' × ')}\nPotential result: ${totalRows.toLocaleString()} rows\n\nThis could take a long time!\n\nRecommendation: set LIMIT ≤ 1000 and add WHERE filters.\n\nContinue anyway?`
      );
      if (!confirmed) return;
    }

    const queryConfig = queryMode !== 'sql' ? buildQueryConfigObject() : null;
    // Validate cross-connection config if enabled
    if (showCrossConn && crossConnId) {
      if (!crossConnFile) {
        addNotification({ type: 'warning', title: 'No Secondary File', message: 'Select a file from the secondary connection' });
        return;
      }
      if (crossConnMode === 'join' && (crossJoinLeftOn.length === 0 || crossJoinRightOn.length === 0)) {
        addNotification({ type: 'warning', title: 'Join Config Incomplete', message: 'Specify both join key columns for cross-connection JOIN' });
        return;
      }
      if (crossConnMode === 'join' && crossJoinLeftOn.length !== crossJoinRightOn.length) {
        addNotification({ type: 'warning', title: 'Join Key Mismatch', message: 'Primary and secondary must have the same number of join key columns' });
        return;
      }
    }

    // Helper: start streaming directly — no column selector, no schema discovery.
    // Backend auto-strips empty columns from results.
    const setupStreaming = (source: any) => {
      setStreamingSource(source);
      setShowResults(true);
      setIsStale(false);
    };

    // Determine if this is stream-only mode (no background download)
    const isS3Conn = !!selectedConnectionId && connections.find((c: any) => c.id === selectedConnectionId)?.connection_type === 's3';
    const isCrossConn = showCrossConn && !!crossConnId && (!!crossConnFile || (queryMode === 'sql' && !!secondaryRawSql?.trim()));
    const streamOnly = enableStreaming && !streamBgDownload && isS3Conn && !isCrossConn;

    // ── Partition filter required for S3 queries ──
    // Without partition filters, S3 queries scan thousands of files and time out.
    // Require at least one partition filter when the table has partitions defined.
    if (isS3Conn && !isCrossConn && queryMode !== 'sql') {
      const needsPartition = selectedTables.some((t: any) => {
        const tName = t.path?.startsWith('__registered__:') ? t.path.replace('__registered__:', '') : null;
        if (!tName) return false;
        const pdata = partitionData[tName];
        if (!pdata?.partition_columns?.length) return false;  // no partition columns → OK
        const selParts = selectedPartitions[tName] || {};
        // Check if at least one partition column has a selected value
        return !Object.values(selParts).some((vals: any) => vals && vals.length > 0);
      });
      if (needsPartition) {
        addNotification({
          type: 'warning',
          title: 'Partition Filter Required',
          message: 'Please select at least one partition filter before running the query. Queries without partition filters scan all S3 files and may time out.',
        });
        return;
      }
    }

    try {
      setExecuting(true);
      setShowResults(false);
      setProgress({ rows: 0, status: 'starting' });
      setFileStats(null);
      setElapsed(0);
      execStartRef.current = Date.now();
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - (execStartRef.current ?? Date.now())) / 1000));
      }, 1000);

      if (streamOnly) {
        // ── Stream-only: no background S3→local download ──
        if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
        const source: any = { connectionId: selectedConnectionId };
        if (queryMode === 'sql') source.rawSql = rawSql;
        else source.queryConfig = queryConfig;
        setupStreaming(source);
        setExecuting(false);
        setProgress(null);
        addNotification({ type: 'info', title: 'Stream Only', message: 'Streaming directly from S3 — no background download' });
        return;
      }

      // ── Normal path: background download (+ optional streaming preview) ──
      const payload: any = selectedConnectionId ? { connection_id: selectedConnectionId } : {};
      if (queryMode === 'sql') {
        payload.raw_sql = rawSql;
        // Phase 86: Include test param values for {{param}} substitution
        if (detectedParams.length > 0 && Object.keys(paramTestValues).length > 0) {
          const paramPayload: Record<string, string> = {};
          detectedParams.forEach(p => {
            const val = paramTestValues[p.name];
            if (val !== undefined && val !== '') {
              paramPayload[p.name] = val;
            } else if (p.default !== null && p.default !== undefined) {
              paramPayload[p.name] = String(p.default);
            }
          });
          if (Object.keys(paramPayload).length > 0) payload.params = paramPayload;
        }
        // Cross-connection in SQL mode: send secondary raw SQL
        if (showCrossConn && crossConnId && secondaryRawSql.trim()) {
          payload.secondary_connection_id = crossConnId;
          payload.secondary_raw_sql = secondaryRawSql;
          payload.combine_mode = crossConnMode;
          if (crossConnMode === 'join') {
            payload.join_config = {
              how: crossJoinHow,
              left_on: crossJoinLeftOn,
              right_on: crossJoinRightOn,
              suffixes: ['_primary', '_secondary'],
            };
          }
        }
      } else {
        payload.query_config = queryConfig;
        // Attach cross-connection params
        if (showCrossConn && crossConnId && crossConnFile) {
          payload.secondary_connection_id = crossConnId;

          // Build secondary filters from partition selections
          // BF-43: resolve source_column from partition metadata — pc.name is
          // the partition field key, but the actual data column may differ
          // (e.g. partition "dt" → source_column "trade_date").
          const secPartFilters: any[] = [];
          const _secPartCols = crossConnPartitionData?.partition_columns || [];
          for (const [partKey, vals] of Object.entries(crossConnSelectedPartitions)) {
            if (vals && vals.length > 0) {
              const pc = _secPartCols.find((p: any) => p.name === partKey);
              const colName = pc?.source_column || partKey;
              if (vals.length === 1) {
                secPartFilters.push({ column: colName, operator: 'eq', value: vals[0] });
              } else {
                secPartFilters.push({ column: colName, operator: 'in', value: vals });
              }
            }
          }

          // For union mode, propagate primary filters to secondary (same schema)
          // so partition pruning + data filtering works on both sides.
          // For join mode, secondary has its own partition filters (different schema).
          let secFilters: any[] | undefined;
          if (secPartFilters.length > 0) {
            // User explicitly selected secondary partitions — use those
            secFilters = secPartFilters;
          } else if (crossConnMode === 'union' && queryConfig?.filters?.length) {
            // No secondary-specific filters in union mode → inherit primary's
            secFilters = queryConfig.filters;
          }

          payload.secondary_query_config  = {
            files: [crossConnFile],
            limit,
            ...(secFilters?.length ? { filters: secFilters } : {}),
          };
          payload.combine_mode            = crossConnMode;
          if (crossConnMode === 'join') {
            payload.join_config = {
              how:      crossJoinHow,
              left_on:  crossJoinLeftOn,
              right_on: crossJoinRightOn,
              suffixes: ['_primary', '_secondary'],
            };
          }
        }
      }
      payload.cache_strategy = cacheStrategy;

      // When streaming+download: start streaming immediately AND fire background download
      const deferDownload = enableStreaming && streamBgDownload && isS3Conn && !isCrossConn;
      if (deferDownload) {
        const source: any = { connectionId: selectedConnectionId };
        if (queryMode === 'sql') source.rawSql = rawSql;
        else source.queryConfig = queryConfig;
        setupStreaming(source);
        const connId = selectedConnectionId || null;
        api.getQueryEta(connId).then(d => setEtaSeconds(d.p75_seconds ?? null));
        const fbResponse = await api.executeQuery(payload);
        setExecutionId(fbResponse.execution_id);
        addNotification({ type: 'info', title: 'Query Started', message: `ID: ${fbResponse.execution_id?.substring(0, 8)}` });
        return;
      }

      // Fetch ETA from historical data for this connection
      const connId = selectedConnectionId || null;
      api.getQueryEta(connId).then(d => setEtaSeconds(d.p75_seconds ?? null));

      const response = await api.executeQuery(payload);
      setExecutionId(response.execution_id);
      if (response.cache_hit) {
        addNotification({ type: 'success', title: 'Cache Hit', message: 'Results served from cache instantly' });
      } else {
        const modeLabel = response.is_cross_connection
          ? ` (${(response.combine_mode || 'union').toUpperCase()})`
          : '';
        addNotification({ type: 'info', title: `Query Started${modeLabel}`, message: `ID: ${response.execution_id?.substring(0, 8)}` });
      }
    } catch (_err) {
      const error = _err as Error;
      setExecuting(false);
      setProgress(null);
      addNotification({ type: 'error', title: 'Failed', message: error.message });
    }
  };

  executeQueryRef.current = executeQuery;

  // ── Streaming column selector handlers ──────────────────────────────────
  const handleStreamColumnsConfirmed = async () => {
    if (!pendingStreamSource) return;
    setStreamColSelectorOpen(false);
    // Build column type map from stream schema (DuckDB types → e.g. "BIGINT", "VARCHAR")
    const colTypeMap: Record<string, string> = {};
    if (streamSchema?.columns) {
      for (const col of streamSchema.columns) {
        colTypeMap[col.name] = col.type;
      }
    }
    setStreamingSource({
      ...pendingStreamSource,
      columns: streamSelectedCols,
      columnTypes: Object.keys(colTypeMap).length > 0 ? colTypeMap : undefined,
    });
    setShowResults(true);
    setIsStale(false);
    setPendingStreamSource(null);
    setStreamSchema(null);

    // Fire deferred download with only the selected (non-empty) columns
    if (deferredExecutePayload) {
      const payload = { ...deferredExecutePayload };
      if (streamSelectedCols.length > 0) {
        if (payload.query_config) {
          // Query builder mode: inject selected columns
          payload.query_config = { ...payload.query_config, columns: streamSelectedCols };
        } else if (payload.raw_sql) {
          // Raw SQL mode: wrap to select only chosen columns
          const colList = streamSelectedCols.map(c => `"${c.replace(/"/g, '""')}"`).join(', ');
          payload.raw_sql = `SELECT ${colList} FROM (${payload.raw_sql}) _filtered`;
        }
      }
      setDeferredExecutePayload(null);
      try {
        const connId = payload.connection_id || null;
        api.getQueryEta(connId).then(d => setEtaSeconds(d.p75_seconds ?? null));

        const response = await api.executeQuery(payload);
        setExecutionId(response.execution_id);
        if (response.cache_hit) {
          addNotification({ type: 'success', title: 'Cache Hit', message: 'Results served from cache instantly' });
        } else {
          addNotification({ type: 'info', title: 'Download Started', message: `Downloading ${streamSelectedCols.length} columns · ID: ${response.execution_id?.substring(0, 8)}` });
        }
      } catch (err: any) {
        addNotification({ type: 'error', title: 'Download Failed', message: err.message });
        setExecuting(false);
        setProgress(null);
      }
    }
  };
  const handleStreamColSelectorCancel = async () => {
    // Skip streaming — user will wait for background query to complete
    setStreamColSelectorOpen(false);
    setPendingStreamSource(null);
    setStreamSchema(null);

    // If download was deferred, fire it now with all columns (user skipped column selection)
    if (deferredExecutePayload) {
      const payload = { ...deferredExecutePayload };
      setDeferredExecutePayload(null);
      try {
        const connId = payload.connection_id || null;
        api.getQueryEta(connId).then(d => setEtaSeconds(d.p75_seconds ?? null));
        const response = await api.executeQuery(payload);
        setExecutionId(response.execution_id);
        addNotification({ type: 'info', title: 'Query Started', message: `ID: ${response.execution_id?.substring(0, 8)}` });
      } catch (err: any) {
        addNotification({ type: 'error', title: 'Failed', message: err.message });
        setExecuting(false);
        setProgress(null);
      }
    }
  };

  // Cleanup elapsed timer on unmount
  useEffect(() => () => {
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
  }, []);

  const cancelQuery = async () => {
    if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
    if (executionId) {
      try { await api.cancelExecution(executionId); } catch {}
    }
    setExecuting(false);
    setProgress(null);
    setStreamingSource(null);
    setDeferredExecutePayload(null);
    setStreamColSelectorOpen(false);
    setPendingStreamSource(null);
    addNotification({ type: 'info', title: 'Cancelled', message: 'Execution cancelled' });
  };

  const selectedConn = connections.find(c => c.id === selectedConnectionId);

  // ── Sidebar file tree (grouped by folder) ─────────────────────────────────
  const filteredFiles = useMemo(() => {
    const q = sidebarSearch.toLowerCase();
    return q ? allFiles.filter(f => f.name?.toLowerCase().includes(q) || f.path?.toLowerCase().includes(q)) : allFiles;
  }, [allFiles, sidebarSearch]);

  // Flat list: only actual files (no folder entries), sorted by display name
  const flatFileList = useMemo(() => {
    return filteredFiles
      .filter(f => f.type !== 'folder')
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [filteredFiles]);

  // ── Unified table list (registered + materialized + local + iceberg) ──────
  const allTables = useMemo(() => {
    const items: any[] = [];
    // Registered tables
    (registeredTables || []).forEach(rt => items.push({
      ...rt, _type: 'registered', _path: `__registered__:${rt.name}`,
      _badge: 'REG', _badgeColor: '#1e40af', _badgeBg: '#dbeafe',
    }));
    // Materialized views
    (materializedViews || []).forEach(mv => items.push({
      ...mv, _type: 'materialized', _path: `__materialized__:${mv.name}`,
      _badge: 'MV', _badgeColor: '#7c3aed', _badgeBg: '#ede9fe',
    }));
    // Local tables
    (localTables || []).forEach(lt => items.push({
      ...lt, _type: 'local', _path: `__local__:${lt.name}`,
      _badge: 'LOCAL', _badgeColor: '#d97706', _badgeBg: '#fef3c7',
    }));
    // Phase 97: Materialized federation views
    (federationViews || []).forEach(fv => items.push({
      ...fv, _type: 'federation', _path: `__federation__:${fv.name}`,
      _badge: 'FED', _badgeColor: '#047857', _badgeBg: '#d1fae5',
    }));
    return items;
  }, [registeredTables, materializedViews, localTables, federationViews]);

  const filteredTables = useMemo(() => {
    let items = allTables;
    if (tableTypeFilter !== 'all') {
      items = items.filter(t => t._type === tableTypeFilter);
    }
    if (sidebarSearch) {
      const q = sidebarSearch.toLowerCase();
      items = items.filter(t => t.name?.toLowerCase().includes(q));
    }
    // Sort favorites first
    if (tableFavorites.size > 0) {
      items = [...items].sort((a, b) => {
        const aFav = tableFavorites.has(a._path) ? 0 : 1;
        const bFav = tableFavorites.has(b._path) ? 0 : 1;
        return aFav - bFav;
      });
    }
    return items;
  }, [allTables, tableTypeFilter, sidebarSearch, tableFavorites]);

  const fileTree = useMemo(() => {
    const rootFiles: any[] = [];
    const rootFolders: any[] = [];
    const childFiles: Record<string, any[]> = {};   // parent folder key → files
    const childFolders: Record<string, any[]> = {};  // parent folder key → sub-folders
    const folderKeys = new Set<string>();

    // First pass: collect explicit folder items from backend
    filteredFiles.forEach(f => {
      if (f.type === 'folder') folderKeys.add(f.key);
    });

    filteredFiles.forEach(f => {
      const parentKey = f.folder || '';
      if (f.type === 'folder') {
        if (!parentKey) { rootFolders.push(f); }
        else {
          if (!childFolders[parentKey]) childFolders[parentKey] = [];
          childFolders[parentKey].push(f);
        }
      } else if (!parentKey) {
        rootFiles.push(f);
      } else if (folderKeys.has(parentKey)) {
        // S3 files — parentKey matches a real folder item's key
        if (!childFiles[parentKey]) childFiles[parentKey] = [];
        childFiles[parentKey].push(f);
      } else {
        // Local files — no explicit folder item, create synthetic one
        if (!folderKeys.has(parentKey)) {
          folderKeys.add(parentKey);
          const displayName = parentKey.replace(/\/$/, '').split('/').pop() || parentKey;
          rootFolders.push({ key: parentKey, name: displayName, type: 'folder', synthetic: true });
        }
        if (!childFiles[parentKey]) childFiles[parentKey] = [];
        childFiles[parentKey].push(f);
      }
    });
    return { rootFiles, rootFolders, childFiles, childFolders };
  }, [filteredFiles]);

  // Render expandable Excel file with worksheet children (like S3 folder expansion)
  const renderExcelFile = (file: any, depth: number = 0) => {
    const key = file.path || file.key;
    const isExpanded = !!expandedExcelFiles[key];
    const sheets = excelFileSheets[key] || [];
    const isLoading = excelLoadingFile === key;
    const indent = 1.5 + depth * 1.5;

    // Count selected sheets from this file
    const selectedSheetCount = sheets.filter(s =>
      selectedTables.some(t => t.path === `${key}::${s}`)
    ).length;
    const allSelected = sheets.length > 0 && selectedSheetCount === sheets.length;

    return (
      <Box key={key}>
        <ListItemButton
          dense
          onClick={async () => {
            const willExpand = !isExpanded;
            setExpandedExcelFiles(prev => ({ ...prev, [key]: willExpand }));
            if (willExpand && !excelFileSheets[key]) await loadExcelSheets(file);
          }}
          sx={{ px: 1.5, py: 0.5, pl: indent }}
        >
          {isExpanded
            ? <ExpandMoreIcon sx={{ fontSize: 14, mr: 0.5, color: 'text.disabled' }} />
            : <ExpandIcon sx={{ fontSize: 14, mr: 0.5, color: 'text.disabled' }} />}
          <TableIcon sx={{ fontSize: 14, mr: 0.75, color: '#217346' }} />
          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', flexGrow: 1 }} noWrap>
            {file.name}
          </Typography>
          {selectedSheetCount > 0 && (
            <Chip size="small" label={selectedSheetCount} color="primary" variant="outlined"
              sx={{ height: 18, fontSize: 10, minWidth: 20, '& .MuiChip-label': { px: 0.5 } }} />
          )}
          {isLoading && <CircularProgress size={12} sx={{ ml: 0.5 }} />}
        </ListItemButton>
        <Collapse in={isExpanded}>
          {/* Select All Sheets toggle */}
          {sheets.length > 1 && (
            <ListItemButton dense onClick={() => toggleAllSheets(file, sheets)}
              sx={{ pl: indent + 1.5, py: 0.25 }}>
              <ListItemIcon sx={{ minWidth: 24 }}>
                <Checkbox size="small" checked={allSelected}
                  indeterminate={selectedSheetCount > 0 && !allSelected}
                  sx={{ p: 0, '& .MuiSvgIcon-root': { fontSize: 16 } }} disableRipple />
              </ListItemIcon>
              <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary' }}>
                All Sheets ({sheets.length})
              </Typography>
            </ListItemButton>
          )}
          {sheets.map(sheetName => {
            const sheetPath = `${key}::${sheetName}`;
            const isSelected = selectedTables.some(t => t.path === sheetPath);
            // Display name: "filename :: SheetName" so it's distinguishable from S3 table names
            const parentBase = (file.name || '').replace(/\.(xlsx|xls)$/i, '');
            const sheetDisplayName = `${parentBase} :: ${sheetName}`;
            return (
              <SidebarFileItem
                key={sheetPath}
                file={{ ...file, path: sheetPath, name: sheetDisplayName }}
                selected={isSelected}
                onToggle={() => toggleTable({ ...file, path: sheetPath, name: sheetDisplayName })}
                indent
              />
            );
          })}
          {isExpanded && !isLoading && sheets.length === 0 && excelFileSheets[key] && (
            <Typography variant="caption" sx={{ pl: indent + 2, color: 'text.disabled', display: 'block', py: 0.5, fontSize: 11 }}>
              No sheets found
            </Typography>
          )}
        </Collapse>
      </Box>
    );
  };

  // Recursive folder renderer for the sidebar tree
  const renderFolder = (folder: any, depth: number) => {
    const folderKey = folder.key;
    const isExpanded = !!expandedFolders[folderKey];
    const isLoaded = loadedFolders.has(folderKey);
    const isLoading = loadingFolder === folderKey;
    const subFiles = fileTree.childFiles[folderKey] || [];
    const subFolders = fileTree.childFolders[folderKey] || [];
    const indent = 1.5 + depth * 1.5;  // progressive indentation

    return (
      <Box key={folderKey}>
        <ListItemButton
          dense
          onClick={async () => {
            const willExpand = !isExpanded;
            setExpandedFolders(prev => ({ ...prev, [folderKey]: willExpand }));
            // Lazy-load: only for non-synthetic (S3) folders that haven't been loaded yet
            if (willExpand && !isLoaded && !folder.synthetic && selectedConnectionId) {
              setLoadingFolder(folderKey);
              await loadFiles(folderKey);
              setLoadedFolders(prev => new Set(prev).add(folderKey));
              setLoadingFolder(null);
            }
          }}
          sx={{ px: 1.5, py: 0.5, pl: indent }}
        >
          {isExpanded ? <CollapseIcon sx={{ fontSize: 14, mr: 0.5, color: 'text.disabled' }} /> : <ExpandIcon sx={{ fontSize: 14, mr: 0.5, color: 'text.disabled' }} />}
          <FolderIcon sx={{ fontSize: 14, mr: 0.75, color: 'warning.main' }} />
          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', flexGrow: 1 }} noWrap>
            {folder.name}
          </Typography>
          {isLoading && <CircularProgress size={12} />}
        </ListItemButton>
        <Collapse in={isExpanded}>
          {subFolders.map(sf => renderFolder(sf, depth + 1))}
          {subFiles.map(file => isExcelFile(file)
            ? renderExcelFile(file, depth + 1)
            : (
              <SidebarFileItem
                key={file.path}
                file={file}
                selected={!!selectedTables.find(t => t.path === file.path)}
                onToggle={() => toggleTable(file)}
                indent
              />
            )
          )}
          {isLoaded && subFiles.length === 0 && subFolders.length === 0 && (
            <Typography variant="caption" sx={{ pl: indent + 1.5, color: 'text.disabled', display: 'block', py: 0.5, fontSize: 11 }}>
              No files found
            </Typography>
          )}
        </Collapse>
      </Box>
    );
  };

  return (
    <Box sx={{ height: 'calc(100vh - 52px)', display: 'flex', flexDirection: 'row', bgcolor: 'background.default', overflow: 'hidden' }}>

      {/* ─── File Sidebar (Toad-style) ──────────────────────────────────────── */}
      <Box sx={{
        width: sidebarOpen ? SIDEBAR_W : 0,
        minWidth: sidebarOpen ? SIDEBAR_W : 0,
        transition: 'width 0.2s ease, min-width 0.2s ease',
        overflow: 'hidden',
        borderRight: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Sidebar header */}
        <Box sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 0.5, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
          <TableRowsIcon sx={{ fontSize: 16, color: 'primary.main', flexShrink: 0 }} />
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary', flexGrow: 1, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Tables
          </Typography>
          <Tooltip title={sidebarView === 'flat' ? 'Folder view' : 'Flat list'}>
            <IconButton size="small" onClick={() => setSidebarView(v => v === 'flat' ? 'tree' : 'flat')} sx={{ p: 0.25 }}>
              {sidebarView === 'flat' ? <TreeViewIcon sx={{ fontSize: 14 }} /> : <FlatViewIcon sx={{ fontSize: 14 }} />}
            </IconButton>
          </Tooltip>
          {filesLoading
            ? <CircularProgress size={14} />
            : <Tooltip title="Refresh">
                <IconButton size="small" onClick={() => loadFiles()} sx={{ p: 0.25 }}>
                  <RefreshIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
          }
          <Tooltip title="Collapse sidebar">
            <IconButton size="small" onClick={() => setSidebarOpen(false)} sx={{ p: 0.25 }} aria-label="Toggle sidebar">
              <CollapseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Box>

        {/* Search */}
        <Box sx={{ px: 1, pt: 1, pb: 0.5, flexShrink: 0 }}>
          <TextField
            size="small"
            placeholder="Search tables..."
            value={sidebarSearch}
            onChange={e => setSidebarSearch(e.target.value)}
            fullWidth
            InputProps={{
              startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 16 }} /></InputAdornment>,
              endAdornment: sidebarSearch
                ? <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setSidebarSearch('')} sx={{ p: 0.25 }}>
                      <CloseIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </InputAdornment>
                : null,
            }}
            sx={{ '& .MuiInputBase-root': { fontSize: 13 } }}
          />
        </Box>

        {/* File tree */}
        <Box sx={{ flex: 1, overflowY: 'auto', pb: 1 }}>

          {/* ── Unified Tables section ──────────────────────────────────── */}
          {(allTables.length > 0 || icebergTables.length > 0 || icebergLoading) && (
            <Box>
              {/* Section header */}
              <Box sx={(theme) => ({
                background: `linear-gradient(135deg, ${alpha(theme.palette.primary.dark, 0.9)} 0%, ${alpha(theme.palette.primary.main, 0.8)} 100%)`,
                borderRadius: '10px',
                p: '8px 12px',
                mb: 1,
                mx: 0.75,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              })}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TableIcon sx={{ fontSize: 18, color: 'rgba(255,255,255,0.7)' }} />
                  <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: '#fff' }}>Tables</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  {registeredTables.length > 0 && (
                    <Tooltip title="Refresh all partition metadata from S3 for every registered table">
                      <Chip
                        size="small"
                        icon={refreshingAllPartitions
                          ? <CircularProgress size={12} thickness={5} sx={{ color: '#fff' }} />
                          : <RefreshIcon sx={{ fontSize: 14 }} />}
                        label={refreshingAllPartitions ? "..." : "Refresh"}
                        disabled={refreshingAllPartitions || !selectedConnectionId}
                        onClick={() => {
                          if (!selectedConnectionId) return;
                          setRefreshingAllPartitions(true);
                          api.refreshAllPartitions(String(selectedConnectionId))
                            .then((res: any) => {
                              addNotification({ type: 'success', title: 'Partitions Refreshed', message: `${res.refreshed}/${res.total} tables refreshed` });
                              selectedTables.forEach(t => {
                                if (t.path?.startsWith('__registered__:')) {
                                  const tName = t.path.replace('__registered__:', '');
                                  api.getRegisteredTablePartitions(String(selectedConnectionId), tName)
                                    .then((pd: any) => setPartitionData(prev => ({ ...prev, [tName]: pd })))
                                    .catch(() => {});
                                }
                              });
                            })
                            .catch((err: any) => {
                              addNotification({ type: 'error', title: 'Refresh Failed', message: String(err?.message || err) });
                            })
                            .finally(() => setRefreshingAllPartitions(false));
                        }}
                        sx={{
                          height: 24, fontSize: '0.7rem', fontWeight: 700,
                          bgcolor: 'rgba(255,255,255,0.15)', color: '#fff',
                          border: '1px solid rgba(255,255,255,0.4)',
                          cursor: 'pointer',
                          '&:hover': { bgcolor: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.7)' },
                          '& .MuiChip-icon': { color: '#fff', ml: 0.5 },
                        }}
                      />
                    </Tooltip>
                  )}
                  <Chip label={allTables.length + icebergTables.length} size="small" sx={{ height: 20, fontSize: '0.7rem', bgcolor: 'rgba(148,163,184,0.2)', color: '#94a3b8' }} />
                </Box>
              </Box>

              {/* Type filter chips */}
              <Box sx={{ display: 'flex', gap: 0.5, px: 1, mb: 1, flexWrap: 'wrap' }}>
                {(['all', 'registered', 'materialized', 'local', 'federation'] as const).map(f => {
                  const labels = { all: 'All', registered: 'REG', materialized: 'MV', local: 'LOCAL', federation: 'FED' };
                  const isActive = tableTypeFilter === f;
                  return (
                    <Chip
                      key={f}
                      label={labels[f]}
                      size="small"
                      onClick={() => setTableTypeFilter(f)}
                      sx={(theme) => ({
                        height: 22, fontSize: '0.65rem', fontWeight: 700,
                        bgcolor: isActive ? alpha(theme.palette.primary.main, 0.15) : alpha(theme.palette.text.secondary, 0.06),
                        color: isActive ? theme.palette.primary.light : theme.palette.text.secondary,
                        border: isActive ? `1px solid ${alpha(theme.palette.primary.main, 0.4)}` : '1px solid transparent',
                        cursor: 'pointer',
                        '&:hover': { bgcolor: isActive ? alpha(theme.palette.primary.main, 0.22) : alpha(theme.palette.text.secondary, 0.12) },
                      })}
                    />
                  );
                })}
                {icebergLoading && <CircularProgress size={14} sx={{ ml: 0.5 }} />}
              </Box>

              {/* Unified table list */}
              {filteredTables.map(item => {
                const isSelected = !!selectedTables.find(t => t.path === item._path);
                // For registered tables, compute partition info
                const rt = item._type === 'registered' ? registeredTables.find(r => r.name === item.name) : null;
                const pdata = rt ? partitionData[rt.name] : null;
                const _pVals = pdata?.values || {};
                const hasPartitions = isSelected && rt && pdata?.partition_columns?.length > 0
                  && Object.values(_pVals).some((vals: any) => vals?.length > 0);
                const selParts = rt ? (selectedPartitions[rt.name] || {}) : {};
                const totalSelectedParts = Object.values(selParts).reduce((sum: number, arr: any) => sum + arr.length, 0);
                return (
                  <React.Fragment key={item._path}>
                    <Box
                      onClick={() => toggleTable({ path: item._path, name: item.name, key: item._path })}
                      onContextMenu={(e: React.MouseEvent) => {
                        e.preventDefault();
                        setTableContextMenu({ anchorPosition: { top: e.clientY, left: e.clientX }, item });
                      }}
                      sx={{
                        p: '6px 10px', borderRadius: '8px', cursor: 'pointer', mb: 0.5, mx: 0.75,
                        border: isSelected ? '1px solid' : '1px solid transparent',
                        borderColor: isSelected ? 'primary.main' : 'transparent',
                        bgcolor: isSelected ? 'action.selected' : 'transparent',
                        '&:hover': { bgcolor: 'action.hover' },
                        display: 'flex', alignItems: 'center', gap: 1,
                      }}>
                      {tableFavorites.has(item._path) && (
                        <StarIcon sx={{ fontSize: 14, color: '#f59e0b' }} />
                      )}
                      <Chip label={item._badge} size="small"
                        sx={{ height: 18, fontSize: '0.6rem', fontWeight: 700,
                              bgcolor: item._badgeBg, color: item._badgeColor,
                              border: `1px solid ${item._badgeColor}30` }} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: '0.78rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                          {item._type === 'registered' && (item.format || 'parquet')}
                          {item._type === 'materialized' && `${formatCount(item.row_count)} rows · ${formatBytes(item.size_bytes)}`}
                          {item._type === 'local' && `${formatCount(item.row_count)} rows · ${formatBytes(item.size_bytes)}`}
                        </Typography>
                      </Box>
                      {/* Loading or selected indicator */}
                      {item._type === 'registered' && (loadingRegSchema === item.name || loadingPartitions.has(item.name))
                        ? <CircularProgress size={14} thickness={5} sx={{ color: 'primary.main' }} />
                        : isSelected && <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'primary.main' }} />
                      }
                    </Box>

                    {/* ── S3 partition error codes (78S) ───────────────────── */}
                    {isSelected && rt && pdata?.error_code === 'S3_ACCESS_DENIED' && (
                      <Alert severity="error" sx={{ mx: 0.75, mb: 0.75, fontSize: 11, py: 0.25 }}>
                        Access denied to S3 prefix. Check IAM permissions.
                      </Alert>
                    )}
                    {isSelected && rt && pdata?.error_code === 'S3_EMPTY_PREFIX' && (
                      <Alert severity="info" sx={{ mx: 0.75, mb: 0.75, fontSize: 11, py: 0.25 }}>
                        No partitions found — this prefix appears to be empty.
                      </Alert>
                    )}

                    {/* ── Partition Selector Panel (registered tables only) ───── */}
                    {hasPartitions && rt && pdata && (() => {
                      const combosAll: any[] = pdata.combos || [];
                      const hasAnySelection = Object.values(selParts).some((arr: any) => arr.length > 0);
                      const matchingCombos = combosAll.filter(c =>
                        Object.entries(selParts).every(([col, vals]: any) =>
                          vals.length === 0 || vals.includes(c[col])
                        )
                      );
                      const estFiles = matchingCombos.reduce((s, c) => s + (c._files || 0), 0);
                      const estRecords = matchingCombos.reduce((s, c) => s + (c._records || 0), 0);
                      const _fmtCount = (n: number) =>
                        n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
                        : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
                        : n.toLocaleString();

                      return (
                        <Box sx={(theme) => ({
                          mx: 0.75, mb: 0.75,
                          borderRadius: 2,
                          border: `1px solid ${totalSelectedParts > 0 ? theme.palette.primary.main : theme.palette.divider}`,
                          overflow: 'visible',
                          bgcolor: 'background.paper',
                          boxShadow: totalSelectedParts > 0
                            ? `0 0 0 1px ${alpha(theme.palette.primary.main, 0.15)}, 0 4px 16px rgba(0,0,0,0.15)`
                            : '0 2px 8px rgba(0,0,0,0.08)',
                          transition: 'border-color 0.2s, box-shadow 0.2s',
                        })}>
                          {/* ── Header (clickable to expand/collapse) ───────────────────────────── */}
                          <Box
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedPartitionPanels(prev => {
                                const n = new Set(prev);
                                n.has(rt.name) ? n.delete(rt.name) : n.add(rt.name);
                                return n;
                              });
                            }}
                            sx={(theme) => ({
                            px: 1.25, py: 0.7,
                            bgcolor: alpha(theme.palette.primary.main, 0.85),
                            display: 'flex', alignItems: 'center', gap: 0.75,
                            borderBottom: expandedPartitionPanels.has(rt.name) ? `1px solid ${totalSelectedParts > 0 ? theme.palette.primary.main : theme.palette.divider}` : 'none',
                            borderRadius: expandedPartitionPanels.has(rt.name) ? '7px 7px 0 0' : '7px',
                            cursor: 'pointer',
                            '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.92) },
                          })}>
                            {expandedPartitionPanels.has(rt.name)
                              ? <ExpandLessIcon sx={{ fontSize: 14, color: '#fff' }} />
                              : <ExpandMoreIcon sx={{ fontSize: 14, color: '#fff' }} />
                            }
                            <FilterIcon sx={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }} />
                            <Typography sx={{ fontSize: 10, fontWeight: 800, color: '#fff', letterSpacing: 0.8, textTransform: 'uppercase' }}>
                              Partition Filter
                            </Typography>
                            {pdata.cached_at && !refiningPartitions.has(rt.name) && !refreshingPartitions.has(rt.name) && (
                              <Typography sx={{ fontSize: 7.5, color: 'rgba(255,255,255,0.55)', fontStyle: 'italic' }}>
                                {_timeAgo(pdata.cached_at)}
                              </Typography>
                            )}
                            <Box sx={{ flex: 1 }} />
                            {refiningPartitions.has(rt.name) && (
                              <Tooltip title="Loading exact partition combos in background — you can still use the selector">
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, flexShrink: 0 }}>
                                  <CircularProgress size={10} thickness={5} sx={{ color: 'rgba(255,255,255,0.7)' }} />
                                  <Typography sx={{ fontSize: 8, color: 'rgba(255,255,255,0.75)', fontWeight: 600 }}>
                                    refining
                                  </Typography>
                                </Box>
                              </Tooltip>
                            )}
                            <Tooltip title="Refresh partition metadata from S3">
                              <IconButton size="small"
                                disabled={refreshingPartitions.has(rt.name)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!selectedConnectionId) return;
                                  const _connId = String(selectedConnectionId);
                                  const _tName = rt.name;
                                  setRefreshingPartitions(prev => new Set(prev).add(_tName));
                                  api.refreshPartitionCache(_connId, _tName)
                                    .then((freshData: any) => {
                                      setPartitionData(prev => ({ ...prev, [_tName]: freshData }));
                                    })
                                    .catch((err: any) => {
                                      addNotification({ type: 'error', title: 'Partition Refresh Failed', message: String(err?.message || err) });
                                    })
                                    .finally(() => {
                                      setRefreshingPartitions(prev => { const n = new Set(prev); n.delete(_tName); return n; });
                                    });
                                }}
                                sx={{ p: 0.4, color: '#fff', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 1,
                                  '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.7)' } }}>
                                {refreshingPartitions.has(rt.name)
                                  ? <CircularProgress size={14} thickness={5} sx={{ color: '#fff' }} />
                                  : <RefreshIcon sx={{ fontSize: 16 }} />}
                              </IconButton>
                            </Tooltip>
                            {totalSelectedParts > 0 ? (
                              <>
                                <Box sx={{ px: 0.9, py: 0.2, borderRadius: 10, bgcolor: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)' }}>
                                  <Typography sx={{ fontSize: 9, fontWeight: 800, color: '#fff', letterSpacing: 0.4 }}>
                                    {totalSelectedParts} filter{totalSelectedParts !== 1 ? 's' : ''} active
                                  </Typography>
                                </Box>
                                <Tooltip title="Clear all partition filters">
                                  <IconButton size="small"
                                    onClick={(e) => { e.stopPropagation(); setSelectedPartitions(prev => ({ ...prev, [rt.name]: {} })); }}
                                    sx={{ p: 0.3, color: 'rgba(255,255,255,0.5)', '&:hover': { color: '#f87171', bgcolor: 'rgba(248,113,113,0.15)' } }}>
                                    <CloseIcon sx={{ fontSize: 12 }} />
                                  </IconButton>
                                </Tooltip>
                              </>
                            ) : (
                              <Typography sx={{ fontSize: 8.5, color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>
                                none selected
                              </Typography>
                            )}
                          </Box>

                          {/* ── Collapsible body ─────────────────── */}
                          <Collapse in={expandedPartitionPanels.has(rt.name)} timeout="auto" unmountOnExit>
                          <Box sx={{ px: 1.25, pt: 0.875, pb: 0.625 }}>
                            {pdata.partition_columns.map((pc: any, pcIdx: number) => {
                              const allVals: string[] = pdata.values?.[pc.name] || [];
                              const counts = pdata.file_counts?.[pc.name] || {};
                              const recCounts = pdata.record_counts?.[pc.name] || {};
                              const selected: string[] = selParts[pc.name] || [];

                              let availableSet: Set<string> | null = null;
                              if (combosAll.length > 0) {
                                const otherFilters: [string, string[]][] = [];
                                for (const opc of pdata.partition_columns) {
                                  if (opc.name !== pc.name) {
                                    const oSel = selParts[opc.name] || [];
                                    if (oSel.length > 0) otherFilters.push([opc.name, oSel]);
                                  }
                                }
                                if (otherFilters.length > 0) {
                                  const matching = combosAll.filter(c =>
                                    otherFilters.every(([col, vals]) => {
                                      const cv = c[col];
                                      return cv === undefined || cv === null || vals.includes(cv);
                                    })
                                  );
                                  const candidates = new Set(
                                    matching.map(c => c[pc.name]).filter((v: any) => v !== undefined && v !== null && v !== '')
                                  );
                                  availableSet = candidates.size > 0 ? candidates : null;
                                }
                              }

                              const dropdownOptions = availableSet
                                ? allVals.filter(v => availableSet!.has(v) || selected.includes(v))
                                : allVals;

                              const label = pc.source_column || pc.name;

                              const tcMap: Record<string, { bg: string; color: string }> = {
                                day:      { bg: '#1e3a5f', color: '#7dd3fc' },
                                month:    { bg: '#1e3a5f', color: '#7dd3fc' },
                                year:     { bg: '#1e3a5f', color: '#93c5fd' },
                                hour:     { bg: '#1e3a5f', color: '#bae6fd' },
                                bucket:   { bg: '#3b1f5e', color: '#c4b5fd' },
                                truncate: { bg: '#1e293b', color: '#cbd5e1' },
                                identity: { bg: '#14532d', color: '#86efac' },
                              };
                              const tc = tcMap[pc.transform] || tcMap.identity;
                              const txLabel = pc.transform === 'identity' ? 'id' : pc.transform;

                              return (
                                <Box key={pc.name} sx={{ mb: pcIdx < pdata.partition_columns.length - 1 ? 0.5 : 0 }}>
                                  {pcIdx > 0 && (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.4, pl: 0.75 }}>
                                      <Box sx={{
                                        width: 10, height: 14,
                                        borderLeft: '1.5px dashed #475569',
                                        borderBottom: '1.5px dashed #475569',
                                        borderRadius: '0 0 0 4px',
                                        mr: 0.5, flexShrink: 0,
                                      }} />
                                      <Typography sx={{ fontSize: 9, color: availableSet ? '#4ade80' : '#64748b', fontWeight: availableSet ? 700 : 400 }}>
                                        {availableSet
                                          ? `↳ ${availableSet.size} of ${allVals.length} available`
                                          : '↳ cascades from above'}
                                      </Typography>
                                    </Box>
                                  )}

                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.4, px: 0.1 }}>
                                    <Typography
                                      title={label}
                                      sx={{ fontSize: 11, fontWeight: 700, color: selected.length > 0 ? '#4ade80' : '#cbd5e1', flex: 1, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', transition: 'color 0.15s' }}>
                                      {label}
                                    </Typography>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, flexShrink: 0 }}>
                                      <Box sx={{ px: 0.65, py: 0.15, borderRadius: 0.75, bgcolor: tc.bg }}>
                                        <Typography sx={{ fontSize: 8.5, fontWeight: 800, color: tc.color, letterSpacing: 0.3 }}>
                                          {txLabel}
                                        </Typography>
                                      </Box>
                                      <Box sx={{ px: 0.55, py: 0.15, borderRadius: 0.75, bgcolor: 'rgba(255,255,255,0.06)' }}>
                                        <Typography sx={{ fontSize: 8.5, color: '#94a3b8', fontFamily: 'monospace' }}>
                                          {allVals.length}v
                                        </Typography>
                                      </Box>
                                    </Box>
                                  </Box>

                                  <BulkPartitionActions
                                    allValues={dropdownOptions}
                                    selected={selected}
                                    onChange={(newVal) => {
                                      setSelectedPartitions(prev => {
                                        const tblParts = { ...(prev[rt.name] || {}) };
                                        tblParts[pc.name] = newVal;
                                        return { ...prev, [rt.name]: tblParts };
                                      });
                                    }}
                                  />

                                  <Autocomplete
                                    multiple
                                    size="small"
                                    loading={refiningPartitions.has(rt.name)}
                                    loadingText={<Typography sx={{ fontSize: 10, color: 'primary.light' }}>Loading exact values...</Typography>}
                                    options={dropdownOptions}
                                    value={selected}
                                    onChange={(_e, newVal) => {
                                      setSelectedPartitions(prev => {
                                        const tblParts = { ...(prev[rt.name] || {}) };
                                        tblParts[pc.name] = newVal as string[];
                                        return { ...prev, [rt.name]: tblParts };
                                      });
                                    }}
                                    disableCloseOnSelect
                                    getOptionLabel={(v) => v}
                                    renderOption={(props, v, { selected: optSel }) => {
                                      const recCount = recCounts[v] || 0;
                                      const fileCount = counts[v] || 0;
                                      const badge = recCount > 0 ? _fmtCount(recCount) : fileCount > 0 ? `${fileCount}f` : '';
                                      return (
                                        <li {...props} key={v} style={{ padding: '2px 8px', minHeight: 28 }}>
                                          <Checkbox size="small" checked={optSel}
                                            sx={{ p: 0.2, mr: 0.5, color: 'text.secondary', '&.Mui-checked': { color: 'success.main' } }} />
                                          <Typography sx={{ fontSize: 11, fontFamily: 'monospace', flex: 1, color: 'text.primary' }}>
                                            {v}
                                          </Typography>
                                          {badge && (
                                            <Box sx={{ px: 0.5, py: 0.1, borderRadius: 0.5, bgcolor: 'rgba(255,255,255,0.06)', ml: 0.75, flexShrink: 0 }}>
                                              <Typography
                                                title={recCount > 0 ? `${recCount.toLocaleString()} rows · ${fileCount} files` : `${fileCount} files`}
                                                sx={{ fontSize: 8.5, color: '#94a3b8', fontFamily: 'monospace' }}>
                                                {badge}
                                              </Typography>
                                            </Box>
                                          )}
                                        </li>
                                      );
                                    }}
                                    renderTags={(tagVals, getTagProps) =>
                                      tagVals.map((v, idx) => (
                                        <Chip
                                          {...getTagProps({ index: idx })}
                                          key={v}
                                          label={v}
                                          size="small"
                                          sx={(theme) => ({
                                            height: 18, fontSize: 10, fontWeight: 700,
                                            bgcolor: alpha(theme.palette.primary.main, 0.12),
                                            color: theme.palette.primary.light,
                                            border: `1px solid ${alpha(theme.palette.primary.main, 0.35)}`,
                                            fontFamily: 'monospace',
                                            '& .MuiChip-label': { px: 0.65 },
                                            '& .MuiChip-deleteIcon': { color: theme.palette.text.secondary, fontSize: 12, '&:hover': { color: theme.palette.error.light } },
                                          })}
                                        />
                                      ))
                                    }
                                    renderInput={(params) => (
                                      <TextField
                                        {...params}
                                        placeholder={selected.length === 0 ? `All ${allVals.length} values…` : undefined}
                                        sx={(theme) => ({
                                          '& .MuiInputBase-root': {
                                            bgcolor: 'background.default',
                                            fontSize: 11,
                                            minHeight: 30,
                                            borderRadius: 1,
                                          },
                                          '& .MuiOutlinedInput-notchedOutline': {
                                            borderColor: selected.length > 0 ? theme.palette.primary.main : theme.palette.divider,
                                          },
                                          '&:hover .MuiOutlinedInput-notchedOutline': {
                                            borderColor: theme.palette.primary.main,
                                          },
                                          '& .MuiInputBase-input': { color: 'text.primary', fontSize: 11 },
                                          '& .MuiInputBase-input::placeholder': { color: theme.palette.text.disabled, opacity: 1 },
                                          '& .MuiSvgIcon-root': { color: theme.palette.text.secondary },
                                        })}
                                      />
                                    )}
                                    ListboxProps={{ style: { maxHeight: 210, padding: '4px 0' } }}
                                    PaperComponent={({ children, ...p }) => (
                                      <Paper {...p} sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1.5, mt: 0.5, boxShadow: 4 }}>
                                        {children}
                                      </Paper>
                                    )}
                                    noOptionsText={<Typography sx={{ fontSize: 10, color: 'text.secondary', py: 0.5, px: 1 }}>No values available</Typography>}
                                    sx={{ width: '100%' }}
                                  />
                                </Box>
                              );
                            })}

                            {/* ── Stats / warning footer ─────────────── */}
                            <Box sx={{ mt: 0.875, pt: 0.75, borderTop: '1px solid', borderColor: 'divider' }}>
                              {hasAnySelection && estFiles > 0 ? (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                                  <Typography sx={{ fontSize: 8.5, color: 'text.secondary', mr: 0.25 }}>Est:</Typography>
                                  <Box sx={(theme) => ({ px: 0.75, py: 0.2, borderRadius: 10, bgcolor: alpha(theme.palette.primary.main, 0.08), border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}` })}>
                                    <Typography sx={{ fontSize: 9.5, fontWeight: 700, color: 'primary.light', fontFamily: 'monospace' }}>
                                      {estFiles === 1 ? '1 file' : `${_fmtCount(estFiles)} files`}
                                    </Typography>
                                  </Box>
                                  {estRecords > 0 && (
                                    <Box sx={(theme) => ({ px: 0.75, py: 0.2, borderRadius: 10, bgcolor: alpha(theme.palette.success.main, 0.08), border: `1px solid ${alpha(theme.palette.success.main, 0.3)}` })}>
                                      <Typography sx={{ fontSize: 9.5, fontWeight: 700, color: 'success.light', fontFamily: 'monospace' }}>
                                        ~{_fmtCount(estRecords)} rows
                                      </Typography>
                                    </Box>
                                  )}
                                </Box>
                              ) : hasAnySelection && estFiles === 0 ? (
                                <Box sx={{
                                  px: 0.875, py: 0.5, borderRadius: 1.5,
                                  display: 'flex', alignItems: 'center', gap: 0.6,
                                  bgcolor: 'rgba(239,68,68,0.08)',
                                  border: '1px solid rgba(239,68,68,0.25)',
                                }}>
                                  <WarningIcon sx={{ fontSize: 12, color: '#f87171', flexShrink: 0 }} />
                                  <Typography sx={{ fontSize: 9.5, color: '#fca5a5', fontWeight: 600, lineHeight: 1.3 }}>
                                    This combination may not exist — query could return 0 rows
                                  </Typography>
                                </Box>
                              ) : !hasAnySelection ? (
                                <Box sx={{
                                  px: 0.875, py: 0.5, borderRadius: 1.5,
                                  display: 'flex', alignItems: 'center', gap: 0.6,
                                  bgcolor: 'rgba(251,191,36,0.06)',
                                  border: '1px solid rgba(251,191,36,0.22)',
                                }}>
                                  <WarningIcon sx={{ fontSize: 12, color: '#fbbf24', flexShrink: 0 }} />
                                  <Typography sx={{ fontSize: 9.5, color: '#fde68a', fontWeight: 600, lineHeight: 1.3 }}>
                                    No partition selected — full table scan
                                  </Typography>
                                </Box>
                              ) : null}
                            </Box>
                          </Box>
                          </Collapse>
                        </Box>
                      );
                    })()}
                  </React.Fragment>
                );
              })}

              {/* ── Iceberg Tables (expandable tree with ICE badge) ──────────── */}
              {icebergTables.map(table => (
                <Box key={table.prefix}>
                  <Box
                    onClick={() => {
                      const isExpanded = !!expandedIcebergTables[table.prefix];
                      setExpandedIcebergTables(prev => ({ ...prev, [table.prefix]: !isExpanded }));
                      if (!isExpanded) loadIcebergTableFiles(table);
                    }}
                    sx={{
                      p: '6px 10px', borderRadius: '8px', cursor: 'pointer', mb: 0.5, mx: 0.75,
                      '&:hover': { bgcolor: 'action.hover' },
                      display: 'flex', alignItems: 'center', gap: 1,
                    }}>
                    {expandedIcebergTables[table.prefix]
                      ? <ExpandLessIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                      : <ExpandMoreIcon sx={{ fontSize: 14, color: 'text.disabled' }} />}
                    <Chip label="ICE" size="small"
                      sx={(theme) => ({ height: 18, fontSize: '0.6rem', fontWeight: 700,
                            bgcolor: alpha(theme.palette.info.main, 0.12),
                            color: theme.palette.info.main,
                            border: `1px solid ${alpha(theme.palette.info.main, 0.3)}` })} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: '0.78rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {table.name}
                      </Typography>
                    </Box>
                    {icebergLoadingTable === table.prefix
                      ? <CircularProgress size={12} />
                      : icebergTableFiles[table.prefix] != null && (
                          <Typography variant="caption" color="text.disabled">
                            ({(icebergTableFiles[table.prefix] || []).length})
                          </Typography>
                        )
                    }
                  </Box>
                  <Collapse in={!!expandedIcebergTables[table.prefix]}>
                    {(icebergTableFiles[table.prefix] || []).map(file => (
                      <SidebarFileItem
                        key={file.key}
                        file={{ ...file, path: file.key, name: file.name.replace(/\.parquet$/i, '') }}
                        selected={!!selectedTables.find(t => t.path === file.key)}
                        onToggle={() => toggleTable({ ...file, path: file.key })}
                        indent
                      />
                    ))}
                    {icebergTableFiles[table.prefix]?.length === 0 && (
                      <Typography variant="caption" sx={{ pl: 4.5, color: 'text.disabled', display: 'block', py: 0.5, fontSize: 11 }}>
                        No data files found
                      </Typography>
                    )}
                  </Collapse>
                </Box>
              ))}

              {(allTables.length > 0 || icebergTables.length > 0) && <Divider sx={{ my: 0.5 }} />}
            </Box>
          )}

          {allFiles.length === 0 && !filesLoading && icebergTables.length === 0 && registeredTables.length === 0 && materializedViews.length === 0 && localTables.length === 0 && (
            <Box sx={{ px: 2, pt: 2, textAlign: 'center' }}>
              <Typography variant="caption" color="text.disabled">
                {selectedConnectionId ? 'No files found' : 'Select a connection or use default data'}
              </Typography>
            </Box>
          )}

          {/* ── Flat view: simple searchable list ─────────────────────────── */}
          {sidebarView === 'flat' && flatFileList.map(file => (
            <SidebarFileItem
              key={file.path || file.key}
              file={{
                ...file,
                // Show relative path as subtitle for context
                displayPath: file.folder ? `${(file.folder || '').replace(/\/$/, '')}` : '',
              }}
              selected={!!selectedTables.find(t => t.path === file.path)}
              onToggle={() => toggleTable(file)}
            />
          ))}

          {/* ── Tree view: folder hierarchy ────────────────────────────────── */}
          {sidebarView === 'tree' && (
            <>
              {fileTree.rootFiles.map(file => isExcelFile(file)
                ? renderExcelFile(file, 0)
                : (
                  <SidebarFileItem
                    key={file.path}
                    file={file}
                    selected={!!selectedTables.find(t => t.path === file.path)}
                    onToggle={() => toggleTable(file)}
                  />
                )
              )}
              {fileTree.rootFolders.map(folder => renderFolder(folder, 0))}
            </>
          )}
        </Box>

        {/* Selected count footer */}
        {selectedTables.length > 0 && (
          <Box sx={{ px: 1.5, py: 0.75, borderTop: 1, borderColor: 'divider', bgcolor: 'primary.50', flexShrink: 0 }}>
            <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 600 }}>
              {selectedTables.length} table{selectedTables.length > 1 ? 's' : ''} selected
            </Typography>
          </Box>
        )}
      </Box>

      {/* ─── Main content (controls + results) ─────────────────────────────── */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* ─── Controls strip (scrollable, max 35vh) ─────────────────────── */}
        <Box sx={{ flexShrink: 0, maxHeight: '35vh', overflowY: 'auto', px: 2, pt: 2, pb: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>

          {/* SQL Preview panel (collapsible) */}
          {showPreview && (
            <Paper sx={{ p: 2, bgcolor: 'grey.900' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2" sx={{ color: 'grey.300' }}>
                  <CodeIcon sx={{ fontSize: 16, mr: 0.5, verticalAlign: 'text-bottom' }} />
                  SQL Preview
                </Typography>
                <IconButton size="small" onClick={() => setShowPreview(false)} sx={{ color: 'grey.400' }}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
              <Box component="pre" sx={{ fontFamily: 'monospace', fontSize: 13, color: '#4fc3f7', whiteSpace: 'pre-wrap', wordBreak: 'break-word', m: 0, maxHeight: 160, overflowY: 'auto' }}>
                {sqlPreview}
              </Box>
            </Paper>
          )}

          {/* Row 1: Data source + sidebar toggle + SQL toggle */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            {/* Sidebar toggle */}
            {!sidebarOpen && (
              <Tooltip title="Show table browser">
                <IconButton size="small" onClick={() => setSidebarOpen(true)} sx={{ border: 1, borderColor: 'divider' }} aria-label="Toggle sidebar">
                  <ExpandIcon />
                </IconButton>
              </Tooltip>
            )}

            <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary', whiteSpace: 'nowrap' }}>
              Data Source:
            </Typography>
            <TextField
              select
              size="small"
              value={selectedConnectionId ?? ''}
              onChange={e => setSelectedConnectionId(e.target.value === '' ? null : Number(e.target.value))}
              sx={{ minWidth: { xs: 140, sm: 220 } }}
            >
              <MenuItem value="">Local (default)</MenuItem>
              {connections.map(c => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                  <Typography component="span" variant="caption" sx={{ ml: 1, color: 'text.disabled' }}>
                    ({c.connection_type})
                  </Typography>
                </MenuItem>
              ))}
            </TextField>
            {connections.length === 0 && (
              <Button
                size="small"
                variant="text"
                startIcon={<OpenInNewIcon fontSize="small" />}
                onClick={() => navigate('/connections')}
                sx={{ textTransform: 'none', fontSize: 12, color: 'text.secondary' }}
              >
                Manage Connections
              </Button>
            )}
            {selectedConn && (
              <Chip
                size="small"
                label={selectedConn.last_test_status === 'success' ? 'Connected' : 'Untested'}
                color={selectedConn.last_test_status === 'success' ? 'success' : 'default'}
                variant="outlined"
              />
            )}
            <Box sx={{ flexGrow: 1 }} />
            <Button variant="outlined" size="small" startIcon={<CodeIcon />} onClick={() => setShowPreview(v => !v)}>
              {showPreview ? 'Hide SQL' : 'SQL Preview'}
            </Button>
          </Box>

          {/* Row 2: Query builder toolbar + execute */}
          <Box role="toolbar" aria-label="Query builder toolbar" sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <ButtonGroup variant="contained" size="small">
              <Tooltip title="Browse tables in sidebar or open picker">
                <Button onClick={() => setShowTableSelector(true)} startIcon={<TableIcon />}>
                  Tables
                  <Chip label={selectedTables.length} size="small" sx={{ ml: 0.75, height: 18, minWidth: 18, fontSize: 11 }} color="default" />
                </Button>
              </Tooltip>
              <Tooltip title="Configure joins (need ≥2 tables)">
                <span>
                  <Button onClick={() => setShowJoinBuilder(true)} disabled={selectedTables.length < 2} startIcon={<JoinIcon />}>
                    Joins
                    <Chip label={joins.length} size="small" sx={{ ml: 0.75, height: 18, minWidth: 18, fontSize: 11 }} color="default" />
                  </Button>
                </span>
              </Tooltip>
              <Tooltip title="Pick columns (SELECT)">
                <span>
                  <Button onClick={() => setShowColumnSelector(true)} disabled={selectedTables.length === 0} startIcon={<ColumnIcon />}>
                    Columns
                    <Chip
                      label={selectedColumns.length || '*'}
                      size="small"
                      sx={{ ml: 0.75, height: 18, minWidth: 18, fontSize: 11 }}
                      color={selectedColumns.length > 0 ? 'primary' : 'default'}
                      onDelete={selectedColumns.length > 0 ? (e) => { e.stopPropagation(); setSelectedColumns([]); } : undefined}
                    />
                  </Button>
                </span>
              </Tooltip>
              <Tooltip title="Aggregate functions (SUM, AVG, COUNT...)">
                <span>
                  <Button onClick={() => setShowAggBuilder(true)} disabled={selectedTables.length === 0}
                    startIcon={<AggIcon />} color={aggregations.length > 0 ? 'secondary' : 'inherit'}>
                    Aggregate
                    <Chip label={aggregations.length} size="small"
                      sx={{ ml: 0.75, height: 18, minWidth: 18, fontSize: 11 }}
                      color={aggregations.length > 0 ? 'secondary' : 'default'} />
                  </Button>
                </span>
              </Tooltip>
              <Tooltip title="Add WHERE filters">
                <Button onClick={() => setShowFilterBuilder(true)} startIcon={<FilterIcon />}>
                  Filters
                  <Chip
                    label={filters.length}
                    size="small"
                    sx={{ ml: 0.75, height: 18, minWidth: 18, fontSize: 11 }}
                    color={filters.length > 0 ? 'warning' : 'default'}
                    onDelete={filters.length > 0 ? (e) => { e.stopPropagation(); setFilters([]); } : undefined}
                  />
                </Button>
              </Tooltip>
            </ButtonGroup>

            {/* Advanced SQL buttons */}
            <ButtonGroup variant="outlined" size="small">
              <Tooltip title="SELECT DISTINCT — remove duplicate rows">
                <Button onClick={() => setDistinct(d => !d)} color={distinct ? 'secondary' : 'inherit'}
                  variant={distinct ? 'contained' : 'outlined'} sx={{ fontSize: 12, minWidth: 0 }}>
                  DISTINCT
                </Button>
              </Tooltip>
              <Tooltip title="HAVING — filter aggregated results">
                <span>
                  <Button onClick={() => setShowHavingBuilder(true)} disabled={aggregations.length === 0}
                    color={having.length > 0 ? 'warning' : 'inherit'} sx={{ fontSize: 12 }}>
                    HAVING <Chip label={having.length} size="small" sx={{ ml: 0.5, height: 16, fontSize: 10 }} />
                  </Button>
                </span>
              </Tooltip>
              <Tooltip title="Computed columns (expressions, date/string functions)">
                <span>
                  <Button onClick={() => setShowComputedBuilder(true)} disabled={selectedTables.length === 0}
                    startIcon={<ComputedIcon sx={{ fontSize: 16 }} />}
                    color={computedColumns.length > 0 ? 'info' : 'inherit'} sx={{ fontSize: 12 }}>
                    Computed <Chip label={computedColumns.length} size="small" sx={{ ml: 0.5, height: 16, fontSize: 10 }} />
                  </Button>
                </span>
              </Tooltip>
              <Tooltip title="CASE WHEN conditional expressions">
                <span>
                  <Button onClick={() => setShowCaseBuilder(true)} disabled={selectedTables.length === 0}
                    startIcon={<CaseIcon sx={{ fontSize: 16 }} />}
                    color={caseExpressions.length > 0 ? 'info' : 'inherit'} sx={{ fontSize: 12 }}>
                    CASE <Chip label={caseExpressions.length} size="small" sx={{ ml: 0.5, height: 16, fontSize: 10 }} />
                  </Button>
                </span>
              </Tooltip>
              <Tooltip title="Window functions (ROW_NUMBER, RANK, LAG, LEAD...)">
                <span>
                  <Button onClick={() => setShowWindowBuilder(true)} disabled={selectedTables.length === 0}
                    startIcon={<WindowIcon sx={{ fontSize: 16 }} />}
                    color={windowFunctions.length > 0 ? 'info' : 'inherit'} sx={{ fontSize: 12 }}>
                    Window <Chip label={windowFunctions.length} size="small" sx={{ ml: 0.5, height: 16, fontSize: 10 }} />
                  </Button>
                </span>
              </Tooltip>
            </ButtonGroup>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>Limit:</Typography>
              <TextField
                select
                size="small"
                value={limit === null ? 'none' : (([100, 500, 1000, 5000, 10000, 50000, 100000].includes(limit)) ? String(limit) : 'custom')}
                onChange={e => {
                  const v = e.target.value;
                  if (v === 'none') setLimit(null);
                  else if (v === 'custom') { /* handled by the custom input below */ }
                  else setLimit(parseInt(v));
                }}
                sx={{ width: 130 }}
                SelectProps={{ native: true }}
              >
                <option value="100">100</option>
                <option value="500">500</option>
                <option value="1000">1,000</option>
                <option value="5000">5,000</option>
                <option value="10000">10,000</option>
                <option value="50000">50,000</option>
                <option value="100000">100,000</option>
                <option value="none">No Limit</option>
                {limit !== null && ![100, 500, 1000, 5000, 10000, 50000, 100000].includes(limit) && (
                  <option value="custom">{limit.toLocaleString()}</option>
                )}
              </TextField>
            </Box>

            {/* Cross-connection toggle */}
            <Tooltip title={showCrossConn ? 'Remove secondary source' : 'Union or Join with a file from another connection'}>
              <Button
                size="small"
                variant={showCrossConn ? 'contained' : 'outlined'}
                color={showCrossConn ? 'warning' : 'inherit'}
                startIcon={<JoinIcon />}
                onClick={() => setShowCrossConn(v => !v)}
                sx={{ fontSize: 12 }}
              >
                {showCrossConn ? 'Cross-Conn ✓' : 'Union / Join'}
              </Button>
            </Tooltip>

            <Box sx={{ flexGrow: 1 }} />

            <Tooltip title={queryMode === 'sql' ? 'Switch to visual query builder' : 'Switch to SQL editor'}>
              <ButtonGroup size="small" variant="outlined">
                <Button
                  onClick={() => setQueryMode('visual')}
                  variant={queryMode === 'visual' ? 'contained' : 'outlined'}
                  color={queryMode === 'visual' ? 'primary' : 'inherit'}
                  sx={{ textTransform: 'none', px: 1.5 }}
                >
                  Visual
                </Button>
                <Button
                  startIcon={sqlLoading ? <CircularProgress size={12} /> : <CodeIcon />}
                  onClick={switchToSqlMode}
                  variant={queryMode === 'sql' ? 'contained' : 'outlined'}
                  color={queryMode === 'sql' ? 'primary' : 'inherit'}
                  sx={{ textTransform: 'none', px: 1.5 }}
                >
                  SQL
                </Button>
              </ButtonGroup>
            </Tooltip>

            <Button
              variant="outlined"
              size="small"
              startIcon={<SaveIcon />}
              onClick={() => setShowSaveDialog(true)}
              disabled={selectedTables.length === 0}
            >
              Save Query
            </Button>

            {/* Phase 122C: Save/Load .sql file — works in both visual and SQL mode */}
            <Button
              variant="outlined"
              size="small"
              startIcon={<SaveIcon />}
              onClick={async () => {
                let sqlToSave = rawSql;
                // In visual mode, generate SQL from query config first
                if (queryMode !== 'sql') {
                  if (selectedTables.length === 0) { addNotification('warning', 'Select a table first'); return; }
                  try {
                    const response = await api.previewSql({
                      query_config: buildQueryConfigObject(),
                      ...(selectedConnectionId ? { connection_id: selectedConnectionId } : {}),
                    });
                    sqlToSave = response?.sql || '';
                  } catch {
                    addNotification('error', 'Could not generate SQL from visual config');
                    return;
                  }
                }
                if (!sqlToSave.trim()) { addNotification('warning', 'No SQL to save'); return; }
                const name = prompt('SQL file name:', 'query.sql');
                if (!name) return;
                try {
                  const savePayload: any = {
                    name,
                    sql: sqlToSave,
                    connection_id: selectedConnectionId || undefined,
                  };
                  // Phase 124-D: Include cross-connection metadata
                  if (showCrossConn && crossConnId) {
                    savePayload.secondary_connection_id = crossConnId;
                    savePayload.secondary_sql = secondaryRawSql || undefined;
                    savePayload.combine_mode = crossConnMode;
                    if (crossConnMode === 'join' && crossJoinLeftOn.length > 0) {
                      savePayload.join_config = {
                        how: crossJoinHow,
                        left_on: crossJoinLeftOn,
                        right_on: crossJoinRightOn,
                      };
                    }
                  }
                  await api.sqlFiles.create(savePayload);
                  addNotification('success', `Saved as ${name}`);
                } catch (err: any) {
                  addNotification('error', err?.message || 'Failed to save .sql file');
                }
              }}
              disabled={queryMode === 'sql' ? !rawSql.trim() : selectedTables.length === 0}
              sx={{ fontSize: 12 }}
            >
              Save .sql
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={async () => {
                try {
                  const files = await api.sqlFiles.list({
                    connection_id: selectedConnectionId || undefined,
                    limit: 50,
                  });
                  if (!files?.length) { addNotification('info', 'No .sql files found'); return; }
                  const names = files.map((f: any) => `${f.id}: ${f.name}`).join('\n');
                  const choice = prompt(`Select file ID:\n${names}`);
                  if (!choice) return;
                  const fid = parseInt(choice, 10);
                  if (isNaN(fid)) return;
                  const file = await api.sqlFiles.get(fid);
                  if (file?.content) {
                    setRawSql(file.content);
                    // Switch to SQL mode so user can see the loaded SQL
                    if (queryMode !== 'sql') setQueryMode('sql');
                    // Phase 124-D: Restore cross-connection state
                    if (file.secondary_connection_id && file.secondary_content) {
                      setShowCrossConn(true);
                      setCrossConnId(file.secondary_connection_id as any);
                      setSecondaryRawSql(file.secondary_content);
                      if (file.combine_mode) setCrossConnMode(file.combine_mode);
                      if (file.join_config) {
                        const jc = file.join_config as any;
                        if (jc.how) setCrossJoinHow(jc.how);
                        if (jc.left_on?.length) setCrossJoinLeftOn(jc.left_on);
                        if (jc.right_on?.length) setCrossJoinRightOn(jc.right_on);
                      }
                    }
                    addNotification('success', `Loaded: ${file.name}`);
                  }
                } catch (err: any) {
                  addNotification('error', err?.message || 'Failed to load .sql file');
                }
              }}
              sx={{ fontSize: 12 }}
            >
              Load .sql
            </Button>

            {/* Phase 85C-2: Publish as API — visible when a query is saved */}
            {editingQueryId && (
              <Tooltip title="Publish this query as an external API endpoint">
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<PublishApiIcon />}
                  onClick={() => setPublishApiDialogOpen(true)}
                  color="secondary"
                  sx={{ fontSize: 12 }}
                >
                  Publish API
                </Button>
              </Tooltip>
            )}

            {/* Cache strategy selector */}
            <Tooltip title={
              cacheStrategy === 'auto' ? 'Use cache (click to change)' :
              cacheStrategy === 'bypass' ? 'Skip all caches — fresh S3 + Iceberg scan (click to change)' :
              'Refresh cache — fresh + store (click to change)'
            }>
              <IconButton
                size="small"
                onClick={(e) => setCacheMenuAnchor(e.currentTarget)}
                sx={{
                  color: cacheStrategy === 'auto' ? 'text.secondary' : cacheStrategy === 'bypass' ? 'warning.main' : 'success.main',
                  border: '1px solid',
                  borderColor: cacheStrategy === 'auto' ? 'divider' : cacheStrategy === 'bypass' ? 'warning.main' : 'success.main',
                  borderRadius: 1,
                }}
              >
                {cacheStrategy === 'auto' ? <CachedIcon fontSize="small" /> :
                 cacheStrategy === 'bypass' ? <CloudOffIcon fontSize="small" /> :
                 <CloudSyncIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
            <Menu anchorEl={cacheMenuAnchor} open={!!cacheMenuAnchor} onClose={() => setCacheMenuAnchor(null)}>
              <MenuItem selected={cacheStrategy === 'auto'} onClick={() => { setCacheStrategy('auto'); setCacheMenuAnchor(null); }}>
                <CachedIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />
                Use cache
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>serve cached result if available</Typography>
              </MenuItem>
              <MenuItem selected={cacheStrategy === 'bypass'} onClick={() => { setCacheStrategy('bypass'); setCacheMenuAnchor(null); }}>
                <CloudOffIcon fontSize="small" sx={{ mr: 1, color: 'warning.main' }} />
                Skip cache
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>fresh data from S3, bypass all caches</Typography>
              </MenuItem>
              <MenuItem selected={cacheStrategy === 'refresh'} onClick={() => { setCacheStrategy('refresh'); setCacheMenuAnchor(null); }}>
                <CloudSyncIcon fontSize="small" sx={{ mr: 1, color: 'success.main' }} />
                Refresh cache
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>query fresh and update cache</Typography>
              </MenuItem>
            </Menu>

            {/* Phase 96: Guardrail warning chips */}
            {guardrailWarnings.blocked && (
              <Tooltip title={guardrailWarnings.blockedReason}>
                <Chip icon={<WarningIcon />} label="Blocked" size="small" color="error" variant="filled" sx={{ fontWeight: 600 }} />
              </Tooltip>
            )}
            {!guardrailWarnings.blocked && guardrailWarnings.warnings.length > 0 && (
              <Tooltip title={guardrailWarnings.warnings.join(' · ')}>
                <Chip icon={<WarningIcon />} label={`${guardrailWarnings.warnings.length} warning${guardrailWarnings.warnings.length > 1 ? 's' : ''}`} size="small" color="warning" variant="outlined" />
              </Tooltip>
            )}

            <Button
              variant="contained"
              color={guardrailWarnings.blocked ? 'error' : 'success'}
              size="small"
              startIcon={executing ? <CircularProgress size={16} color="inherit" /> : <PlayIcon />}
              onClick={executeQuery}
              disabled={(queryMode !== 'sql' && selectedTables.length === 0) || executing || loadingPartitions.size > 0 || guardrailWarnings.blocked}
              sx={{ fontWeight: 700, minWidth: 120 }}
            >
              {executing ? 'Running...' : loadingPartitions.size > 0 ? 'Loading Partitions...' : guardrailWarnings.blocked ? 'Blocked' : 'Execute'}
            </Button>

            {/* Streaming toggle — only for S3 connections */}
            {(() => {
              const conn = connections.find((c: any) => c.id === selectedConnectionId);
              return conn?.connection_type === 's3' && appSettings.features.streaming_enabled ? (
                <>
                  <Tooltip title={enableStreaming
                    ? 'Streaming ON — preview data from S3 while query runs. Choose columns to stream.'
                    : 'Streaming OFF — wait for full query to complete, all columns returned.'
                  }>
                    <Chip
                      icon={<StreamIcon sx={{ fontSize: 16 }} />}
                      label="Stream"
                      size="small"
                      variant={enableStreaming ? 'filled' : 'outlined'}
                      color={enableStreaming ? 'info' : 'default'}
                      onClick={() => setEnableStreaming(!enableStreaming)}
                      sx={{ cursor: 'pointer', fontWeight: enableStreaming ? 700 : 400 }}
                    />
                  </Tooltip>
                  {enableStreaming && appSettings.features.streaming_mode !== 'stream_only' && (
                    <Tooltip title={streamBgDownload
                      ? 'Download ON — also downloads full results to local file in background (for export/history).'
                      : 'Download OFF — stream only, no local file created. Faster, saves disk space.'
                    }>
                      <Chip
                        icon={<CloudDownloadIcon sx={{ fontSize: 16 }} />}
                        label="Download"
                        size="small"
                        variant={streamBgDownload ? 'filled' : 'outlined'}
                        color={streamBgDownload ? 'warning' : 'default'}
                        onClick={() => setStreamBgDownload(!streamBgDownload)}
                        sx={{ cursor: 'pointer', fontWeight: streamBgDownload ? 700 : 400 }}
                      />
                    </Tooltip>
                  )}
                </>
              ) : null;
            })()}
            {/* Cost estimate chip */}
            {estimating && (
              <Chip size="small" label="Estimating..." variant="outlined"
                sx={{ fontSize: 11, height: 24 }} />
            )}
            {!estimating && costEstimate && costEstimate.estimated_rows >= 0 && (
              <Chip
                size="small"
                variant="outlined"
                color={costEstimate.estimated_rows > 50_000_000 ? 'error' : costEstimate.estimated_rows > 10_000_000 ? 'warning' : 'default'}
                label={`~${costEstimate.estimated_rows.toLocaleString()} rows · ${costEstimate.estimated_files} file${costEstimate.estimated_files !== 1 ? 's' : ''}`}
                sx={{ fontSize: 11, height: 24, fontWeight: 600 }}
              />
            )}
          </Box>

          {/* Row 2b: Cross-Connection UNION / JOIN panel */}
          {showCrossConn && (
            <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'warning.50', borderColor: 'warning.300' }}>
              {/* Phase 85B: Help text explaining UNION vs JOIN */}
              <Alert severity="info" sx={{ mb: 1.5, py: 0.5, '& .MuiAlert-message': { py: 0.5 } }}>
                <strong>UNION ALL</strong> — Stacks rows from both tables (same columns required).&nbsp;
                <strong>JOIN</strong> — Combines columns from both tables on a matching key column.
              </Alert>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <JoinIcon sx={{ fontSize: 16, color: 'warning.main', flexShrink: 0 }} />
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'warning.dark', whiteSpace: 'nowrap' }}>
                  CROSS-CONNECTION
                </Typography>

                {/* Mode: UNION or JOIN */}
                <TextField
                  select size="small" label="Mode"
                  value={crossConnMode}
                  onChange={e => setCrossConnMode(e.target.value)}
                  sx={{ minWidth: 100 }}
                >
                  <MenuItem value="union">UNION (stack rows)</MenuItem>
                  <MenuItem value="join">JOIN (merge by key)</MenuItem>
                </TextField>

                {/* Secondary connection */}
                <TextField
                  select size="small" label="Secondary Connection"
                  value={crossConnId || ''}
                  onChange={e => { const v = e.target.value ? Number(e.target.value) : null; setCrossConnId(v); loadCrossConnFiles(v); }}
                  sx={{ minWidth: 200 }}
                >
                  <MenuItem value="">— Select —</MenuItem>
                  {connections.map(c => (
                    <MenuItem key={c.id} value={c.id} disabled={c.id === selectedConnectionId}>
                      {c.name} ({c.connection_type})
                    </MenuItem>
                  ))}
                </TextField>

                {/* Secondary file */}
                {crossConnId && (
                  <TextField
                    select size="small" label="Secondary File"
                    value={crossConnFile || ''}
                    onChange={e => setCrossConnFile(e.target.value || null)}
                    sx={{ minWidth: 240 }}
                    disabled={crossConnLoading}
                    InputProps={{ endAdornment: crossConnLoading ? <CircularProgress size={14} /> : null }}
                  >
                    <MenuItem value="">— Select file —</MenuItem>
                    {crossConnFiles.map(f => (
                      <MenuItem key={f.path} value={f.path}>{f.name}{f.folder ? ` (${f.folder})` : ''}</MenuItem>
                    ))}
                  </TextField>
                )}

                {/* JOIN keys */}
                {crossConnMode === 'join' && crossConnId && (
                  <>
                    <TextField
                      select size="small" label="Join Type"
                      value={crossJoinHow}
                      onChange={e => setCrossJoinHow(e.target.value)}
                      sx={{ minWidth: 110 }}
                    >
                      {['inner', 'left', 'right', 'outer'].map(h => (
                        <MenuItem key={h} value={h}>{h.toUpperCase()}</MenuItem>
                      ))}
                    </TextField>
                    <Autocomplete
                      multiple size="small"
                      options={sortedPrimaryColumns}
                      value={crossJoinLeftOn}
                      onChange={(_, v) => setCrossJoinLeftOn(v as string[])}
                      disableCloseOnSelect
                      loading={!primaryColumns.length && selectedTables.length > 0}
                      noOptionsText="No columns available"
                      groupBy={(opt) => suggestedJoinKeys.primary.some(s => s.toLowerCase() === opt.toLowerCase()) ? 'Matching columns' : 'All columns'}
                      renderOption={(props, opt, { selected: optSel }) => (
                        <li {...props} key={opt} style={{ padding: '2px 8px', minHeight: 28 }}>
                          <Checkbox size="small" checked={optSel}
                            sx={{ p: 0.2, mr: 0.5, color: 'text.secondary', '&.Mui-checked': { color: 'success.main' } }} />
                          <Typography sx={{ fontSize: 12, fontFamily: 'monospace' }}>{opt}</Typography>
                          {suggestedJoinKeys.primary.some(s => s.toLowerCase() === opt.toLowerCase()) && (
                            <Chip label="match" size="small" sx={{ ml: 0.5, height: 16, fontSize: 9, bgcolor: 'success.main', color: '#fff' }} />
                          )}
                        </li>
                      )}
                      renderTags={(vals, getTagProps) =>
                        vals.map((v, idx) => (
                          <Chip {...getTagProps({ index: idx })} key={v} label={v} size="small"
                            sx={{ height: 20, fontSize: 11, fontFamily: 'monospace' }} />
                        ))
                      }
                      renderInput={(params) => <TextField {...params} label="Primary key col(s)" placeholder={crossJoinLeftOn.length ? '' : 'Select...'} />}
                      sx={{ minWidth: 220 }}
                    />
                    <Typography variant="caption" color="text.secondary">=</Typography>
                    <Autocomplete
                      multiple size="small"
                      options={sortedSecondaryColumns}
                      value={crossJoinRightOn}
                      onChange={(_, v) => setCrossJoinRightOn(v as string[])}
                      disableCloseOnSelect
                      loading={crossConnSchemaLoading}
                      noOptionsText={crossConnSchemaLoading ? 'Loading schema...' : 'No columns available'}
                      groupBy={(opt) => suggestedJoinKeys.secondary.some(s => s.toLowerCase() === opt.toLowerCase()) ? 'Matching columns' : 'All columns'}
                      renderOption={(props, opt, { selected: optSel }) => (
                        <li {...props} key={opt} style={{ padding: '2px 8px', minHeight: 28 }}>
                          <Checkbox size="small" checked={optSel}
                            sx={{ p: 0.2, mr: 0.5, color: 'text.secondary', '&.Mui-checked': { color: 'success.main' } }} />
                          <Typography sx={{ fontSize: 12, fontFamily: 'monospace' }}>{opt}</Typography>
                          {suggestedJoinKeys.secondary.some(s => s.toLowerCase() === opt.toLowerCase()) && (
                            <Chip label="match" size="small" sx={{ ml: 0.5, height: 16, fontSize: 9, bgcolor: 'success.main', color: '#fff' }} />
                          )}
                        </li>
                      )}
                      renderTags={(vals, getTagProps) =>
                        vals.map((v, idx) => (
                          <Chip {...getTagProps({ index: idx })} key={v} label={v} size="small"
                            sx={{ height: 20, fontSize: 11, fontFamily: 'monospace' }} />
                        ))
                      }
                      renderInput={(params) => <TextField {...params} label="Secondary key col(s)" placeholder={crossJoinRightOn.length ? '' : 'Select...'} />}
                      sx={{ minWidth: 220 }}
                    />
                    {/* Auto-suggest join keys button */}
                    {suggestedJoinKeys.primary.length > 0 && crossJoinLeftOn.length === 0 && (
                      <Tooltip title={`Auto-fill: ${suggestedJoinKeys.primary.join(', ')}`}>
                        <Button
                          size="small" variant="outlined" color="success"
                          onClick={() => {
                            setCrossJoinLeftOn(suggestedJoinKeys.primary);
                            setCrossJoinRightOn(suggestedJoinKeys.secondary);
                          }}
                          sx={{ textTransform: 'none', fontSize: 11, py: 0.25, minWidth: 0 }}
                        >
                          Auto-fill ({suggestedJoinKeys.primary.length})
                        </Button>
                      </Tooltip>
                    )}
                  </>
                )}

                {crossConnFile && (
                  <Chip
                    size="small"
                    color="warning"
                    label={`${crossConnMode.toUpperCase()} ready`}
                    sx={{ fontSize: 11 }}
                  />
                )}

                {/* Phase 85B: Preview Join button */}
                {crossConnFile && crossConnMode === 'join' && crossJoinLeftOn.length > 0 && crossJoinRightOn.length > 0 && (
                  <Tooltip title="Preview the first 5 rows of the join result">
                    <Button
                      size="small"
                      variant="outlined"
                      color="primary"
                      startIcon={crossJoinPreviewLoading ? <CircularProgress size={12} /> : <PreviewIcon />}
                      onClick={handleCrossJoinPreview}
                      disabled={crossJoinPreviewLoading}
                      sx={{ fontSize: 11, py: 0.25 }}
                    >
                      Preview Join (5 rows)
                    </Button>
                  </Tooltip>
                )}
              </Box>

              {/* ── Secondary Partition Filters ─────────────────── */}
              {crossConnFile && crossConnPartitionData?.partition_columns?.length > 0 && (
                <Box sx={{ mt: 1, px: 1.5, pb: 1 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: '#94a3b8', mb: 0.5, display: 'block' }}>
                    Secondary Partition Filters
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'flex-start' }}>
                    {crossConnPartitionData.partition_columns.map((pc: any) => {
                      const allVals: string[] = crossConnPartitionData.values?.[pc.name] || [];
                      const counts = crossConnPartitionData.file_counts?.[pc.name] || {};
                      const selected: string[] = crossConnSelectedPartitions[pc.name] || [];
                      const label = pc.source_column || pc.name;

                      // BF-51: Cascading — filter dropdown options based on other
                      // selected partition values using the combos array (same logic
                      // as primary partition cascading at lines ~2295-2326).
                      const combosAll: Record<string, string>[] = crossConnPartitionData.combos || [];
                      let availableSet: Set<string> | null = null;
                      if (combosAll.length > 0) {
                        const otherFilters: [string, string[]][] = [];
                        for (const opc of crossConnPartitionData.partition_columns) {
                          if (opc.name !== pc.name) {
                            const oSel = crossConnSelectedPartitions[opc.name] || [];
                            if (oSel.length > 0) otherFilters.push([opc.name, oSel]);
                          }
                        }
                        if (otherFilters.length > 0) {
                          const matching = combosAll.filter((c: any) =>
                            otherFilters.every(([col, vals]) => {
                              const cv = c[col];
                              return cv === undefined || cv === null || vals.includes(cv);
                            })
                          );
                          const candidates = new Set(
                            matching.map((c: any) => c[pc.name]).filter((v: any) => v !== undefined && v !== null && v !== '')
                          );
                          availableSet = candidates.size > 0 ? candidates : null;
                        }
                      }
                      const dropdownOptions = availableSet
                        ? allVals.filter(v => availableSet!.has(v) || selected.includes(v))
                        : allVals;

                      return (
                        <Autocomplete
                          key={pc.name}
                          multiple size="small"
                          options={dropdownOptions}
                          value={selected}
                          onChange={(_e, newVal) => {
                            setCrossConnSelectedPartitions(prev => ({
                              ...prev,
                              [pc.name]: newVal as string[],
                            }));
                          }}
                          disableCloseOnSelect
                          getOptionLabel={(v) => v}
                          renderOption={(props, v, { selected: optSel }) => {
                            const fileCount = counts[v] || 0;
                            const isAvailable = !availableSet || availableSet.has(v);
                            return (
                              <li {...props} key={v} style={{ padding: '2px 8px', minHeight: 28,
                                opacity: isAvailable ? 1 : 0.45 }}>
                                <Checkbox size="small" checked={optSel}
                                  sx={{ p: 0.2, mr: 0.5, color: 'text.secondary', '&.Mui-checked': { color: 'success.main' } }} />
                                <Typography sx={{ fontSize: 11, fontFamily: 'monospace', flex: 1 }}>{v}</Typography>
                                {fileCount > 0 && (
                                  <Typography sx={{ fontSize: 9, color: '#94a3b8', ml: 0.5 }}>{fileCount}f</Typography>
                                )}
                              </li>
                            );
                          }}
                          renderTags={(vals, getTagProps) =>
                            vals.map((v, idx) => (
                              <Chip {...getTagProps({ index: idx })} key={v} label={v} size="small"
                                sx={{ height: 18, fontSize: 10, fontFamily: 'monospace' }} />
                            ))
                          }
                          renderInput={(params) => (
                            <TextField {...params} label={label} placeholder={selected.length ? '' : 'All'}
                              size="small" sx={{ minWidth: 160 }} />
                          )}
                          sx={{ minWidth: 180, maxWidth: 300 }}
                        />
                      );
                    })}
                    {Object.values(crossConnSelectedPartitions).some(v => v.length > 0) && (
                      <Button
                        size="small" variant="text" color="inherit"
                        onClick={() => setCrossConnSelectedPartitions({})}
                        sx={{ textTransform: 'none', fontSize: 11, color: '#94a3b8' }}
                      >
                        Clear all
                      </Button>
                    )}
                  </Box>
                </Box>
              )}
            </Paper>
          )}

          {/* Row 3: Query summary + execution progress */}
          {(selectedTables.length > 0 || executing) && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', minHeight: 28 }}>
              {selectedTables.length > 0 && (
                <Typography variant="body2" color="text.secondary">
                  <strong>FROM</strong> {joins.length > 0
                    ? `${selectedTables[0].name} + ${joins.length} join(s)`
                    : selectedTables.length > 1
                      ? `${selectedTables.length} tables (UNION ALL)`
                      : selectedTables[0].name}
                  {selectedColumns.length > 0 && ` · ${selectedColumns.length} column(s) selected`}
                  {filters.length > 0 && ` · ${filters.length} filter(s)`}
                </Typography>
              )}
              {executing && (
                <>
                  <LinearProgress sx={{ flex: 1, minWidth: 80, maxWidth: 240 }} />
                  <Typography variant="caption" color="primary.main" sx={{ fontWeight: 500 }}>
                    {progress?.status === 'starting'
                      ? 'Starting...'
                      : `${(progress?.rows || 0).toLocaleString()} rows · ${fmtSecs(elapsed)}`}
                  </Typography>
                  {etaSeconds != null && elapsed < etaSeconds && (
                    <Typography variant="caption" color="text.secondary">
                      ~{fmtSecs(Math.max(1, Math.round(etaSeconds - elapsed)))} left
                    </Typography>
                  )}
                  <Button size="small" variant="text" color="error" onClick={cancelQuery}
                    sx={{ textTransform: 'none', py: 0 }}>Cancel</Button>
                </>
              )}
              {!executing && progress?.status === 'completed' && (
                <Typography variant="caption" color="success.main" sx={{ fontWeight: 600 }}>
                  Done in {fmtSecs(progress.elapsed ?? 0)} · {(progress.rows || 0).toLocaleString()} rows
                </Typography>
              )}
              {!executing && streamingSource && (
                <Button size="small" variant="text" color="error" onClick={() => {
                  setStreamingSource(null);
                  setShowResults(false);
                  addNotification({ type: 'info', title: 'Stopped', message: 'Streaming cancelled' });
                }}
                  sx={{ textTransform: 'none', py: 0 }}>Cancel Streaming</Button>
              )}
            </Box>
          )}

          {/* Stale-result warning */}
          {progress?.stale_warning && (
            <Alert severity="warning" sx={{ py: 0.4, fontSize: '0.8rem' }}
              onClose={() => setProgress((p: any) => p ? { ...p, stale_warning: null } : p)}>
              <strong>Showing cached result</strong> — {progress.stale_warning}
            </Alert>
          )}

          {/* Error alert */}
          {progress?.status === 'failed' && (
            <Alert severity="error" onClose={() => setProgress(null)} sx={{ py: 0.5 }}>
              <strong>Query failed:</strong> {progress.error}
            </Alert>
          )}

        </Box>

        {/* ─── Results / SQL editor area ─────────────────────────────────── */}
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', p: 1 }}>
          {queryMode === 'sql' ? (
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1, flex: showResults ? '0 0 42%' : 1, minHeight: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CodeIcon fontSize="small" color="primary" />
                  <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 0.5 }}>SQL EDITOR</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                    — type or paste SQL, then Execute
                  </Typography>
                  <Box sx={{ flexGrow: 1 }} />
                  <Tooltip title="Regenerate SQL from current visual builder state">
                    <span>
                      <Button size="small" variant="text" onClick={switchToSqlMode}
                        disabled={sqlLoading || selectedTables.length === 0}
                        startIcon={sqlLoading ? <CircularProgress size={12} /> : <RefreshIcon />}
                        sx={{ textTransform: 'none', py: 0 }}
                      >
                        Refresh
                      </Button>
                    </span>
                  </Tooltip>
                </Box>
                {/* Available tables reference — click to insert into SQL */}
                {registeredTables.length > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', px: 0.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, fontWeight: 600, mr: 0.5 }}>
                      Tables:
                    </Typography>
                    {registeredTables.map((rt: any) => (
                      <Chip
                        key={rt.name}
                        label={`"${rt.name}"`}
                        size="small"
                        variant="outlined"
                        color={rt.format === 'iceberg' ? 'primary' : 'default'}
                        onClick={() => setRawSql(prev => prev + `"${rt.name}"`)}
                        sx={{ height: 20, fontSize: 11, fontFamily: 'monospace', cursor: 'pointer',
                              '&:hover': { bgcolor: 'primary.50' } }}
                      />
                    ))}
                  </Box>
                )}
                <TextField
                  multiline
                  fullWidth
                  value={rawSql}
                  onChange={e => setRawSql(e.target.value)}
                  placeholder={registeredTables.length > 0
                    ? `-- Example: SELECT * FROM "${registeredTables[0]?.name || 'table_name'}" LIMIT 100`
                    : '-- Write or paste your SQL here...'}
                  sx={{ flex: 1, '& .MuiInputBase-root': { fontFamily: 'monospace', fontSize: 13, alignItems: 'flex-start', height: '100%' }, '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6 } }}
                  inputProps={{ spellCheck: false }}
                />
                {/* Phase 124-D: Secondary SQL editor for cross-connection SQL mode */}
                {showCrossConn && (
                  <>
                    <Box sx={{ px: 1, py: 0.5, bgcolor: 'warning.50', borderTop: '1px dashed', borderColor: 'warning.main', display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, color: 'warning.dark', fontSize: 11 }}>
                        SECONDARY SQL ({crossConnMode.toUpperCase()})
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>
                        Runs against the secondary connection
                      </Typography>
                    </Box>
                    <TextField
                      multiline
                      fullWidth
                      value={secondaryRawSql}
                      onChange={e => setSecondaryRawSql(e.target.value)}
                      placeholder="-- Secondary connection SQL..."
                      sx={{ flex: 1, '& .MuiInputBase-root': { fontFamily: 'monospace', fontSize: 13, alignItems: 'flex-start', minHeight: 100 }, '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6 } }}
                      inputProps={{ spellCheck: false }}
                    />
                  </>
                )}
              </Paper>

              {/* Phase 86: Parameter Panel — shown when SQL contains {{param}} placeholders */}
              {queryMode === 'sql' && detectedParams.length > 0 && (
                <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'info.light', borderRadius: 1, mx: 0.5, mt: 0.5, flexShrink: 0, overflow: 'hidden' }}>
                  <Box sx={{ px: 1.5, py: 0.75, bgcolor: 'info.50', borderBottom: '1px solid', borderColor: 'info.light', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: 'info.dark', fontSize: 12 }}>
                      Parameters ({detectedParams.length}) — fill test values below
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11 }}>
                      Values are used when running the query. Types and defaults are saved with the query.
                    </Typography>
                  </Box>
                  <Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                    {detectedParams.map((p, idx) => (
                      <Box key={p.name} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'primary.main', fontSize: 12, minWidth: 80, pt: 1 }}>
                          {`{{${p.name}}}`}
                        </Typography>
                        <TextField
                          select
                          size="small"
                          label="Type"
                          value={p.type}
                          onChange={e => setDetectedParams(prev => prev.map((dp, i) => i === idx ? { ...dp, type: e.target.value as any } : dp))}
                          sx={{ width: 90 }}
                          SelectProps={{ native: false }}
                        >
                          {['string', 'integer', 'float', 'boolean', 'date'].map(t => (
                            <MenuItem key={t} value={t}>{t}</MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          size="small"
                          label="Default"
                          value={p.default ?? ''}
                          onChange={e => setDetectedParams(prev => prev.map((dp, i) => i === idx ? { ...dp, default: e.target.value || null } : dp))}
                          sx={{ width: 110 }}
                          placeholder="optional"
                        />
                        <FormControlLabel
                          control={<Checkbox size="small" checked={p.required} onChange={e => setDetectedParams(prev => prev.map((dp, i) => i === idx ? { ...dp, required: e.target.checked } : dp))} />}
                          label={<Typography variant="caption">Required</Typography>}
                          sx={{ m: 0 }}
                        />
                        <TextField
                          size="small"
                          label={`Test value for ${p.name}`}
                          value={paramTestValues[p.name] || ''}
                          onChange={e => setParamTestValues(prev => ({ ...prev, [p.name]: e.target.value }))}
                          sx={{ flex: 1, minWidth: 120, '& .MuiInputBase-root': { bgcolor: 'warning.50' } }}
                          placeholder={p.default ?? p.type}
                        />
                      </Box>
                    ))}
                  </Box>
                </Paper>
              )}

              {streamSchemaLoading && (
                <Paper elevation={0} sx={{ p: 1, display: 'flex', alignItems: 'center', gap: 1.5, bgcolor: '#fff3e0', border: '1px solid #ffb74d', borderRadius: 1, mx: 0.5, mt: 0.5, flexShrink: 0 }}>
                  <CircularProgress size={16} thickness={5} sx={{ color: '#e65100' }} />
                  <Typography variant="body2" sx={{ fontWeight: 600, color: '#e65100', fontSize: '12px' }}>
                    Discovering columns from S3...
                  </Typography>
                </Paper>
              )}
              {showResults && (streamingSource || resultsExecutionId) ? (
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
                  {streamingSource && executing && (
                    <Paper elevation={0} sx={(theme) => ({ p: 1, display: 'flex', alignItems: 'center', gap: 1.5, bgcolor: alpha(theme.palette.primary.main, 0.08), border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`, borderRadius: 1, mx: 0.5, mt: 0.5, flexShrink: 0 })}>
                      <CircularProgress size={16} thickness={5} sx={{ color: 'primary.main' }} />
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 600, color: 'primary.dark', fontSize: '12px' }}>
                          Streaming from S3 — query is being processed
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'primary.main', fontSize: '11px' }}>
                          You can paginate, sort, and filter while results are loading.
                        </Typography>
                      </Box>
                    </Paper>
                  )}
                  <Box sx={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                    <DataGridViewer
                      key={resultKey}
                      executionId={resultsExecutionId}
                      streamingSource={streamingSource}
                      partitionColumns={activePartitionColumns}
                      initialFileStats={fileStats}
                      embedded
                      onClose={() => { setShowResults(false); setResultsExecutionId(null); setStreamingSource(null); setIsStale(false); }}
                    />
                  </Box>
                </Box>
              ) : isStale && resultsExecutionId ? (
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, color: 'text.secondary', userSelect: 'none' }}>
                  <CachedIcon sx={{ fontSize: '3rem', opacity: 0.15 }} />
                  <Typography variant="body1" sx={{ fontWeight: 600, opacity: 0.5 }}>Results available</Typography>
                  <Typography variant="body2" sx={{ opacity: 0.4 }}>This tab was idle — click to reload</Typography>
                  <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={() => { setIsStale(false); setShowResults(true); }} sx={{ mt: 1 }}>
                    Load Results
                  </Button>
                </Box>
              ) : null}
            </Box>
          ) : streamSchemaLoading ? (
            <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Paper elevation={0} sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.5, bgcolor: '#fff3e0', border: '1px solid #ffb74d', borderRadius: 1 }}>
                <CircularProgress size={20} thickness={5} sx={{ color: '#e65100' }} />
                <Typography variant="body2" sx={{ fontWeight: 600, color: '#e65100' }}>
                  Discovering columns from S3...
                </Typography>
              </Paper>
            </Box>
          ) : showResults && (streamingSource || resultsExecutionId) ? (
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              {streamingSource && executing && (
                <Paper elevation={0} sx={(theme) => ({ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, bgcolor: alpha(theme.palette.primary.main, 0.08), border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`, borderRadius: 1, mx: 1, mt: 1 })}>
                  <CircularProgress size={18} thickness={5} sx={{ color: 'primary.main' }} />
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: 'primary.dark' }}>
                      Streaming from S3 — query is being processed
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'primary.main' }}>
                      You can paginate, sort, and filter while results are loading.
                    </Typography>
                  </Box>
                </Paper>
              )}
              <Box sx={{ flex: 1, overflow: 'hidden' }}>
                <DataGridViewer
                  key={resultKey}
                  executionId={resultsExecutionId}
                  streamingSource={streamingSource}
                  partitionColumns={activePartitionColumns}
                  initialFileStats={fileStats}
                  onClose={() => { setShowResults(false); setResultsExecutionId(null); setStreamingSource(null); setIsStale(false); }}
                />
              </Box>
            </Box>
          ) : isStale && resultsExecutionId ? (
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, color: 'text.secondary', userSelect: 'none' }}>
              <CachedIcon sx={{ fontSize: '4rem', opacity: 0.15 }} />
              <Typography variant="h6" sx={{ fontWeight: 600, opacity: 0.5 }}>
                Results available
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.4 }}>
                This tab was idle — click below to reload
              </Typography>
              <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => { setIsStale(false); setShowResults(true); }} sx={{ mt: 1 }}>
                Load Results
              </Button>
            </Box>
          ) : (
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, color: 'text.secondary', userSelect: 'none' }}>
              <TableIcon sx={{ fontSize: '5rem', opacity: 0.08 }} />
              <Typography variant="h5" sx={{ fontWeight: 600, opacity: 0.4 }}>
                {selectedTables.length === 0 ? 'Click a table in the sidebar to get started' : 'Run the query to see results'}
              </Typography>
              {selectedTables.length > 0 && !executing && loadingPartitions.size === 0 && (
                <Button variant="contained" size="large" startIcon={<PlayIcon />} onClick={executeQuery} sx={{ mt: 1 }}>
                  Execute Query
                </Button>
              )}
            </Box>
          )}
        </Box>
      </Box>

      {/* ─── Modals ──────────────────────────────────────────────────────────── */}
      <TableSelectorModal
        open={showTableSelector}
        files={allFiles}
        selectedTables={selectedTables}
        onUpdate={setSelectedTables}
        onClose={() => setShowTableSelector(false)}
      />
      <JoinBuilderModal
        open={showJoinBuilder}
        tables={selectedTables}
        schemas={tableSchemas}
        joins={joins}
        onUpdate={setJoins}
        onClose={() => setShowJoinBuilder(false)}
        connectionId={selectedConnectionId}
      />
      <ColumnSelectorModal
        open={showColumnSelector}
        tables={selectedTables}
        schemas={tableSchemas}
        selectedColumns={selectedColumns}
        onUpdate={setSelectedColumns}
        onClose={() => setShowColumnSelector(false)}
      />
      <StreamingColumnSelectorDialog
        open={streamColSelectorOpen}
        columns={streamSchema?.columns || []}
        estimatedRows={streamSchema?.estimated_rows ?? -1}
        selectedCols={streamSelectedCols}
        onSelectCols={setStreamSelectedCols}
        onConfirm={handleStreamColumnsConfirmed}
        onCancel={handleStreamColSelectorCancel}
      />
      <FilterBuilderModal
        open={showFilterBuilder}
        tables={selectedTables}
        schemas={tableSchemas}
        filters={filters}
        filterLogic={filterLogic}
        onFilterLogicChange={setFilterLogic}
        onUpdate={setFilters}
        onClose={() => setShowFilterBuilder(false)}
      />
      <AggregationBuilderModal
        open={showAggBuilder}
        tables={selectedTables}
        schemas={tableSchemas}
        selectedColumns={selectedColumns}
        aggregations={aggregations}
        onUpdate={setAggregations}
        onClose={() => setShowAggBuilder(false)}
        connectionId={selectedConnectionId}
      />
      <HavingBuilderModal
        open={showHavingBuilder}
        aggregations={aggregations}
        tables={selectedTables}
        schemas={tableSchemas}
        having={having}
        onUpdate={setHaving}
        onClose={() => setShowHavingBuilder(false)}
      />
      <ComputedColumnBuilderModal
        open={showComputedBuilder}
        tables={selectedTables}
        schemas={tableSchemas}
        computedColumns={computedColumns}
        onUpdate={setComputedColumns}
        onClose={() => setShowComputedBuilder(false)}
      />
      <CaseExpressionBuilderModal
        open={showCaseBuilder}
        tables={selectedTables}
        schemas={tableSchemas}
        caseExpressions={caseExpressions}
        onUpdate={setCaseExpressions}
        onClose={() => setShowCaseBuilder(false)}
      />
      <WindowFunctionBuilderModal
        open={showWindowBuilder}
        tables={selectedTables}
        schemas={tableSchemas}
        windowFunctions={windowFunctions}
        onUpdate={setWindowFunctions}
        onClose={() => setShowWindowBuilder(false)}
      />
      <SaveQueryModal
        open={showSaveDialog}
        queryConfig={buildQueryConfigObject()}
        sqlPreview={sqlPreview}
        editingQueryId={editingQueryId}
        editingQueryName={editingQueryName}
        paramDefinitions={queryMode === 'sql' ? detectedParams : []}
        onClose={() => setShowSaveDialog(false)}
        onSaved={(id, name) => { setEditingQueryId(id); setEditingQueryName(name); onDirtyChange?.(false); onNameChange?.(name); }}
      />

      {/* ── Table Context Menu (right-click) ─────────────────────────────── */}
      <Menu
        open={!!tableContextMenu}
        onClose={() => setTableContextMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={tableContextMenu?.anchorPosition}
      >
        <MenuItem onClick={() => {
          const item = tableContextMenu?.item;
          setTableContextMenu(null);
          if (!item) return;
          setPreviewLoading(true);
          setPreviewDialogOpen(true);
          setPreviewData(null);
          api.previewTable({ table_path: item._path, connection_id: selectedConnectionId || undefined, limit: 100 })
            .then((res: any) => setPreviewData(res))
            .catch((e: any) => setPreviewData({ error: e.message || 'Preview failed' }))
            .finally(() => setPreviewLoading(false));
        }}>
          <ListItemIcon><PreviewIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Preview (100 rows)</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => {
          const item = tableContextMenu?.item;
          setTableContextMenu(null);
          if (!item) return;
          setProfileLoading(true);
          setProfileDialogOpen(true);
          setProfileData(null);
          api.profileTable({ table_path: item._path, connection_id: selectedConnectionId || undefined })
            .then((res: any) => setProfileData(res))
            .catch((e: any) => setProfileData({ error: e.message || 'Profile failed' }))
            .finally(() => setProfileLoading(false));
        }}>
          <ListItemIcon><AssessmentIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Column Profile</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => {
          const item = tableContextMenu?.item;
          setTableContextMenu(null);
          if (!item) return;
          toggleTable({ path: item._path, name: item.name, key: item._path });
        }}>
          <ListItemIcon><AddIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Add to Query</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => {
          const item = tableContextMenu?.item;
          setTableContextMenu(null);
          if (!item) return;
          api.toggleTableFavorite({
            table_path: item._path,
            table_name: item.name,
            connection_id: selectedConnectionId || undefined,
            table_type: item._type,
          }).then((res: any) => {
            setTableFavorites(prev => {
              const next = new Set(prev);
              if (res.favorited) next.add(item._path);
              else next.delete(item._path);
              return next;
            });
          }).catch(() => {});
        }}>
          <ListItemIcon>
            {tableFavorites.has(tableContextMenu?.item?._path) ? <StarIcon fontSize="small" sx={{ color: '#f59e0b' }} /> : <StarBorderIcon fontSize="small" />}
          </ListItemIcon>
          <ListItemText>{tableFavorites.has(tableContextMenu?.item?._path) ? 'Remove Favorite' : 'Add Favorite'}</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => {
          const item = tableContextMenu?.item;
          setTableContextMenu(null);
          if (!item) return;
          navigator.clipboard.writeText(item.name).catch(() => {});
        }}>
          <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Copy Table Name</ListItemText>
        </MenuItem>
      </Menu>

      {/* ── Preview Dialog ────────────────────────────────────────────────── */}
      <Dialog open={previewDialogOpen} onClose={() => setPreviewDialogOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PreviewIcon /> Table Preview
          <Box sx={{ flex: 1 }} />
          <IconButton size="small" onClick={() => setPreviewDialogOpen(false)}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0, maxHeight: '60vh', overflow: 'auto' }}>
          {previewLoading && <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /><Typography sx={{ mt: 1 }}>Loading preview...</Typography></Box>}
          {previewData?.error && <Alert severity="error" sx={{ m: 2 }}>{previewData.error}</Alert>}
          {previewData && !previewData.error && (
            <Box sx={{ overflow: 'auto' }}>
              <Typography variant="caption" sx={{ p: 1, display: 'block', color: 'text.secondary' }}>
                Showing {previewData.rows?.length || 0} of ~{(previewData.total_rows_estimate || 0).toLocaleString()} rows
              </Typography>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ position: 'sticky', top: 0, background: '#f5f5f5' }}>
                    {previewData.columns?.map((col: any, i: number) => (
                      <th key={i} style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '2px solid #ddd', whiteSpace: 'nowrap', fontWeight: 600 }}>
                        {col.name}
                        <Typography component="span" sx={{ fontSize: '0.6rem', ml: 0.5, color: 'text.secondary' }}>({col.type})</Typography>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewData.rows?.map((row: any[], ri: number) => (
                    <tr key={ri} style={{ borderBottom: '1px solid #eee' }}>
                      {row.map((cell, ci) => (
                        <td key={ci} style={{ padding: '4px 10px', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {cell === null ? <span style={{ color: '#aaa', fontStyle: 'italic' }}>NULL</span> : String(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Column Profile Dialog ─────────────────────────────────────────── */}
      <Dialog open={profileDialogOpen} onClose={() => setProfileDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AssessmentIcon /> Column Profile
          <Box sx={{ flex: 1 }} />
          <IconButton size="small" onClick={() => setProfileDialogOpen(false)}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0, maxHeight: '60vh', overflow: 'auto' }}>
          {profileLoading && <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /><Typography sx={{ mt: 1 }}>Profiling columns...</Typography></Box>}
          {profileData?.error && <Alert severity="error" sx={{ m: 2 }}>{profileData.error}</Alert>}
          {profileData && !profileData.error && (
            <Box sx={{ overflow: 'auto' }}>
              <Typography variant="caption" sx={{ p: 1, display: 'block', color: 'text.secondary' }}>
                Profiled on {(profileData.sample_size || 0).toLocaleString()} row sample
              </Typography>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ position: 'sticky', top: 0, background: '#f5f5f5' }}>
                    {['Column', 'Type', 'Nulls %', 'Distinct', 'Min', 'Max'].map(h => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '2px solid #ddd', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {profileData.columns?.map((col: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '4px 10px', fontWeight: 500 }}>{col.name}</td>
                      <td style={{ padding: '4px 10px', color: '#666' }}>{col.type}</td>
                      <td style={{ padding: '4px 10px' }}>
                        {col.error ? <span style={{ color: '#d32f2f' }}>err</span> : `${col.null_pct ?? 0}%`}
                      </td>
                      <td style={{ padding: '4px 10px' }}>{col.distinct_count?.toLocaleString() ?? '-'}</td>
                      <td style={{ padding: '4px 10px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {col.min ?? '-'}
                      </td>
                      <td style={{ padding: '4px 10px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {col.max ?? '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
          )}
        </DialogContent>
      </Dialog>

      {/* Phase 85C-2: Publish as API Dialog */}
      {publishApiDialogOpen && editingQueryId && (
        <PublishViewDialog
          open={publishApiDialogOpen}
          onClose={() => setPublishApiDialogOpen(false)}
          queryId={editingQueryId}
          queryName={editingQueryName || 'My Query'}
          columns={[]}
          queryParamDefs={queryMode === 'sql' ? detectedParams : []}
        />
      )}

      {/* Phase 85B: Cross-Connection Join Preview Dialog */}
      <Dialog open={crossJoinPreviewOpen} onClose={() => { setCrossJoinPreviewOpen(false); setCrossJoinPreviewError(''); }} maxWidth="lg" fullWidth>
        <DialogTitle>Join Preview (5 rows)</DialogTitle>
        <DialogContent dividers>
          {crossJoinPreviewLoading ? (
            <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress /><Typography sx={{ mt: 1 }}>Running preview...</Typography></Box>
          ) : crossJoinPreviewError ? (
            <Alert severity="error">{crossJoinPreviewError}</Alert>
          ) : crossJoinPreviewRows.length === 0 ? (
            <Typography color="text.secondary">No rows returned.</Typography>
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                <thead>
                  <tr>
                    {crossJoinPreviewCols.map(col => (
                      <th key={col} style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '2px solid #e0e0e0', whiteSpace: 'nowrap', fontWeight: 700 }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {crossJoinPreviewRows.map((row, idx) => (
                    <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#fff' : '#f9f9f9' }}>
                      {crossJoinPreviewCols.map(col => (
                        <td key={col} style={{ padding: '3px 8px', borderBottom: '1px solid #f0f0f0', whiteSpace: 'nowrap' }}>
                          {row[col] === null || row[col] === undefined ? <span style={{ color: '#aaa' }}>null</span> : String(row[col]).substring(0, 80)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCrossJoinPreviewOpen(false); setCrossJoinPreviewError(''); }}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Excel worksheet picker dialog */}
      <Dialog open={!!sheetPickerFile} onClose={() => setSheetPickerFile(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Select Worksheet</DialogTitle>
        <DialogContent>
          {sheetPickerLoading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
              <CircularProgress size={20} />
              <Typography variant="body2">Loading worksheets…</Typography>
            </Box>
          ) : (
            <FormControl size="small" fullWidth sx={{ mt: 1 }}>
              <InputLabel>Worksheet</InputLabel>
              <Select value={sheetPickerSelected} label="Worksheet"
                onChange={e => setSheetPickerSelected(e.target.value as string)}>
                {sheetPickerSheets.map(s => (
                  <MenuItem key={s} value={s}>{s}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSheetPickerFile(null)}>Cancel</Button>
          <Button variant="contained" onClick={confirmSheetSelection}
            disabled={sheetPickerLoading || !sheetPickerSelected}>
            Select
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default CompleteQueryBuilder;
