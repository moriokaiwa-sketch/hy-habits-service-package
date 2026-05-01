import { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import './App.css';

interface Habit {
  id: string;
  task: string;
  isDone: boolean;
}

const initialData: Habit[] = [
  { id: "task-01", task: "Duolingo", isDone: false },
  { id: "task-02", task: "Pimsleur", isDone: false },
  { id: "task-03", task: "3行日記", isDone: false },
  { id: "task-04", task: "筋トレ", isDone: false }
];

function App() {
  const [isEditMode, setIsEditMode] = useState(false);
  const [habits, setHabits] = useState<Habit[]>(() => {
    const saved = localStorage.getItem('habits');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return initialData;
      }
    }
    return initialData;
  });

  useEffect(() => {
    localStorage.setItem('habits', JSON.stringify(habits));
  }, [habits]);

  const toggleMode = () => setIsEditMode(!isEditMode);

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const items = Array.from(habits);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setHabits(items);
  };

  const handleTaskChange = (id: string, newTaskName: string) => {
    setHabits(habits.map(h => h.id === id ? { ...h, task: newTaskName } : h));
  };

  const toggleDone = (id: string) => {
    if (isEditMode) return;
    setHabits(habits.map(h => h.id === id ? { ...h, isDone: !h.isDone } : h));
  };

  const deleteHabit = (id: string) => {
    setHabits(habits.filter(h => h.id !== id));
  };

  const addHabit = () => {
    const newId = `task-${Date.now()}`;
    setHabits([...habits, { id: newId, task: "New Task", isDone: false }]);
  };

  const getTodayDate = () => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  };

  return (
    <div className="app-container">
      <div className="header-top">
        <div className="document-title">
          <div className="card-title">MY HABITS SERVICE-PACKAGE</div>
        </div>
        <div className="mode-toggle">
          <span>{isEditMode ? 'Edit Mode' : 'Execution Mode'}</span>
          <label className="switch">
            <input type="checkbox" checked={isEditMode} onChange={toggleMode} />
            <span className="slider"></span>
          </label>
        </div>
      </div>

      <div className="metadata">
        <div className="meta-item">
          <span className="meta-label">Card No:</span>
          <span>AG-001</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Issue Date(JST):</span>
          <span>{getTodayDate()}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Revision:</span>
          <span>01</span>
        </div>
      </div>

      <div className="table-container">
        <div className="table-header">
          <div className="col-task">Action Items</div>
          {!isEditMode ? (
            <div className="col-done">Sign-off</div>
          ) : (
            <div className="col-action">Action</div>
          )}
        </div>

        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="habits" isDropDisabled={!isEditMode}>
            {(provided) => (
              <div 
                {...provided.droppableProps} 
                ref={provided.innerRef}
              >
                {habits.map((habit, index) => (
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
                        className={`habit-row ${snapshot.isDragging ? 'is-dragging' : ''}`}
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
                              onChange={(e) => handleTaskChange(habit.id, e.target.value)}
                            />
                          ) : (
                            <span>{habit.task}</span>
                          )}
                        </div>

                        {!isEditMode ? (
                          <div 
                            className="done-cell" 
                            onClick={() => toggleDone(habit.id)}
                          >
                            {habit.isDone && <div className="stamp">済</div>}
                          </div>
                        ) : (
                          <div className="action-cell">
                            <button 
                              className="delete-btn" 
                              onClick={() => deleteHabit(habit.id)}
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
        </DragDropContext>
        
        {isEditMode && (
          <div className="add-row">
            <button className="add-btn" onClick={addHabit}>
              ＋ Add Action Item
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
