import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { getClassColor, getTextColor } from '../utils/colors';
import { isHoliday, getHolidayName, isWorkday, getWorkdayReason } from '../utils/holidays';
import { todayStr, getMonday } from '../utils/date';

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

  const navBtn = "px-2 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-base bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 transition-transform select-none";

  return (
    <div>
      <div className="flex items-center justify-between mb-2 sm:mb-4">
        <button onClick={prevMonth} className={navBtn}><span className="sm:hidden">‹</span><span className="hidden sm:inline">上月</span></button>
        <h2 className="text-base sm:text-xl font-medium">{year}年{month + 1}月</h2>
        <div className="flex gap-1 sm:gap-2">
          <button onClick={() => { const n = new Date(); setYear(n.getFullYear()); setMonth(n.getMonth()); }}
            className={navBtn}><span className="sm:hidden">今</span><span className="hidden sm:inline">本月</span></button>
          <button onClick={nextMonth} className={navBtn}><span className="sm:hidden">›</span><span className="hidden sm:inline">下月</span></button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
        {['一','二','三','四','五','六','日'].map(d => (
          <div key={d} className="p-1 sm:p-2 text-center text-xs sm:text-base bg-gray-100 dark:bg-gray-800 rounded">
            <span className="sm:hidden">{d}</span>
            <span className="hidden sm:inline">周{d}</span>
          </div>
        ))}
        {dates.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} className="p-1 sm:p-2 bg-gray-100 dark:bg-gray-800/50 rounded min-h-[60px] sm:min-h-[80px]" />;
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
              className={`p-1 sm:p-2 rounded min-h-[60px] sm:min-h-[80px] cursor-pointer overflow-hidden ${
                isToday ? 'bg-blue-100 dark:bg-blue-900/30 ring-1 ring-blue-400' :
                holiday ? 'bg-red-50 dark:bg-red-900/20' :
                workday ? 'bg-orange-50 dark:bg-orange-900/20' :
                'bg-gray-100 dark:bg-gray-800'
              } hover:bg-gray-200 dark:hover:bg-gray-700`}>
              <div className="flex items-center gap-0.5 sm:gap-1 mb-0.5 sm:mb-1 flex-wrap">
                <span className={`text-xs sm:text-sm ${isToday ? 'font-bold text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`}>{day}</span>
                {isToday && <span className="text-[9px] sm:text-[10px] bg-blue-500 text-white px-0.5 sm:px-1 rounded">今</span>}
                {holiday && <span className="text-[9px] sm:text-[10px] bg-red-500 text-white px-0.5 sm:px-1 rounded truncate max-w-full">{getHolidayName(dateStr)}</span>}
                {workday && <span className="text-[9px] sm:text-[10px] bg-orange-500 text-white px-0.5 sm:px-1 rounded">
                  <span className="sm:hidden">班</span><span className="hidden sm:inline">调休上班</span>
                </span>}
              </div>
              {daySchedules.map(s => {
                const tooMany = daySchedules.length > 3;
                return (
                  <div key={s.id}
                    className={`${tooMany ? 'text-[9px] sm:text-[10px] py-0.5 px-0.5 sm:px-1' : 'text-[10px] sm:text-xs px-0.5 sm:p-1 py-0.5'} rounded mb-0.5 truncate`}
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
