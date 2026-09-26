/** 外借记录（LoanRecord）：登记借阅信息并跟踪归还，逾期记录长期保留 */
export interface LoanRecord {
  id: string;
  sampleId: string;
  /** 借阅人 */
  borrower: string;
  /** 联系方式 */
  contact: string;
  /** 借出日期，YYYY-MM-DD */
  lentAt: string;
  /** 应还日期，YYYY-MM-DD */
  dueDate: string;
  /** 借出前的存放位置，归还时自动恢复 */
  previousStorage: import('./sample').StorageLocation;
  /** 实际归还日期，YYYY-MM-DD；未填写表示仍在外借中 */
  returnedAt?: string;
  /** 归还时的接收人 */
  receiver?: string;
  /** 归还时是否逾期：逾期照常收下，标记保留在档案中 */
  overdue?: boolean;
  createdAt: number;
}

/** 是否处于外借中（尚未登记归还） */
export function isLoanActive(loan: LoanRecord): boolean {
  return !loan.returnedAt;
}

/** 当天日期 YYYY-MM-DD（本地时区） */
export function todayStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 是否逾期：仅对未归还记录按指定日期（默认今天）判断 */
export function isLoanOverdue(loan: LoanRecord, today: string = todayStr()): boolean {
  return isLoanActive(loan) && loan.dueDate < today;
}

/** 在 YYYY-MM-DD 日期上增减天数 */
export function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return todayStr(d);
}
