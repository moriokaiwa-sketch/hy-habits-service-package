import { useState, useEffect, useRef, Component, ErrorInfo, ReactNode } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import SignatureCanvas from 'react-signature-canvas';
import { db } from './firebase';
import { doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import html2canvas from 'html2canvas';
import './App.css';

export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'monospace', maxWidth: '500px', margin: '2rem auto', border: '3px solid #1a1a1a', background: '#fff' }}>
          <h2 style={{ color: '#d32f2f', margin: '0 0 1rem' }}>⚠️ エラーが発生しました</h2>
          <p style={{ color: '#555', margin: '1rem 0', wordBreak: 'break-word', fontSize: '0.85rem' }}>
            {this.state.error?.message || "予期しないエラーが発生しました"}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '1.5rem' }}>
            <button 
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              style={{
                padding: '0.75rem 1.25rem',
                backgroundColor: '#1a1a1a',
                color: '#fff',
                border: 'none',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              🔄 再読み込み
            </button>
            <button 
              onClick={() => {
                if (window.confirm("キャッシュデータを初期化して復旧しますか？")) {
                  localStorage.removeItem('cards');
                  localStorage.removeItem('masterCardTemplate');
                  window.location.reload();
                }
              }}
              style={{
                padding: '0.75rem 1.25rem',
                backgroundColor: '#d32f2f',
                color: '#fff',
                border: 'none',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              ⚠️ データ初期化
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const StarIcon = ({ filled, onClick }: { filled: boolean, onClick: () => void }) => (
  <svg 
    onClick={onClick}
    width="32" 
    height="32" 
    viewBox="0 0 24 24" 
    fill={filled ? "#E2584D" : "none"}
    stroke={filled ? "#E2584D" : "#333"} 
    strokeWidth="1.5" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className="star-icon"
  >
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

export interface KpiLinkConfig {
  enabled: boolean;
  sourceType: 'sleep' | 'task' | 'perfect' | 'rating' | 'newThings' | 'studyTime';
  operator?: '>=' | '<=' | 'recorded';
  threshold?: number;
  taskName?: string;
  ratingThreshold?: number;
}

export interface MonthlyKpi {
  id: string;
  title: string;
  type: 'check' | 'number' | 'text';
  targetValue?: number;
  currentValue: boolean | number | string;
  linkConfig?: KpiLinkConfig;
}

const defaultMonthlyKpis: MonthlyKpi[] = [
  {
    id: 'kpi-default-1',
    title: 'ジム・筋トレ（月12回）',
    type: 'number',
    targetValue: 12,
    currentValue: 0
  },
  {
    id: 'kpi-default-2',
    title: '月次振り返り・次月目標設定',
    type: 'check',
    currentValue: false
  },
  {
    id: 'kpi-default-3',
    title: '読んだ本・インプット作品メモ',
    type: 'text',
    currentValue: ''
  },
  {
    id: 'kpi-default-4',
    title: 'スキルアップ・SG研究（月20h）',
    type: 'number',
    targetValue: 20,
    currentValue: 0,
    linkConfig: {
      enabled: true,
      sourceType: 'studyTime'
    }
  }
];

export interface BasicData {
  sleepStart?: string;     // 例: "21:00"
  sleepEnd?: string;       // 例: "06:00"
  skippedFields?: string[]; // スキップされたフィールド ('sleep')
}

const calculateSleepDuration = (start?: string, end?: string) => {
  if (!start || !end) return null;
  const [sH, sM] = start.split(':').map(Number);
  const [eH, eM] = end.split(':').map(Number);
  if (isNaN(sH) || isNaN(sM) || isNaN(eH) || isNaN(eM)) return null;

  let diffMinutes = (eH * 60 + eM) - (sH * 60 + sM);
  if (diffMinutes < 0) {
    diffMinutes += 24 * 60; // 翌朝に跨ぐ場合 (例: 21:00 - 06:00 は +9時間)
  }

  const hoursDecimal = (diffMinutes / 60).toFixed(1);
  return {
    start,
    end,
    minutes: diffMinutes,
    hoursDecimal,
    formattedText: `${start} - ${end} (${hoursDecimal}h)`
  };
};

export const isStudyTimerTask = (categoryName?: string, taskName?: string): boolean => {
  const c = (categoryName || '').trim().toLowerCase();
  const t = (taskName || '').trim().toLowerCase();
  if (c === 'study') return true;
  if (t.includes('sg') || t.includes('研究')) return true;
  return false;
};

const computeLinkedKpiCount = (config: KpiLinkConfig | undefined, monthlyCards: Record<string, any>): number => {
  if (!config || !config.enabled) return 0;
  let count = 0;

  Object.values(monthlyCards).forEach(card => {
    if (!card) return;

    if (config.sourceType === 'sleep') {
      const b = card.basicData;
      if (b && b.sleepStart && b.sleepEnd) {
        const sleep = calculateSleepDuration(b.sleepStart, b.sleepEnd);
        if (sleep) {
          const hours = parseFloat(sleep.hoursDecimal);
          const thresh = config.threshold !== undefined ? Number(config.threshold) : 7.0;
          if (config.operator === '<=') {
            if (hours <= thresh) count++;
          } else {
            if (hours >= thresh) count++;
          }
        }
      }
    } else if (config.sourceType === 'task') {
      const target = (config.taskName || '').trim().toLowerCase();
      if (!target) return;
      let isDone = false;
      (card.categories || []).forEach((cat: any) => {
        (cat?.items || []).forEach((item: any) => {
          if (item?.isDone && item?.task && item.task.trim().toLowerCase() === target) {
            isDone = true;
          }
        });
      });
      if (isDone) count++;
    } else if (config.sourceType === 'studyTime') {
      (card.categories || []).forEach((cat: any) => {
        const catName = cat?.name || '';
        (cat?.items || []).forEach((item: any) => {
          if (item?.type === 'timer' || isStudyTimerTask(catName, item?.task)) {
            const mins = Number(item.accumulatedMinutes) || 0;
            count += mins;
          }
        });
      });
    } else if (config.sourceType === 'perfect') {
      if (card.signature) count++;
    } else if (config.sourceType === 'rating') {
      const rating = Number(card.dayRating) || 0;
      const thresh = config.threshold !== undefined ? Number(config.threshold) : 4;
      if (rating >= thresh) count++;
    } else if (config.sourceType === 'newThings') {
      if (card.newThings && typeof card.newThings === 'string' && card.newThings.trim().length > 0) {
        count++;
      }
    }
  });

  if (config.sourceType === 'studyTime') {
    return Math.round((count / 60) * 10) / 10;
  }

  return count;
};

const SHIFTS = ["D", "S", "N", "/", "H"];

const formatShift = (shift: string): string => {
  if (!shift) return '';
  const s = String(shift).trim();
  if (s === 'D' || s.includes('日勤')) return 'D';
  if (s === 'S' || s.includes('遅番')) return 'S';
  if (s === '/' || s.includes('夜勤明け') || s.includes('明け')) return '/';
  if (s === 'N' || s.includes('夜勤')) return 'N';
  if (s === 'H' || s.includes('休日') || s.includes('休')) return 'H';
  return s;
};

const getShiftClass = (shift: string): string => {
  const s = formatShift(shift);
  if (s === 'D') return 'shift-D';
  if (s === 'S') return 'shift-S';
  if (s === 'N') return 'shift-N';
  if (s === '/') return 'shift-slash';
  if (s === 'H') return 'shift-H';
  return '';
};

const formatNoteDate = (dateStr: string, shift?: string) => {
  const parts = dateStr.split('-');
  const day = parts.length >= 3 ? parseInt(parts[2], 10) : dateStr;
  const s = shift ? formatShift(shift) : '';
  return s ? `${day} (${s})` : `${day}`;
};

const getMonthlyNewThingsList = (monthlyCards: Record<string, any>): { dateStr: string; shift: string; text: string }[] => {
  return Object.entries(monthlyCards)
    .filter(([_, card]) => card && typeof card.newThings === 'string' && card.newThings.trim().length > 0)
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([dateStr, card]) => ({
      dateStr,
      shift: formatShift(card.currentShift || ''),
      text: card.newThings.trim()
    }));
};

const isKpiLinkedToNewThings = (kpi: MonthlyKpi): boolean => {
  if (kpi.linkConfig?.enabled && kpi.linkConfig.sourceType === 'newThings') {
    return true;
  }
  if (kpi.linkConfig?.enabled === false) return false;
  const t = (kpi.title || '').trim().toLowerCase();
  return t.includes('new things') || t.includes('newthings') || t.includes('新しいこと') || t.includes('新体験');
};

const sanitizeLoadedKpi = (kpi: any): MonthlyKpi => {
  const item: MonthlyKpi = {
    id: String(kpi.id || `kpi-${Date.now()}`),
    title: String(kpi.title || ''),
    type: (kpi.type === 'check' || kpi.type === 'text' || kpi.type === 'number') ? kpi.type : 'number',
    currentValue: kpi.currentValue !== undefined ? kpi.currentValue : (kpi.type === 'number' ? 0 : kpi.type === 'check' ? false : ''),
    ...(kpi.type === 'number' && typeof kpi.targetValue === 'number' && !Number.isNaN(kpi.targetValue) ? { targetValue: kpi.targetValue } : {})
  };

  if (kpi.linkConfig && kpi.linkConfig.enabled) {
    item.linkConfig = {
      enabled: true,
      sourceType: kpi.linkConfig.sourceType,
      ...(kpi.linkConfig.operator ? { operator: kpi.linkConfig.operator } : {}),
      ...(kpi.linkConfig.threshold !== undefined && !Number.isNaN(Number(kpi.linkConfig.threshold)) ? { threshold: Number(kpi.linkConfig.threshold) } : {}),
      ...(kpi.linkConfig.taskName ? { taskName: String(kpi.linkConfig.taskName) } : {}),
      ...(kpi.linkConfig.ratingThreshold !== undefined ? { ratingThreshold: Number(kpi.linkConfig.ratingThreshold) } : {})
    };
  } else {
    // 過去の保存バグで linkConfig が消失していた場合の自動救済・復元
    const t = item.title.toLowerCase();
    if (t.includes('睡眠') || t.includes('sleep')) {
      item.linkConfig = {
        enabled: true,
        sourceType: 'sleep',
        operator: '>=',
        threshold: 7.0
      };
    } else if (t.includes('new things') || t.includes('newthings') || t.includes('新しいこと') || t.includes('新体験')) {
      item.linkConfig = {
        enabled: true,
        sourceType: 'newThings'
      };
    } else if (t.includes('スキルアップ') || t.includes('sg研究') || t.includes('勉強時間')) {
      item.linkConfig = {
        enabled: true,
        sourceType: 'studyTime'
      };
    }
  }

  return item;
};

interface Habit {
  id: string;
  task: string;
  description?: string;
  isDone: boolean;
  isSkipped?: boolean;
  time?: string;
  estimatedTime?: number;
  type?: 'check' | 'timer';
  accumulatedMinutes?: number;
  timerActiveStart?: number;
}

interface Category {
  id: string;
  name: string;
  items: Habit[];
}

const defaultHabits: Habit[] = [
  { id: "task-01", task: "Duolingo", isDone: false },
  { id: "task-02", task: "Pimsleur", isDone: false },
  { id: "task-03", task: "3行日記", isDone: false },
  { id: "task-04", task: "筋トレ", isDone: false }
];

const defaultCategories: Category[] = [
  { id: "cat-general", name: "General", items: defaultHabits }
];

function sanitizeCategories(raw: any): Category[] {
  if (!raw) return defaultCategories;
  
  let list: any[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'object') {
    list = Object.values(raw);
  } else {
    return defaultCategories;
  }

  if (list.length === 0) return defaultCategories;

  return list.map((cat: any, cIdx: number) => {
    const rawItems = Array.isArray(cat?.items) 
      ? cat.items 
      : (cat?.items && typeof cat.items === 'object' ? Object.values(cat.items) : []);

    const sanitizedItems: Habit[] = rawItems.map((item: any, iIdx: number) => {
      const estimatedTime = typeof item?.estimatedTime === 'number' 
        ? item.estimatedTime 
        : (item?.time ? parseInt(item.time, 10) || undefined : undefined);

      let taskText = '';
      if (item?.task !== undefined && item?.task !== null) {
        taskText = String(item.task);
      } else if (item?.name !== undefined && item?.name !== null) {
        taskText = String(item.name);
      } else if (item?.habit !== undefined && item?.habit !== null) {
        taskText = String(item.habit);
      }

      // 「SGけ」「SG 色塗り」などの誤入力・旧名称を「SG研究」へ自動修復
      const catName = String(cat?.name || '').trim().toLowerCase();
      const taskTrimmed = taskText.trim();
      if (
        (catName === 'study' && (taskTrimmed.startsWith('SG') || taskTrimmed.startsWith('sg') || taskTrimmed.includes('色塗り') || taskTrimmed === 'SGけ')) ||
        taskTrimmed === 'SGけ' ||
        taskTrimmed === 'SG 色塗り' ||
        taskTrimmed === 'SG色塗り' ||
        taskTrimmed === 'sg色塗り' ||
        taskTrimmed === 'sgけ'
      ) {
        taskText = 'SG研究';
      }

      // タイプ判定（明示的に指定されている場合はそれを優先、既存データ救済で study カテゴリや SG研究、累積時間保持は timer）
      let habitType: 'check' | 'timer' = 'check';
      if (item?.type === 'timer' || item?.type === 'check') {
        habitType = item.type;
      } else if (catName === 'study' || taskTrimmed.includes('sg') || taskTrimmed.includes('研究') || (typeof item?.accumulatedMinutes === 'number' && item.accumulatedMinutes > 0)) {
        habitType = 'timer';
      }

      const habitObj: Habit = {
        id: String(item?.id || `task-${Date.now()}-${cIdx}-${iIdx}`),
        task: taskText,
        description: item?.description ? String(item.description) : '',
        time: item?.time ? String(item.time) : (estimatedTime ? String(estimatedTime) : ''),
        isDone: Boolean(item?.isDone),
        isSkipped: Boolean(item?.isSkipped),
        type: habitType,
        accumulatedMinutes: typeof item?.accumulatedMinutes === 'number' ? item.accumulatedMinutes : undefined,
        timerActiveStart: typeof item?.timerActiveStart === 'number' ? item.timerActiveStart : undefined
      };

      if (estimatedTime !== undefined && !Number.isNaN(estimatedTime)) {
        habitObj.estimatedTime = estimatedTime;
      }

      return habitObj;
    });

    return {
      id: String(cat?.id || `cat-${Date.now()}-${cIdx}`),
      name: cat?.name !== undefined && cat?.name !== null ? String(cat.name) : '',
      items: sanitizedItems
    };
  });
}

function App() {
  const [isEditMode, setIsEditMode] = useState(false);
  
  const getDateString = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const getTodayDate = () => getDateString(0);

  const formatDateLabel = (dateStr: string) => {
    if (dateStr === getTodayDate()) return 'TODAY';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parts[1]}/${parts[2]}`;
    }
    return dateStr;
  };

  const [templates, setTemplates] = useState<Record<string, Category[]>>(() => {
    const savedTemplates = localStorage.getItem('templates');
    if (savedTemplates) {
      try {
        const parsed = JSON.parse(savedTemplates);
        const migrated: Record<string, Category[]> = { ...parsed };
        const keyMap: Record<string, string> = {
          '日勤': 'D',
          '遅番': 'S',
          '夜勤': 'N',
          '夜勤明け': '/',
          '休日': 'H'
        };
        Object.entries(keyMap).forEach(([oldKey, newKey]) => {
          if (migrated[oldKey] && !migrated[newKey]) {
            migrated[newKey] = migrated[oldKey];
          }
        });
        const sanitized: Record<string, Category[]> = {};
        Object.entries(migrated).forEach(([k, cats]) => {
          sanitized[k] = sanitizeCategories(cats);
        });
        return sanitized;
      } catch (e) {
        // ignore
      }
    }
    
    // Migration: If no templates, use existing categories as base for all shifts
    const currentSaved = localStorage.getItem('categories');
    const baseCategories = currentSaved ? JSON.parse(currentSaved) : defaultCategories;
    
    const cleanBase = baseCategories.map((c: Category) => ({
      ...c,
      items: c.items.map(t => ({ ...t, isDone: false, isSkipped: false }))
    }));

    const initialTemplates: Record<string, Category[]> = {};
    SHIFTS.forEach(shift => {
      initialTemplates[shift] = cleanBase;
    });
    return initialTemplates;
  });

  const [cards, setCards] = useState<Record<string, any>>(() => {
    const saved = localStorage.getItem('cards');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          const sanitized: Record<string, any> = {};
          Object.entries(parsed).forEach(([d, card]: [string, any]) => {
            if (card) {
              sanitized[d] = {
                ...card,
                categories: card.categories ? sanitizeCategories(card.categories) : card.categories
              };
            }
          });
          return sanitized;
        }
      } catch (e) {
        // ignore
      }
    }
    
    // Migration from old flat state
    const today = getTodayDate();
    const c = localStorage.getItem('categories');
    const categoriesData = c ? JSON.parse(c) : defaultCategories;
    const shiftData = localStorage.getItem('currentShift') || 'D';
    const sigData = localStorage.getItem('signature') || null;
    const rwData = localStorage.getItem('rewardImage') || null;
    
    return {
      [today]: {
        categories: categoriesData,
        currentShift: formatShift(shiftData) || 'D',
        signature: sigData,
        rewardImage: rwData
      }
    };
  });

  const [activeDate, setActiveDate] = useState<string>(getTodayDate());
  const [selectedIssueDate, setSelectedIssueDate] = useState<string>(getTodayDate());

  const [archivedCycles, setArchivedCycles] = useState<any[]>(() => {
    const saved = localStorage.getItem('archivedCycles');
    return saved ? JSON.parse(saved) : [];
  });

  const [masterCardTemplate, setMasterCardTemplate] = useState<Category[]>(() => {
    const saved = localStorage.getItem('masterCardTemplate');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return sanitizeCategories(parsed);
      } catch (e) {
        console.error(e);
      }
    }
    const currentSaved = localStorage.getItem('templates');
    if (currentSaved) {
      try {
        const parsed = JSON.parse(currentSaved);
        if (parsed['D']) {
          return sanitizeCategories(parsed['D']);
        }
        if (parsed['日勤']) {
          return sanitizeCategories(parsed['日勤']);
        }
      } catch (e) {}
    }
    return defaultCategories;
  });

  const [monthlyKpis, setMonthlyKpis] = useState<MonthlyKpi[]>(() => {
    const saved = localStorage.getItem('monthlyKpis');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(sanitizeLoadedKpi);
        }
      } catch (e) {
        console.error(e);
      }
    }
    return defaultMonthlyKpis.map(sanitizeLoadedKpi);
  });

  const [isKpiView, setIsKpiView] = useState(false);
  const [editingKpiId, setEditingKpiId] = useState<string | null>(null);
  const [editKpiTitle, setEditKpiTitle] = useState('');
  const [editKpiType, setEditKpiType] = useState<'check' | 'number' | 'text'>('number');
  const [editKpiTarget, setEditKpiTarget] = useState<number | string>(10);
  const [editKpiLinkEnabled, setEditKpiLinkEnabled] = useState(false);
  const [editKpiLinkSource, setEditKpiLinkSource] = useState<KpiLinkConfig['sourceType']>('sleep');
  const [editKpiLinkThreshold, setEditKpiLinkThreshold] = useState<number | string>(7.0);
  const [editKpiLinkOperator, setEditKpiLinkOperator] = useState<'>=' | '<=' | 'recorded'>('>=');
  const [editKpiLinkTaskName, setEditKpiLinkTaskName] = useState<string>('');

  const [isAddingKpi, setIsAddingKpi] = useState(false);
  const [newKpiTitle, setNewKpiTitle] = useState('');
  const [newKpiType, setNewKpiType] = useState<'check' | 'number' | 'text'>('number');
  const [newKpiTarget, setNewKpiTarget] = useState<number | string>(10);
  const [newKpiLinkEnabled, setNewKpiLinkEnabled] = useState(false);
  const [newKpiLinkSource, setNewKpiLinkSource] = useState<KpiLinkConfig['sourceType']>('sleep');
  const [newKpiLinkThreshold, setNewKpiLinkThreshold] = useState<number | string>(7.0);
  const [newKpiLinkOperator, setNewKpiLinkOperator] = useState<'>=' | '<=' | 'recorded'>('>=');
  const [newKpiLinkTaskName, setNewKpiLinkTaskName] = useState<string>('');

  const [isEditingMasterTemplate, setIsEditingMasterTemplate] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'menu' | 'rewards'>('menu');

  const lastSyncStr = useRef({ cards: '', templates: '', rewardImageUrls: '', archivedCycles: '', masterCardTemplate: '', monthlyKpis: '' });
  const [isFirebaseLoaded, setIsFirebaseLoaded] = useState(false);
  const isFirestoreLoadedRef = useRef({
    cards: false,
    templates: false,
    masterCardTemplate: false,
    monthlyKpis: false,
    archivedCycles: false
  });
  const cardsDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestCardsRef = useRef<Record<string, any>>(cards);
  latestCardsRef.current = cards;

  // Direct Firestore Sync functions for cards
  const performCardsSync = async (cardsToSync: Record<string, any>) => {
    if (!db || !isFirestoreLoadedRef.current.cards) return;
    const currentStr = JSON.stringify(cardsToSync);
    if (currentStr === lastSyncStr.current.cards) return;
    try {
      const cleanPayload = JSON.parse(currentStr);
      await updateDoc(doc(db!, 'appData', 'sharedState'), { cards: cleanPayload }).catch(async (e) => {
        if (e.code === 'not-found') {
          await setDoc(doc(db!, 'appData', 'sharedState'), { cards: cleanPayload });
        } else {
          throw e;
        }
      });
      lastSyncStr.current.cards = currentStr;
    } catch (err) {
      console.error("Firestore sync error for cards:", err);
    }
  };

  // 即時保存（睡眠・体組成入力、タスク完了チェック、署名、カード発行/削除など離散的な確定アクション用）
  const saveCardsNow = (updatedCards: Record<string, any>) => {
    if (cardsDebounceTimer.current) {
      clearTimeout(cardsDebounceTimer.current);
      cardsDebounceTimer.current = null;
    }
    localStorage.setItem('cards', JSON.stringify(updatedCards));
    latestCardsRef.current = updatedCards;
    performCardsSync(updatedCards);
  };

  // 遅延保存（テキストタイピング用: 400ms デバウンス）
  const saveCardsDebounced = (updatedCards: Record<string, any>) => {
    localStorage.setItem('cards', JSON.stringify(updatedCards));
    latestCardsRef.current = updatedCards;
    if (cardsDebounceTimer.current) {
      clearTimeout(cardsDebounceTimer.current);
    }
    cardsDebounceTimer.current = setTimeout(() => {
      cardsDebounceTimer.current = null;
      performCardsSync(latestCardsRef.current);
    }, 400);
  };

  // アプリがバックグラウンドに回った時や離脱時に、タイマー待ちの変更を直ちにフラッシュ
  useEffect(() => {
    const handleFlush = () => {
      if (cardsDebounceTimer.current) {
        clearTimeout(cardsDebounceTimer.current);
        cardsDebounceTimer.current = null;
        performCardsSync(latestCardsRef.current);
      }
    };

    document.addEventListener('visibilitychange', handleFlush);
    window.addEventListener('pagehide', handleFlush);
    window.addEventListener('beforeunload', handleFlush);

    return () => {
      document.removeEventListener('visibilitychange', handleFlush);
      window.removeEventListener('pagehide', handleFlush);
      window.removeEventListener('beforeunload', handleFlush);
    };
  }, []);

  // Sync from Firestore with intelligent local data protection
  useEffect(() => {
    if (!db) {
      setIsFirebaseLoaded(true);
      return;
    }
    const docRef = doc(db, 'appData', 'sharedState');
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists() && !docSnap.metadata.hasPendingWrites) {
        const data = docSnap.data();

        // 1. CARDS 同期 (HABITS CARD)
        if (data.cards) {
          setCards(prevCards => {
            const merged = { ...data.cards };

            for (const [dateKey, localCard] of Object.entries(prevCards)) {
              const remoteCard = merged[dateKey];
              if (!remoteCard) {
                merged[dateKey] = localCard;
              } else {
                // basicData の保護 (睡眠時間)
                const localBasic = localCard.basicData || {};
                const remoteBasic = remoteCard.basicData || {};
                const localHasSleep = Boolean(localBasic.sleepStart && localBasic.sleepEnd);
                const remoteHasSleep = Boolean(remoteBasic.sleepStart && remoteBasic.sleepEnd);

                const mergedBasic = { ...remoteBasic };
                if (localHasSleep && !remoteHasSleep) {
                  mergedBasic.sleepStart = localBasic.sleepStart;
                  mergedBasic.sleepEnd = localBasic.sleepEnd;
                }
                if (localBasic.skippedFields && (!remoteBasic.skippedFields || remoteBasic.skippedFields.length === 0)) {
                  mergedBasic.skippedFields = localBasic.skippedFields;
                }

                // 完了タスク & 累積時間の保護 (リモート構成を常に正とする)
                const remoteCats = Array.isArray(remoteCard.categories) ? remoteCard.categories : [];
                const localCats = Array.isArray(localCard.categories) ? localCard.categories : [];

                const mergedCategories = sanitizeCategories(remoteCats.map((rc: any) => {
                  const lc = localCats.find((c: any) => c.id === rc.id || c.name?.trim().toLowerCase() === rc.name?.trim().toLowerCase());
                  if (!lc) return rc;

                  const newItems = (rc.items || []).map((ri: any) => {
                    const li = (lc.items || []).find((i: any) => i.id === ri.id || i.task?.trim().toLowerCase() === ri.task?.trim().toLowerCase());
                    if (!li) return ri;
                    const isDone = Boolean(li.isDone || ri.isDone);
                    const accumulatedMinutes = Math.max(Number(li.accumulatedMinutes) || 0, Number(ri.accumulatedMinutes) || 0);
                    const isSkipped = Boolean(li.isSkipped || ri.isSkipped);
                    const resolvedType = ri.type || li.type || 'check';

                    return {
                      ...ri,
                      type: resolvedType,
                      isDone,
                      isSkipped,
                      accumulatedMinutes: accumulatedMinutes > 0 ? accumulatedMinutes : undefined
                    };
                  });
                  return { ...rc, items: newItems };
                }));

                // ローカルにのみ存在する新規追加カテゴリがあれば保護 (デフォルト初期値 General 1つは除外)
                localCats.forEach((lc: any) => {
                  const existsInRemote = remoteCats.some((rc: any) => rc.id === lc.id || rc.name?.trim().toLowerCase() === lc.name?.trim().toLowerCase());
                  const isDefaultSingleGeneral = localCats.length === 1 && lc.id === 'cat-general' && remoteCats.length > 1;
                  if (!existsInRemote && !isDefaultSingleGeneral) {
                    mergedCategories.push(lc);
                  }
                });

                merged[dateKey] = {
                  ...remoteCard,
                  categories: mergedCategories,
                  basicData: mergedBasic,
                  signOffNote: remoteCard.signOffNote || localCard.signOffNote || '',
                  newThings: remoteCard.newThings || localCard.newThings || '',
                  momentOfTheDay: remoteCard.momentOfTheDay || localCard.momentOfTheDay || '',
                  appreciate: remoteCard.appreciate || localCard.appreciate || '',
                  signature: remoteCard.signature || localCard.signature || null,
                  dayRating: remoteCard.dayRating || localCard.dayRating || 0
                };
              }
            }

            // 全カードを sanitizeCategories に通してタスク名等を自動修復
            Object.keys(merged).forEach(dateKey => {
              if (merged[dateKey] && merged[dateKey].categories) {
                merged[dateKey] = {
                  ...merged[dateKey],
                  categories: sanitizeCategories(merged[dateKey].categories)
                };
              }
            });

            const cardsStr = JSON.stringify(merged);
            localStorage.setItem('cards', cardsStr);
            lastSyncStr.current.cards = cardsStr;
            isFirestoreLoadedRef.current.cards = true;

            return merged;
          });

          // activeDate が cards に存在しない場合、今日または最新の日付に安全にフォールバック
          setActiveDate(prevActiveDate => {
            const dateKeys = Object.keys(data.cards).sort();
            if (dateKeys.length === 0) return prevActiveDate;
            if (data.cards[prevActiveDate]) return prevActiveDate;
            const today = getTodayDate();
            if (data.cards[today]) return today;
            return dateKeys[dateKeys.length - 1];
          });
        }

        // 2. TEMPLATES 同期 (シフト別テンプレート)
        if (data.templates) {
          const sanitizedTemplates: Record<string, Category[]> = {};
          Object.entries(data.templates).forEach(([shiftKey, cats]: [string, any]) => {
            sanitizedTemplates[shiftKey] = sanitizeCategories(cats);
          });
          const templatesStr = JSON.stringify(sanitizedTemplates);
          localStorage.setItem('templates', templatesStr);
          lastSyncStr.current.templates = templatesStr;
          isFirestoreLoadedRef.current.templates = true;
          setTemplates(sanitizedTemplates);
        }

        // 3. MASTER CARD TEMPLATE 同期
        if (data.masterCardTemplate) {
          const sanitizedMaster = sanitizeCategories(data.masterCardTemplate);
          const masterStr = JSON.stringify(sanitizedMaster);
          localStorage.setItem('masterCardTemplate', masterStr);
          lastSyncStr.current.masterCardTemplate = masterStr;
          isFirestoreLoadedRef.current.masterCardTemplate = true;
          setMasterCardTemplate(sanitizedMaster);
        }

        // 4. REWARD IMAGE URLS 同期
        if (data.rewardImageUrls !== undefined) {
          lastSyncStr.current.rewardImageUrls = data.rewardImageUrls;
          localStorage.setItem('rewardImageUrls', data.rewardImageUrls);
          setRewardImageUrls(data.rewardImageUrls);
        }

        // 5. MONTHLY KPIS 同期 (月次目標)
        if (data.monthlyKpis && Array.isArray(data.monthlyKpis)) {
          const sanitizedKpis = data.monthlyKpis.map(sanitizeLoadedKpi);
          const kpisStr = JSON.stringify(sanitizedKpis);
          localStorage.setItem('monthlyKpis', kpisStr);
          lastSyncStr.current.monthlyKpis = kpisStr;
          isFirestoreLoadedRef.current.monthlyKpis = true;
          setMonthlyKpis(sanitizedKpis);
        }

        // 6. ARCHIVED CYCLES 同期 (過去アーカイブ)
        if (data.archivedCycles && Array.isArray(data.archivedCycles)) {
          const cyclesStr = JSON.stringify(data.archivedCycles);
          localStorage.setItem('archivedCycles', cyclesStr);
          lastSyncStr.current.archivedCycles = cyclesStr;
          isFirestoreLoadedRef.current.archivedCycles = true;
          setArchivedCycles(data.archivedCycles);
        }
      }
      setIsFirebaseLoaded(true);
    }, (error) => {
      console.error("Firebase sync error:", error);
      setIsFirebaseLoaded(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const currentStr = JSON.stringify(archivedCycles);
    localStorage.setItem('archivedCycles', currentStr);
    
    if (isFirebaseLoaded && db && isFirestoreLoadedRef.current.archivedCycles && currentStr !== lastSyncStr.current.archivedCycles) {
      try {
        const cleanPayload = JSON.parse(currentStr);
        setDoc(doc(db, 'appData', 'sharedState'), { archivedCycles: cleanPayload }, { merge: true })
          .then(() => {
            lastSyncStr.current.archivedCycles = currentStr;
          })
          .catch((err) => {
            console.error("Firestore sync error for archivedCycles:", err);
            if (err && (err.code === 'resource-exhausted' || err.message?.includes('exceeds maximum allowed size'))) {
              alert("⚠️ データベース容量の制限によりアーカイブの同期に失敗しました。管理者に確認してください。");
            }
          });
      } catch (err) {
        console.error("Firestore serialization error for archivedCycles:", err);
      }
    }
  }, [archivedCycles, isFirebaseLoaded]);

  useEffect(() => {
    const currentStr = JSON.stringify(masterCardTemplate);
    localStorage.setItem('masterCardTemplate', currentStr);
    
    if (isFirebaseLoaded && db && isFirestoreLoadedRef.current.masterCardTemplate && currentStr !== lastSyncStr.current.masterCardTemplate) {
      try {
        const cleanPayload = JSON.parse(currentStr);
        updateDoc(doc(db, 'appData', 'sharedState'), { masterCardTemplate: cleanPayload })
          .then(() => {
            lastSyncStr.current.masterCardTemplate = currentStr;
          })
          .catch(async (e) => {
            if (e.code === 'not-found') {
              await setDoc(doc(db!, 'appData', 'sharedState'), { masterCardTemplate: cleanPayload });
              lastSyncStr.current.masterCardTemplate = currentStr;
            } else {
              console.error("Firestore sync error for masterCardTemplate:", e);
            }
          });
      } catch (err) {
        console.error("Firestore sync error for masterCardTemplate:", err);
      }
    }
  }, [masterCardTemplate, isFirebaseLoaded]);

  useEffect(() => {
    const cleanKpis = monthlyKpis.map(kpi => {
      const obj: any = {
        id: String(kpi.id),
        title: String(kpi.title || ''),
        type: kpi.type,
        currentValue: kpi.currentValue
      };
      if (kpi.type === 'number' && typeof kpi.targetValue === 'number' && !Number.isNaN(kpi.targetValue)) {
        obj.targetValue = kpi.targetValue;
      }
      if (kpi.linkConfig && kpi.linkConfig.enabled) {
        const linkObj: any = {
          enabled: true,
          sourceType: kpi.linkConfig.sourceType
        };
        if (kpi.linkConfig.operator) linkObj.operator = kpi.linkConfig.operator;
        if (kpi.linkConfig.threshold !== undefined && !Number.isNaN(Number(kpi.linkConfig.threshold))) {
          linkObj.threshold = Number(kpi.linkConfig.threshold);
        }
        if (kpi.linkConfig.taskName) linkObj.taskName = String(kpi.linkConfig.taskName);
        if (kpi.linkConfig.ratingThreshold !== undefined) {
          linkObj.ratingThreshold = Number(kpi.linkConfig.ratingThreshold);
        }
        obj.linkConfig = linkObj;
      }
      return obj;
    });

    const currentStr = JSON.stringify(cleanKpis);
    localStorage.setItem('monthlyKpis', currentStr);
    
    if (isFirebaseLoaded && db && isFirestoreLoadedRef.current.monthlyKpis && currentStr !== lastSyncStr.current.monthlyKpis) {
      try {
        const cleanPayload = JSON.parse(currentStr);
        updateDoc(doc(db, 'appData', 'sharedState'), { monthlyKpis: cleanPayload })
          .then(() => {
            lastSyncStr.current.monthlyKpis = currentStr;
          })
          .catch(async (e) => {
            if (e.code === 'not-found') {
              await setDoc(doc(db!, 'appData', 'sharedState'), { monthlyKpis: cleanPayload });
              lastSyncStr.current.monthlyKpis = currentStr;
            } else {
              console.error("Firestore sync error for monthlyKpis:", e);
            }
          });
      } catch (err) {
        console.error("Firestore serialization error for monthlyKpis:", err);
      }
    }
  }, [monthlyKpis, isFirebaseLoaded]);

  const [isArchiveListOpen, setIsArchiveListOpen] = useState(false);
  const [isArchiveView, setIsArchiveView] = useState(false);
  const [viewingArchivedCycle, setViewingArchivedCycle] = useState<{ cycleData: Record<string, any>, activeDate: string } | null>(null);

  const displayCards = viewingArchivedCycle ? viewingArchivedCycle.cycleData : cards;
  const currentActiveDate = viewingArchivedCycle ? viewingArchivedCycle.activeDate : activeDate;

  // Derived state for the active tab or master template
  const fallbackCategories = (masterCardTemplate && masterCardTemplate.length > 0) ? masterCardTemplate : defaultCategories;
  const activeCard = displayCards[currentActiveDate] || {
    categories: fallbackCategories,
    currentShift: 'D',
    signature: null,
    rewardImage: null,
    dayRating: 0,
    signOffNote: '',
    newThings: '',
    momentOfTheDay: '',
    appreciate: '',
    basicData: {}
  };

  const categories: Category[] = sanitizeCategories(
    isEditingMasterTemplate ? masterCardTemplate : activeCard?.categories
  );
  const currentShift: string = isEditingMasterTemplate ? 'MASTER' : activeCard.currentShift;
  const signature: string | null = isEditingMasterTemplate ? null : activeCard.signature;
  const rewardImage: string | null = isEditingMasterTemplate ? null : activeCard.rewardImage;
  const dayRating: number = isEditingMasterTemplate ? 0 : (activeCard.dayRating || 0);
  const signOffNote: string = isEditingMasterTemplate ? '' : (activeCard.signOffNote || '');
  const newThings: string = isEditingMasterTemplate ? '' : (activeCard.newThings || '');
  const momentOfTheDay: string = isEditingMasterTemplate ? '' : (activeCard.momentOfTheDay || '');
  const appreciate: string = isEditingMasterTemplate ? '' : (activeCard.appreciate || '');
  const basicData: BasicData = isEditingMasterTemplate ? {} : (activeCard.basicData || {});

  const setBasicData = (newData: Partial<BasicData>) => {
    if (viewingArchivedCycle || isEditingMasterTemplate) return;
    setCards(prev => {
      const card = prev[activeDate] || { 
        categories: fallbackCategories, 
        currentShift: 'D', 
        signature: null, 
        rewardImage: null,
        basicData: {} 
      };
      const updatedBasicData: BasicData = {
        ...(card.basicData || {}),
        ...newData
      };
      const next = {
        ...prev,
        [activeDate]: {
          ...card,
          basicData: updatedBasicData
        }
      };
      saveCardsNow(next);
      return next;
    });
  };

  const setCategories = (newCats: any, isTyping = false) => {
    if (viewingArchivedCycle) return;
    if (isEditingMasterTemplate) {
      setMasterCardTemplate(prev => {
        return typeof newCats === 'function' ? newCats(prev) : newCats;
      });
      return;
    }
    setCards(prev => {
      const card = prev[activeDate] || { categories: fallbackCategories, currentShift: 'D', signature: null, rewardImage: null };
      const resolved = typeof newCats === 'function' ? newCats(card.categories) : newCats;
      const next = { ...prev, [activeDate]: { ...card, categories: resolved } };
      if (isTyping) {
        saveCardsDebounced(next);
      } else {
        saveCardsNow(next);
      }
      return next;
    });
  };

  const setSignature = (sig: string | null) => {
    if (viewingArchivedCycle) return;
    setCards(prev => {
      if (!prev[activeDate] && sig === null) return prev;
      const card = prev[activeDate] || { categories: fallbackCategories, currentShift: 'D', signature: null, rewardImage: null };
      const next = { ...prev, [activeDate]: { ...card, signature: sig } };
      saveCardsNow(next);
      return next;
    });
  };

  const setRewardImage = (img: string | null) => {
    if (viewingArchivedCycle) return;
    setCards(prev => {
      if (!prev[activeDate] && img === null) return prev;
      const card = prev[activeDate] || { categories: fallbackCategories, currentShift: 'D', signature: null, rewardImage: null, dayRating: 0, signOffNote: '' };
      const next = { ...prev, [activeDate]: { ...card, rewardImage: img } };
      saveCardsNow(next);
      return next;
    });
  };

  const setDayRating = (rating: number) => {
    if (viewingArchivedCycle) return;
    setCards(prev => {
      const card = prev[activeDate] || { categories: fallbackCategories, currentShift: 'D', signature: null, rewardImage: null, dayRating: 0, signOffNote: '' };
      const next = { ...prev, [activeDate]: { ...card, dayRating: rating } };
      saveCardsNow(next);
      return next;
    });
  };

  const setSignOffNote = (note: string) => {
    if (viewingArchivedCycle) return;
    setCards(prev => {
      const card = prev[activeDate] || { categories: fallbackCategories, currentShift: 'D', signature: null, rewardImage: null, dayRating: 0, signOffNote: '' };
      const next = { ...prev, [activeDate]: { ...card, signOffNote: note } };
      saveCardsDebounced(next);
      return next;
    });
  };

  const setNewThings = (val: string) => {
    if (viewingArchivedCycle) return;
    setCards(prev => {
      const card = prev[activeDate] || { categories: fallbackCategories, currentShift: 'D', signature: null, rewardImage: null, dayRating: 0, signOffNote: '' };
      const next = { ...prev, [activeDate]: { ...card, newThings: val } };
      saveCardsDebounced(next);
      return next;
    });
  };

  const setMomentOfTheDay = (val: string) => {
    if (viewingArchivedCycle) return;
    setCards(prev => {
      const card = prev[activeDate] || { categories: fallbackCategories, currentShift: 'D', signature: null, rewardImage: null, dayRating: 0, signOffNote: '' };
      const next = { ...prev, [activeDate]: { ...card, momentOfTheDay: val } };
      saveCardsDebounced(next);
      return next;
    });
  };

  const setAppreciate = (val: string) => {
    if (viewingArchivedCycle) return;
    setCards(prev => {
      const card = prev[activeDate] || { categories: fallbackCategories, currentShift: 'D', signature: null, rewardImage: null, dayRating: 0, signOffNote: '' };
      const next = { ...prev, [activeDate]: { ...card, appreciate: val } };
      saveCardsDebounced(next);
      return next;
    });
  };

  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isSleepModalOpen, setIsSleepModalOpen] = useState(false);
  const [tempSleepStart, setTempSleepStart] = useState('');
  const [tempSleepEnd, setTempSleepEnd] = useState('');

  const openSleepModal = () => {
    if (viewingArchivedCycle || isEditingMasterTemplate) return;
    setTempSleepStart(basicData.sleepStart || '23:00');
    setTempSleepEnd(basicData.sleepEnd || '07:00');
    setIsSleepModalOpen(true);
  };

  const toggleBasicDataSkipped = (field: string) => {
    if (viewingArchivedCycle || isEditingMasterTemplate) return;
    const currentSkipped = basicData.skippedFields || [];
    const isCurrentlySkipped = currentSkipped.includes(field);
    const newSkipped = isCurrentlySkipped
      ? currentSkipped.filter(f => f !== field)
      : [...currentSkipped, field];
    setBasicData({ skippedFields: newSkipped });
  };

  // --- STUDY TIMER STATE & HANDLERS ---
  const [isStudyTimerModalOpen, setIsStudyTimerModalOpen] = useState(false);
  const [timerTargetTask, setTimerTargetTask] = useState<{
    categoryId: string;
    habitId: string;
    categoryName: string;
    taskName: string;
    targetMinutes: number;
  } | null>(null);

  const [timerIsRunning, setTimerIsRunning] = useState(false);
  const [timerSessionSeconds, setTimerSessionSeconds] = useState(0);
  const [timerAccumulatedSeconds, setTimerAccumulatedSeconds] = useState(0);
  const [timerLastSessionSeconds, setTimerLastSessionSeconds] = useState(0);
  const timerStartTimestampRef = useRef<number | null>(null);

  const updateStudyTaskTime = (totalSeconds: number, targetTaskOverride?: typeof timerTargetTask) => {
    const task = targetTaskOverride || timerTargetTask;
    if (!task) return;
    const finalMinutes = totalSeconds > 0 ? Math.max(1, Math.round(totalSeconds / 60)) : 0;
    const targetMins = task.targetMinutes;
    const isCompleted = targetMins > 0 ? finalMinutes >= targetMins : finalMinutes > 0;

    setCategories(categories.map(c => {
      if (c.id === task.categoryId) {
        return {
          ...c,
          items: c.items.map(t => {
            if (t.id === task.habitId) {
              return {
                ...t,
                accumulatedMinutes: finalMinutes,
                isDone: isCompleted
              };
            }
            return t;
          })
        };
      }
      return c;
    }));
  };

  const openStudyTimerModal = (category: Category, habit: Habit) => {
    if (viewingArchivedCycle || isEditingMasterTemplate) return;
    const targetMins = habit.time ? parseInt(habit.time, 10) : 0;
    const currentMins = habit.accumulatedMinutes || 0;
    
    setTimerTargetTask({
      categoryId: category.id,
      habitId: habit.id,
      categoryName: category.name,
      taskName: habit.task,
      targetMinutes: isNaN(targetMins) ? 0 : targetMins
    });
    setTimerIsRunning(false);
    setTimerSessionSeconds(0);
    setTimerLastSessionSeconds(0);
    setTimerAccumulatedSeconds(currentMins * 60);
    timerStartTimestampRef.current = null;
    setIsStudyTimerModalOpen(true);
  };

  useEffect(() => {
    let interval: any = null;
    if (timerIsRunning) {
      if (!timerStartTimestampRef.current) {
        timerStartTimestampRef.current = Date.now() - timerSessionSeconds * 1000;
      }
      interval = setInterval(() => {
        if (timerStartTimestampRef.current) {
          const elapsed = Math.floor((Date.now() - timerStartTimestampRef.current) / 1000);
          setTimerSessionSeconds(elapsed);
        }
      }, 250);
    } else {
      if (interval) clearInterval(interval);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [timerIsRunning]);

  const handleStartTimer = () => {
    timerStartTimestampRef.current = Date.now() - timerSessionSeconds * 1000;
    setTimerIsRunning(true);
  };

  const handleStopTimer = () => {
    setTimerIsRunning(false);
    const newTotal = timerAccumulatedSeconds + timerSessionSeconds;
    setTimerAccumulatedSeconds(newTotal);
    setTimerLastSessionSeconds(timerSessionSeconds);
    setTimerSessionSeconds(0);
    timerStartTimestampRef.current = null;
    updateStudyTaskTime(newTotal);
  };

  const handleAdjustTimerMinutes = (deltaMinutes: number) => {
    const curSession = timerIsRunning ? timerSessionSeconds : 0;
    setTimerAccumulatedSeconds(prev => {
      const newTotal = Math.max(0, prev + deltaMinutes * 60);
      updateStudyTaskTime(newTotal + curSession);
      return newTotal;
    });
  };

  const handleResetTimer = () => {
    if (window.confirm("本日のタイマー記録をリセットしますか？")) {
      setTimerIsRunning(false);
      setTimerSessionSeconds(0);
      setTimerLastSessionSeconds(0);
      setTimerAccumulatedSeconds(0);
      timerStartTimestampRef.current = null;
      updateStudyTaskTime(0);
    }
  };

  const handleSaveAndCloseTimer = () => {
    if (!timerTargetTask) {
      setIsStudyTimerModalOpen(false);
      return;
    }

    let finalTotalSeconds = timerAccumulatedSeconds;
    if (timerIsRunning) {
      finalTotalSeconds += timerSessionSeconds;
      setTimerIsRunning(false);
      setTimerAccumulatedSeconds(finalTotalSeconds);
      setTimerSessionSeconds(0);
    }

    updateStudyTaskTime(finalTotalSeconds);
    setIsStudyTimerModalOpen(false);
  };
  
  const [rewardImageUrls, setRewardImageUrls] = useState(() => localStorage.getItem('rewardImageUrls') || '');
  const [isFetchingReward, setIsFetchingReward] = useState(false);
  const [rewardError, setRewardError] = useState<string | null>(null);
  
  const signaturePadRef = useRef<SignatureCanvas>(null);
  const prevIsAllTasksCompleted = useRef<boolean | null>(null);

  useEffect(() => {
    localStorage.setItem('rewardImageUrls', rewardImageUrls);
    
    if (isFirebaseLoaded && db && rewardImageUrls !== lastSyncStr.current.rewardImageUrls) {
      lastSyncStr.current.rewardImageUrls = rewardImageUrls;
      setDoc(doc(db, 'appData', 'sharedState'), { rewardImageUrls }, { merge: true }).catch(console.error);
    }
  }, [rewardImageUrls, isFirebaseLoaded]);
  useEffect(() => {
    if (isSignatureModalOpen && signaturePadRef.current) {
      const timer = setTimeout(() => {
        const canvas = signaturePadRef.current?.getCanvas();
        if (canvas) {
          const ratio = Math.max(window.devicePixelRatio || 1, 1);
          canvas.width = canvas.offsetWidth * ratio;
          canvas.height = canvas.offsetHeight * ratio;
          canvas.getContext("2d")?.scale(ratio, ratio);
          signaturePadRef.current?.clear();
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isSignatureModalOpen]);

  useEffect(() => {
    const currentStr = JSON.stringify(templates);
    localStorage.setItem('templates', currentStr);
    
    if (isFirebaseLoaded && db && isFirestoreLoadedRef.current.templates && currentStr !== lastSyncStr.current.templates) {
      try {
        const cleanPayload = JSON.parse(currentStr);
        updateDoc(doc(db, 'appData', 'sharedState'), { templates: cleanPayload })
          .then(() => {
            lastSyncStr.current.templates = currentStr;
          })
          .catch(async (e) => {
            if (e.code === 'not-found') {
              await setDoc(doc(db!, 'appData', 'sharedState'), { templates: cleanPayload });
              lastSyncStr.current.templates = currentStr;
            } else {
              console.error("Firestore sync error for templates:", e);
            }
          });
      } catch (err) {
        console.error("Firestore sync error for templates:", err);
      }
    }
  }, [templates, isFirebaseLoaded]);

  useEffect(() => {
    // Auto-save to template when editing
    if (isEditMode && !isEditingMasterTemplate) {
      const cleanCategories = categories.map(c => ({
        ...c,
        items: c.items.map(t => ({ ...t, isDone: false, isSkipped: false }))
      }));
      setTemplates(prev => ({ ...prev, [currentShift]: cleanCategories }));
    }
  }, [categories, isEditMode, currentShift, isEditingMasterTemplate]);

  const hasSleepTime = Boolean(basicData.sleepStart && basicData.sleepEnd);

  // 睡眠データ（BASIC DATA）は Complete Check 要件から除外（カテゴリタスクのみで判定）
  const totalTasks = categories.reduce((sum, cat) => sum + (Array.isArray(cat?.items) ? cat.items.length : 0), 0);
  const completedOrSkippedTasks = categories.reduce((sum, cat) => sum + (Array.isArray(cat?.items) ? cat.items.filter(t => t?.isDone || t?.isSkipped).length : 0), 0);
  const isAllTasksCompleted = totalTasks > 0 && totalTasks === completedOrSkippedTasks;

  useEffect(() => {
    // 初回マウント時は実行しない。true→falseに変化したときのみリセット
    if (prevIsAllTasksCompleted.current === true && !isAllTasksCompleted) {
      setSignature(null);
      setRewardImage(null);
      setRewardError(null);
    }
    prevIsAllTasksCompleted.current = isAllTasksCompleted;
  }, [isAllTasksCompleted]);

  const scrollToLatestArchiveMonth = (behavior: ScrollBehavior = 'auto') => {
    const scroll = () => {
      const el = document.getElementById('archive-latest-month');
      if (el) {
        el.scrollIntoView({ behavior, block: 'start' });
      }
    };
    requestAnimationFrame(() => {
      scroll();
      setTimeout(scroll, 60);
    });
  };

  useEffect(() => {
    if (isArchiveView && !viewingArchivedCycle) {
      scrollToLatestArchiveMonth('auto');
    }
  }, [isArchiveView, viewingArchivedCycle]);

  const fetchRewardImage = async () => {
    if (!rewardImageUrls) {
      setRewardError('⚙️ Reward Settings に ご褒美画像のURLを設定してください。');
      return;
    }
    
    setIsFetchingReward(true);
    setRewardError(null);
    try {
      const urlsArray = rewardImageUrls.split('\n').map(u => u.trim()).filter(u => u);
      if (urlsArray.length === 0) {
        setRewardError('有効なURLが設定されていません。');
        setIsFetchingReward(false);
        return;
      }
      
      const randomUrl = urlsArray[Math.floor(Math.random() * urlsArray.length)];
      
      // 念のため少しだけ「取得中」っぽく見せるためのディレイ
      await new Promise(resolve => setTimeout(resolve, 600));
      
      setRewardImage(randomUrl);
    } catch (error) {
      console.error("Failed to set reward image", error);
      setRewardError('エラーが発生しました。');
    } finally {
      setIsFetchingReward(false);
    }
  };

  const toggleMode = () => {
    if (isEditMode) {
      if (cardsDebounceTimer.current) {
        clearTimeout(cardsDebounceTimer.current);
        cardsDebounceTimer.current = null;
        performCardsSync(latestCardsRef.current);
      }
    }
    setIsEditMode(!isEditMode);
  };

  const handleDragEnd = (result: DropResult) => {
    const { source, destination, type } = result;
    if (!destination) return;

    if (type === 'category') {
      const newCategories = Array.from(categories);
      const [reorderedCategory] = newCategories.splice(source.index, 1);
      newCategories.splice(destination.index, 0, reorderedCategory);
      setCategories(newCategories);
      return;
    }

    if (source.droppableId === destination.droppableId) {
      const categoryIndex = categories.findIndex(c => c.id === source.droppableId);
      const category = categories[categoryIndex];
      const newItems = Array.from(category.items);
      const [reorderedItem] = newItems.splice(source.index, 1);
      newItems.splice(destination.index, 0, reorderedItem);

      const newCategories = [...categories];
      newCategories[categoryIndex] = { ...category, items: newItems };
      setCategories(newCategories);
    } else {
      const sourceCatIndex = categories.findIndex(c => c.id === source.droppableId);
      const destCatIndex = categories.findIndex(c => c.id === destination.droppableId);
      
      const sourceItems = Array.from(categories[sourceCatIndex].items);
      const destItems = Array.from(categories[destCatIndex].items);
      
      const [movedItem] = sourceItems.splice(source.index, 1);
      destItems.splice(destination.index, 0, movedItem);

      const newCategories = [...categories];
      newCategories[sourceCatIndex] = { ...categories[sourceCatIndex], items: sourceItems };
      newCategories[destCatIndex] = { ...categories[destCatIndex], items: destItems };
      setCategories(newCategories);
    }
  };

  const handleTaskChange = (categoryId: string, taskId: string, newTaskName: string) => {
    setCategories(categories.map(c => {
      if (c.id === categoryId) {
        return {
          ...c,
          items: c.items.map(t => t.id === taskId ? { ...t, task: newTaskName } : t)
        };
      }
      return c;
    }), true);
  };

  const handleDescriptionChange = (categoryId: string, taskId: string, newDescription: string) => {
    setCategories(categories.map(c => {
      if (c.id === categoryId) {
        return {
          ...c,
          items: c.items.map(t => t.id === taskId ? { ...t, description: newDescription } : t)
        };
      }
      return c;
    }), true);
  };

  const handleTimeChange = (categoryId: string, taskId: string, newTime: string) => {
    setCategories(categories.map(c => {
      if (c.id === categoryId) {
        return {
          ...c,
          items: c.items.map(t => {
            if (t.id === taskId) {
              const estimatedTime = newTime.trim() !== '' ? parseInt(newTime, 10) : undefined;
              const updatedHabit = { ...t, time: newTime };
              if (estimatedTime === undefined || Number.isNaN(estimatedTime)) {
                delete updatedHabit.estimatedTime;
              } else {
                updatedHabit.estimatedTime = estimatedTime;
              }
              return updatedHabit;
            }
            return t;
          })
        };
      }
      return c;
    }));
  };

  const toggleDone = (categoryId: string, taskId: string) => {
    if (isEditMode) return;
    setCategories(categories.map(c => {
      if (c.id === categoryId) {
        return {
          ...c,
          items: c.items.map(t => {
            if (t.id === taskId && !t.isSkipped) {
              return { ...t, isDone: !t.isDone };
            }
            return t;
          })
        };
      }
      return c;
    }));
  };

  const toggleSkipped = (categoryId: string, taskId: string) => {
    if (isEditMode) return;
    setCategories(categories.map(c => {
      if (c.id === categoryId) {
        return {
          ...c,
          items: c.items.map(t => t.id === taskId ? { ...t, isSkipped: !t.isSkipped, isDone: false } : t)
        };
      }
      return c;
    }));
  };

  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTouchStart = (categoryId: string, taskId: string) => {
    if (isEditMode) return;
    pressTimer.current = setTimeout(() => {
      if (window.confirm("この項目を削除しますか？")) {
        toggleSkipped(categoryId, taskId);
      }
    }, 800);
  };

  const handleTouchEnd = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const handleContextMenu = (e: React.MouseEvent, categoryId: string, taskId: string) => {
    e.preventDefault();
    if (isEditMode) return;
    if (window.confirm("この項目を削除しますか？")) {
      toggleSkipped(categoryId, taskId);
    }
  };

  const openShiftModal = () => {
    setIsShiftModalOpen(true);
  };

  const loadShiftTemplate = (shift: string) => {
    const normalizedShift = formatShift(shift);
    const legacyShiftKey = normalizedShift === 'D' ? '日勤' : normalizedShift === 'S' ? '遅番' : normalizedShift === 'N' ? '夜勤' : normalizedShift === '/' ? '夜勤明け' : normalizedShift === 'H' ? '休日' : '';
    const rawTemplate = (templates[normalizedShift] && templates[normalizedShift].length > 0)
      ? templates[normalizedShift]
      : (legacyShiftKey && templates[legacyShiftKey] && templates[legacyShiftKey].length > 0)
        ? templates[legacyShiftKey]
        : masterCardTemplate;
    const template = (rawTemplate && rawTemplate.length > 0) ? rawTemplate : defaultCategories;
    const cleanCategories = template.map(c => ({
      ...c,
      items: c.items.map(t => ({ ...t, isDone: false, isSkipped: false }))
    }));

    setCards(prev => {
      const newCards = { ...prev };

      newCards[selectedIssueDate] = {
        categories: cleanCategories,
        currentShift: normalizedShift,
        signature: null,
        rewardImage: null,
        basicData: {}
      };
      
      saveCardsNow(newCards);
      return newCards;
    });
    
    setActiveDate(selectedIssueDate);
    setIsShiftModalOpen(false);
  };

  const deleteHabit = (categoryId: string, taskId: string) => {
    setCategories(categories.map(c => {
      if (c.id === categoryId) {
        return { ...c, items: c.items.filter(t => t.id !== taskId) };
      }
      return c;
    }));
  };

  const handleTypeChange = (categoryId: string, taskId: string, newType: 'check' | 'timer') => {
    setCategories(categories.map(c => {
      if (c.id === categoryId) {
        return {
          ...c,
          items: c.items.map(t => t.id === taskId ? { ...t, type: newType } : t)
        };
      }
      return c;
    }));
  };

  const addHabit = (categoryId: string, defaultType: 'check' | 'timer' = 'check') => {
    const newId = `task-${Date.now()}`;
    const targetCat = categories.find(c => c.id === categoryId);
    const isStudyCat = (targetCat?.name || '').trim().toLowerCase() === 'study';
    const resolvedType = defaultType === 'timer' || isStudyCat ? 'timer' : 'check';
    setCategories(categories.map(c => {
      if (c.id === categoryId) {
        return { 
          ...c, 
          items: [
            ...c.items, 
            { 
              id: newId, 
              task: "", 
              description: "", 
              isDone: false,
              type: resolvedType
            }
          ] 
        };
      }
      return c;
    }));
  };

  const handleCategoryNameChange = (categoryId: string, newName: string) => {
    setCategories(categories.map(c => c.id === categoryId ? { ...c, name: newName } : c), true);
  };

  const deleteCategory = (categoryId: string) => {
    if (window.confirm("このカテゴリと中のすべての項目を削除しますか？")) {
      setCategories(categories.filter(c => c.id !== categoryId));
    }
  };

  const handleArchiveCycle = async () => {
    if (Object.keys(cards).length === 0) {
      alert("アーカイブ対象のカードがありません。");
      return;
    }

    if (window.confirm("現在のサイクルを終了し、過去ログにアーカイブしますか？")) {
      const cycleId = `cycle-${Date.now()}`;
      const newCycle = {
        cycleId,
        timestamp: Date.now(),
        cards: { ...cards }
      };
      const updatedCycles = [...archivedCycles, newCycle];

      // Firestore への先行アトミック保存（アーカイブ保存とカードクリアを同時実行）
      if (isFirebaseLoaded && db) {
        try {
          const cleanCycles = JSON.parse(JSON.stringify(updatedCycles));
          await setDoc(doc(db, 'appData', 'sharedState'), { 
            archivedCycles: cleanCycles,
            cards: {}
          }, { merge: true });
          lastSyncStr.current.archivedCycles = JSON.stringify(cleanCycles);
          lastSyncStr.current.cards = JSON.stringify({});
        } catch (err: any) {
          console.error("Archive sync error:", err);
          alert("アーカイブの保存中にエラーが発生しました: " + (err?.message || String(err)) + "\n現在のカードは保護されています。");
          return;
        }
      }
      
      setArchivedCycles(updatedCycles);
      setCards({});
      const today = getTodayDate();
      setSelectedIssueDate(today);
      setActiveDate(today);
      setIsArchiveView(false);
      setIsArchiveListOpen(false);
      setIsShiftModalOpen(true);
    }
  };

  const handleNavCard = () => {
    setIsKpiView(false);
    setIsArchiveView(false);
    setIsArchiveListOpen(false);
    setIsSettingsModalOpen(false);
    setIsEditingMasterTemplate(false);
    if (viewingArchivedCycle) {
      setViewingArchivedCycle(null);
    }
  };

  const handleNavKpi = () => {
    setIsKpiView(true);
    setIsArchiveView(false);
    setIsArchiveListOpen(false);
    setIsSettingsModalOpen(false);
    setIsEditingMasterTemplate(false);
    if (viewingArchivedCycle) {
      setViewingArchivedCycle(null);
    }
  };

  const handleNavArchive = () => {
    setIsKpiView(false);
    setIsArchiveView(true);
    setIsArchiveListOpen(false);
    setIsSettingsModalOpen(false);
    setIsEditingMasterTemplate(false);
    if (viewingArchivedCycle) {
      setViewingArchivedCycle(null);
    }
    scrollToLatestArchiveMonth('smooth');
  };

  const handleNavSettings = () => {
    setIsArchiveListOpen(false);
    setSettingsTab('menu');
    setIsSettingsModalOpen(true);
  };

  // KPI Handlers
  const handleAddKpi = () => {
    if (!newKpiTitle.trim()) {
      alert("KPIタイトルを入力してください");
      return;
    }
    const parsedTarget = typeof newKpiTarget === 'number' ? newKpiTarget : parseInt(newKpiTarget, 10);
    const targetValue = !isNaN(parsedTarget) && parsedTarget > 0 ? parsedTarget : 1;
    const linkConfig: KpiLinkConfig | undefined = newKpiLinkEnabled ? {
      enabled: true,
      sourceType: newKpiLinkSource,
      operator: newKpiLinkOperator,
      threshold: typeof newKpiLinkThreshold === 'number' ? newKpiLinkThreshold : parseFloat(newKpiLinkThreshold as string) || 7.0,
      taskName: newKpiLinkTaskName.trim()
    } : undefined;

    const newKpi: MonthlyKpi = {
      id: `kpi-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      title: newKpiTitle.trim(),
      type: newKpiType,
      currentValue: newKpiType === 'check' ? false : newKpiType === 'number' ? 0 : '',
      ...(newKpiType === 'number' ? { targetValue } : {}),
      linkConfig
    };
    setMonthlyKpis(prev => [...prev, newKpi]);
    setNewKpiTitle('');
    setNewKpiType('number');
    setNewKpiTarget(10);
    setNewKpiLinkEnabled(false);
    setNewKpiLinkSource('sleep');
    setNewKpiLinkThreshold(7.0);
    setNewKpiLinkOperator('>=');
    setNewKpiLinkTaskName('');
    setIsAddingKpi(false);
  };

  const handleStartEditKpi = (kpi: MonthlyKpi) => {
    setEditingKpiId(kpi.id);
    setEditKpiTitle(kpi.title);
    setEditKpiType(kpi.type);
    setEditKpiTarget(kpi.targetValue !== undefined ? kpi.targetValue : 10);
    setEditKpiLinkEnabled(Boolean(kpi.linkConfig?.enabled));
    setEditKpiLinkSource(kpi.linkConfig?.sourceType || 'sleep');
    setEditKpiLinkThreshold(kpi.linkConfig?.threshold !== undefined ? kpi.linkConfig.threshold : 7.0);
    setEditKpiLinkOperator(kpi.linkConfig?.operator || '>=');
    setEditKpiLinkTaskName(kpi.linkConfig?.taskName || '');
  };

  const handleSaveEditKpi = (id: string) => {
    if (!editKpiTitle.trim()) {
      alert("KPIタイトルを入力してください");
      return;
    }
    setMonthlyKpis(prev => prev.map(kpi => {
      if (kpi.id === id) {
        let newCurrentVal = kpi.currentValue;
        if (kpi.type !== editKpiType) {
          newCurrentVal = editKpiType === 'check' ? false : editKpiType === 'number' ? 0 : '';
        }
        const linkConfig: KpiLinkConfig | undefined = editKpiLinkEnabled ? {
          enabled: true,
          sourceType: editKpiLinkSource,
          operator: editKpiLinkOperator,
          threshold: typeof editKpiLinkThreshold === 'number' ? editKpiLinkThreshold : parseFloat(editKpiLinkThreshold as string) || 7.0,
          taskName: editKpiLinkTaskName.trim()
        } : undefined;

        const updated: MonthlyKpi = {
          ...kpi,
          title: editKpiTitle.trim(),
          type: editKpiType,
          currentValue: newCurrentVal,
          linkConfig
        };
        if (editKpiType === 'number') {
          const parsedTarget = typeof editKpiTarget === 'number' ? editKpiTarget : parseInt(editKpiTarget, 10);
          updated.targetValue = !isNaN(parsedTarget) && parsedTarget > 0 ? parsedTarget : 1;
        } else {
          delete updated.targetValue;
        }
        return updated;
      }
      return kpi;
    }));
    setEditingKpiId(null);
  };

  const handleDeleteKpi = (id: string, title: string) => {
    if (window.confirm(`KPI「${title}」を削除しますか？`)) {
      setMonthlyKpis(prev => prev.filter(kpi => kpi.id !== id));
      if (editingKpiId === id) setEditingKpiId(null);
    }
  };

  const handleToggleCheckKpi = (id: string) => {
    if (isEditMode) return;
    setMonthlyKpis(prev => prev.map(k => {
      if (k.id === id) {
        return { ...k, currentValue: !k.currentValue };
      }
      return k;
    }));
  };

  const handleUpdateNumberKpi = (id: string, delta: number) => {
    if (isEditMode) return;
    setMonthlyKpis(prev => prev.map(k => {
      if (k.id === id) {
        const current = typeof k.currentValue === 'number' ? k.currentValue : 0;
        const nextVal = Math.max(0, current + delta);
        return { ...k, currentValue: nextVal };
      }
      return k;
    }));
  };

  const handleTextKpiChange = (id: string, text: string) => {
    setMonthlyKpis(prev => prev.map(k => {
      if (k.id === id) {
        return { ...k, currentValue: text };
      }
      return k;
    }));
  };

  const handleKpiDragEnd = (result: DropResult) => {
    const { source, destination } = result;
    if (!destination) return;
    if (source.index === destination.index) return;

    const newKpis = Array.from(monthlyKpis);
    const [reorderedItem] = newKpis.splice(source.index, 1);
    newKpis.splice(destination.index, 0, reorderedItem);
    setMonthlyKpis(newKpis);
  };

  const handleLoadFromMaster = () => {
    try {
      const safeTemplate = sanitizeCategories(masterCardTemplate);
      if (!safeTemplate || safeTemplate.length === 0) {
        alert("マスターカード（テンプレート）が空です。SETTINGS > MASTER HABITS CARD からテンプレートを作成してください。");
        return;
      }

      const targetDate = currentActiveDate || activeDate || getTodayDate();
      const confirmMsg = `マスターカード（テンプレート）からタスク一覧を読み込みますか？\n\n※このカードの現在のタスク一覧はマスターの内容で上書きされます。\n※カードの「日付（${targetDate}）」や「シフト（[${currentShift}]）」の情報は保持されます。`;
      
      if (window.confirm(confirmMsg)) {
        const clonedCategories: Category[] = safeTemplate.map((cat, cIdx) => ({
          id: `cat-${Date.now()}-${cIdx}-${Math.random().toString(36).substring(2, 7)}`,
          name: cat.name !== undefined && cat.name !== null ? String(cat.name) : '',
          items: (cat.items || []).map((item, iIdx) => {
            const taskObj: Habit = {
              id: `task-${Date.now()}-${cIdx}-${iIdx}-${Math.random().toString(36).substring(2, 7)}`,
              task: item.task !== undefined && item.task !== null ? String(item.task) : '',
              description: item.description || '',
              time: item.time || (item.estimatedTime ? String(item.estimatedTime) : ''),
              isDone: false,
              isSkipped: false
            };
            if (typeof item.estimatedTime === 'number' && !Number.isNaN(item.estimatedTime)) {
              taskObj.estimatedTime = item.estimatedTime;
            }
            return taskObj;
          })
        }));

        setCards(prev => {
          const current = (prev && prev[targetDate]) ? prev[targetDate] : {
            categories: defaultCategories,
            currentShift: currentShift || 'D',
            signature: null,
            rewardImage: null,
            dayRating: 0,
            signOffNote: '',
            newThings: '',
            momentOfTheDay: '',
            appreciate: ''
          };

          const next = {
            ...prev,
            [targetDate]: {
              ...current,
              categories: clonedCategories
            }
          };
          saveCardsNow(next);
          return next;
        });

        setActiveDate(targetDate);
      }
    } catch (err) {
      console.error("Failed to load from master:", err);
      alert("マスターカードの読み込み中にエラーが発生しました: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const addCategory = () => {
    const newId = `cat-${Date.now()}`;
    setCategories([...categories, { id: newId, name: "", items: [] }]);
  };

  const tabPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rewardPreviewPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleRewardTouchStart = (urlToRemove: string) => {
    rewardPreviewPressTimer.current = setTimeout(() => {
      if (window.confirm("この画像を削除しますか？")) {
        setRewardImageUrls(prev => {
          const list = prev.split('\n').map(u => u.trim()).filter(u => u !== '');
          const newList = list.filter(u => u !== urlToRemove);
          return newList.join('\n');
        });
      }
    }, 800);
  };

  const handleRewardTouchEnd = () => {
    if (rewardPreviewPressTimer.current) {
      clearTimeout(rewardPreviewPressTimer.current);
      rewardPreviewPressTimer.current = null;
    }
  };

  const handleTabTouchStart = (dateStr: string) => {
    tabPressTimer.current = setTimeout(() => {
      if (window.confirm(`${formatDateLabel(dateStr)} のカードを削除しますか？`)) {
        setCards(prev => {
          const newCards = { ...prev };
          delete newCards[dateStr];
          
          if (activeDate === dateStr) {
             const remainingDates = Object.keys(newCards).sort();
             if (remainingDates.length > 0) {
               const today = getTodayDate();
               setActiveDate(newCards[today] ? today : remainingDates[0]);
             } else {
               setActiveDate(getTodayDate());
             }
          }
          saveCardsNow(newCards);
          return newCards;
        });
      }
    }, 800);
  };

  const handleTabTouchEnd = () => {
    if (tabPressTimer.current) {
      clearTimeout(tabPressTimer.current);
      tabPressTimer.current = null;
    }
  };



  const renderArchiveView = () => {
    const groupedByMonth: Record<string, Array<{ cycle: any, shiftIndex: number }>> = {};
    const cycleCountsByMonth: Record<string, number> = {};

    // 日付昇順（古い順）にソートして各月の通し番号（シフト1, 2...）を決定
    const sortedCycles = [...archivedCycles].sort((a: any, b: any) => {
      const getFirstDate = (c: any) => {
        const dates = Object.keys(c.cards || {}).sort();
        return dates[0] || '';
      };
      const dateA = getFirstDate(a);
      const dateB = getFirstDate(b);
      if (dateA && dateB) return dateA.localeCompare(dateB);
      return (a.timestamp || 0) - (b.timestamp || 0);
    });

    sortedCycles.forEach((cycle: any) => {
      const dates = Object.keys(cycle.cards || {}).sort();
      if (dates.length === 0) return;
      const firstDateStr = dates[0];
      const monthStr = firstDateStr.substring(0, 7); // e.g. "2026-06"
      
      if (!cycleCountsByMonth[monthStr]) cycleCountsByMonth[monthStr] = 0;
      cycleCountsByMonth[monthStr]++;
      
      if (!groupedByMonth[monthStr]) groupedByMonth[monthStr] = [];
      groupedByMonth[monthStr].push({
        cycle,
        shiftIndex: cycleCountsByMonth[monthStr]
      });
    });

    const getHeatClass = (card: any) => {
      if (!card) return 'heat-0';
      let total = 0;
      let done = 0;
      (card.categories || []).forEach((cat: any) => {
        (cat?.items || []).forEach((item: any) => {
          total++;
          if (item?.isDone || item?.isSkipped) {
            done++;
          }
        });
      });

      if (total === 0) {
        return card.signature ? 'heat-4' : 'heat-0';
      }

      const rate = done / total;
      if (rate <= 0) return 'heat-0';
      if (rate < 0.35) return 'heat-1';
      if (rate < 0.70) return 'heat-2';
      if (rate < 1.0) return 'heat-3';
      return 'heat-4';
    };

    return (
      <div className="archive-view-container">
        {/* Industrial Header */}
        <div className="header-top">
          <div className="title-area">
            <div className="document-title">
              <div className="card-title" style={{ cursor: 'default' }}>ARCHIVE</div>
            </div>
            <div className="issue-date">
              CYCLES: {archivedCycles.length}
            </div>
          </div>
        </div>
        <hr className="header-divider" />

        {!viewingArchivedCycle && Object.keys(cards).length > 0 && (
          <div style={{ marginBottom: '1.25rem', marginTop: '0.25rem' }}>
            <button 
              className="action-btn-archive-cycle"
              onClick={handleArchiveCycle}
            >
              <span>📁</span> 前サイクルをアーカイブして新カード発行
            </button>
          </div>
        )}

        <div className="archive-list-body">
          {Object.keys(groupedByMonth).length === 0 ? (
            <div className="archive-empty-state">
              <p>アーカイブされたサイクルはありません。</p>
            </div>
          ) : (() => {
            const sortedMonthKeys = Object.keys(groupedByMonth).sort();
            return sortedMonthKeys.map((monthStr, mIdx) => {
              const [, month] = monthStr.split('-');
              const monthLabel = `${parseInt(month, 10)}月`; // "6月"
              const isLatestMonth = mIdx === sortedMonthKeys.length - 1;
              
              return (
                <div 
                  key={monthStr} 
                  id={isLatestMonth ? "archive-latest-month" : undefined}
                  className="archive-month-group"
                >
                  <div className="archive-month-title">{monthLabel}</div>
                  {groupedByMonth[monthStr].map(({ cycle }) => {
                    const dates = Object.keys(cycle.cards || {}).sort();
                    return (
                      <div key={cycle.cycleId} className="archive-shift-group">
                        <div className="archive-cards-row">
                          {dates.map(dateStr => {
                            const c = cycle.cards[dateStr];
                            const dayNum = parseInt(dateStr.split('-')[2], 10);
                            const shiftClass = getShiftClass(c?.currentShift || '');
                            const heatClass = getHeatClass(c);
                            const rating = Number(c?.dayRating) || 0;
                            const hasNotes = Boolean(
                              c?.newThings?.trim() || 
                              c?.momentOfTheDay?.trim() || 
                              c?.appreciate?.trim() || 
                              c?.signOffNote?.trim()
                            );

                            return (
                              <div 
                                key={dateStr} 
                                className={`archive-card-box ${shiftClass} ${heatClass}`}
                                onClick={() => {
                                  setIsKpiView(false);
                                  setIsArchiveView(false);
                                  setViewingArchivedCycle({ cycleData: cycle.cards, activeDate: dateStr });
                                  setIsArchiveListOpen(false);
                                  setIsEditMode(false); // Force execution mode UI for read-only
                                }}
                              >
                                {rating > 0 && (
                                  <div className="archive-card-stars" title={`the day度: ${rating}`}>
                                    {Array.from({ length: Math.min(rating, 5) }).map((_, i) => (
                                      <span key={i} className="archive-card-star">★</span>
                                    ))}
                                  </div>
                                )}

                                <div className="archive-card-date">{dayNum}</div>

                                {hasNotes && (
                                  <div className="archive-card-pencil" title="メモあり">
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                                    </svg>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            });
          })()}
        </div>
      </div>
    );
  };

  const renderMonthlyKpiView = () => {
    const now = new Date();
    const currentMonthDisplay = `${now.getFullYear()}年${now.getMonth() + 1}月`;
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // 当月の全カードマップ（アーカイブ済み + 現在アクティブ）
    const monthlyCards: Record<string, any> = {};
    (archivedCycles || []).forEach(cycle => {
      if (cycle && cycle.cards) {
        Object.entries(cycle.cards).forEach(([dateStr, card]) => {
          if (dateStr.startsWith(currentYearMonth)) {
            monthlyCards[dateStr] = card;
          }
        });
      }
    });
    Object.entries(cards || {}).forEach(([dateStr, card]) => {
      if (dateStr.startsWith(currentYearMonth)) {
        monthlyCards[dateStr] = card;
      }
    });

    // 選択可能なタスク一覧（マスターテンプレート＋現在のカードから一意抽出）
    const availableHabitTasks: string[] = Array.from(new Set([
      ...(masterCardTemplate || []).flatMap(c => (c.items || []).map(t => t.task).filter(Boolean)),
      ...(categories || []).flatMap(c => (c.items || []).map(t => t.task).filter(Boolean))
    ]));

    return (
      <div className="monthly-inspection-container">
        {/* Industrial Header */}
        <div className="header-top">
          <div className="title-area">
            <div className="document-title">
              <div className="card-title" style={{ cursor: 'default' }}>KPI  CARD</div>
            </div>
            <div className="issue-date">
              {currentMonthDisplay}
            </div>
          </div>
          <div className="mode-toggle">
            <span>{isEditMode ? 'Edit Mode' : 'Execution Mode'}</span>
            <label className="switch">
              <input type="checkbox" checked={isEditMode} onChange={toggleMode} />
              <span className="slider"></span>
            </label>
          </div>
        </div>
        <hr className="header-divider" />

        {/* KPI Main Board */}
        <div className="table-container kpi-board-container">
          <div className="table-header category-header-single" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ padding: '0.75rem 1rem', letterSpacing: '0.05em' }}>MONTHLY ACTION KPIS</span>
            <span style={{ padding: '0 1rem', fontSize: '0.75rem', color: '#ccc', fontFamily: 'monospace' }}>
              ITEMS: {monthlyKpis.length}
            </span>
          </div>

          <DragDropContext onDragEnd={handleKpiDragEnd}>
            <Droppable droppableId="kpi-items-droppable" isDropDisabled={!isEditMode}>
              {(provided) => (
                <div 
                  className="kpi-items-list"
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                >
                  {monthlyKpis.map((kpi, index) => {
                    const isEditingThis = isEditMode && editingKpiId === kpi.id;

                    return (
                      <Draggable
                        key={kpi.id}
                        draggableId={kpi.id}
                        index={index}
                        isDragDisabled={!isEditMode || isEditingThis}
                      >
                        {(provided, snapshot) => {
                          if (isEditingThis) {
                            return (
                              <div 
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                className="kpi-edit-form-card"
                              >
                    <div className="kpi-edit-form-header">
                      <span className="kpi-edit-badge">EDIT KPI #{index + 1}</span>
                    </div>
                    <div className="kpi-form-body">
                      <div className="kpi-form-field">
                        <label className="kpi-form-label">TITLE / 項目名</label>
                        <input 
                          type="text" 
                          className="kpi-form-input" 
                          value={editKpiTitle} 
                          onChange={e => setEditKpiTitle(e.target.value)}
                          placeholder="例: ジム・運動 (月12回)"
                          autoFocus
                        />
                      </div>
                      <div className="kpi-form-row">
                        <div className="kpi-form-field" style={{ flex: 1 }}>
                          <label className="kpi-form-label">TYPE / 評価タイプ</label>
                          <select 
                            className="kpi-form-select"
                            value={editKpiType}
                            onChange={e => setEditKpiType(e.target.value as any)}
                          >
                            <option value="check">Check (済スタンプ)</option>
                            <option value="number">Number (数値カウンター)</option>
                            <option value="text">Text (複数行メモ)</option>
                          </select>
                        </div>
                        {editKpiType === 'number' && (
                          <div className="kpi-form-field" style={{ width: '110px' }}>
                            <label className="kpi-form-label">TARGET / 目標値</label>
                            <input 
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              className="kpi-form-input" 
                              value={editKpiTarget}
                              onChange={e => {
                                const val = e.target.value;
                                if (val === '' || /^\d+$/.test(val)) {
                                  setEditKpiTarget(val);
                                }
                              }}
                              placeholder="目標値"
                            />
                          </div>
                        )}
                      </div>

                      {/* 🔗 自動リンク設定 */}
                      {(editKpiType === 'number' || editKpiType === 'text') && (
                        <div className="kpi-link-config-box">
                          <label className="kpi-link-toggle-label">
                            <input
                              type="checkbox"
                              checked={editKpiLinkEnabled}
                              onChange={e => {
                                const checked = e.target.checked;
                                setEditKpiLinkEnabled(checked);
                                if (checked && editKpiType === 'text') {
                                  setEditKpiLinkSource('newThings');
                                }
                              }}
                            />
                            <span className="kpi-link-toggle-text">🔗 HABITS CARDと自動連動する</span>
                          </label>

                          {editKpiLinkEnabled && (
                            <div className="kpi-link-details">
                              <div className="kpi-form-field">
                                <label className="kpi-form-label">連動データ</label>
                                <select
                                  className="kpi-form-select"
                                  value={editKpiLinkSource}
                                  onChange={e => setEditKpiLinkSource(e.target.value as any)}
                                >
                                  {editKpiType === 'text' ? (
                                    <option value="newThings">サインオフノート (NEW THINGS)</option>
                                  ) : (
                                    <>
                                      <option value="sleep">睡眠時間 (Sleeping Time)</option>
                                      <option value="studyTime">勉強時間 (STUDY / SG研究)</option>
                                      <option value="task">習慣タスク (Habit Task)</option>
                                      <option value="perfect">全タスク完了 / サイン (Complete Check)</option>
                                      <option value="rating">the day度 (Day Rating)</option>
                                      <option value="newThings">NEW THINGS (記録した日数)</option>
                                    </>
                                  )}
                                </select>
                              </div>

                              {/* 勉強時間 (STUDY / SG研究) 説明文 */}
                              {editKpiLinkSource === 'studyTime' && (
                                <div className="kpi-link-desc-hint">
                                  ※ 当月のカードから「study」カテゴリ「sg研究」の累積勉強時間を自動合算し、時間単位（h）で反映します。
                                </div>
                              )}

                              {/* NEW THINGS 説明文 */}
                              {editKpiLinkSource === 'newThings' && (
                                <div className="kpi-link-desc-hint">
                                  {editKpiType === 'text'
                                    ? '※ HABITS CARDのサインオフノート（NEW THINGS）に記入した内容が日付順でここに自動転記されます。'
                                    : '※ 当月にNEW THINGSが記入された日数を自動集計します。'}
                                </div>
                              )}

                              {/* 睡眠時間 */}
                              {editKpiLinkSource === 'sleep' && (
                                <div className="kpi-link-condition-row">
                                  <input
                                    type="number"
                                    step="0.5"
                                    className="kpi-form-input kpi-link-num-input"
                                    value={editKpiLinkThreshold}
                                    onChange={e => setEditKpiLinkThreshold(e.target.value)}
                                  />
                                  <span className="kpi-link-unit">時間</span>
                                  <select
                                    className="kpi-form-select kpi-link-op-select"
                                    value={editKpiLinkOperator}
                                    onChange={e => setEditKpiLinkOperator(e.target.value as any)}
                                  >
                                    <option value=">=">以上達成</option>
                                    <option value="<=">以下</option>
                                  </select>
                                </div>
                              )}

                              {/* 習慣タスク */}
                              {editKpiLinkSource === 'task' && (
                                <div className="kpi-form-field">
                                  <label className="kpi-form-label">対象タスクを選択</label>
                                  <select
                                    className="kpi-form-select"
                                    value={editKpiLinkTaskName}
                                    onChange={e => setEditKpiLinkTaskName(e.target.value)}
                                  >
                                    <option value="">-- タスクを選択 --</option>
                                    {availableHabitTasks.map(tName => (
                                      <option key={tName} value={tName}>{tName}</option>
                                    ))}
                                  </select>
                                </div>
                              )}

                              {/* the day度 */}
                              {editKpiLinkSource === 'rating' && (
                                <div className="kpi-link-condition-row">
                                  <span className="kpi-link-unit">星</span>
                                  <input
                                    type="number"
                                    min="1"
                                    max="5"
                                    className="kpi-form-input kpi-link-num-input"
                                    value={editKpiLinkThreshold}
                                    onChange={e => setEditKpiLinkThreshold(e.target.value)}
                                  />
                                  <span className="kpi-link-unit">個以上</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="kpi-form-actions">
                        <button 
                          type="button" 
                          className="kpi-btn-cancel" 
                          onClick={() => setEditingKpiId(null)}
                        >
                          Cancel
                        </button>
                        <button 
                          type="button" 
                          className="kpi-btn-save" 
                          onClick={() => handleSaveEditKpi(kpi.id)}
                        >
                          💾 保存
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

                          return (
                            <div 
                              key={kpi.id} 
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              className={`kpi-row-item kpi-type-${kpi.type} ${isEditMode ? 'in-edit-mode' : ''} ${snapshot.isDragging ? 'is-dragging' : ''}`}
                            >
                              {isEditMode && (
                                <div 
                                  className="drag-handle kpi-drag-handle"
                                  {...provided.dragHandleProps}
                                  title="ドラッグして並び替え"
                                >
                                  ☰
                                </div>
                              )}

                              <div className="kpi-main-content">
                                <div className="kpi-title-line">
                                  <span className="kpi-title-text">{kpi.title}</span>
                                  {(kpi.linkConfig?.enabled || isKpiLinkedToNewThings(kpi)) && (
                                    <span className="kpi-linked-badge" title="HABITS CARDと自動連動中">
                                      AUTO
                                    </span>
                                  )}
                                  {isEditMode && (
                                    <span className="kpi-type-badge">{kpi.type.toUpperCase()}</span>
                                  )}
                                </div>

                                {!isEditMode && kpi.type === 'text' && (() => {
                                  const isLinkedNewThings = isKpiLinkedToNewThings(kpi);

                                  if (isLinkedNewThings) {
                                    const newThingsList = getMonthlyNewThingsList(monthlyCards);
                                    return (
                                      <div className="kpi-interactive-area kpi-linked-new-things-area">
                                        <div className="kpi-transcribed-list">
                                          {newThingsList.length > 0 ? (
                                            newThingsList.map(item => (
                                              <div key={item.dateStr} className="kpi-transcribed-item">
                                                <span className="kpi-transcribed-date">{formatNoteDate(item.dateStr, item.shift)}</span>
                                                <span className="kpi-transcribed-text">{item.text}</span>
                                              </div>
                                            ))
                                          ) : (
                                            <div className="kpi-transcribed-empty">
                                              <span>※ HABITS CARDのサインオフノート（NEW THINGS）に記入した内容がここに自動で転記されます</span>
                                            </div>
                                          )}
                                        </div>

                                        {/* 自由追記メモ欄 */}
                                        <div className="kpi-text-area-wrapper" style={{ marginTop: '0.5rem' }}>
                                          <textarea
                                            className="kpi-textarea kpi-sub-textarea"
                                            placeholder="月次総括・振り返りメモ（任意入力）..."
                                            value={typeof kpi.currentValue === 'string' ? kpi.currentValue : ''}
                                            onChange={(e) => {
                                              handleTextKpiChange(kpi.id, e.target.value);
                                              e.target.style.height = 'auto';
                                              e.target.style.height = `${e.target.scrollHeight}px`;
                                            }}
                                            ref={(el) => {
                                              if (el) {
                                                el.style.height = 'auto';
                                                el.style.height = `${Math.max(48, el.scrollHeight)}px`;
                                              }
                                            }}
                                          />
                                        </div>
                                      </div>
                                    );
                                  }

                                  return (
                                    <div className="kpi-interactive-area">
                                      <div className="kpi-text-area-wrapper">
                                        <textarea
                                          className="kpi-textarea"
                                          placeholder="読んだ本、観た映画、気付きなどを記録..."
                                          value={typeof kpi.currentValue === 'string' ? kpi.currentValue : ''}
                                          onChange={(e) => {
                                            handleTextKpiChange(kpi.id, e.target.value);
                                            e.target.style.height = 'auto';
                                            e.target.style.height = `${e.target.scrollHeight}px`;
                                          }}
                                          ref={(el) => {
                                            if (el) {
                                              el.style.height = 'auto';
                                              el.style.height = `${Math.max(60, el.scrollHeight)}px`;
                                            }
                                          }}
                                        />
                                      </div>
                                    </div>
                                  );
                                })()}

                                {isEditMode && kpi.type === 'number' && (
                                  <div className="kpi-target-preview">
                                    Target: <strong>{kpi.targetValue || 0}</strong>
                                  </div>
                                )}
                              </div>

                              {/* Check Type Stamp Cell (Same as Habits Card done-cell) */}
                              {!isEditMode && kpi.type === 'check' && (
                                <div 
                                  className="kpi-stamp-cell done-cell"
                                  onClick={() => handleToggleCheckKpi(kpi.id)}
                                  title="タップで済スタンプを切り替え"
                                >
                                  {kpi.currentValue && <div className="stamp">済</div>}
                                </div>
                              )}

                              {/* Number Type Counter Cell (Aligned to right like done-cell) */}
                              {!isEditMode && kpi.type === 'number' && (() => {
                                const isLinked = Boolean(kpi.linkConfig?.enabled);
                                const linkedCount = isLinked ? computeLinkedKpiCount(kpi.linkConfig, monthlyCards) : 0;
                                const current = isLinked ? linkedCount : (typeof kpi.currentValue === 'number' ? kpi.currentValue : 0);
                                const target = kpi.targetValue || 1;
                                const isCompleted = current >= target;
                                const isStudyTimeKpi = kpi.linkConfig?.sourceType === 'studyTime';
                                const padLen = target >= 100 ? 3 : 2;
                                const currentDisplay = isStudyTimeKpi ? `${current}h` : String(current).padStart(padLen, '0');
                                const targetDisplay = isStudyTimeKpi ? `${target}h` : String(target).padStart(padLen, '0');

                                return (
                                  <div 
                                    className={`kpi-number-cell done-cell ${isCompleted ? 'is-completed' : ''} ${isLinked ? 'is-linked' : ''}`}
                                    title={isLinked ? 'HABITS CARDから自動集計中（手動調整不可）' : undefined}
                                  >
                                    {!isLinked && (
                                      <button
                                        type="button"
                                        className="kpi-cell-btn minus"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleUpdateNumberKpi(kpi.id, -1);
                                        }}
                                        disabled={current <= 0}
                                        title="1減らす"
                                      >
                                        −
                                      </button>
                                    )}

                                    <div 
                                      className="kpi-cell-value-display"
                                      onClick={() => {
                                        if (!isLinked) handleUpdateNumberKpi(kpi.id, 1);
                                      }}
                                      title={isLinked ? 'HABITS CARDから自動集計中' : 'タップで1増やす'}
                                      style={{ cursor: isLinked ? 'default' : 'pointer' }}
                                    >
                                      <span className="counter-current">{currentDisplay}</span>
                                      <span className="counter-separator">/</span>
                                      <span className="counter-target">{targetDisplay}</span>
                                    </div>

                                    {!isLinked && (
                                      <button
                                        type="button"
                                        className="kpi-cell-btn plus"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleUpdateNumberKpi(kpi.id, 1);
                                        }}
                                        title="1増やす"
                                      >
                                        +
                                      </button>
                                    )}

                                    {isCompleted && (
                                      <div className="stamp kpi-bg-stamp" title="目標達成！">
                                        済
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}

                              {isEditMode && (
                                <div className="kpi-action-buttons">
                                  <button 
                                    type="button"
                                    className="kpi-action-btn edit"
                                    onClick={() => handleStartEditKpi(kpi)}
                                    title="Edit KPI"
                                  >
                                    ⚙️
                                  </button>
                                  <button 
                                    type="button"
                                    className="kpi-action-btn delete"
                                    onClick={() => handleDeleteKpi(kpi.id, kpi.title)}
                                    title="Delete KPI"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        }}
                      </Draggable>
                    );
                  })}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>

            {isEditMode && isAddingKpi && (
              <div className="kpi-edit-form-card new-kpi-form">
                <div className="kpi-edit-form-header">
                  <span className="kpi-edit-badge">[ + NEW KPI ITEM ]</span>
                </div>
                <div className="kpi-form-body">
                  <div className="kpi-form-field">
                    <label className="kpi-form-label">TITLE / 項目名</label>
                    <input 
                      type="text" 
                      className="kpi-form-input" 
                      value={newKpiTitle} 
                      onChange={e => setNewKpiTitle(e.target.value)}
                      placeholder="例: ジム・運動 (月12回)"
                      autoFocus
                    />
                  </div>
                  <div className="kpi-form-row">
                    <div className="kpi-form-field" style={{ flex: 1 }}>
                      <label className="kpi-form-label">TYPE / 評価タイプ</label>
                      <select 
                        className="kpi-form-select"
                        value={newKpiType}
                        onChange={e => setNewKpiType(e.target.value as any)}
                      >
                        <option value="check">Check (済スタンプ)</option>
                        <option value="number">Number (数値カウンター)</option>
                        <option value="text">Text (複数行メモ)</option>
                      </select>
                    </div>
                    {newKpiType === 'number' && (
                      <div className="kpi-form-field" style={{ width: '110px' }}>
                        <label className="kpi-form-label">TARGET / 目標値</label>
                        <input 
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          className="kpi-form-input" 
                          value={newKpiTarget}
                          onChange={e => {
                            const val = e.target.value;
                            if (val === '' || /^\d+$/.test(val)) {
                              setNewKpiTarget(val);
                            }
                          }}
                          placeholder="目標値"
                        />
                      </div>
                    )}
                  </div>

                  {/* 🔗 自動リンク設定 */}
                  {(newKpiType === 'number' || newKpiType === 'text') && (
                    <div className="kpi-link-config-box">
                      <label className="kpi-link-toggle-label">
                        <input
                          type="checkbox"
                          checked={newKpiLinkEnabled}
                          onChange={e => {
                            const checked = e.target.checked;
                            setNewKpiLinkEnabled(checked);
                            if (checked && newKpiType === 'text') {
                              setNewKpiLinkSource('newThings');
                            }
                          }}
                        />
                        <span className="kpi-link-toggle-text">🔗 HABITS CARDと自動連動する</span>
                      </label>

                      {newKpiLinkEnabled && (
                        <div className="kpi-link-details">
                          <div className="kpi-form-field">
                            <label className="kpi-form-label">連動データ</label>
                            <select
                              className="kpi-form-select"
                              value={newKpiLinkSource}
                              onChange={e => setNewKpiLinkSource(e.target.value as any)}
                            >
                              {newKpiType === 'text' ? (
                                <option value="newThings">サインオフノート (NEW THINGS)</option>
                              ) : (
                                <>
                                  <option value="sleep">睡眠時間 (Sleeping Time)</option>
                                  <option value="studyTime">勉強時間 (STUDY / SG研究)</option>
                                  <option value="task">習慣タスク (Habit Task)</option>
                                  <option value="perfect">全タスク完了 / サイン (Complete Check)</option>
                                  <option value="rating">the day度 (Day Rating)</option>
                                  <option value="newThings">NEW THINGS (記録した日数)</option>
                                </>
                              )}
                            </select>
                          </div>

                          {/* 勉強時間 (STUDY / SG研究) 説明文 */}
                          {newKpiLinkSource === 'studyTime' && (
                            <div className="kpi-link-desc-hint">
                              ※ 当月のカードから「study」カテゴリ「sg研究」の累積勉強時間を自動合算し、時間単位（h）で反映します。
                            </div>
                          )}

                          {/* NEW THINGS 説明文 */}
                          {newKpiLinkSource === 'newThings' && (
                            <div className="kpi-link-desc-hint">
                              {newKpiType === 'text'
                                ? '※ HABITS CARDのサインオフノート（NEW THINGS）に記入した内容が日付順でここに自動転記されます。'
                                : '※ 当月にNEW THINGSが記入された日数を自動集計します。'}
                            </div>
                          )}

                          {/* 睡眠時間 */}
                          {newKpiLinkSource === 'sleep' && (
                            <div className="kpi-link-condition-row">
                              <input
                                type="number"
                                step="0.5"
                                className="kpi-form-input kpi-link-num-input"
                                value={newKpiLinkThreshold}
                                onChange={e => setNewKpiLinkThreshold(e.target.value)}
                              />
                              <span className="kpi-link-unit">時間</span>
                              <select
                                className="kpi-form-select kpi-link-op-select"
                                value={newKpiLinkOperator}
                                onChange={e => setNewKpiLinkOperator(e.target.value as any)}
                              >
                                <option value=">=">以上達成</option>
                                <option value="<=">以下</option>
                              </select>
                            </div>
                          )}

                          {/* 習慣タスク */}
                          {newKpiLinkSource === 'task' && (
                            <div className="kpi-form-field">
                              <label className="kpi-form-label">対象タスクを選択</label>
                              <select
                                className="kpi-form-select"
                                value={newKpiLinkTaskName}
                                onChange={e => setNewKpiLinkTaskName(e.target.value)}
                              >
                                <option value="">-- タスクを選択 --</option>
                                {availableHabitTasks.map(tName => (
                                  <option key={tName} value={tName}>{tName}</option>
                                ))}
                              </select>
                            </div>
                          )}

                          {/* the day度 */}
                          {newKpiLinkSource === 'rating' && (
                            <div className="kpi-link-condition-row">
                              <span className="kpi-link-unit">星</span>
                              <input
                                type="number"
                                min="1"
                                max="5"
                                className="kpi-form-input kpi-link-num-input"
                                value={newKpiLinkThreshold}
                                onChange={e => setNewKpiLinkThreshold(e.target.value)}
                              />
                              <span className="kpi-link-unit">個以上</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="kpi-form-actions">
                    <button 
                      type="button" 
                      className="kpi-btn-cancel" 
                      onClick={() => setIsAddingKpi(false)}
                    >
                      Cancel
                    </button>
                    <button 
                      type="button" 
                      className="kpi-btn-save" 
                      onClick={handleAddKpi}
                    >
                      + 追加する
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isEditMode && !isAddingKpi && (
              <div className="kpi-add-button-row">
                <button 
                  type="button" 
                  className="kpi-add-new-btn"
                  onClick={() => {
                    setNewKpiTitle('');
                    setNewKpiType('number');
                    setNewKpiTarget(10);
                    setIsAddingKpi(true);
                  }}
                >
                  + ADD NEW KPI
                </button>
              </div>
            )}
        </div>
      </div>
    );
  };

  const signOffNotesRef = useRef<HTMLDivElement>(null);

  const handleScreenshot = async () => {
    if (!signOffNotesRef.current) return;
    
    try {
      // Temporarily add a class or style if needed, but html2canvas should capture as-is
      const canvas = await html2canvas(signOffNotesRef.current, {
        backgroundColor: '#f2f2f2', // Match the app's background color
        scale: 2, // Higher resolution for better quality
      });
      
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        
        const file = new File([blob], `signoff-notes-${activeDate}.png`, { type: 'image/png' });
        
        // 1. Web Share API (Best for Mobile iOS/Android)
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({
              files: [file],
              title: 'SIGN-OFF NOTES',
            });
            return; // Successfully shared or copied via native sheet
          } catch (err) {
            console.error("Share API failed or cancelled", err);
            // Fall through to Clipboard API
          }
        }

        // 2. Clipboard API (Best for Desktop)
        try {
          const item = new ClipboardItem({ 'image/png': blob });
          await navigator.clipboard.write([item]);
          alert("SIGN-OFF NOTESのスクリーンショットをクリップボードにコピーしました！");
          return;
        } catch (err) {
          console.error("Clipboard API failed, falling back to download", err);
        }

        // 3. Fallback: Download / Open in new tab
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `signoff-notes-${activeDate}.png`;
        a.click();
        URL.revokeObjectURL(url);
        alert("画像を保存しました。");
      }, 'image/png');
    } catch (err) {
      console.error("Screenshot failed", err);
      alert("スクリーンショットの生成に失敗しました。");
    }
  };

  const effectiveIsEditMode = isEditingMasterTemplate ? true : isEditMode;

  return (
    <div className={`app-container ${effectiveIsEditMode ? 'edit-mode' : 'execution-mode'} ${viewingArchivedCycle ? 'archive-mode' : ''} ${isEditingMasterTemplate ? 'master-edit-mode' : ''}`}>
      {isKpiView && !viewingArchivedCycle ? (
        renderMonthlyKpiView()
      ) : isArchiveView && !viewingArchivedCycle ? (
        renderArchiveView()
      ) : (
        <>
          {isEditingMasterTemplate && (
        <div className="master-mode-banner">
          <div className="master-mode-info">
            <span className="master-mode-badge">[ MASTER CARD EDIT MODE ]</span>
            <span className="master-mode-desc">全カードの基本ひな形（テンプレート）を編集中</span>
          </div>
          <button 
            type="button"
            className="master-mode-done-btn"
            onClick={() => setIsEditingMasterTemplate(false)}
          >
            💾 完了して保存
          </button>
        </div>
      )}

      {viewingArchivedCycle && (
        <div className="read-only-banner">
          <span>⚠️ アーカイブ閲覧中 (Read-Only)</span>
          <button onClick={() => {
            setViewingArchivedCycle(null);
            setIsArchiveView(true);
          }}>一覧に戻る</button>
        </div>
      )}
      {!isEditingMasterTemplate && (
        <div className="date-tabs">
          {Object.keys(displayCards).sort().map(dateStr => (
            <button 
              key={dateStr} 
              className={`date-tab ${dateStr === currentActiveDate ? 'active' : ''}`}
              onClick={() => {
                if (viewingArchivedCycle) {
                  setViewingArchivedCycle({ ...viewingArchivedCycle, activeDate: dateStr });
                } else {
                  setActiveDate(dateStr);
                }
              }}
              onTouchStart={() => {
                if (!viewingArchivedCycle) handleTabTouchStart(dateStr);
              }}
              onTouchEnd={handleTabTouchEnd}
              onTouchMove={handleTabTouchEnd}
              onMouseDown={() => {
                if (!viewingArchivedCycle) handleTabTouchStart(dateStr);
              }}
              onMouseUp={handleTabTouchEnd}
              onMouseLeave={handleTabTouchEnd}
              onContextMenu={e => {
                e.preventDefault();
                if (!viewingArchivedCycle) handleTabTouchStart(dateStr);
              }}
              style={{ userSelect: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
              title="長押しまたは右クリックでカードを削除"
            >
              {formatDateLabel(dateStr)}
            </button>
          ))}

          {!viewingArchivedCycle && (
            <button 
              type="button"
              className="date-tab-add-btn"
              onClick={() => {
                const sortedDates = Object.keys(cards).sort();
                if (sortedDates.length > 0) {
                  const latest = sortedDates[sortedDates.length - 1];
                  const [y, m, d] = latest.split('-').map(Number);
                  const nextDate = new Date(y, m - 1, d + 1);
                  const nextDateStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;
                  setSelectedIssueDate(nextDateStr);
                } else {
                  setSelectedIssueDate(getTodayDate());
                }
                openShiftModal();
              }}
              title="新しいCARDを発行"
            >
              +
            </button>
          )}
        </div>
      )}

      {!isEditingMasterTemplate && !viewingArchivedCycle && Object.keys(displayCards).length === 0 ? (
        <div className="empty-cards-container">
          <div className="empty-cards-box">
            <div className="empty-cards-icon">📋</div>
            <h3 className="empty-cards-title">NO ACTIVE CARDS</h3>
            <p className="empty-cards-desc">
              現在発行されているHABITS CARDはありません。<br />
              下のボタンから新しいカードを発行してください。
            </p>
            <div className="empty-cards-actions">
              <button 
                type="button"
                className="empty-cards-issue-btn"
                onClick={() => {
                  setSelectedIssueDate(getTodayDate());
                  openShiftModal();
                }}
              >
                ＋ 新しいCARDを発行
              </button>
              {archivedCycles.length > 0 && (
                <button 
                  type="button"
                  className="empty-cards-restore-btn"
                  onClick={() => {
                    const latest = archivedCycles[archivedCycles.length - 1];
                    const dates = Object.keys(latest.cards || {}).sort();
                    if (window.confirm(`直前のアーカイブ（${dates[0]}〜${dates[dates.length - 1]}）からカードを復元しますか？`)) {
                      const restored = latest.cards || {};
                      setCards(restored);
                      saveCardsNow(restored);
                      if (dates.length > 0) setActiveDate(dates[dates.length - 1]);
                    }
                  }}
                >
                  📁 直前のアーカイブから復元
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
      <div className="header-top">
        <div className="title-area">
          <div className="document-title">
            <div 
              className="card-title"
              style={{ cursor: 'default', userSelect: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
            >
              {isEditingMasterTemplate ? 'MASTER HABITS CARD' : 'HABITS CARD'}
            </div>
          </div>
          <div className="issue-date">
            {isEditingMasterTemplate ? (
              <span className="master-badge">TEMPLATE [MASTER]</span>
            ) : (
              <>Issue date: {currentActiveDate} <span className="shift-badge">[{formatShift(currentShift)}]</span></>
            )}
          </div>
        </div>
        <div className="mode-toggle">
          {!viewingArchivedCycle && !isEditingMasterTemplate && (
            <>
              <span>{isEditMode ? 'Edit Mode' : 'Execution Mode'}</span>
              <label className="switch">
                <input type="checkbox" checked={isEditMode} onChange={toggleMode} />
                <span className="slider"></span>
              </label>
            </>
          )}
          {isEditingMasterTemplate && (
            <span className="master-mode-status-pill">TEMPLATE EDIT</span>
          )}
        </div>
      </div>
      <hr className="header-divider" />

      {effectiveIsEditMode && !viewingArchivedCycle && !isEditingMasterTemplate && (
        <div className="edit-mode-toolbar">
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button 
              type="button"
              className="load-master-btn" 
              onClick={handleLoadFromMaster}
              title="マスターカード（テンプレート）のタスク構成をこのカードに上書き読み込みします"
            >
              📋 LOAD FROM MASTER
            </button>
            <button 
              type="button"
              className="delete-card-toolbar-btn" 
              onClick={() => {
                if (window.confirm(`${formatDateLabel(currentActiveDate)} のカードを削除しますか？`)) {
                  setCards(prev => {
                    const newCards = { ...prev };
                    delete newCards[currentActiveDate];
                    const remainingDates = Object.keys(newCards).sort();
                    if (remainingDates.length > 0) {
                      const today = getTodayDate();
                      setActiveDate(newCards[today] ? today : remainingDates[0]);
                    } else {
                      setActiveDate(getTodayDate());
                    }
                    saveCardsNow(newCards);
                    return newCards;
                  });
                }
              }}
              title="このカードを削除します"
            >
              🗑 このカードを削除
            </button>
          </div>
          <span className="load-master-hint">※マスターのタスク構成を読み込み（日付/シフト情報は保持）</span>
        </div>
      )}

      {/* BASIC DATA 固定ブロック */}
      {!isEditingMasterTemplate && (
        <div className="table-container basic-data-table">
          <div className="table-header basic-data-header">
            <span>BASIC DATA</span>
            <span className="basic-data-header-tag">FIXED</span>
          </div>
          {/* 1. 睡眠時間 */}
          <div className="basic-data-row">
            <div className="basic-data-label-cell">
              <span className="basic-data-item-title">Sleeping Time</span>
            </div>
            <div 
              className={`basic-data-value-cell ${hasSleepTime ? 'is-done' : 'is-empty'} ${viewingArchivedCycle ? 'is-readonly' : ''} ${basicData.skippedFields?.includes('sleep') ? 'is-skipped' : ''}`}
              onClick={openSleepModal}
              onContextMenu={(e) => {
                e.preventDefault();
                if (viewingArchivedCycle) return;
                if (window.confirm("睡眠時間の項目をスキップ/解除しますか？")) toggleBasicDataSkipped('sleep');
              }}
              title={viewingArchivedCycle ? '睡眠時間' : 'タップして睡眠時間を記録（右クリック/長押しでスキップ）'}
            >
              {(() => {
                const sleepInfo = calculateSleepDuration(basicData.sleepStart, basicData.sleepEnd);
                if (sleepInfo) {
                  return (
                    <div className="basic-data-time-wrapper">
                      <span className="basic-data-range-text">{sleepInfo.start} - {sleepInfo.end}</span>
                      <span className="basic-data-duration-badge">({sleepInfo.hoursDecimal}h)</span>
                    </div>
                  );
                }
                if (basicData.skippedFields?.includes('sleep')) {
                  return <div className="slash-line"></div>;
                }
                return (
                  <div className="basic-data-placeholder-wrapper">
                    <span className="basic-data-placeholder-time">--:-- - --:--</span>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="board" type="category" isDropDisabled={!effectiveIsEditMode}>
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps}>
              {categories.map((category, index) => (
                <Draggable key={category.id} draggableId={category.id} index={index} isDragDisabled={!effectiveIsEditMode}>
                  {(provided, snapshot) => (
                    <div 
                      ref={provided.innerRef} 
                      {...provided.draggableProps} 
                      className={`table-container category-table ${snapshot.isDragging ? 'category-is-dragging' : ''}`}
                    >
                      <div className="table-header category-header-single">
                        {effectiveIsEditMode ? (
                          <div className="category-edit-wrapper">
                            <div 
                              className="drag-handle category-drag-handle" 
                              {...provided.dragHandleProps}
                            >
                              ☰
                            </div>
                            <input
                              className="category-input"
                              value={category.name}
                              onChange={(e) => handleCategoryNameChange(category.id, e.target.value)}
                              placeholder="Category Name"
                              autoFocus={category.name === ""}
                            />
                            <button 
                              className="delete-category-btn"
                              onClick={() => deleteCategory(category.id)}
                              title="Delete category"
                            >
                              🗑️
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'stretch', width: '100%' }}>
                            <span style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center' }}>{category.name}</span>
                            {(() => {
                              let total = 0;
                              let hasTimeTasks = false;
                              (category.items || []).forEach(habit => {
                                let timeVal = habit.estimatedTime;
                                if (timeVal === undefined && habit.time) {
                                  const parsed = parseInt(habit.time, 10);
                                  if (!isNaN(parsed)) timeVal = parsed;
                                }
                                if (timeVal !== undefined && timeVal > 0) {
                                  hasTimeTasks = true;
                                  if (!habit.isDone && !habit.isSkipped) {
                                    total += timeVal;
                                  }
                                }
                              });
                              if (!hasTimeTasks) return null;
                              return (
                                <div className="category-time-counter">
                                  {total}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>

                      <Droppable droppableId={category.id} type="task" isDropDisabled={!effectiveIsEditMode}>
              {(provided) => (
                <div 
                  {...provided.droppableProps} 
                  ref={provided.innerRef}
                  className="droppable-container"
                >
                  {(category.items || []).map((habit, index) => (
                    <Draggable 
                      key={habit.id} 
                      draggableId={habit.id} 
                      index={index} 
                      isDragDisabled={!effectiveIsEditMode}
                    >
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          className={`habit-row ${snapshot.isDragging ? 'is-dragging' : ''} ${habit.isSkipped && !effectiveIsEditMode ? 'is-skipped' : ''}`}
                        >
                          <div className="task-cell">
                            {effectiveIsEditMode && (
                              <div 
                                className="drag-handle" 
                                {...provided.dragHandleProps}
                              >
                                ☰
                              </div>
                            )}
                            
                            <div className="task-content">
                              {effectiveIsEditMode ? (
                                <>
                                  <input
                                    className="task-input"
                                    value={habit.task}
                                    onChange={(e) => handleTaskChange(category.id, habit.id, e.target.value)}
                                    placeholder="Action Item Name"
                                    autoFocus={habit.task === ""}
                                  />
                                  <input
                                    className="description-input"
                                    value={habit.description || ""}
                                    onChange={(e) => handleDescriptionChange(category.id, habit.id, e.target.value)}
                                    placeholder="Description (Optional)"
                                  />
                                </>
                              ) : (
                                <>
                                  <span className="task-name-display">{habit.task}</span>
                                  {habit.description && <span className="task-desc-display">{habit.description}</span>}
                                </>
                              )}
                            </div>
                          </div>

                          <div className="time-cell">
                            {effectiveIsEditMode ? (
                              <select
                                className="time-input"
                                value={habit.time || ''}
                                onChange={(e) => handleTimeChange(category.id, habit.id, e.target.value)}
                                style={{ appearance: 'none', WebkitAppearance: 'none', textAlign: 'center', cursor: 'pointer' }}
                              >
                                <option value="">-</option>
                                {[1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 40, 50, 60].map(val => (
                                  <option key={val} value={val}>{val}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="time-display">{habit.time}</span>
                            )}
                          </div>

                          {!effectiveIsEditMode ? (() => {
                            const isTimer = habit.type === 'timer' || isStudyTimerTask(category.name, habit.task);
                            const hasAccumulated = (habit.accumulatedMinutes || 0) > 0;
                            const formattedTime = (habit.accumulatedMinutes || 0) >= 60 
                              ? `${((habit.accumulatedMinutes || 0) / 60).toFixed(1)}h` 
                              : `${habit.accumulatedMinutes || 0}m`;

                            return (
                              <div 
                                className={`done-cell ${isTimer ? 'is-study-timer' : ''} ${habit.isDone ? 'is-done' : ''}`} 
                                onClick={() => {
                                  if (isTimer) {
                                    openStudyTimerModal(category, habit);
                                  } else {
                                    toggleDone(category.id, habit.id);
                                  }
                                }}
                                onTouchStart={() => handleTouchStart(category.id, habit.id)}
                                onTouchEnd={handleTouchEnd}
                                onTouchMove={handleTouchEnd}
                                onMouseDown={() => handleTouchStart(category.id, habit.id)}
                                onMouseUp={handleTouchEnd}
                                onMouseLeave={handleTouchEnd}
                                onContextMenu={(e) => handleContextMenu(e, category.id, habit.id)}
                                title={isTimer ? (viewingArchivedCycle ? `累積時間: ${formattedTime}` : 'タップしてタイマーを開く（右クリックでスキップ）') : undefined}
                              >
                                {habit.isDone && <div className="stamp">済</div>}
                                {habit.isSkipped && <div className="slash-line"></div>}
                                {isTimer && !habit.isSkipped && hasAccumulated && (
                                  <div className={`study-timer-badge ${habit.isDone ? 'is-achieved' : 'is-accumulating'}`}>
                                    {formattedTime}
                                  </div>
                                )}
                              </div>
                            );
                          })() : (
                            <div className="action-cell">
                              <button
                                type="button"
                                className={`item-type-toggle-btn ${habit.type === 'timer' ? 'is-timer' : 'is-check'}`}
                                onClick={() => handleTypeChange(category.id, habit.id, habit.type === 'timer' ? 'check' : 'timer')}
                                title="タップしてタイプ切り替え（CHECK: 通常押印 / TIMER: 計測）"
                              >
                                {habit.type === 'timer' ? '⏱ TIMER' : 'CHECK'}
                              </button>
                              <button 
                                type="button"
                                className="delete-btn" 
                                onClick={() => deleteHabit(category.id, habit.id)}
                                title="Delete task"
                              >
                                🗑️
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
            
                    {effectiveIsEditMode && (
                      <div className="add-row">
                        <button className="add-btn" onClick={() => addHabit(category.id)}>
                          ＋ Add Action Item
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {effectiveIsEditMode && (
        <div className="add-category-wrapper">
          <button className="add-category-btn" onClick={addCategory}>
            ＋ Add Category
          </button>
        </div>
      )}

      {isEditingMasterTemplate && (
        <div style={{ marginTop: '1.5rem', marginBottom: '2.5rem', textAlign: 'center' }}>
          <button 
            type="button"
            className="master-mode-bottom-done-btn"
            onClick={() => setIsEditingMasterTemplate(false)}
          >
            💾 MASTER CARD を保存して終了
          </button>
        </div>
      )}

      {!isEditingMasterTemplate && (
        <>
          {/* SIGN-OFF NOTES Section */}
          <div className="table-container sign-off-container" ref={signOffNotesRef}>
            <div className="table-header category-header-single" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ padding: '0.75rem 1rem' }}>SIGN-OFF NOTES</span>
              {!effectiveIsEditMode && (
                <button 
                  onClick={handleScreenshot}
                  style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', padding: '0.5rem 1rem' }}
                  title="Copy screenshot to clipboard"
                >
                  📷
                </button>
              )}
            </div>
            <div className="sign-off-content">
              <div className="rating-container">
                <div className="stars-wrapper">
                  {[1, 2, 3, 4, 5].map(star => (
                    <StarIcon 
                      key={star} 
                      filled={dayRating >= star} 
                      onClick={() => setDayRating(star)} 
                    />
                  ))}
                </div>
              </div>
              
              <div className="reflection-inputs">
                <textarea
                  className="reflection-textarea"
                  rows={1}
                  placeholder="NEW THINGS"
                  value={newThings}
                  onChange={(e) => {
                    setNewThings(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${e.target.scrollHeight}px`;
                  }}
                  ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }}
                />
                <textarea
                  className="reflection-textarea"
                  rows={1}
                  placeholder="MOMENT OF THE DAY"
                  value={momentOfTheDay}
                  onChange={(e) => {
                    setMomentOfTheDay(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${e.target.scrollHeight}px`;
                  }}
                  ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }}
                />
                <textarea
                  className="reflection-textarea"
                  rows={1}
                  placeholder="APPRECIATE"
                  value={appreciate}
                  onChange={(e) => {
                    setAppreciate(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${e.target.scrollHeight}px`;
                  }}
                  ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }}
                />
              </div>
            </div>
          </div>

          <div className="table-container complete-check-container">
            <div className="habit-row complete-check-row">
              <div className="task-cell complete-check-task">
                <span>Complete Check</span>
              </div>

              {!effectiveIsEditMode ? (
                <div 
                  className={`done-cell complete-check-done ${!isAllTasksCompleted ? 'disabled' : ''}`}
                  onClick={() => {
                    if (isAllTasksCompleted) {
                      setIsSignatureModalOpen(true);
                    }
                  }}
                >
                  {signature && <img src={signature} alt="Signature" className="signature-img" />}
                </div>
              ) : (
                <div className="action-cell">
                  <span style={{ opacity: 0.5, fontSize: '1.2rem' }} title="System fixed item">🔒</span>
                </div>
              )}
            </div>
          </div>

          {/* MEMO Section */}
          <div className="table-container memo-container" style={{ marginTop: '2rem' }}>
            <div className="table-header category-header-single" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ padding: '0.75rem 1rem' }}>MEMO</span>
              <button 
                className="copy-memo-btn" 
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(signOffNote);
                  } catch (err) {
                    console.error('Failed to copy text: ', err);
                  }
                }}
                title="Copy Memo"
                style={{ marginRight: '1rem', padding: '4px 8px' }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>
            <div className="memo-content" style={{ display: 'flex', flexDirection: 'column', backgroundColor: '#fff', padding: '1rem' }}>
              <textarea
                className="sign-off-textarea"
                placeholder=""
                value={signOffNote}
                onChange={(e) => {
                  setSignOffNote(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${e.target.scrollHeight}px`;
                }}
                ref={(el) => {
                  if (el) {
                    el.style.height = 'auto';
                    el.style.height = `${el.scrollHeight}px`;
                  }
                }}
                style={{ border: 'none', padding: 0, minHeight: '150px' }}
              />
            </div>
          </div>

          {(rewardImage || isFetchingReward || rewardError) && (
            <div className="reward-container">
              <h3 className="reward-title">🎉 REWARD 🎉</h3>
              {isFetchingReward ? (
                <div className="reward-loading">Fetching your reward image...</div>
              ) : rewardError ? (
                <div className="reward-error">{rewardError}</div>
              ) : (
                <img src={rewardImage!} alt="Reward" className="reward-image" />
              )}
            </div>
          )}
        </>
      )}
        </>
      )}
        </>
      )}

      {isSignatureModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content signature-modal-content">
            <h3 className="modal-title">Sign to Complete</h3>
            <div className="signature-canvas-wrapper">
              <SignatureCanvas 
                ref={signaturePadRef} 
                penColor="black"
                minWidth={1.5}
                maxWidth={4}
                velocityFilterWeight={0.7}
                canvasProps={{ className: 'signature-canvas' }}
              />
            </div>
            <div className="signature-buttons">
              <button className="cancel-btn" onClick={() => setIsSignatureModalOpen(false)}>Cancel</button>
              <button className="clear-btn" onClick={() => signaturePadRef.current?.clear()}>Clear</button>
              <button 
                className="done-btn" 
                onClick={() => {
                  if (signaturePadRef.current?.isEmpty()) {
                    alert("Please provide a signature first.");
                    return;
                  }
                  const trimmed = signaturePadRef.current?.getTrimmedCanvas();
                  if (trimmed) {
                    // 軽量化: 最大幅240pxにリサイズして保存（30KB→2KB程度に削減）
                    let dataURL = '';
                    try {
                      const targetWidth = Math.min(trimmed.width, 240);
                      const scale = targetWidth / trimmed.width;
                      const targetHeight = Math.round(trimmed.height * scale);
                      const resizeCanvas = document.createElement('canvas');
                      resizeCanvas.width = targetWidth;
                      resizeCanvas.height = targetHeight;
                      const ctx = resizeCanvas.getContext('2d');
                      if (ctx) {
                        ctx.drawImage(trimmed, 0, 0, targetWidth, targetHeight);
                        dataURL = resizeCanvas.toDataURL('image/png');
                      }
                    } catch (e) {
                      console.error("Signature resize failed, using raw trimmed canvas", e);
                    }
                    if (!dataURL) {
                      dataURL = trimmed.toDataURL('image/png');
                    }
                    setSignature(dataURL);
                    setIsSignatureModalOpen(false);
                    if (!rewardImage && rewardImageUrls) {
                      fetchRewardImage();
                    }
                  }
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {isSettingsModalOpen && (
        <div className="modal-overlay" onClick={() => setIsSettingsModalOpen(false)}>
          <div className="modal-content settings-modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 className="modal-title" style={{ margin: 0 }}>SETTINGS</h3>
              <button onClick={() => setIsSettingsModalOpen(false)} style={{ background: 'none', border: 'none', fontSize: '2rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            {settingsTab === 'menu' ? (
              <div className="settings-menu-container">
                <button 
                  type="button"
                  className="settings-menu-row"
                  onClick={() => {
                    setIsSettingsModalOpen(false);
                    setIsEditingMasterTemplate(true);
                  }}
                >
                  <div className="settings-menu-left">
                    <span className="settings-menu-icon">📋</span>
                    <div className="settings-menu-text">
                      <div className="settings-menu-label">MASTER HABITS CARD</div>
                      <div className="settings-menu-caption">大元となるマスターテンプレートの編集</div>
                    </div>
                  </div>
                  <span className="settings-menu-arrow">▶</span>
                </button>

                <button 
                  type="button"
                  className="settings-menu-row"
                  onClick={() => setSettingsTab('rewards')}
                >
                  <div className="settings-menu-left">
                    <span className="settings-menu-icon">🎁</span>
                    <div className="settings-menu-text">
                      <div className="settings-menu-label">REWARD SETTINGS</div>
                      <div className="settings-menu-caption">達成時ご褒美画像URLの設定・プレビュー</div>
                    </div>
                  </div>
                  <span className="settings-menu-arrow">▶</span>
                </button>
              </div>
            ) : (
              <div className="settings-subview-container">
                <button 
                  type="button"
                  className="settings-back-btn"
                  onClick={() => setSettingsTab('menu')}
                >
                  ◀ 設定メニューに戻る
                </button>
                <h4 style={{ margin: '0.75rem 0 0.5rem', fontFamily: 'var(--font-mono)' }}>Reward Settings</h4>
                <p className="settings-desc">ご褒美画像のURL（ウェブ上の画像リンク）を1行ずつ貼り付けてください。サイン完了時にランダムで1枚表示されます。</p>
                
                <div className="settings-field">
                  <label>Preview</label>
                  <div className="reward-preview-grid">
                    {rewardImageUrls.split('\n').map(u => u.trim()).filter(u => u !== '').map((url, i) => (
                      <div 
                        key={`${url}-${i}`} 
                        className="reward-preview-item"
                        onTouchStart={() => handleRewardTouchStart(url)}
                        onTouchEnd={handleRewardTouchEnd}
                        onMouseDown={() => handleRewardTouchStart(url)}
                        onMouseUp={handleRewardTouchEnd}
                        onMouseLeave={handleRewardTouchEnd}
                      >
                        <img src={url} alt={`preview-${i}`} className="reward-preview-img" />
                      </div>
                    ))}
                  </div>
                  
                  <label>Image URLs</label>
                  <textarea 
                    value={rewardImageUrls} 
                    onChange={e => setRewardImageUrls(e.target.value)} 
                    placeholder="https://example.com/image1.jpg&#10;https://example.com/image2.png" 
                    rows={8}
                  />
                </div>
                
                <button className="done-btn" style={{marginTop: '1.25rem', width: '100%'}} onClick={() => setIsSettingsModalOpen(false)}>Save & Close</button>
              </div>
            )}
          </div>
        </div>
      )}

      {isShiftModalOpen && (
        <div className="modal-overlay" onClick={() => setIsShiftModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">新しいCARDを発行</h3>
            <p className="modal-subtitle">{formatDateLabel(selectedIssueDate)} のシフトを選択してください</p>

            <div className="shift-buttons">
              {SHIFTS.map(shift => {
                const btnClass = shift === '/' ? 'slash' : shift;
                return (
                  <button 
                    key={shift} 
                    className={`shift-btn shift-btn-${btnClass}`}
                    onClick={() => loadShiftTemplate(shift)}
                  >
                    {shift}
                  </button>
                );
              })}
            </div>
            <button className="cancel-btn" onClick={() => setIsShiftModalOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {isSleepModalOpen && (
        <div className="modal-overlay" onClick={() => setIsSleepModalOpen(false)}>
          <div className="modal-content sleep-modal-content" onClick={e => e.stopPropagation()}>
            <div className="sleep-modal-header">
              <h3 className="modal-title">SLEEP TIME</h3>
              <button 
                type="button" 
                className="sleep-modal-close-icon"
                onClick={() => setIsSleepModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="sleep-simple-inputs">
              <div className="sleep-simple-col">
                <span className="sleep-simple-label">入眠</span>
                <input
                  type="time"
                  className="sleep-simple-time-input"
                  value={tempSleepStart}
                  onChange={e => setTempSleepStart(e.target.value)}
                />
              </div>

              <span className="sleep-simple-tilde">〜</span>

              <div className="sleep-simple-col">
                <span className="sleep-simple-label">起床</span>
                <input
                  type="time"
                  className="sleep-simple-time-input"
                  value={tempSleepEnd}
                  onChange={e => setTempSleepEnd(e.target.value)}
                />
              </div>
            </div>

            {/* 合計時間：枠線・余計なラベルなしで数値だけ */}
            <div className="sleep-simple-duration">
              {(() => {
                const preview = calculateSleepDuration(tempSleepStart, tempSleepEnd);
                return preview ? `${preview.hoursDecimal}h` : '--';
              })()}
            </div>

            <div className="sleep-simple-actions">
              <button 
                type="button"
                className="done-btn sleep-simple-save-btn" 
                onClick={() => {
                  if (!tempSleepStart || !tempSleepEnd) {
                    alert("入眠時刻と起床時刻を入力してください。");
                    return;
                  }
                  setBasicData({ sleepStart: tempSleepStart, sleepEnd: tempSleepEnd });
                  setIsSleepModalOpen(false);
                }}
              >
                SET
              </button>

              {basicData.sleepStart && (
                <button
                  type="button"
                  className="sleep-simple-clear-btn"
                  onClick={() => {
                    if (window.confirm("睡眠時間の記録を解除しますか？")) {
                      setBasicData({ sleepStart: undefined, sleepEnd: undefined });
                      setIsSleepModalOpen(false);
                    }
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {isStudyTimerModalOpen && timerTargetTask && (() => {
        const currentTotalSec = timerAccumulatedSeconds + (timerIsRunning ? timerSessionSeconds : 0);
        const currentTotalMins = currentTotalSec > 0 ? Math.max(1, Math.round(currentTotalSec / 60)) : 0;
        const targetMins = timerTargetTask.targetMinutes;
        const isAchieved = targetMins > 0 ? currentTotalMins >= targetMins : currentTotalMins > 0;
        const progressPercent = targetMins > 0 ? Math.min(100, Math.round((currentTotalMins / targetMins) * 100)) : 100;

        const formatSec = (totalSec: number) => {
          const h = Math.floor(totalSec / 3600);
          const m = Math.floor((totalSec % 3600) / 60);
          const s = totalSec % 60;
          if (h > 0) {
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
          }
          return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        };

        return (
          <div className="modal-overlay" onClick={handleSaveAndCloseTimer}>
            <div className="modal-content study-timer-modal-content" onClick={e => e.stopPropagation()}>
              <div className="study-timer-header">
                <div className="study-timer-title-box">
                  <span className="study-timer-tag">STUDY TIMER</span>
                  <h3 className="modal-title">{timerTargetTask.taskName.toUpperCase()}</h3>
                </div>
                <button 
                  type="button" 
                  className="study-timer-close-btn"
                  onClick={handleSaveAndCloseTimer}
                  title="保存して閉じる"
                >
                  ✕
                </button>
              </div>

              {/* メインタイマー表示（大文字等幅デジタル） */}
              <div className="study-timer-display-box">
                <div className={`study-timer-session-label ${timerIsRunning ? 'recording' : 'paused'}`}>
                  {timerIsRunning ? '● RECORDING' : '❚❚ PAUSED'}
                </div>
                <div className={`study-timer-digits ${timerIsRunning ? 'is-running' : ''}`}>
                  {formatSec(currentTotalSec)}
                </div>
                <div className="study-timer-sub-label">
                  {timerIsRunning 
                    ? `SESSION: +${formatSec(timerSessionSeconds)}` 
                    : (timerLastSessionSeconds > 0 
                        ? `LAST SESSION: +${formatSec(timerLastSessionSeconds)}` 
                        : 'TOTAL STUDY TIME')}
                </div>
              </div>

              {/* 操作ボタン (START / STOP) */}
              <div className="study-timer-controls">
                {!timerIsRunning ? (
                  <button 
                    type="button" 
                    className="study-timer-btn start" 
                    onClick={handleStartTimer}
                  >
                    ▶ START
                  </button>
                ) : (
                  <button 
                    type="button" 
                    className="study-timer-btn stop" 
                    onClick={handleStopTimer}
                  >
                    ❚❚ STOP / PAUSE
                  </button>
                )}
              </div>

              {/* 当日累計ステータス & 目安時間比較 */}
              <div className="study-timer-stats-card">
                <div className="study-timer-stats-header">
                  <span className="stats-label">TODAY'S TOTAL:</span>
                  <span className="stats-value">
                    <strong>{currentTotalMins}</strong> min
                    {targetMins > 0 && <span className="stats-target"> / {targetMins} min</span>}
                  </span>
                  {isAchieved && (
                    <span className="stats-badge achieved">ACHIEVED</span>
                  )}
                </div>

                {targetMins > 0 && (
                  <div className="study-timer-progress-track">
                    <div 
                      className={`study-timer-progress-fill ${isAchieved ? 'is-achieved' : ''}`}
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                )}
              </div>

              {/* 手動微調整ボタン */}
              <div className="study-timer-adjust-row">
                <span className="adjust-label">QUICK ADJUST:</span>
                <div className="adjust-buttons">
                  <button type="button" className="adjust-btn" onClick={() => handleAdjustTimerMinutes(-5)}>-5m</button>
                  <button type="button" className="adjust-btn" onClick={() => handleAdjustTimerMinutes(5)}>+5m</button>
                  <button type="button" className="adjust-btn" onClick={() => handleAdjustTimerMinutes(15)}>+15m</button>
                  <button type="button" className="adjust-btn" onClick={() => handleAdjustTimerMinutes(30)}>+30m</button>
                </div>
              </div>

              {/* フッターアクション */}
              <div className="study-timer-footer">
                <button 
                  type="button" 
                  className="study-timer-reset-btn"
                  onClick={handleResetTimer}
                >
                  RESET
                </button>
                <button 
                  type="button" 
                  className="done-btn study-timer-save-btn"
                  onClick={handleSaveAndCloseTimer}
                >
                  SAVE & CLOSE
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Fixed Bottom Navigation */}
      <nav className="bottom-nav">
        <button 
          className={`bottom-nav-item ${isKpiView && !isArchiveView && !isArchiveListOpen && !isSettingsModalOpen && !viewingArchivedCycle && !isEditingMasterTemplate ? 'active' : ''}`}
          onClick={handleNavKpi}
          title="MONTHLY INSPECTION"
        >
          <span className="bottom-nav-icon">📊</span>
          <span className="bottom-nav-label">KPI</span>
        </button>
        <button 
          className={`bottom-nav-item ${isArchiveView || isArchiveListOpen || !!viewingArchivedCycle ? 'active' : ''}`}
          onClick={handleNavArchive}
          title="Past Archives"
        >
          <span className="bottom-nav-icon">📁</span>
          <span className="bottom-nav-label">ARCHIVE</span>
        </button>
        <button 
          className={`bottom-nav-item ${!isKpiView && !isArchiveView && !isArchiveListOpen && !isSettingsModalOpen && !viewingArchivedCycle && !isEditingMasterTemplate ? 'active' : ''}`}
          onClick={handleNavCard}
          title="HABITS CARD"
        >
          <span className="bottom-nav-icon">📋</span>
          <span className="bottom-nav-label">CARD</span>
        </button>
        <button 
          className={`bottom-nav-item ${isSettingsModalOpen || isEditingMasterTemplate ? 'active' : ''}`}
          onClick={handleNavSettings}
          title="Settings"
        >
          <span className="bottom-nav-icon">⚙️</span>
          <span className="bottom-nav-label">SETTINGS</span>
        </button>
      </nav>
    </div>
  );
}

export default App;
