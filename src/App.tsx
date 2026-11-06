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

interface Habit {
  id: string;
  task: string;
  description?: string;
  isDone: boolean;
  isSkipped?: boolean;
  time?: string;
  estimatedTime?: number;
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

      const habitObj: Habit = {
        id: String(item?.id || `task-${Date.now()}-${cIdx}-${iIdx}`),
        task: taskText,
        description: item?.description ? String(item.description) : '',
        time: item?.time ? String(item.time) : (estimatedTime ? String(estimatedTime) : ''),
        isDone: Boolean(item?.isDone),
        isSkipped: Boolean(item?.isSkipped)
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

const SHIFTS = ["日勤", "遅番", "夜勤", "夜勤明け", "休日"];

function App() {
  const [isEditMode, setIsEditMode] = useState(false);
  
  const getDateString = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const getTodayDate = () => getDateString(0);

  const formatDateLabel = (dateStr: string) => {
    if (dateStr === getDateString(0)) return '今日';
    if (dateStr === getDateString(1)) return '明日';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
    }
    return dateStr;
  };

  const [templates, setTemplates] = useState<Record<string, Category[]>>(() => {
    const savedTemplates = localStorage.getItem('templates');
    if (savedTemplates) {
      try {
        return JSON.parse(savedTemplates);
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
        return JSON.parse(saved);
      } catch (e) {
        // ignore
      }
    }
    
    // Migration from old flat state
    const today = getTodayDate();
    const c = localStorage.getItem('categories');
    const categoriesData = c ? JSON.parse(c) : defaultCategories;
    const shiftData = localStorage.getItem('currentShift') || '日勤';
    const sigData = localStorage.getItem('signature') || null;
    const rwData = localStorage.getItem('rewardImage') || null;
    
    return {
      [today]: {
        categories: categoriesData,
        currentShift: shiftData,
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
        if (parsed['日勤']) {
          return sanitizeCategories(parsed['日勤']);
        }
      } catch (e) {}
    }
    return defaultCategories;
  });

  const [isEditingMasterTemplate, setIsEditingMasterTemplate] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'menu' | 'rewards'>('menu');

  const lastSyncStr = useRef({ cards: '', templates: '', rewardImageUrls: '', archivedCycles: '', masterCardTemplate: '' });
  const [isFirebaseLoaded, setIsFirebaseLoaded] = useState(false);


  // Sync from Firestore
  useEffect(() => {
    if (!db) {
      setIsFirebaseLoaded(true);
      return;
    }
    const docRef = doc(db, 'appData', 'sharedState');
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists() && !docSnap.metadata.hasPendingWrites) {
        const data = docSnap.data();
        if (data.cards) {
          lastSyncStr.current.cards = JSON.stringify(data.cards);
          setCards(data.cards);
        }
        if (data.templates) {
          lastSyncStr.current.templates = JSON.stringify(data.templates);
          setTemplates(data.templates);
        }
        if (data.masterCardTemplate) {
          const sanitizedMaster = sanitizeCategories(data.masterCardTemplate);
          lastSyncStr.current.masterCardTemplate = JSON.stringify(sanitizedMaster);
          setMasterCardTemplate(sanitizedMaster);
        }
        if (data.rewardImageUrls !== undefined) {
          lastSyncStr.current.rewardImageUrls = data.rewardImageUrls;
          setRewardImageUrls(data.rewardImageUrls);
        }
        if (data.archivedCycles) {
          setArchivedCycles(prev => {
            const merged = [...prev];
            const existingIds = new Set(prev.map(c => c.cycleId));
            let changed = false;
            data.archivedCycles.forEach((c: any) => {
              if (!existingIds.has(c.cycleId)) {
                merged.push(c);
                changed = true;
              }
            });
            
            // Check if local storage has any historical items that Firebase is missing
            const firebaseIds = new Set((data.archivedCycles || []).map((c: any) => c.cycleId));
            const localHasExtra = prev.some(c => !firebaseIds.has(c.cycleId));
            
            if (changed) {
              merged.sort((a, b) => a.timestamp - b.timestamp);
              if (!localHasExtra) {
                lastSyncStr.current.archivedCycles = JSON.stringify(merged);
              } else {
                // Local contributed extra items, force useEffect to upload the complete merged list to Firebase
                lastSyncStr.current.archivedCycles = "force_upload";
              }
              return merged;
            } else if (!localHasExtra && prev.length === data.archivedCycles.length) {
              lastSyncStr.current.archivedCycles = JSON.stringify(data.archivedCycles);
            } else if (localHasExtra || prev.length > data.archivedCycles.length) {
              // Local has items not in Firebase, force useEffect to upload
              lastSyncStr.current.archivedCycles = "force_upload";
            }
            return prev;
          });
        }
      }
      setIsFirebaseLoaded(true);
    }, (error) => {
      console.error("Firebase sync error:", error);
      setIsFirebaseLoaded(true);
    });
    return () => unsubscribe();
  }, []);

  // Sync to localStorage and Firestore
  useEffect(() => {
    const currentStr = JSON.stringify(cards);
    localStorage.setItem('cards', currentStr);
    
    if (isFirebaseLoaded && db && currentStr !== lastSyncStr.current.cards) {
      lastSyncStr.current.cards = currentStr;
      try {
        const cleanPayload = JSON.parse(currentStr);
        updateDoc(doc(db, 'appData', 'sharedState'), { cards: cleanPayload }).catch((e) => {
          if (e.code === 'not-found') setDoc(doc(db!, 'appData', 'sharedState'), { cards: cleanPayload });
          else console.error(e);
        });
      } catch (err) {
        console.error("Firestore sync error for cards:", err);
      }
    }
  }, [cards, isFirebaseLoaded]);

  useEffect(() => {
    const currentStr = JSON.stringify(archivedCycles);
    localStorage.setItem('archivedCycles', currentStr);
    
    if (isFirebaseLoaded && db && currentStr !== lastSyncStr.current.archivedCycles) {
      lastSyncStr.current.archivedCycles = currentStr;
      try {
        const cleanPayload = JSON.parse(currentStr);
        setDoc(doc(db, 'appData', 'sharedState'), { archivedCycles: cleanPayload }, { merge: true }).catch(console.error);
      } catch (err) {
        console.error("Firestore sync error for archivedCycles:", err);
      }
    }
  }, [archivedCycles, isFirebaseLoaded]);

  useEffect(() => {
    const currentStr = JSON.stringify(masterCardTemplate);
    localStorage.setItem('masterCardTemplate', currentStr);
    
    if (isFirebaseLoaded && db && currentStr !== lastSyncStr.current.masterCardTemplate) {
      lastSyncStr.current.masterCardTemplate = currentStr;
      try {
        const cleanPayload = JSON.parse(currentStr);
        updateDoc(doc(db, 'appData', 'sharedState'), { masterCardTemplate: cleanPayload }).catch((e) => {
          if (e.code === 'not-found') setDoc(doc(db!, 'appData', 'sharedState'), { masterCardTemplate: cleanPayload });
          else console.error(e);
        });
      } catch (err) {
        console.error("Firestore sync error for masterCardTemplate:", err);
      }
    }
  }, [masterCardTemplate, isFirebaseLoaded]);

  const [isArchiveListOpen, setIsArchiveListOpen] = useState(false);
  const [viewingArchivedCycle, setViewingArchivedCycle] = useState<{ cycleData: Record<string, any>, activeDate: string } | null>(null);

  const displayCards = viewingArchivedCycle ? viewingArchivedCycle.cycleData : cards;
  const currentActiveDate = viewingArchivedCycle ? viewingArchivedCycle.activeDate : activeDate;

  // Derived state for the active tab or master template
  const activeCard = displayCards[currentActiveDate] || {
    categories: defaultCategories,
    currentShift: '日勤',
    signature: null,
    rewardImage: null,
    dayRating: 0,
    signOffNote: '',
    newThings: '',
    momentOfTheDay: '',
    appreciate: ''
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

  const setCategories = (newCats: any) => {
    if (viewingArchivedCycle) return;
    if (isEditingMasterTemplate) {
      setMasterCardTemplate(prev => {
        return typeof newCats === 'function' ? newCats(prev) : newCats;
      });
      return;
    }
    setCards(prev => {
      const card = prev[activeDate] || { categories: defaultCategories, currentShift: '日勤', signature: null, rewardImage: null };
      const resolved = typeof newCats === 'function' ? newCats(card.categories) : newCats;
      return { ...prev, [activeDate]: { ...card, categories: resolved } };
    });
  };



  const setSignature = (sig: string | null) => {
    if (viewingArchivedCycle) return;
    setCards(prev => {
      if (!prev[activeDate] && sig === null) return prev;
      const card = prev[activeDate] || { categories: defaultCategories, currentShift: '日勤', signature: null, rewardImage: null };
      return { ...prev, [activeDate]: { ...card, signature: sig } };
    });
  };

  const setRewardImage = (img: string | null) => {
    if (viewingArchivedCycle) return;
    setCards(prev => {
      if (!prev[activeDate] && img === null) return prev;
      const card = prev[activeDate] || { categories: defaultCategories, currentShift: '日勤', signature: null, rewardImage: null, dayRating: 0, signOffNote: '' };
      return { ...prev, [activeDate]: { ...card, rewardImage: img } };
    });
  };

  const setDayRating = (rating: number) => {
    if (viewingArchivedCycle) return;
    setCards(prev => {
      const card = prev[activeDate] || { categories: defaultCategories, currentShift: '日勤', signature: null, rewardImage: null, dayRating: 0, signOffNote: '' };
      return { ...prev, [activeDate]: { ...card, dayRating: rating } };
    });
  };

  const setSignOffNote = (note: string) => {
    if (viewingArchivedCycle) return;
    setCards(prev => {
      const card = prev[activeDate] || { categories: defaultCategories, currentShift: '日勤', signature: null, rewardImage: null, dayRating: 0, signOffNote: '' };
      return { ...prev, [activeDate]: { ...card, signOffNote: note } };
    });
  };

  const setNewThings = (val: string) => {
    if (viewingArchivedCycle) return;
    setCards(prev => {
      const card = prev[activeDate] || { categories: defaultCategories, currentShift: '日勤', signature: null, rewardImage: null, dayRating: 0, signOffNote: '' };
      return { ...prev, [activeDate]: { ...card, newThings: val } };
    });
  };

  const setMomentOfTheDay = (val: string) => {
    if (viewingArchivedCycle) return;
    setCards(prev => {
      const card = prev[activeDate] || { categories: defaultCategories, currentShift: '日勤', signature: null, rewardImage: null, dayRating: 0, signOffNote: '' };
      return { ...prev, [activeDate]: { ...card, momentOfTheDay: val } };
    });
  };

  const setAppreciate = (val: string) => {
    if (viewingArchivedCycle) return;
    setCards(prev => {
      const card = prev[activeDate] || { categories: defaultCategories, currentShift: '日勤', signature: null, rewardImage: null, dayRating: 0, signOffNote: '' };
      return { ...prev, [activeDate]: { ...card, appreciate: val } };
    });
  };

  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  
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
    
    if (isFirebaseLoaded && db && currentStr !== lastSyncStr.current.templates) {
      lastSyncStr.current.templates = currentStr;
      try {
        const cleanPayload = JSON.parse(currentStr);
        updateDoc(doc(db, 'appData', 'sharedState'), { templates: cleanPayload }).catch((e) => {
          if (e.code === 'not-found') setDoc(doc(db!, 'appData', 'sharedState'), { templates: cleanPayload });
          else console.error(e);
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

  const toggleMode = () => setIsEditMode(!isEditMode);

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
    }));
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
    }));
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

  const titlePressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openShiftModal = () => {
    setIsShiftModalOpen(true);
  };

  const handleTitleTouchStart = () => {
    titlePressTimer.current = setTimeout(() => {
      openShiftModal();
    }, 800);
  };

  const handleTitleTouchEnd = () => {
    if (titlePressTimer.current) {
      clearTimeout(titlePressTimer.current);
      titlePressTimer.current = null;
    }
  };

  const handleTitleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    openShiftModal();
  };

  const loadShiftTemplate = (shift: string) => {
    const rawTemplate = (templates[shift] && templates[shift].length > 0) ? templates[shift] : masterCardTemplate;
    const template = (rawTemplate && rawTemplate.length > 0) ? rawTemplate : defaultCategories;
    const cleanCategories = template.map(c => ({
      ...c,
      items: c.items.map(t => ({ ...t, isDone: false, isSkipped: false }))
    }));

    setCards(prev => {
      const newCards = { ...prev };

      
      newCards[selectedIssueDate] = {
        categories: cleanCategories,
        currentShift: shift,
        signature: null,
        rewardImage: null
      };
      
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

  const addHabit = (categoryId: string) => {
    const newId = `task-${Date.now()}`;
    setCategories(categories.map(c => {
      if (c.id === categoryId) {
        return { ...c, items: [...c.items, { id: newId, task: "", description: "", isDone: false }] };
      }
      return c;
    }));
  };

  const handleCategoryNameChange = (categoryId: string, newName: string) => {
    setCategories(categories.map(c => c.id === categoryId ? { ...c, name: newName } : c));
  };

  const deleteCategory = (categoryId: string) => {
    if (window.confirm("このカテゴリと中のすべての項目を削除しますか？")) {
      setCategories(categories.filter(c => c.id !== categoryId));
    }
  };

  const handleArchiveCycle = () => {
    if (window.confirm("現在のサイクルを終了し、過去ログにアーカイブしますか？")) {
      const cycleId = `cycle-${Date.now()}`;
      setArchivedCycles(prev => [...prev, {
        cycleId,
        timestamp: Date.now(),
        cards: cards
      }]);
      
      setCards({});
      const today = getTodayDate();
      setSelectedIssueDate(today);
      setActiveDate(today);
      setIsArchiveListOpen(false);
      setIsShiftModalOpen(true);
    }
  };

  const handleNavCard = () => {
    setIsArchiveListOpen(false);
    setIsSettingsModalOpen(false);
    setIsEditingMasterTemplate(false);
    if (viewingArchivedCycle) {
      setViewingArchivedCycle(null);
    }
  };

  const handleNavArchive = () => {
    setIsSettingsModalOpen(false);
    setIsEditingMasterTemplate(false);
    setIsArchiveListOpen(true);
  };

  const handleNavSettings = () => {
    setIsArchiveListOpen(false);
    setSettingsTab('menu');
    setIsSettingsModalOpen(true);
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
            currentShift: currentShift || '日勤',
            signature: null,
            rewardImage: null,
            dayRating: 0,
            signOffNote: '',
            newThings: '',
            momentOfTheDay: '',
            appreciate: ''
          };

          return {
            ...prev,
            [targetDate]: {
              ...current,
              categories: clonedCategories
            }
          };
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
               const today = getTodayDate();
               newCards[today] = { categories: defaultCategories, currentShift: '日勤', signature: null, rewardImage: null };
               setActiveDate(today);
             }
          }
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



  const renderArchiveModal = () => {
    if (!isArchiveListOpen) return null;
    
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

    return (
      <div className="modal-overlay" onClick={() => setIsArchiveListOpen(false)}>
        <div className="modal-content archive-modal-content" onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3 className="modal-title" style={{ margin: 0 }}>アーカイブ一覧</h3>
            <button onClick={() => setIsArchiveListOpen(false)} style={{ background: 'none', border: 'none', fontSize: '2rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
          
          {!viewingArchivedCycle && Object.keys(cards).length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <button 
                className="action-btn-archive-cycle"
                onClick={handleArchiveCycle}
              >
                <span>📁</span> 前サイクルをアーカイブして新カード発行
              </button>
            </div>
          )}
          
          {Object.keys(groupedByMonth).length === 0 ? (
            <p>アーカイブされたサイクルはありません。</p>
          ) : (
            Object.keys(groupedByMonth).sort().reverse().map(monthStr => {
              const [, month] = monthStr.split('-');
              const monthLabel = `${parseInt(month, 10)}月`; // "6月"
              
              return (
                <div key={monthStr} className="archive-month-group">
                  <div className="archive-month-title">{monthLabel}</div>
                  {[...groupedByMonth[monthStr]].reverse().map(({ cycle }) => {
                    const dates = Object.keys(cycle.cards || {}).sort();
                    return (
                      <div key={cycle.cycleId} className="archive-shift-group">
                        <div className="archive-cards-row">
                          {dates.map(dateStr => {
                            const c = cycle.cards[dateStr];
                            const dayNum = parseInt(dateStr.split('-')[2], 10);
                            return (
                              <div 
                                key={dateStr} 
                                className={`archive-card-box ${c.signature ? 'completed-day' : ''}`}
                                onClick={() => {
                                  setViewingArchivedCycle({ cycleData: cycle.cards, activeDate: dateStr });
                                  setIsArchiveListOpen(false);
                                  setIsEditMode(false); // Force execution mode UI for read-only
                                }}
                              >
                                <div className="archive-card-date">{dayNum}</div>
                                <div className="archive-card-shift">{c.currentShift}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })
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
          <button onClick={() => setViewingArchivedCycle(null)}>閉じる</button>
        </div>
      )}
      {!isEditingMasterTemplate && Object.keys(displayCards).length > 1 && (
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
        </div>
      )}
      <div className="header-top">
        <div className="title-area">
          <div className="document-title">
            <div 
              className="card-title"
              onTouchStart={isEditingMasterTemplate ? undefined : handleTitleTouchStart}
              onTouchEnd={isEditingMasterTemplate ? undefined : handleTitleTouchEnd}
              onTouchMove={isEditingMasterTemplate ? undefined : handleTitleTouchEnd}
              onMouseDown={isEditingMasterTemplate ? undefined : handleTitleTouchStart}
              onMouseUp={isEditingMasterTemplate ? undefined : handleTitleTouchEnd}
              onMouseLeave={isEditingMasterTemplate ? undefined : handleTitleTouchEnd}
              onContextMenu={isEditingMasterTemplate ? (e) => e.preventDefault() : handleTitleContextMenu}
              style={{ cursor: isEditingMasterTemplate ? 'default' : 'pointer', userSelect: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
              title={isEditingMasterTemplate ? "MASTER HABITS CARD" : "Long press or right-click to issue a new card"}
            >
              {isEditingMasterTemplate ? 'MASTER HABITS CARD' : 'HABITS CARD'}
            </div>
          </div>
          <div className="issue-date">
            {isEditingMasterTemplate ? (
              <span className="master-badge">TEMPLATE [MASTER]</span>
            ) : (
              <>Issue date: {currentActiveDate} <span className="shift-badge">[{currentShift}]</span></>
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
          <button 
            type="button"
            className="load-master-btn" 
            onClick={handleLoadFromMaster}
            title="マスターカード（テンプレート）のタスク構成をこのカードに上書き読み込みします"
          >
            📋 LOAD FROM MASTER
          </button>
          <span className="load-master-hint">※マスターのタスク構成を読み込み（日付/シフト情報は保持）</span>
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

                          {!effectiveIsEditMode ? (
                            <div 
                              className="done-cell" 
                              onClick={() => toggleDone(category.id, habit.id)}
                              onTouchStart={() => handleTouchStart(category.id, habit.id)}
                              onTouchEnd={handleTouchEnd}
                              onTouchMove={handleTouchEnd}
                              onMouseDown={() => handleTouchStart(category.id, habit.id)}
                              onMouseUp={handleTouchEnd}
                              onMouseLeave={handleTouchEnd}
                              onContextMenu={(e) => handleContextMenu(e, category.id, habit.id)}
                            >
                              {habit.isDone && <div className="stamp">済</div>}
                              {habit.isSkipped && <div className="slash-line"></div>}
                            </div>
                          ) : (
                            <div className="action-cell">
                              <button 
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
                  const dataURL = signaturePadRef.current?.getTrimmedCanvas().toDataURL('image/png');
                  if (dataURL) {
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
            <p className="modal-subtitle">日付とシフトを選択してください</p>
            
            <div className="date-selector" style={{display: 'flex', gap: '5px', marginBottom: '20px', justifyContent: 'center'}}>
              {[0, 1, 2, 3, 4].map(offset => {
                const dStr = getDateString(offset);
                return (
                  <button 
                    key={offset}
                    className={`shift-btn ${selectedIssueDate === dStr ? 'active' : ''}`}
                    onClick={() => setSelectedIssueDate(dStr)}
                    style={{flex: 1, padding: '0.5rem 0', fontSize: '0.85rem'}}
                  >
                    {formatDateLabel(dStr)}
                  </button>
                );
              })}
            </div>

            <div className="shift-buttons">
              {SHIFTS.map(shift => (
                <button 
                  key={shift} 
                  className={`shift-btn`}
                  onClick={() => loadShiftTemplate(shift)}
                >
                  {shift}
                </button>
              ))}
            </div>
            <button className="cancel-btn" onClick={() => setIsShiftModalOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {renderArchiveModal()}

      {/* Fixed Bottom Navigation */}
      <nav className="bottom-nav">
        <button 
          className={`bottom-nav-item ${!isArchiveListOpen && !isSettingsModalOpen && !viewingArchivedCycle && !isEditingMasterTemplate ? 'active' : ''}`}
          onClick={handleNavCard}
          title="HABITS CARD"
        >
          <span className="bottom-nav-icon">📋</span>
          <span className="bottom-nav-label">CARD</span>
        </button>
        <button 
          className={`bottom-nav-item ${isArchiveListOpen || !!viewingArchivedCycle ? 'active' : ''}`}
          onClick={handleNavArchive}
          title="Past Archives"
        >
          <span className="bottom-nav-icon">📁</span>
          <span className="bottom-nav-label">ARCHIVE</span>
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
