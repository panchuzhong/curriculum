import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { getClassColor, getTextColor } from '../utils/colors';
import { isHoliday, getHolidayName, isWorkday, getWorkdayReason } from '../utils/holidays';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

function getMonday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function MonthlySchedule() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const now = new Date();
  const [year, setYear] = useState(searchParams.get('year') ? +searchParams.get('year') : now.getFullYear());
  const [month, setMonth] = useState(searchParams.get('month') != null ? +searchParams.get('month') : now.getMonth());
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
        <button onClick={prevMonth} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform">上月</button>
        <h2 className="text-xl">{year}年{month + 1}月</h2>
        <div className="flex gap-2">
          <button onClick={() => { const n = new Date(); setYear(n.getFullYear()); setMonth(n.getMonth()); }}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform">本月</button>
          <button onClick={nextMonth} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform">下月</button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {['周一','周二','周三','周四','周五','周六','周日'].map(d => (
          <div key={d} className="p-2 text-center bg-gray-100 dark:bg-gray-800 rounded">{d}</div>
        ))}
        {dates.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} className="p-2 bg-gray-100 dark:bg-gray-800/50 rounded min-h-[80px]" />;
          const dateStr = formatDate(year, month, day);
          const daySchedules = byDate[dateStr] || [];
          const holiday = isHoliday(dateStr);
          const workday = isWorkday(dateStr);
          const isToday = dateStr === todayStr();
          return (
            <div key={day} onClick={() => {
              const monday = getMonday(dateStr);
              navigate(`/?week=${monday}`);
            }}
              className={`p-2 rounded min-h-[80px] cursor-pointer ${
                isToday ? 'bg-blue-100 dark:bg-blue-900/30 ring-1 ring-blue-400' :
                holiday ? 'bg-red-50 dark:bg-red-900/20' :
                workday ? 'bg-orange-50 dark:bg-orange-900/20' :
                'bg-gray-100 dark:bg-gray-800'
              } hover:bg-gray-200 dark:hover:bg-gray-700`}>
              <div className="flex items-center gap-1 mb-1 flex-wrap">
                <span className={`text-sm ${isToday ? 'font-bold text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`}>{day}</span>
                {isToday && <span className="text-[10px] bg-blue-500 text-white px-1 rounded">今</span>}
                {holiday && <span className="text-[10px] bg-red-500 text-white px-1 rounded">{getHolidayName(dateStr)}</span>}
                {workday && <span className="text-[10px] bg-orange-500 text-white px-1 rounded">调休上班</span>}
              </div>
              {daySchedules.map(s => {
                const tooMany = daySchedules.length > 3;
                return (
                  <div key={s.id}
                    className={`${tooMany ? 'text-[10px] py-0.5 px-1' : 'text-xs p-1'} rounded mb-0.5 truncate`}
                    style={{ backgroundColor: getClassColor(s.class), color: getTextColor(s.class) }}>
                    {s.class?.isCompetition && '★ '}{s.class?.name}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
