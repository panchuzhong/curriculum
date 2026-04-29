import { useState, useEffect } from 'react';
import { api } from '../api';
import { getClassColor } from '../utils/colors';
import ClassForm from './ClassForm';
import StudentManager from './StudentManager';

export default function ClassList() {
  const [classes, setClasses] = useState([]);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => { api.getClasses().then(setClasses); }, []);

  async function handleCreate(form) {
    await api.createClass(form);
    setShowForm(false);
    api.getClasses().then(setClasses);
  }

  async function handleUpdate(form) {
    await api.updateClass(editing.id, form);
    setEditing(null);
    api.getClasses().then(setClasses);
  }

  async function handleDelete(id) {
    if (!confirm('确定删除？')) return;
    await api.deleteClass(id);
    api.getClasses().then(setClasses);
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl">班级管理</h2>
        <button onClick={() => { setShowForm(true); setEditing(null); }}
          className="px-4 py-2 bg-blue-600 rounded">新建班级</button>
      </div>

      {(showForm || editing) && (
        <ClassForm
          initial={editing}
          onSubmit={editing ? handleUpdate : handleCreate}
          onCancel={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      <div className="grid gap-2 mt-4">
        {classes.map(cls => (
          <div key={cls.id} className="bg-gray-800 rounded-lg overflow-hidden">
            <div className="p-4 flex items-center justify-between cursor-pointer"
              onClick={() => setExpandedId(expandedId === cls.id ? null : cls.id)}>
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: getClassColor(cls) }} />
                <div>
                  <div className="font-bold">
                    {cls.isCompetition && '★ '}{cls.name}
                  </div>
                  <div className="text-sm text-gray-400">
                    {cls.grade} · {cls.subject} · {cls.studentCount}人 · ¥{cls.unitPrice}/人/时
                    {cls.discountAmount > 0 && ` · 优惠¥${cls.discountAmount}`}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={e => { e.stopPropagation(); setEditing(cls); }}
                  className="px-3 py-1 bg-gray-600 rounded text-sm">编辑</button>
                <button onClick={e => { e.stopPropagation(); handleDelete(cls.id); }}
                  className="px-3 py-1 bg-red-600 rounded text-sm">删除</button>
              </div>
            </div>
            {expandedId === cls.id && <StudentManager classId={cls.id} />}
          </div>
        ))}
      </div>
    </div>
  );
}
