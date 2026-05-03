export default function TimeColumn({ HEADER_HEIGHT, displayHours, rowHeight, topGapHeight }) {
  return (
    <div className="flex flex-col border-r border-gray-200 dark:border-gray-700">
      <div style={{ height: HEADER_HEIGHT, flexShrink: 0 }}
        className="flex items-center justify-center border-b-2 border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-sm font-medium text-gray-600 dark:text-gray-300">
        时间
      </div>
      <div className="flex-1 overflow-hidden relative bg-white dark:bg-gray-900">
        <div style={{ height: topGapHeight }} className="border-b border-gray-200 dark:border-gray-800" />
        {displayHours.map(hour => (
          <div key={hour} className="relative" style={{ height: rowHeight }}>
            <div className="absolute top-0 left-0 right-0 border-b border-gray-200 dark:border-gray-800" />
            <span className="absolute text-[11px] text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-900 px-1"
              style={{ top: '-7px', left: '50%', transform: 'translateX(-50%)' }}>
              {String(hour).padStart(2, '0')}:00
            </span>
          </div>
        ))}
        <div className="absolute bottom-0 left-0 right-0 border-b border-gray-200 dark:border-gray-800" />
      </div>
    </div>
  );
}
