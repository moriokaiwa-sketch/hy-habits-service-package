import { useState, useEffect, useRef } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import SignatureCanvas from 'react-signature-canvas';
import { db } from './firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import './App.css';

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

  const lastSyncStr = useRef({ cards: '', templates: '', rewardImageUrls: '' });
  const [isFirebaseLoaded, setIsFirebaseLoaded] = useState(false);

  // Clean up old cards on load
  useEffect(() => {
    const today = getTodayDate();
    setCards(prev => {
      let changed = false;
      const newCards = { ...prev };
      Object.keys(newCards).forEach(date => {
        if (date < today) {
          delete newCards[date];
          changed = true;
        }
      });
      return changed ? newCards : prev;
    });
  }, []);

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
        if (data.rewardImageUrls !== undefined) {
          lastSyncStr.current.rewardImageUrls = data.rewardImageUrls;
          setRewardImageUrls(data.rewardImageUrls);
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
      setDoc(doc(db, 'appData', 'sharedState'), { cards }, { merge: true }).catch(console.error);
    }
  }, [cards, isFirebaseLoaded]);

  // Derived state for the active tab
  const activeCard = cards[activeDate] || {
    categories: defaultCategories,
    currentShift: '日勤',
    signature: null,
    rewardImage: null,
    dayRating: 0,
    signOffNote: ''
  };

  const categories: Category[] = activeCard.categories;
  const currentShift: string = activeCard.currentShift;
  const signature: string | null = activeCard.signature;
  const rewardImage: string | null = activeCard.rewardImage;
  const dayRating: number = activeCard.dayRating || 0;
  const signOffNote: string = activeCard.signOffNote || '';

  const setCategories = (newCats: any) => {
    setCards(prev => {
      const card = prev[activeDate] || { categories: defaultCategories, currentShift: '日勤', signature: null, rewardImage: null };
      const resolved = typeof newCats === 'function' ? newCats(card.categories) : newCats;
      return { ...prev, [activeDate]: { ...card, categories: resolved } };
    });
  };



  const setSignature = (sig: string | null) => {
    setCards(prev => {
      const card = prev[activeDate] || { categories: defaultCategories, currentShift: '日勤', signature: null, rewardImage: null };
      return { ...prev, [activeDate]: { ...card, signature: sig } };
    });
  };

  const setRewardImage = (img: string | null) => {
    setCards(prev => {
      const card = prev[activeDate] || { categories: defaultCategories, currentShift: '日勤', signature: null, rewardImage: null, dayRating: 0, signOffNote: '' };
      return { ...prev, [activeDate]: { ...card, rewardImage: img } };
    });
  };

  const setDayRating = (rating: number) => {
    setCards(prev => {
      const card = prev[activeDate] || { categories: defaultCategories, currentShift: '日勤', signature: null, rewardImage: null, dayRating: 0, signOffNote: '' };
      return { ...prev, [activeDate]: { ...card, dayRating: rating } };
    });
  };

  const setSignOffNote = (note: string) => {
    setCards(prev => {
      const card = prev[activeDate] || { categories: defaultCategories, currentShift: '日勤', signature: null, rewardImage: null, dayRating: 0, signOffNote: '' };
      return { ...prev, [activeDate]: { ...card, signOffNote: note } };
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
      setDoc(doc(db, 'appData', 'sharedState'), { templates }, { merge: true }).catch(console.error);
    }
  }, [templates, isFirebaseLoaded]);

  useEffect(() => {
    // Auto-save to template when editing
    if (isEditMode) {
      const cleanCategories = categories.map(c => ({
        ...c,
        items: c.items.map(t => ({ ...t, isDone: false, isSkipped: false }))
      }));
      setTemplates(prev => ({ ...prev, [currentShift]: cleanCategories }));
    }
  }, [categories, isEditMode, currentShift]);

  const totalTasks = categories.reduce((sum, cat) => sum + cat.items.length, 0);
  const completedOrSkippedTasks = categories.reduce((sum, cat) => sum + cat.items.filter(t => t.isDone || t.isSkipped).length, 0);
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
              return { 
                ...t, 
                time: newTime, 
                estimatedTime: Number.isNaN(estimatedTime) ? undefined : estimatedTime 
              };
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
    const template = templates[shift] || [];
    const cleanCategories = template.map(c => ({
      ...c,
      items: c.items.map(t => ({ ...t, isDone: false, isSkipped: false }))
    }));

    setCards(prev => {
      const newCards = { ...prev };
      
      // Clean up old cards
      const today = getTodayDate();
      Object.keys(newCards).forEach(date => {
        if (date < today) {
          delete newCards[date];
        }
      });
      
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

  const addCategory = () => {
    const newId = `cat-${Date.now()}`;
    setCategories([...categories, { id: newId, name: "", items: [] }]);
  };

  const tabPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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



  return (
    <div className={`app-container ${isEditMode ? 'edit-mode' : 'execution-mode'}`}>
      {Object.keys(cards).length > 1 && (
        <div className="date-tabs">
          {Object.keys(cards).sort().map(dateStr => (
            <button 
              key={dateStr}
              className={`date-tab ${dateStr === activeDate ? 'active' : ''}`}
              onClick={() => setActiveDate(dateStr)}
              onTouchStart={() => handleTabTouchStart(dateStr)}
              onTouchEnd={handleTabTouchEnd}
              onTouchMove={handleTabTouchEnd}
              onMouseDown={() => handleTabTouchStart(dateStr)}
              onMouseUp={handleTabTouchEnd}
              onMouseLeave={handleTabTouchEnd}
              onContextMenu={e => {
                e.preventDefault();
                handleTabTouchStart(dateStr);
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
              onTouchStart={handleTitleTouchStart}
              onTouchEnd={handleTitleTouchEnd}
              onTouchMove={handleTitleTouchEnd}
              onMouseDown={handleTitleTouchStart}
              onMouseUp={handleTitleTouchEnd}
              onMouseLeave={handleTitleTouchEnd}
              onContextMenu={handleTitleContextMenu}
              style={{ cursor: 'pointer', userSelect: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
              title="Long press or right-click to issue a new card"
            >
              HABITS CARD
            </div>
          </div>
          <div className="issue-date">
            Issue date: {activeDate} <span className="shift-badge">[{currentShift}]</span>
          </div>
        </div>
        <div className="mode-toggle">
          <span>{isEditMode ? 'Edit Mode' : 'Execution Mode'}</span>
          <label className="switch">
            <input type="checkbox" checked={isEditMode} onChange={toggleMode} />
            <span className="slider"></span>
          </label>
          <button className="settings-btn" onClick={() => setIsSettingsModalOpen(true)} title="Reward Settings">⚙️</button>
        </div>
      </div>
      <hr className="header-divider" />

      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="board" type="category" isDropDisabled={!isEditMode}>
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps}>
              {categories.map((category, index) => (
                <Draggable key={category.id} draggableId={category.id} index={index} isDragDisabled={!isEditMode}>
                  {(provided, snapshot) => (
                    <div 
                      ref={provided.innerRef} 
                      {...provided.draggableProps} 
                      className={`table-container category-table ${snapshot.isDragging ? 'category-is-dragging' : ''}`}
                    >
                      <div className="table-header category-header-single">
                        {isEditMode ? (
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
                              category.items.forEach(habit => {
                                let timeVal = habit.estimatedTime;
                                if (timeVal === undefined && habit.time) {
                                  const parsed = parseInt(habit.time, 10);
                                  if (!isNaN(parsed)) timeVal = parsed;
                                }
                                if (timeVal !== undefined && timeVal > 0) {
                                  hasTimeTasks = true;
                                  if (!habit.isDone) {
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

                      <Droppable droppableId={category.id} type="task" isDropDisabled={!isEditMode}>
              {(provided) => (
                <div 
                  {...provided.droppableProps} 
                  ref={provided.innerRef}
                  className="droppable-container"
                >
                  {category.items.map((habit, index) => (
                    <Draggable 
                      key={habit.id} 
                      draggableId={habit.id} 
                      index={index} 
                      isDragDisabled={!isEditMode}
                    >
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          className={`habit-row ${snapshot.isDragging ? 'is-dragging' : ''} ${habit.isSkipped && !isEditMode ? 'is-skipped' : ''}`}
                        >
                          <div className="task-cell">
                            {isEditMode && (
                              <div 
                                className="drag-handle" 
                                {...provided.dragHandleProps}
                              >
                                ☰
                              </div>
                            )}
                            
                            <div className="task-content">
                              {isEditMode ? (
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
                            {isEditMode ? (
                              <input
                                className="time-input"
                                type="number"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={habit.time || ''}
                                onChange={(e) => handleTimeChange(category.id, habit.id, e.target.value)}
                                placeholder="-"
                              />
                            ) : (
                              <span className="time-display">{habit.time}</span>
                            )}
                          </div>

                          {!isEditMode ? (
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
            
                    {isEditMode && (
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

      {isEditMode && (
        <div className="add-category-wrapper">
          <button className="add-category-btn" onClick={addCategory}>
            ＋ Add Category
          </button>
        </div>
      )}

      {/* SIGN-OFF NOTES Section */}
      <div className="table-container sign-off-container">
        <div className="table-header category-header-single">
          <span style={{ padding: '0.75rem 1rem' }}>SIGN-OFF NOTES</span>
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
        </div>
      </div>

      <div className="table-container complete-check-container">
        <div className="habit-row complete-check-row">
          <div className="task-cell complete-check-task">
            <span>Complete Check</span>
          </div>

          {!isEditMode ? (
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
            <h3 className="modal-title">Reward Settings</h3>
            <p className="settings-desc">ご褒美画像のURL（ウェブ上の画像リンク）を1行ずつ貼り付けてください。サイン完了時にランダムで1枚表示されます。</p>
            
            <div className="settings-field">
              <label>Image URLs</label>
              <textarea 
                value={rewardImageUrls} 
                onChange={e => setRewardImageUrls(e.target.value)} 
                placeholder="https://example.com/image1.jpg&#10;https://example.com/image2.png" 
                rows={10}
              />
            </div>
            
            <button className="done-btn" style={{marginTop: '1.5rem', width: '100%'}} onClick={() => setIsSettingsModalOpen(false)}>Save & Close</button>
          </div>
        </div>
      )}

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
    </div>
  );
}

export default App;
