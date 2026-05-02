import { useState, useEffect, useRef } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import './App.css';

interface Habit {
  id: string;
  task: string;
  isDone: boolean;
  isSkipped?: boolean;
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

  const [isCardCompleted, setIsCardCompleted] = useState(() => {
    const saved = localStorage.getItem('isCardCompleted');
    return saved ? JSON.parse(saved) : false;
  });

  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);

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
    localStorage.setItem('isCardCompleted', JSON.stringify(isCardCompleted));
  }, [isCardCompleted]);

  const totalTasks = categories.reduce((sum, cat) => sum + cat.items.length, 0);
  const completedOrSkippedTasks = categories.reduce((sum, cat) => sum + cat.items.filter(t => t.isDone || t.isSkipped).length, 0);
  const isAllTasksCompleted = totalTasks > 0 && totalTasks === completedOrSkippedTasks;

  useEffect(() => {
    if (isCardCompleted && !isAllTasksCompleted) {
      setIsCardCompleted(false);
    }
  }, [isAllTasksCompleted, isCardCompleted]);

  const toggleMode = () => setIsEditMode(!isEditMode);

  const handleDragEnd = (result: DropResult) => {
    const { source, destination } = result;
    if (!destination) return;

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
    setIsCardCompleted(false);
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
    setCategories([...categories, { id: newId, name: "New Category", items: [] }]);
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
        </div>
      </div>
      <hr className="header-divider" />

      <DragDropContext onDragEnd={handleDragEnd}>
        {categories.map((category) => (
          <div key={category.id} className="table-container category-table">
            <div className="table-header category-header-single">
              {isEditMode ? (
                <div className="category-edit-wrapper">
                  <input
                    className="category-input"
                    value={category.name}
                    onChange={(e) => handleCategoryNameChange(category.id, e.target.value)}
                    placeholder="Category Name"
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

            <Droppable droppableId={category.id} isDropDisabled={!isEditMode}>
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
                              />
                            ) : (
                              <span>{habit.task}</span>
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
        ))}
      </DragDropContext>

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
                  const newState = !isCardCompleted;
                  setIsCardCompleted(newState);
                  // Temporary reward alert
                  if (newState) {
                    setTimeout(() => alert("Reward feature coming soon!"), 100);
                  }
                }
              }}
            >
              {isCardCompleted && <div className="stamp">済</div>}
            </div>
          ) : (
            <div className="action-cell">
              <span style={{ opacity: 0.5, fontSize: '1.2rem' }} title="System fixed item">🔒</span>
            </div>
          )}
        </div>
      </div>

      {isEditMode && (
        <div className="add-category-wrapper">
          <button className="add-category-btn" onClick={addCategory}>
            ＋ Add Category
          </button>
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
