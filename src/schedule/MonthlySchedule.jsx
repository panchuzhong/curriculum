import { useState, useEffect } from 'react';
import { api } from '../api';
import { getClassColor } from '../utils/colors';

function getMonthDates(year, month) {
  const first = new Date(year, month, 1);
  const startDay = first.getDay() || 7; // 1=Mon
  const last = new Date(year, month + 1, 0);
  const dates = [];
  for (let i = 1; i < startDay; i++) dates.push(null);
  for (let d = 1; d <= last.getDate(); d++) dates.push(d);
  return dates;
}

function formatDate(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export default function MonthlySchedule({ onDayClick }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [schedules, setSchedules] = useState([]);

  const startDate = formatDate(year, month, 1);
  const endDate = new Date(year, month + 1, 0);
  const endStr = formatDate(year, month, endDate.getDate());

  useEffect(() => {
    api.getSchedules(startDate, endStr).then(setSchedules);
  }, [year, month]);

  const dates = getMonthDates(year, month);
  const byDate = {};
  schedules.forEach(s => {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push(s);
  });

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="px-4 py-2 bg-gray-700 rounded">上月</button>
        <h2 className="text-xl">{year}年{month + 1}月</h2>
        <button onClick={nextMonth} className="px-4 py-2 bg-gray-700 rounded">下月</button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {['周一','周二','周三','周四','周五','周六','周日'].map(d => (
          <div key={d} className="p-2 text-center bg-gray-800 rounded">{d}</div>
        ))}
        {dates.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} className="p-2 bg-gray-800/50 rounded min-h-[80px]" />;
          const dateStr = formatDate(year, month, day);
          const daySchedules = byDate[dateStr] || [];
          return (
            <div key={day} onClick={() => onDayClick?.(dateStr)}
              className="p-2 bg-gray-800 rounded min-h-[80px] cursor-pointer hover:bg-gray-700">
              <div className="text-sm text-gray-400 mb-1">{day}</div>
              {daySchedules.slice(0, 3).map(s => (
                <div key={s.id} className="text-xs p-1 rounded mb-0.5 truncate"
                  style={{ backgroundColor: getClassColor(s.class) }}>
                  {s.class?.isCompetition && '★ '}{s.class?.name}
                </div>
              ))}
              {daySchedules.length > 3 && (
                <div className="text-xs text-gray-400">+{daySchedules.length - 3} 更多</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
