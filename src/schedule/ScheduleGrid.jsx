import { getClassColor } from '../utils/colors';

const HOURS = Array.from({ length: 15 }, (_, i) => i + 8); // 8:00-22:00

function getWeekDates(weekStart) {
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });
}

export default function ScheduleGrid({ schedules, weekStart, onScheduleClick }) {
  const dates = getWeekDates(weekStart);

  // Group schedules by date
  const byDate = {};
  dates.forEach(d => byDate[d] = []);
  schedules.forEach(s => {
    if (byDate[s.date]) byDate[s.date].push(s);
  });

  // Detect conflicts
  function getConflicts(dateSchedules) {
    const conflicts = new Set();
    for (let i = 0; i < dateSchedules.length; i++) {
      for (let j = i + 1; j < dateSchedules.length; j++) {
        const a = dateSchedules[i], b = dateSchedules[j];
        if (a.startTime < b.endTime && b.startTime < a.endTime) {
          conflicts.add(a.id);
          conflicts.add(b.id);
        }
      }
    }
    return conflicts;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="w-16 p-2 bg-gray-800 border border-gray-700">时间</th>
            {dates.map((d, i) => (
              <th key={d} className="p-2 bg-gray-800 border border-gray-700">
                {['周一','周二','周三','周四','周五'][i]}<br/>
                <span className="text-sm text-gray-400">{d.slice(5)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HOURS.map(hour => (
            <tr key={hour}>
              <td className="p-1 border border-gray-700 text-center text-sm text-gray-400">
                {String(hour).padStart(2, '0')}:00
              </td>
              {dates.map(date => {
                const daySchedules = (byDate[date] || []).filter(s => {
                  const sh = parseInt(s.startTime.split(':')[0]);
                  const eh = parseInt(s.endTime.split(':')[0]) + (parseInt(s.endTime.split(':')[1]) > 0 ? 1 : 0);
                  return sh <= hour && eh > hour;
                });
                const conflicts = getConflicts(byDate[date] || []);
                const isStartSlot = daySchedules.some(s => parseInt(s.startTime.split(':')[0]) === hour);

                return (
                  <td key={date} className="border border-gray-700 p-1 align-top min-w-[150px]">
                    {isStartSlot && daySchedules.map(s => (
                      <div
                        key={s.id}
                        onClick={() => onScheduleClick?.(s)}
                        className={`p-2 rounded text-sm cursor-pointer mb-1 ${
                          conflicts.has(s.id) ? 'border-2 border-red-500' : ''
                        }`}
                        style={{ backgroundColor: getClassColor(s.class) }}
                      >
                        <div className="font-bold">
                          {s.class?.isCompetition && '★ '}{s.class?.name}
                        </div>
                        <div className="opacity-70 text-xs">{s.startTime}-{s.endTime}</div>
                      </div>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
