const CinemaCatalog = (() => {
  const BASE_URL = 'https://v3-cinemeta.strem.io';
  const PAGE_SIZE = 100;
  const FIRST_YEAR = 1920;
  const MAX_CACHE_ENTRIES = 100;
  const cache = new Map();

  function yearsFor(filter, order) {
    const last = new Date().getFullYear();
    let start = FIRST_YEAR;
    let end = last;

    if (filter === 'classic') {
      end = 1989;
    } else if (filter !== 'all') {
      start = Number(filter);
      end = start === 2020 ? last : start + 9;
    }

    const years = [];
    for (let year = start; year <= Math.min(end, last); year++) years.push(year);
    if (order !== 'oldest') years.reverse();
    return years;
  }

  function createPlan(filters) {
    const search = filters.search.trim();
    const genre = filters.genre;
    const year = filters.year;
    const rating = Number(filters.rating) || 0;
    const sort = filters.sort;

    let mode = 'top';
    if (search.length >= 2) {
      mode = 'top';
    } else if (sort === 'newest' || sort === 'oldest') {
      mode = 'year';
    } else if (sort === 'rating' || rating >= 8) {
      mode = 'imdbRating';
    } else if (year !== 'all') {
      mode = 'year';
    } else if (rating > 0) {
      mode = 'imdbRating';
    }

    return {
      mode,
      search,
      genre,
      year,
      rating,
      sort,
      years: mode === 'year' ? yearsFor(year, sort) : []
    };
  }

  function initialCursor() {
    return { page: 0, yearIndex: 0 };
  }

  function requestUrl(plan, cursor) {
    if (plan.mode === 'year' && cursor.yearIndex >= plan.years.length) return '';

    const fields = [];
    if (plan.mode === 'year') {
      fields.push('genre=' + plan.years[cursor.yearIndex]);
    } else {
      if (plan.mode === 'top' && plan.search.length >= 2) {
        fields.push('search=' + encodeURIComponent(plan.search));
      }
      if (plan.genre) fields.push('genre=' + encodeURIComponent(plan.genre));
    }
    if (cursor.page) fields.push('skip=' + cursor.page * PAGE_SIZE);
    return BASE_URL + '/catalog/movie/' + plan.mode + (fields.length ? '/' + fields.join('&') : '') + '.json';
  }

  function nextCursor(plan, cursor, count) {
    if (plan.mode === 'year' && count < PAGE_SIZE) {
      return { page: 0, yearIndex: cursor.yearIndex + 1 };
    }
    return { page: cursor.page + 1, yearIndex: cursor.yearIndex };
  }

  function moreAvailable(plan, cursor, count) {
    if (plan.mode === 'year') return cursor.yearIndex < plan.years.length;
    return count >= PAGE_SIZE;
  }

  function pause(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(Object.assign(new Error('Cancelado'), { code: 'CANCELLED' }));
        return;
      }
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
        resolve();
      };
      const stop = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
        reject(Object.assign(new Error('Cancelado'), { code: 'CANCELLED' }));
      };
      const timer = setTimeout(done, ms);
      signal?.addEventListener('abort', stop, { once: true });
    });
  }

  function cached(url) {
    const saved = cache.get(url);
    if (!saved) return null;
    if (saved.expires <= Date.now()) {
      cache.delete(url);
      return null;
    }
    cache.delete(url);
    cache.set(url, saved);
    return saved.data;
  }

  function remember(url, data, kind) {
    cache.delete(url);
    cache.set(url, {
      data,
      expires: Date.now() + (kind === 'details' ? 30 : 10) * 60 * 1000
    });
    if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  }

  async function read(url, signal, options = {}) {
    const kind = options.kind === 'details' ? 'details' : 'catalog';
    if (signal?.aborted) throw Object.assign(new Error('Cancelado'), { code: 'CANCELLED' });
    const previous = cached(url);
    if (previous) return previous;

    const deadline = Number.isFinite(options.deadline) ? options.deadline : Date.now() + 15000;
    let attempt = 0;

    while (attempt < 2) {
      if (signal?.aborted) throw Object.assign(new Error('Cancelado'), { code: 'CANCELLED' });
      const remaining = deadline - Date.now();
      if (remaining < 250) throw Object.assign(new Error('Tempo esgotado'), { code: 'TIMEOUT' });
      const controller = new AbortController();
      let expired = false;
      const stop = () => controller.abort();
      const timer = setTimeout(() => { expired = true; controller.abort(); }, Math.min(6500, remaining));
      signal?.addEventListener('abort', stop, { once: true });

      try {
        const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
        if (!response.ok) {
          const failure = Object.assign(new Error('HTTP ' + response.status), {
            code: response.status === 429 ? 'RATE_LIMIT' : 'HTTP',
            retryable: response.status === 408 || response.status === 429 || response.status >= 500
          });
          throw failure;
        }
        const payload = await response.json();
        const valid = payload && (kind === 'catalog'
          ? Array.isArray(payload.metas)
          : payload.meta && typeof payload.meta === 'object' && !Array.isArray(payload.meta));
        if (!valid) throw Object.assign(new Error('Resposta invalida'), { code: 'INVALID' });
        remember(url, payload, kind);
        return payload;
      } catch (error) {
        if (signal?.aborted) throw Object.assign(new Error('Cancelado'), { code: 'CANCELLED' });
        const failure = expired
          ? Object.assign(new Error('Tempo esgotado'), { code: 'TIMEOUT', retryable: true })
          : error;
        const retryable = failure.retryable || failure.name === 'TypeError';
        if (!retryable || attempt === 1 || deadline - Date.now() <= 900) throw failure;
        attempt++;
        await pause(Math.min(450 * attempt, Math.max(50, deadline - Date.now() - 250)), signal);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
      }
    }
  }

  return { createPlan, initialCursor, requestUrl, nextCursor, moreAvailable, read, clearCache: () => cache.clear() };
})();
