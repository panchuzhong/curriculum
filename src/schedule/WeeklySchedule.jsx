import { useState, useEffect } from 'react';
import { api } from '../api';
import ScheduleGrid from './ScheduleGrid';

function getMonday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day2 = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day2}`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function WeeklySchedule() {
  const [weekStart, setWeekStart] = useState(getMonday(todayStr()));
  const [schedules, setSchedules] = useState([]);

  useEffect(() => {
    const weekEnd = addDays(weekStart, 4);
    api.getSchedules(weekStart, weekEnd).then(setSchedules);
  }, [weekStart]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setWeekStart(addDays(weekStart, -7))}
          className="px-4 py-2 bg-gray-700 rounded hover:bg-gray-600">上一周</button>
        <h2 className="text-xl">{weekStart} ~ {addDays(weekStart, 4)}</h2>
        <div className="flex gap-2">
          <button onClick={() => setWeekStart(getMonday(todayStr()))}
            className="px-4 py-2 bg-gray-700 rounded hover:bg-gray-600">本周</button>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="px-4 py-2 bg-gray-700 rounded hover:bg-gray-600">下一周</button>
        </div>
      </div>
      <ScheduleGrid schedules={schedules} weekStart={weekStart} />
    </div>
  );
}
