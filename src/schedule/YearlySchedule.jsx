import { useState, useEffect } from 'react';
import { api } from '../api';

function formatDate(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export default function YearlySchedule({ onMonthClick }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [schedules, setSchedules] = useState([]);

  useEffect(() => {
    api.getSchedules(`${year}-01-01`, `${year}-12-31`).then(setSchedules);
  }, [year]);

  // Group by month
  const byMonth = {};
  for (let m = 0; m < 12; m++) byMonth[m] = new Set();
  schedules.forEach(s => {
    const m = parseInt(s.date.split('-')[1]) - 1;
    byMonth[m].add(s.date);
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setYear(y => y - 1)} className="px-4 py-2 bg-gray-700 rounded">上一年</button>
        <h2 className="text-xl">{year}年</h2>
        <button onClick={() => setYear(y => y + 1)} className="px-4 py-2 bg-gray-700 rounded">下一年</button>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 12 }, (_, m) => (
          <div key={m} onClick={() => onMonthClick?.(year, m)}
            className="p-4 bg-gray-800 rounded cursor-pointer hover:bg-gray-700">
            <h3 className="text-lg mb-2">{m + 1}月</h3>
            <div className="text-sm text-gray-400">
              {byMonth[m].size > 0 ? `${byMonth[m].size} 天有课` : '无排课'}
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {Array.from(byMonth[m]).sort().slice(0, 10).map(d => (
                <div key={d} className="w-2 h-2 bg-blue-500 rounded-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
