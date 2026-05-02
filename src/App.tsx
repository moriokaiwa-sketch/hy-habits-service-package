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

function App() {
  const [isEditMode, setIsEditMode] = useState(false);
  const [categories, setCategories] = useState<Category[]>(() => {
    const savedHabits = localStorage.getItem('habits'); // Check for old flat list
    const savedCategories = localStorage.getItem('categories');
    
    if (savedCategories) {
      try {
        return JSON.parse(savedCategories);
      } catch (e) {
        return defaultCategories;
      }
    } else if (savedHabits) {
      // Migrate old data
      try {
        const oldHabits = JSON.parse(savedHabits);
        if (Array.isArray(oldHabits) && oldHabits.length > 0) {
          return [{ id: "cat-general", name: "General", items: oldHabits }];
        }
      } catch (e) {
        // ignore
      }
    }
    return defaultCategories;
  });

  useEffect(() => {
    localStorage.setItem('categories', JSON.stringify(categories));
  }, [categories]);

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

  const resetCard = () => {
    setCategories(categories.map(c => ({
      ...c,
      items: c.items.map(t => ({ ...t, isDone: false, isSkipped: false }))
    })));
  };

  const titlePressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTitleTouchStart = () => {
    titlePressTimer.current = setTimeout(() => {
      if (window.confirm("新しいCARDを発行しますか？")) {
        resetCard();
      }
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
    if (window.confirm("新しいCARDを発行しますか？")) {
      resetCard();
    }
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
            >
              HABITS CARD
            </div>
          </div>
          <div className="issue-date">
            Issue date: {getTodayDate()}
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

      {isEditMode && (
        <div className="add-category-wrapper">
          <button className="add-category-btn" onClick={addCategory}>
            ＋ Add Category
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
