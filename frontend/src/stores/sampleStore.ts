import { create } from 'zustand';
import { db, makeId, seedIfEmpty } from '../db';
import type { AnalysisRecord } from '../types/analysis';
import type { FindRecord } from '../types/find';
import type { LoanRecord } from '../types/loan';
import { isLoanActive } from '../types/loan';
import type { MeteoriteSample } from '../types/sample';
import type { ThinSection } from '../types/section';

/** 外借期间禁止修改的样本字段：重量、分类、存放位置（化学群随分类一并锁定） */
const LOCKED_SAMPLE_KEYS = ['totalWeight', 'category', 'chemicalGroup', 'storage'] as const;

export interface SampleState {
  samples: MeteoriteSample[];
  finds: FindRecord[];
  sections: ThinSection[];
  analysis: AnalysisRecord[];
  loans: LoanRecord[];
  loading: boolean;
  loaded: boolean;
  loadAll: () => Promise<void>;
  addSample: (input: Omit<MeteoriteSample, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>;
  updateSample: (id: string, patch: Partial<MeteoriteSample>) => Promise<void>;
  removeSample: (id: string) => Promise<void>;
  addFind: (input: Omit<FindRecord, 'id' | 'createdAt'>) => Promise<string>;
  addSection: (input: Omit<ThinSection, 'id' | 'createdAt'>) => Promise<string>;
  updateSection: (id: string, patch: Partial<ThinSection>) => Promise<void>;
  addAnalysis: (input: Omit<AnalysisRecord, 'id' | 'createdAt'>) => Promise<string>;
  loanOut: (
    input: Omit<LoanRecord, 'id' | 'createdAt'>,
  ) => Promise<string>;
  returnLoan: (loanId: string, returnedAt: string, receiver: string) => Promise<void>;
  nextSampleSeq: () => number;
}

export const useSampleStore = create<SampleState>((set, get) => ({
  samples: [],
  finds: [],
  sections: [],
  analysis: [],
  loans: [],
  loading: false,
  loaded: false,

  loadAll: async () => {
    set({ loading: true });
    await seedIfEmpty();
    const [samples, finds, sections, analysis, loans] = await Promise.all([
      db.samples.toArray(),
      db.finds.toArray(),
      db.sections.toArray(),
      db.analysis.toArray(),
      db.loans.toArray(),
    ]);
    samples.sort((a, b) => b.createdAt - a.createdAt);
    finds.sort((a, b) => b.createdAt - a.createdAt);
    sections.sort((a, b) => b.createdAt - a.createdAt);
    analysis.sort((a, b) => b.createdAt - a.createdAt);
    loans.sort((a, b) => b.createdAt - a.createdAt);
    set({ samples, finds, sections, analysis, loans, loading: false, loaded: true });
  },

  addSample: async (input) => {
    const now = Date.now();
    const record: MeteoriteSample = { ...input, id: makeId('sample'), createdAt: now, updatedAt: now };
    await db.samples.add(record);
    set({ samples: [record, ...get().samples] });
    return record.id;
  },

  updateSample: async (id, patch) => {
    // 外借中禁止修改重量、分类（含化学群）与存放位置
    const locked = get().loans.some((l) => l.sampleId === id && isLoanActive(l));
    if (locked && LOCKED_SAMPLE_KEYS.some((key) => key in patch)) {
      throw new Error('样本外借中，归还前不能修改重量、分类或存放位置');
    }
    const updatedAt = Date.now();
    await db.samples.update(id, { ...patch, updatedAt });
    set({
      samples: get().samples.map((s) => (s.id === id ? { ...s, ...patch, updatedAt } : s)),
    });
  },

  removeSample: async (id) => {
    await db.transaction('rw', db.samples, db.finds, db.sections, db.analysis, db.loans, async () => {
      await db.samples.delete(id);
      await db.finds.where('sampleId').equals(id).delete();
      await db.sections.where('sampleId').equals(id).delete();
      await db.analysis.where('sampleId').equals(id).delete();
      await db.loans.where('sampleId').equals(id).delete();
    });
    set({
      samples: get().samples.filter((s) => s.id !== id),
      finds: get().finds.filter((f) => f.sampleId !== id),
      sections: get().sections.filter((s) => s.sampleId !== id),
      analysis: get().analysis.filter((a) => a.sampleId !== id),
      loans: get().loans.filter((l) => l.sampleId !== id),
    });
  },

  addFind: async (input) => {
    const record: FindRecord = { ...input, id: makeId('find'), createdAt: Date.now() };
    await db.finds.add(record);
    set({ finds: [record, ...get().finds] });
    return record.id;
  },

  addSection: async (input) => {
    // 外借中的样本不能新建切片
    if (get().loans.some((l) => l.sampleId === input.sampleId && isLoanActive(l))) {
      throw new Error('样本外借中，归还前不能新建切片');
    }
    const record: ThinSection = { ...input, id: makeId('section'), createdAt: Date.now() };
    await db.sections.add(record);
    set({ sections: [record, ...get().sections] });
    return record.id;
  },

  updateSection: async (id, patch) => {
    await db.sections.update(id, patch);
    set({ sections: get().sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  },

  addAnalysis: async (input) => {
    // 外借中的样本不能新建检测记录（含挂在该样本切片下的检测）
    const sampleId =
      input.sampleId ||
      get().sections.find((s) => s.id === input.sectionId)?.sampleId;
    if (sampleId && get().loans.some((l) => l.sampleId === sampleId && isLoanActive(l))) {
      throw new Error('样本外借中，归还前不能新建检测记录');
    }
    const record: AnalysisRecord = { ...input, id: makeId('analysis'), createdAt: Date.now() };
    await db.analysis.add(record);
    set({ analysis: [record, ...get().analysis] });
    return record.id;
  },

  loanOut: async (input) => {
    const sample = get().samples.find((s) => s.id === input.sampleId);
    if (!sample) throw new Error('样本不存在，无法登记外借');
    const active = get().loans.some((l) => l.sampleId === input.sampleId && isLoanActive(l));
    if (active) throw new Error('该样本已在外借中，请先办理归还');

    const record: LoanRecord = { ...input, id: makeId('loan'), createdAt: Date.now() };
    await db.transaction('rw', db.loans, db.samples, async () => {
      await db.loans.add(record);
      await db.samples.update(record.sampleId, { storage: 'loan-out', updatedAt: Date.now() });
    });
    set({
      loans: [record, ...get().loans],
      samples: get().samples.map((s) =>
        s.id === record.sampleId ? { ...s, storage: 'loan-out', updatedAt: Date.now() } : s,
      ),
    });
    return record.id;
  },

  returnLoan: async (loanId, returnedAt, receiver) => {
    const loan = get().loans.find((l) => l.id === loanId);
    if (!loan) throw new Error('外借记录不存在');
    if (!isLoanActive(loan)) throw new Error('该外借记录已办理归还');

    // 逾期照常收下，仅在档案中保留逾期标记
    const overdue = returnedAt > loan.dueDate;
    const finished: LoanRecord = { ...loan, returnedAt, receiver, overdue };
    await db.transaction('rw', db.loans, db.samples, async () => {
      await db.loans.put(finished);
      // 归还后恢复借出前的存放位置
      await db.samples.update(loan.sampleId, {
        storage: loan.previousStorage,
        updatedAt: Date.now(),
      });
    });
    const now = Date.now();
    set({
      loans: get().loans.map((l) => (l.id === loanId ? finished : l)),
      samples: get().samples.map((s) =>
        s.id === loan.sampleId ? { ...s, storage: loan.previousStorage, updatedAt: now } : s,
      ),
    });
  },

  nextSampleSeq: () => {
    const year = new Date().getFullYear();
    const prefix = `MET-${year}-`;
    const used = get()
      .samples.map((s) => s.sampleNo)
      .filter((no) => no.startsWith(prefix))
      .map((no) => Number(no.slice(prefix.length)))
      .filter((n) => Number.isFinite(n));
    const max = used.length ? Math.max(...used) : 0;
    return max + 1;
  },
}));
