import { useState, useEffect } from 'react';
import { api } from '../api';

export default function StudentManager({ classId }) {
  const [students, setStudents] = useState([]);
  const [name, setName] = useState('');

  useEffect(() => {
    if (classId) api.getStudents(classId).then(setStudents);
  }, [classId]);

  async function addStudent() {
    if (!name.trim()) return;
    await api.addStudent(classId, { name: name.trim() });
    setName('');
    api.getStudents(classId).then(setStudents);
  }

  async function removeStudent(sid) {
    await api.removeStudentFromClass(classId, sid);
    setStudents(s => s.filter(x => x.id !== sid));
  }

  return (
    <div className="mt-4 p-4 border-t border-gray-300 dark:border-gray-700">
      <h3 className="text-lg mb-2">学生列表</h3>
      <div className="flex gap-2 mb-2">
        <input className="flex-1 p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded" placeholder="学生姓名"
          value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addStudent()} />
        <button onClick={addStudent} className="px-4 py-2 bg-green-600 rounded">添加</button>
      </div>
      {students.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">暂无学生</p>
      ) : (
        <ul className="space-y-1">
          {students.map(s => (
            <li key={s.id} className="flex justify-between items-center p-2 bg-gray-50 dark:bg-gray-800 rounded">
              <span>{s.name}</span>
              <button onClick={() => removeStudent(s.id)} className="text-red-400 hover:text-red-300">删除</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
