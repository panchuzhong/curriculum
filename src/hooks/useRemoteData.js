import { useCallback, useEffect, useRef, useState } from 'react';

export default function useRemoteData(load) {
  const latest = useRef(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    const request = ++latest.current;
    setLoading(true);
    setError('');
    try {
      const result = await load();
      if (request === latest.current) setData(result);
    } catch (e) {
      if (request === latest.current) setError(e.message || '请求失败');
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    reload();
    return () => { ++latest.current; };
  }, [reload]);

  return { data, loading, error, reload };
}
