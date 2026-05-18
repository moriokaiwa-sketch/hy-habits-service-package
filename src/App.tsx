import { useState, useEffect, useRef } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import SignatureCanvas from 'react-signature-canvas';
import './App.css';

interface Habit {
  id: string;
  task: string;
  isDone: boolean;
  isSkipped?: boolean;
  time?: string;
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
  
  const [currentShift, setCurrentShift] = useState<string>(() => {
    const saved = localStorage.getItem('currentShift');
    return saved ? saved : "日勤";
  });

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

  const [categories, setCategories] = useState<Category[]>(() => {
    const savedCategories = localStorage.getItem('categories');
    if (savedCategories) {
      try {
        return JSON.parse(savedCategories);
      } catch (e) {
        return defaultCategories;
      }
    }
    return defaultCategories;
  });

  const [signature, setSignature] = useState<string | null>(() => {
    const saved = localStorage.getItem('signature');
    return saved ? saved : null;
  });

  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  
  const [rewardImageUrls, setRewardImageUrls] = useState(() => localStorage.getItem('rewardImageUrls') || '');
  const [rewardImage, setRewardImage] = useState<string | null>(() => localStorage.getItem('rewardImage') || null);
  const [isFetchingReward, setIsFetchingReward] = useState(false);
  const [rewardError, setRewardError] = useState<string | null>(null);
  
  const signaturePadRef = useRef<SignatureCanvas>(null);
  const prevIsAllTasksCompleted = useRef<boolean | null>(null);

  useEffect(() => {
    localStorage.setItem('rewardImageUrls', rewardImageUrls);
  }, [rewardImageUrls]);
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
    localStorage.setItem('currentShift', currentShift);
  }, [currentShift]);

  useEffect(() => {
    localStorage.setItem('templates', JSON.stringify(templates));
  }, [templates]);

  useEffect(() => {
    localStorage.setItem('categories', JSON.stringify(categories));
    
    // Auto-save to template when editing
    if (isEditMode) {
      const cleanCategories = categories.map(c => ({
        ...c,
        items: c.items.map(t => ({ ...t, isDone: false, isSkipped: false }))
      }));
      setTemplates(prev => ({ ...prev, [currentShift]: cleanCategories }));
    }
  }, [categories, isEditMode, currentShift]);

  useEffect(() => {
    if (signature) {
      localStorage.setItem('signature', signature);
    } else {
      localStorage.removeItem('signature');
    }
  }, [signature]);

  useEffect(() => {
    if (rewardImage) {
      localStorage.setItem('rewardImage', rewardImage);
    } else {
      localStorage.removeItem('rewardImage');
    }
  }, [rewardImage]);

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

  const handleTimeChange = (categoryId: string, taskId: string, newTime: string) => {
    setCategories(categories.map(c => {
      if (c.id === categoryId) {
        return {
          ...c,
          items: c.items.map(t => t.id === taskId ? { ...t, time: newTime } : t)
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
    const newCategories = template.map(c => ({
      ...c,
      items: c.items.map(t => ({ ...t, isDone: false, isSkipped: false }))
    }));
    
    setCategories(newCategories);
    setCurrentShift(shift);
    setSignature(null);
    setRewardImage(null);
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
        return { ...c, items: [...c.items, { id: newId, task: "", isDone: false }] };
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

  const getTodayDate = () => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  };

  return (
    <div className={`app-container ${isEditMode ? 'edit-mode' : 'execution-mode'}`}>
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
            Issue date: {getTodayDate()} <span className="shift-badge">[{currentShift}]</span>
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
                          category.name
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
                            
                            {isEditMode ? (
                              <input
                                className="task-input"
                                value={habit.task}
                                onChange={(e) => handleTaskChange(category.id, habit.id, e.target.value)}
                                placeholder="New Task"
                                autoFocus={habit.task === ""}
                              />
                            ) : (
                              <span>{habit.task}</span>
                            )}
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
            <p className="modal-subtitle">シフトを選択してください</p>
            <div className="shift-buttons">
              {SHIFTS.map(shift => (
                <button 
                  key={shift} 
                  className={`shift-btn ${shift === currentShift ? 'active' : ''}`}
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
