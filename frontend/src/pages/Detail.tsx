import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import UndoIcon from '@mui/icons-material/Undo';
import { Link as RouterLink, useParams } from 'react-router-dom';
import SampleCard from '../components/common/SampleCard';
import FieldGroup from '../components/common/FieldGroup';
import ClassificationBadge from '../components/common/Badge';
import EmptyState from '../components/common/EmptyState';
import { useSampleStore } from '../stores/sampleStore';
import { useToastStore } from '../stores/uiStore';
import {
  ANALYSIS_METHODS,
  ANALYSIS_METHOD_LABELS,
  ANALYSIS_THRESHOLDS,
  type AnalysisMethod,
} from '../types/analysis';
import {
  MINERAL_KEYS,
  MINERAL_LABELS,
  PREPARATIONS,
  PREPARATION_LABELS,
  SECTION_QUALITIES,
  SECTION_QUALITY_LABELS,
  mineralTotal,
  type MineralRatios,
  type PreparationMethod,
  type SectionQuality,
} from '../types/section';
import {
  FALL_OR_FIND_LABELS,
  STORAGE_LABELS,
  WEATHERING_LABELS,
  type StorageLocation,
} from '../types/sample';
import { isLoanActive, isLoanOverdue, shiftDate, todayStr, type LoanRecord } from '../types/loan';
import { FIND_ENVIRONMENT_LABELS, COORDINATE_SOURCE_LABELS } from '../types/find';
import { classifyByAnalysis, evaluateThresholds } from '../utils/classify';
import { formatDate, formatNumber, formatWeight } from '../utils/format';
import { formatCoordinate } from '../utils/geo';

interface LoanForm {
  borrower: string;
  contact: string;
  lentAt: string;
  dueDate: string;
}

interface ReturnForm {
  returnedAt: string;
  receiver: string;
}

/** `/samples/:id` 样本详情 */
export default function Detail() {
  const { id = '' } = useParams();
  const samples = useSampleStore((s) => s.samples);
  const finds = useSampleStore((s) => s.finds);
  const sections = useSampleStore((s) => s.sections);
  const analysis = useSampleStore((s) => s.analysis);
  const loans = useSampleStore((s) => s.loans);
  const addSection = useSampleStore((s) => s.addSection);
  const addAnalysis = useSampleStore((s) => s.addAnalysis);
  const updateSample = useSampleStore((s) => s.updateSample);
  const loanOut = useSampleStore((s) => s.loanOut);
  const returnLoan = useSampleStore((s) => s.returnLoan);
  const notify = useToastStore((s) => s.notify);

  const sample = useMemo(() => samples.find((s) => s.id === id), [samples, id]);
  const find = useMemo(() => finds.find((f) => f.sampleId === id), [finds, id]);
  const mySections = useMemo(() => sections.filter((s) => s.sampleId === id), [sections, id]);
  const myAnalysis = useMemo(() => analysis.filter((a) => a.sampleId === id), [analysis, id]);
  const myLoans = useMemo(
    () => loans.filter((l) => l.sampleId === id).sort((a, b) => b.createdAt - a.createdAt),
    [loans, id],
  );
  const activeLoan = myLoans.find(isLoanActive);
  const today = todayStr();
  const activeOverdue = activeLoan ? isLoanOverdue(activeLoan, today) : false;
  // 旧档案可能只把 storage 标成 loan-out 而没有外借记录：仍可正常打开，不按外借中锁定
  const legacyLoanMark = !activeLoan && sample?.storage === 'loan-out';

  const [sectionDraft, setSectionDraft] = useState({
    sectionNo: '',
    thickness: 30,
    preparation: 'resin' as PreparationMethod,
    quality: 'unrated' as SectionQuality,
    micrograph: '',
    minerals: { olivine: 40, pyroxene: 25, feldspar: 15, metal: 20 } as MineralRatios,
  });
  const [analysisDraft, setAnalysisDraft] = useState({
    method: 'microprobe' as AnalysisMethod,
    fa: 18,
    fs: 16,
    ni: 0.8,
    kamaciteBandwidth: 0.05,
    testedAt: today,
  });

  const [loanDialog, setLoanDialog] = useState(false);
  const [returnDialog, setReturnDialog] = useState(false);
  const [loanForm, setLoanForm] = useState<LoanForm>({
    borrower: '',
    contact: '',
    lentAt: today,
    dueDate: shiftDate(today, 30),
  });
  const [returnForm, setReturnForm] = useState<ReturnForm>({ returnedAt: today, receiver: '' });
  const [loanErrors, setLoanErrors] = useState<string[]>([]);
  const [returnErrors, setReturnErrors] = useState<string[]>([]);

  if (!sample) {
    return (
      <Stack spacing={2}>
        <EmptyState
          title="未找到该样本档案"
          description={`样本 id「${id}」不在本地库中，可能已被删除或链接失效。`}
          actionLabel="返回样本总览"
          actionTo="/"
        />
      </Stack>
    );
  }

  const mineralSum = mineralTotal(sectionDraft.minerals);
  const advice = classifyByAnalysis(analysisDraft);
  const hits = evaluateThresholds(analysisDraft);

  const submitSection = async () => {
    const no = sectionDraft.sectionNo.trim() || `TS-${new Date().getFullYear()}-${mySections.length + 1}`.padEnd(3, '0');
    try {
      await addSection({
        sectionNo: no,
        sampleId: sample.id,
        thickness: Number(sectionDraft.thickness),
        preparation: sectionDraft.preparation,
        minerals: sectionDraft.minerals,
        micrographs: sectionDraft.micrograph.trim() ? [sectionDraft.micrograph.trim()] : [],
        quality: sectionDraft.quality,
      });
    } catch (err) {
      notify(err instanceof Error ? err.message : '新增切片失败', 'warning');
      return;
    }
    notify(`已为 ${sample.sampleNo} 新增切片 ${no}`);
    setSectionDraft((d) => ({ ...d, sectionNo: '', micrograph: '' }));
  };

  const submitAnalysis = async () => {
    try {
      await addAnalysis({
        sampleId: sample.id,
        target: 'sample',
        method: analysisDraft.method,
        fa: Number(analysisDraft.fa),
        fs: Number(analysisDraft.fs),
        ni: Number(analysisDraft.ni),
        kamaciteBandwidth: Number(analysisDraft.kamaciteBandwidth),
        testedAt: analysisDraft.testedAt,
      });
    } catch (err) {
      notify(err instanceof Error ? err.message : '写入检测记录失败', 'warning');
      return;
    }
    notify(`已为 ${sample.sampleNo} 写入一条检测记录`);
  };

  const openLoanDialog = () => {
    setLoanForm({ borrower: '', contact: '', lentAt: todayStr(), dueDate: shiftDate(todayStr(), 30) });
    setLoanErrors([]);
    setLoanDialog(true);
  };

  const openReturnDialog = () => {
    setReturnForm({ returnedAt: todayStr(), receiver: '' });
    setReturnErrors([]);
    setReturnDialog(true);
  };

  const submitLoan = async () => {
    const errors: string[] = [];
    if (!loanForm.borrower.trim()) errors.push('借阅人不能为空');
    if (!loanForm.contact.trim()) errors.push('联系方式不能为空');
    if (!loanForm.lentAt) errors.push('借出日期不能为空');
    if (!loanForm.dueDate) errors.push('应还日期不能为空');
    if (loanForm.lentAt && loanForm.dueDate && loanForm.dueDate < loanForm.lentAt) {
      errors.push('应还日期不能早于借出日期');
    }
    setLoanErrors(errors);
    if (errors.length) return;

    try {
      await loanOut({
        sampleId: sample.id,
        borrower: loanForm.borrower.trim(),
        contact: loanForm.contact.trim(),
        lentAt: loanForm.lentAt,
        dueDate: loanForm.dueDate,
        // 旧档案残留 loan-out 标记时按 A 柜处理，归还后即恢复正常
        previousStorage: sample.storage === 'loan-out' ? 'cabinet-a' : sample.storage,
      });
    } catch (err) {
      notify(err instanceof Error ? err.message : '登记外借失败', 'warning');
      return;
    }
    setLoanDialog(false);
    notify(`已登记 ${sample.sampleNo} 外借给 ${loanForm.borrower.trim()}`);
  };

  const submitReturn = async () => {
    const errors: string[] = [];
    if (!returnForm.returnedAt) errors.push('实际归还日期不能为空');
    if (!returnForm.receiver.trim()) errors.push('接收人不能为空');
    setReturnErrors(errors);
    if (errors.length || !activeLoan) return;

    try {
      await returnLoan(activeLoan.id, returnForm.returnedAt, returnForm.receiver.trim());
    } catch (err) {
      notify(err instanceof Error ? err.message : '归还登记失败', 'warning');
      return;
    }
    setReturnDialog(false);
    const overdue = returnForm.returnedAt > activeLoan.dueDate;
    notify(
      overdue
        ? `已逾期归还，档案保留逾期记录，样本恢复至${STORAGE_LABELS[activeLoan.previousStorage]}`
        : `已完成归还，样本恢复至${STORAGE_LABELS[activeLoan.previousStorage]}`,
      overdue ? 'warning' : 'success',
    );
  };

  const clearLegacyMark = async () => {
    try {
      await updateSample(sample.id, { storage: 'cabinet-a' });
      notify('已清除旧的外借标记，存放位置恢复为 A 柜 · 干燥剂箱');
    } catch (err) {
      notify(err instanceof Error ? err.message : '清除标记失败', 'warning');
    }
  };

  /** 外借中整体禁用新增表单（fieldset 会级联禁用内部控件） */
  const lockSx = { border: 'none', p: 0, m: 0, minWidth: 0 } as const;

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Button component={RouterLink} to="/" startIcon={<ArrowBackIcon />} variant="text">
          返回总览
        </Button>
        <Typography variant="h4">样本详情</Typography>
        {activeLoan ? (
          <Chip
            size="small"
            color={activeOverdue ? 'error' : 'warning'}
            label={activeOverdue ? '外借中 · 已逾期' : '外借中'}
            sx={{ fontWeight: 700 }}
          />
        ) : null}
      </Stack>

      {activeLoan ? (
        <Alert
          severity={activeOverdue ? 'error' : 'warning'}
          action={
            <Button color="inherit" size="small" startIcon={<UndoIcon />} onClick={openReturnDialog}>
              办理归还
            </Button>
          }
        >
          {sample.sampleNo} 外借中
          {activeOverdue ? '（已超过应还日期）' : ''}：借阅人 {activeLoan.borrower}，应还日期{' '}
          {activeLoan.dueDate}。归还前不能修改重量、分类或存放位置，也不能新建切片和检测记录。
        </Alert>
      ) : null}
      {legacyLoanMark ? (
        <Alert
          severity="info"
          action={
            <Button color="inherit" size="small" onClick={() => void clearLegacyMark()}>
              清除旧标记
            </Button>
          }
        >
          该旧档案的存放位置被标为「外借中」，但查不到对应的外借登记记录，已按在库处理，所有功能照常使用。
        </Alert>
      ) : null}

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={4}>
          <SampleCard
            sample={sample}
            find={find}
            sectionCount={mySections.length}
            analysisCount={myAnalysis.length}
            onLoan={!!activeLoan}
          />
        </Grid>

        <Grid item xs={12} md={8}>
          <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
            <Stack spacing={1.5}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="h6">基本信息</Typography>
                {activeLoan ? (
                  <Button
                    size="small"
                    variant="contained"
                    color={activeOverdue ? 'error' : 'warning'}
                    startIcon={<UndoIcon />}
                    onClick={openReturnDialog}
                  >
                    办理归还
                  </Button>
                ) : (
                  <Button size="small" variant="outlined" startIcon={<AutorenewIcon />} onClick={openLoanDialog}>
                    登记外借
                  </Button>
                )}
              </Stack>
              <ClassificationBadge
                category={sample.category}
                group={sample.chemicalGroup}
                size="medium"
              />
              <Grid container spacing={1.5}>
                <Grid item xs={6} sm={4}>
                  <Typography variant="caption" color="text.secondary">
                    编号
                  </Typography>
                  <Typography variant="body1">{sample.sampleNo}</Typography>
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Typography variant="caption" color="text.secondary">
                    总重量
                  </Typography>
                  <Typography variant="body1">{formatWeight(sample.totalWeight)}</Typography>
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Typography variant="caption" color="text.secondary">
                    风化等级
                  </Typography>
                  <Typography variant="body1">{WEATHERING_LABELS[sample.weathering]}</Typography>
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Typography variant="caption" color="text.secondary">
                    发现 / 坠落
                  </Typography>
                  <Typography variant="body1">{FALL_OR_FIND_LABELS[sample.fallOrFind]}</Typography>
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Typography variant="caption" color="text.secondary">
                    存放位置
                  </Typography>
                  <Typography variant="body1">
                    {activeLoan
                      ? `外借中（借出前：${STORAGE_LABELS[activeLoan.previousStorage]}）`
                      : STORAGE_LABELS[sample.storage]}
                  </Typography>
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Typography variant="caption" color="text.secondary">
                    登记 / 更新
                  </Typography>
                  <Typography variant="body1">
                    {formatDate(sample.createdAt)} / {formatDate(sample.updatedAt)}
                  </Typography>
                </Grid>
              </Grid>
              {sample.note ? (
                <Typography variant="body2" color="text.secondary">
                  备注：{sample.note}
                </Typography>
              ) : null}
              <Divider />
              <Typography variant="h6">发现地摘要</Typography>
              {find ? (
                <Grid container spacing={1.5}>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary">
                      地名
                    </Typography>
                    <Typography variant="body2">{find.placeName}</Typography>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary">
                      国家 / 地区
                    </Typography>
                    <Typography variant="body2">{find.region}</Typography>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary">
                      坐标
                    </Typography>
                    <Typography variant="body2">
                      {formatCoordinate(find.longitude, find.latitude)}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary">
                      坐标来源
                    </Typography>
                    <Typography variant="body2">
                      {COORDINATE_SOURCE_LABELS[find.coordinateSource]}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary">
                      发现环境
                    </Typography>
                    <Typography variant="body2">
                      {FIND_ENVIRONMENT_LABELS[find.environment]}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary">
                      发现者
                    </Typography>
                    <Typography variant="body2">{find.finder}</Typography>
                  </Grid>
                </Grid>
              ) : (
                <Alert severity="warning">
                  该样本尚未登记发现地坐标，可返回 <RouterLink to="/samples/new">样本登记</RouterLink> 补录。
                </Alert>
              )}
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      <LoanHistoryPanel
        loans={myLoans}
        active={!!activeLoan}
        onLoan={openLoanDialog}
        onReturn={openReturnDialog}
      />

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={7}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="h6" sx={{ mb: 1.5 }}>
              切片与制样（{mySections.length}）
            </Typography>
            {mySections.length === 0 ? (
              <Alert severity="info">暂无切片记录，可在下方就地新增。</Alert>
            ) : (
              <Stack spacing={1.25}>
                {mySections.map((s) => (
                  <Box
                    key={s.id}
                    sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}
                  >
                    <Stack direction="row" justifyContent="space-between" flexWrap="wrap" gap={1}>
                      <Typography variant="subtitle1" fontWeight={700}>
                        {s.sectionNo}
                      </Typography>
                      <Stack direction="row" spacing={0.75}>
                        <Chip size="small" label={`厚度 ${s.thickness} μm`} />
                        <Chip size="small" variant="outlined" label={PREPARATION_LABELS[s.preparation]} />
                        <Chip size="small" color="secondary" label={SECTION_QUALITY_LABELS[s.quality]} />
                      </Stack>
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      矿物占比：{MINERAL_KEYS.map((k) => `${MINERAL_LABELS[k]} ${s.minerals[k]}%`).join(' · ')}
                      （合计 {mineralTotal(s.minerals)}%）
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      显微照片：{s.micrographs.length ? s.micrographs.join('、') : '未上传'}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            )}

            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
              就地新增切片
            </Typography>
            {activeLoan ? (
              <Alert severity="warning" sx={{ mb: 1.5 }}>
                样本外借中，归还前不能新建切片。
              </Alert>
            ) : null}
            <Box component="fieldset" disabled={!!activeLoan} sx={lockSx}>
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                  <TextField
                    id="section-no"
                    size="small"
                    label="切片编号"
                    value={sectionDraft.sectionNo}
                    onChange={(e) => setSectionDraft((d) => ({ ...d, sectionNo: e.target.value }))}
                    sx={{ width: 180 }}
                  />
                  <TextField
                    id="section-thickness"
                    size="small"
                    type="number"
                    label="厚度 μm"
                    value={sectionDraft.thickness}
                    onChange={(e) => setSectionDraft((d) => ({ ...d, thickness: Number(e.target.value) }))}
                    sx={{ width: 140 }}
                  />
                  <FormControl size="small" sx={{ minWidth: 150 }}>
                    <InputLabel id="prep-label">制样方式</InputLabel>
                    <Select
                      labelId="prep-label"
                      label="制样方式"
                      value={sectionDraft.preparation}
                      onChange={(e) =>
                        setSectionDraft((d) => ({ ...d, preparation: e.target.value as PreparationMethod }))
                      }
                    >
                      {PREPARATIONS.map((p) => (
                        <MenuItem key={p} value={p}>
                          {PREPARATION_LABELS[p]}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ minWidth: 170 }}>
                    <InputLabel id="quality-label">质量标注</InputLabel>
                    <Select
                      labelId="quality-label"
                      label="质量标注"
                      value={sectionDraft.quality}
                      onChange={(e) =>
                        setSectionDraft((d) => ({ ...d, quality: e.target.value as SectionQuality }))
                      }
                    >
                      {SECTION_QUALITIES.map((q) => (
                        <MenuItem key={q} value={q}>
                          {SECTION_QUALITY_LABELS[q]}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <TextField
                    id="section-micrograph"
                    size="small"
                    label="显微照片文件名"
                    value={sectionDraft.micrograph}
                    onChange={(e) => setSectionDraft((d) => ({ ...d, micrograph: e.target.value }))}
                    sx={{ width: 220 }}
                  />
                </Stack>

                <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                  {MINERAL_KEYS.map((k) => (
                    <FieldGroup
                      key={k}
                      title={`${MINERAL_LABELS[k]}占比`}
                      unit="%"
                      min={0}
                      max={100}
                      value={sectionDraft.minerals[k]}
                      onChange={(v) =>
                        setSectionDraft((d) => ({ ...d, minerals: { ...d.minerals, [k]: v } }))
                      }
                      inputId={`mineral-${k}`}
                      label={MINERAL_LABELS[k]}
                    />
                  ))}
                </Stack>
                <Typography variant="caption" color={mineralSum === 100 ? 'success.main' : 'warning.main'}>
                  矿物占比合计 {mineralSum}%（建议合计 100%）
                </Typography>
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={submitSection}
                  id="add-section"
                  disabled={!!activeLoan}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  新增切片
                </Button>
              </Stack>
            </Box>
          </Paper>
        </Grid>

        <Grid item xs={12} md={5}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="h6" sx={{ mb: 1.5 }}>
              分析检测记录（{myAnalysis.length}）
            </Typography>
            {myAnalysis.length === 0 ? (
              <Alert severity="info">暂无检测记录。</Alert>
            ) : (
              <Stack spacing={1.25} sx={{ mb: 2 }}>
                {myAnalysis.map((a) => {
                  const a2 = classifyByAnalysis(a);
                  return (
                    <Box
                      key={a.id}
                      sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}
                    >
                      <Stack direction="row" justifyContent="space-between" flexWrap="wrap" gap={1}>
                        <Typography variant="subtitle2">
                          {ANALYSIS_METHOD_LABELS[a.method]} · {a.testedAt}
                        </Typography>
                        <ClassificationBadge category={a2.category} showGroup={false} />
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        Fa {formatNumber(a.fa, 2, ' mol%')} · Fs {formatNumber(a.fs, 2, ' mol%')} · Ni{' '}
                        {formatNumber(a.ni, 2, ' wt%')} · 带宽 {formatNumber(a.kamaciteBandwidth, 3, ' mm')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {a2.summary}
                      </Typography>
                    </Box>
                  );
                })}
              </Stack>
            )}

            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
              就地录入检测数值
            </Typography>
            {activeLoan ? (
              <Alert severity="warning" sx={{ mb: 1.5 }}>
                样本外借中，归还前不能新建检测记录。
              </Alert>
            ) : null}
            <Box component="fieldset" disabled={!!activeLoan} sx={lockSx}>
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                  <FormControl size="small" sx={{ minWidth: 150 }}>
                    <InputLabel id="method-label">检测方法</InputLabel>
                    <Select
                      labelId="method-label"
                      label="检测方法"
                      value={analysisDraft.method}
                      onChange={(e) =>
                        setAnalysisDraft((d) => ({ ...d, method: e.target.value as AnalysisMethod }))
                      }
                    >
                      {ANALYSIS_METHODS.map((m) => (
                        <MenuItem key={m} value={m}>
                          {ANALYSIS_METHOD_LABELS[m]}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <TextField
                    id="detail-tested-at"
                    size="small"
                    type="date"
                    label="检测日期"
                    InputLabelProps={{ shrink: true }}
                    value={analysisDraft.testedAt}
                    onChange={(e) => setAnalysisDraft((d) => ({ ...d, testedAt: e.target.value }))}
                    sx={{ width: 180 }}
                  />
                </Stack>
                <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                  <FieldGroup
                    title="橄榄石 Fa"
                    unit="mol%"
                    min={0}
                    max={30}
                    value={analysisDraft.fa}
                    onChange={(v) => setAnalysisDraft((d) => ({ ...d, fa: v }))}
                    inputId="detail-fa"
                    label="Fa"
                  />
                  <FieldGroup
                    title="辉石 Fs"
                    unit="mol%"
                    min={0}
                    max={30}
                    value={analysisDraft.fs}
                    onChange={(v) => setAnalysisDraft((d) => ({ ...d, fs: v }))}
                    inputId="detail-fs"
                    label="Fs"
                  />
                  <FieldGroup
                    title="Ni 含量"
                    unit="wt%"
                    min={0}
                    max={20}
                    value={analysisDraft.ni}
                    onChange={(v) => setAnalysisDraft((d) => ({ ...d, ni: v }))}
                    inputId="detail-ni"
                    label="Ni"
                  />
                  <FieldGroup
                    title="铁纹石带宽"
                    unit="mm"
                    min={0}
                    max={2}
                    value={analysisDraft.kamaciteBandwidth}
                    onChange={(v) => setAnalysisDraft((d) => ({ ...d, kamaciteBandwidth: v }))}
                    inputId="detail-band"
                    label="带宽"
                  />
                </Stack>
                <Alert severity={hits.every((h) => h.inRange) ? 'success' : 'warning'}>
                  分类建议：{advice.summary}
                  <br />
                  阈值命中：{hits.filter((h) => h.inRange).length}/{hits.length} 项落在常规区间
                  <br />
                  命中说明：{advice.hits.join('；')}
                </Alert>
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={submitAnalysis}
                  id="add-analysis"
                  disabled={!!activeLoan}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  写入检测记录
                </Button>
                <Typography variant="caption" color="text.secondary">
                  阈值参考：
                  {ANALYSIS_THRESHOLDS.map((t) => `${t.label} ${t.min}~${t.max}${t.unit}`).join(' · ')}
                </Typography>
              </Stack>
            </Box>
          </Paper>
        </Grid>
      </Grid>

      {/* 登记外借 */}
      <Dialog open={loanDialog} onClose={() => setLoanDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>登记外借 · {sample.sampleNo}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {loanErrors.length ? (
              <Alert severity="error">
                {loanErrors.map((e) => (
                  <div key={e}>{e}</div>
                ))}
              </Alert>
            ) : null}
            <TextField
              id="loan-borrower"
              size="small"
              label="借阅人"
              required
              value={loanForm.borrower}
              onChange={(e) => setLoanForm((f) => ({ ...f, borrower: e.target.value }))}
            />
            <TextField
              id="loan-contact"
              size="small"
              label="联系方式"
              required
              value={loanForm.contact}
              onChange={(e) => setLoanForm((f) => ({ ...f, contact: e.target.value }))}
            />
            <TextField
              id="loan-lent-at"
              size="small"
              type="date"
              label="借出日期"
              InputLabelProps={{ shrink: true }}
              required
              value={loanForm.lentAt}
              onChange={(e) => setLoanForm((f) => ({ ...f, lentAt: e.target.value }))}
            />
            <TextField
              id="loan-due-date"
              size="small"
              type="date"
              label="应还日期"
              InputLabelProps={{ shrink: true }}
              required
              value={loanForm.dueDate}
              onChange={(e) => setLoanForm((f) => ({ ...f, dueDate: e.target.value }))}
            />
            <Typography variant="caption" color="text.secondary">
              登记后样本显示为外借中，存放位置将在归还时自动恢复为
              「{STORAGE_LABELS[sample.storage === 'loan-out' ? 'cabinet-a' : sample.storage]}」。
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLoanDialog(false)}>取消</Button>
          <Button id="loan-submit" variant="contained" onClick={() => void submitLoan()}>
            确认外借
          </Button>
        </DialogActions>
      </Dialog>

      {/* 办理归还 */}
      <Dialog open={returnDialog} onClose={() => setReturnDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>办理归还 · {sample.sampleNo}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {activeLoan ? (
              <Alert severity="info">
                借阅人：{activeLoan.borrower}（{activeLoan.contact}）
                <br />
                借出 {activeLoan.lentAt} · 应还 {activeLoan.dueDate}
                {activeOverdue ? <Chip size="small" color="error" label="已逾期" sx={{ ml: 1 }} /> : null}
              </Alert>
            ) : null}
            {returnErrors.length ? (
              <Alert severity="error">
                {returnErrors.map((e) => (
                  <div key={e}>{e}</div>
                ))}
              </Alert>
            ) : null}
            <TextField
              id="loan-returned-at"
              size="small"
              type="date"
              label="实际归还日期"
              InputLabelProps={{ shrink: true }}
              required
              value={returnForm.returnedAt}
              onChange={(e) => setReturnForm((f) => ({ ...f, returnedAt: e.target.value }))}
            />
            <TextField
              id="loan-receiver"
              size="small"
              label="接收人"
              required
              value={returnForm.receiver}
              onChange={(e) => setReturnForm((f) => ({ ...f, receiver: e.target.value }))}
            />
            {returnForm.returnedAt && activeLoan && returnForm.returnedAt > activeLoan.dueDate ? (
              <Alert severity="warning">
                实际归还日期晚于应还日期，将照常收下并在档案中保留逾期记录。
              </Alert>
            ) : null}
            {activeLoan ? (
              <Typography variant="caption" color="text.secondary">
                归还后存放位置恢复为「{STORAGE_LABELS[activeLoan.previousStorage]}」，之后可再次外借。
              </Typography>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReturnDialog(false)}>取消</Button>
          <Button id="loan-return" variant="contained" onClick={() => void submitReturn()}>
            确认归还
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

/** 外借记录面板：显示当前外借信息与完整借阅历史 */
function LoanHistoryPanel({
  loans,
  active,
  onLoan,
  onReturn,
}: {
  loans: LoanRecord[];
  active: boolean;
  onLoan: () => void;
  onReturn: () => void;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="h6">外借记录（{loans.length}）</Typography>
        {active ? (
          <Button size="small" variant="contained" color="warning" startIcon={<UndoIcon />} onClick={onReturn}>
            办理归还
          </Button>
        ) : (
          <Button id="loan-register" size="small" variant="outlined" startIcon={<AutorenewIcon />} onClick={onLoan}>
            登记外借
          </Button>
        )}
      </Stack>
      {loans.length === 0 ? (
        <Alert severity="info">暂无外借记录。点击「登记外借」记录借阅人、联系方式与应还日期。</Alert>
      ) : (
        <Stack spacing={1.25}>
          {loans.map((l) => {
            const running = isLoanActive(l);
            const overdue = running ? isLoanOverdue(l) : !!l.overdue;
            return (
              <Box
                key={l.id}
                sx={{
                  border: '1px solid',
                  borderColor: running ? 'warning.main' : 'divider',
                  borderRadius: 2,
                  p: 1.5,
                  bgcolor: running ? 'rgba(237,108,2,0.05)' : 'transparent',
                }}
              >
                <Stack direction="row" justifyContent="space-between" flexWrap="wrap" gap={1}>
                  <Typography variant="subtitle1" fontWeight={700}>
                    {l.borrower}
                    <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                      {l.contact}
                    </Typography>
                  </Typography>
                  <Stack direction="row" spacing={0.75}>
                    <Chip
                      size="small"
                      color={running ? (overdue ? 'error' : 'warning') : 'default'}
                      label={
                        running ? (overdue ? '外借中 · 已逾期' : '外借中') : overdue ? '已归还 · 逾期' : '已归还'
                      }
                    />
                  </Stack>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  借出 {l.lentAt} · 应还 {l.dueDate}
                  {l.returnedAt
                    ? ` · 实际归还 ${l.returnedAt} · 接收人 ${l.receiver ?? '—'}`
                    : null}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  借出前存放位置：{STORAGE_LABELS[l.previousStorage as StorageLocation]}
                </Typography>
              </Box>
            );
          })}
        </Stack>
      )}
    </Paper>
  );
}
