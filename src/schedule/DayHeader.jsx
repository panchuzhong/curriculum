import { isHoliday, isWorkday, getHolidayName } from '../utils/holidays';
import { parseDateStr } from '../utils/date';

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export default function DayHeader({ date, isToday, HEADER_HEIGHT }) {
  const holiday = isHoliday(date);
  const workday = isWorkday(date);
  const dayLabel = WEEKDAY_LABELS[parseDateStr(date).getDay()];

  return (
    <div style={{ height: HEADER_HEIGHT, flexShrink: 0 }}
      className={`flex flex-col items-center justify-center border-r border-b-2 border-gray-300 dark:border-gray-600 ${
        isToday ? 'bg-blue-50 dark:bg-blue-900/40' :
        workday ? 'bg-orange-50 dark:bg-orange-900/20' :
        holiday ? 'bg-red-50 dark:bg-red-900/20' :
        'bg-gray-50 dark:bg-gray-800'
      }`}>
      <div className="flex items-center gap-1">
        <span className={`font-medium text-sm ${isToday ? 'text-blue-700 dark:text-blue-300' : ''}`}>{dayLabel}</span>
        {isToday && <span className="text-[10px] bg-blue-500 text-white px-1.5 py-0.5 rounded-full font-medium">今天</span>}
        {holiday && <span className="text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded-full">{getHolidayName(date)}</span>}
        {workday && <span className="text-[10px] bg-orange-500 text-white px-1.5 py-0.5 rounded-full">调休</span>}
      </div>
      <span className="text-xs text-gray-400 dark:text-gray-500">{date.slice(5)}</span>
    </div>
  );
}
