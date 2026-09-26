import { create } from 'zustand';
import { db, makeId, seedIfEmpty } from '../db';
import type { AnalysisRecord } from '../types/analysis';
import type { FindRecord } from '../types/find';
import type { LoanRecord } from '../types/loan';
import { activeLoanOf } from '../types/loan';
import type { MeteoriteSample } from '../types/sample';
import type { ThinSection } from '../types/section';

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
  addLoan: (
    input: Pick<LoanRecord, 'sampleId' | 'borrower' | 'contact' | 'dueDate' | 'loanedAt'>,
  ) => Promise<string>;
  returnLoan: (loanId: string, input: Pick<LoanRecord, 'returnedAt' | 'receiver'>) => Promise<void>;
  nextSampleSeq: () => number;
}

/** 外借未归还时锁定提示，供拦截处统一抛出 */
export const LOAN_LOCK_MESSAGE = '样本外借中，归还前不能修改重量、分类或存放位置，也不能新增切片和检测记录';

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
    // 外借未归还时锁定重量、分类与存放位置（存放位置由借阅/归还流程自动维护）
    if (
      activeLoanOf(get().loans, id) &&
      ('totalWeight' in patch || 'category' in patch || 'storage' in patch)
    ) {
      throw new Error(LOAN_LOCK_MESSAGE);
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
    if (activeLoanOf(get().loans, input.sampleId)) {
      throw new Error(LOAN_LOCK_MESSAGE);
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
    if (activeLoanOf(get().loans, input.sampleId)) {
      throw new Error(LOAN_LOCK_MESSAGE);
    }
    const record: AnalysisRecord = { ...input, id: makeId('analysis'), createdAt: Date.now() };
    await db.analysis.add(record);
    set({ analysis: [record, ...get().analysis] });
    return record.id;
  },

  addLoan: async (input) => {
    const sample = get().samples.find((s) => s.id === input.sampleId);
    if (!sample) throw new Error('样本不存在');
    if (activeLoanOf(get().loans, input.sampleId)) {
      throw new Error('该样本已在外借中，归还后才能再次借出');
    }
    const record: LoanRecord = {
      ...input,
      id: makeId('loan'),
      // 旧档案可能已被手工置为「外借中」而无借阅记录，此时回退到 A 柜（沿用旧切换按钮的恢复目标）
      previousStorage: sample.storage === 'loan-out' ? 'cabinet-a' : sample.storage,
      createdAt: Date.now(),
    };
    const updatedAt = Date.now();
    await db.transaction('rw', db.loans, db.samples, async () => {
      await db.loans.add(record);
      await db.samples.update(input.sampleId, { storage: 'loan-out', updatedAt });
    });
    set({
      loans: [record, ...get().loans],
      samples: get().samples.map((s) =>
        s.id === input.sampleId ? { ...s, storage: 'loan-out', updatedAt } : s,
      ),
    });
    return record.id;
  },

  returnLoan: async (loanId, input) => {
    const loan = get().loans.find((l) => l.id === loanId);
    if (!loan) throw new Error('借阅记录不存在');
    if (loan.returnedAt) throw new Error('该借阅已办理归还');
    const updatedAt = Date.now();
    await db.transaction('rw', db.loans, db.samples, async () => {
      await db.loans.update(loanId, { returnedAt: input.returnedAt, receiver: input.receiver });
      // 归还后恢复借出前的存放位置
      await db.samples.update(loan.sampleId, { storage: loan.previousStorage, updatedAt });
    });
    set({
      loans: get().loans.map((l) =>
        l.id === loanId ? { ...l, returnedAt: input.returnedAt, receiver: input.receiver } : l,
      ),
      samples: get().samples.map((s) =>
        s.id === loan.sampleId ? { ...s, storage: loan.previousStorage, updatedAt } : s,
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
