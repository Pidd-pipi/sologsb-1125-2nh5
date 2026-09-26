import type { StorageLocation } from './sample';

/** 借阅记录（LoanRecord）：一次外借从登记到归还的完整流水 */
export interface LoanRecord {
  id: string;
  /** 关联样本 id */
  sampleId: string;
  /** 借阅人 */
  borrower: string;
  /** 联系方式 */
  contact: string;
  /** 应还日期，YYYY-MM-DD */
  dueDate: string;
  /** 借出日期，YYYY-MM-DD */
  loanedAt: string;
  /** 借出前的存放位置，归还后恢复 */
  previousStorage: StorageLocation;
  /** 实际归还日期，YYYY-MM-DD；未归还时缺省 */
  returnedAt?: string;
  /** 归还接收人；未归还时缺省 */
  receiver?: string;
  createdAt: number;
}

/** 找出某样本当前未归还的借阅记录（同一时刻至多一条） */
export function activeLoanOf(loans: LoanRecord[], sampleId: string): LoanRecord | undefined {
  return loans.find((l) => l.sampleId === sampleId && !l.returnedAt);
}

/** 判断是否逾期：未归还按今天比对，已归还按实际归还日比对（YYYY-MM-DD 可直接按字符串比较） */
export function isLoanOverdue(loan: LoanRecord, today = new Date().toISOString().slice(0, 10)): boolean {
  const end = loan.returnedAt ?? today;
  return end > loan.dueDate;
}
