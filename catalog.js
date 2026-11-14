const CinemaCatalog = (() => {
  const BASE_URL = 'https://v3-cinemeta.strem.io';
  const PAGE_SIZE = 100;
  const FIRST_YEAR = 1920;

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
    for (let year = start; year <= Math.min(end, last); year++) {
      years.push(year);
    }
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
    } else if (year !== 'all' || sort === 'newest' || sort === 'oldest') {
      mode = 'year';
    } else if (rating > 0 || sort === 'rating') {
      mode = 'imdbRating';
    }

    return { mode, search, genre, year, rating, sort, years: mode === 'year' ? yearsFor(year, sort) : [] };
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
      if (plan.search.length >= 2) fields.push('search=' + encodeURIComponent(plan.search));
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

  return { createPlan, initialCursor, requestUrl, nextCursor, moreAvailable };
})();
