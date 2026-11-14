const API_BASE = 'https://v3-cinemeta.strem.io';
const PAGE_SIZE = 100;
const STORAGE_KEY = 'cineatlas_favoritos_v2';
const OLD_STORAGE_KEY = 'cineatlas_favoritos_v1';
const MIN_VISIBLE = 12;
const MAX_PAGES_PER_LOAD = 3;

const app = Vue.createApp({
  data() {
    return {
      items: [],
      favorites: [],
      view: 'explore',
      searchQuery: '',
      selectedGenre: '',
      yearFilter: 'all',
      ratingFilter: 0,
      sortBy: 'featured',
      page: -1,
      hasMore: true,
      loading: true,
      loadingMore: false,
      detailsLoading: false,
      error: '',
      activeFilm: null,
      announcement: '',
      requestId: 0,
      detailRequestId: 0,
      controller: null,
      detailController: null,
      searchTimer: null,
      previousFocus: null,
      suspendFetch: false,
      genres: [
        { value: '', label: 'Todos' },
        { value: 'Action', label: 'Acao' },
        { value: 'Adventure', label: 'Aventura' },
        { value: 'Animation', label: 'Animacao' },
        { value: 'Comedy', label: 'Comedia' },
        { value: 'Drama', label: 'Drama' },
        { value: 'Fantasy', label: 'Fantasia' },
        { value: 'Sci-Fi', label: 'Ficcao cientifica' },
        { value: 'Romance', label: 'Romance' },
        { value: 'Thriller', label: 'Suspense' },
        { value: 'Horror', label: 'Terror' }
      ]
    };
  },
  computed: {
    featuredFilm() {
      return this.items.find(movie => this.safeImage(movie.poster)) || null;
    },
    localFilterActive() {
      return this.yearFilter !== 'all' || this.ratingFilter > 0 || (this.selectedGenre && this.searchQuery.trim().length >= 2);
    },
    visibleFilms() {
      return this.filteredMovies(this.view === 'favorites' ? this.favorites : this.items);
    },
    resultsLabel() {
      if (this.view === 'favorites') return 'A minha lista';
      if (this.searchQuery.trim()) return 'Resultados da pesquisa';
      if (this.selectedGenre) return 'Filmes por genero';
      return 'Filmes em destaque';
    }
  },
  watch: {
    searchQuery() {
      this.scheduleFetch();
    },
    selectedGenre() {
      this.scheduleFetch();
    },
    yearFilter() {
      this.scheduleFetch();
    },
    ratingFilter() {
      this.scheduleFetch();
    },
    activeFilm(film) {
      document.body.classList.toggle('modal-open', Boolean(film));
      if (film) this.$nextTick(() => this.$refs.movieDialog?.focus());
    }
  },
  mounted() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(OLD_STORAGE_KEY) || '[]');
      if (Array.isArray(saved)) {
        const seen = new Set();
        this.favorites = saved.map(movie => this.normalizeMovie(movie)).filter(movie => {
          if (!movie || seen.has(movie.id)) return false;
          seen.add(movie.id);
          return true;
        });
      }
    } catch {
      this.favorites = [];
    }
    this.fetchMovies();
    window.addEventListener('keydown', this.handleKeydown);
  },
  beforeUnmount() {
    this.cancelCatalog();
    this.cancelDetails();
    document.body.classList.remove('modal-open');
    window.removeEventListener('keydown', this.handleKeydown);
  },
  methods: {
    normalizeMovie(movie) {
      if (!movie || !/^tt\d+$/.test(String(movie.id || '')) || typeof movie.name !== 'string' || !movie.name.trim()) return null;
      return {
        id: movie.id,
        name: movie.name.trim(),
        type: 'movie',
        poster: this.safeImage(movie.poster),
        releaseInfo: String(movie.releaseInfo || movie.year || ''),
        imdbRating: movie.imdbRating || '',
        genres: Array.isArray(movie.genres) ? movie.genres.filter(value => typeof value === 'string').slice(0, 10) : [],
        description: typeof movie.description === 'string' ? movie.description : '',
        runtime: typeof movie.runtime === 'string' ? movie.runtime : '',
        director: Array.isArray(movie.director) || typeof movie.director === 'string' ? movie.director : '',
        cast: Array.isArray(movie.cast) ? movie.cast.filter(value => typeof value === 'string').slice(0, 12) : []
      };
    },
    safeImage(url) {
      return typeof url === 'string' && /^https:\/\/[^\s]+$/i.test(url) ? url : '';
    },
    movieYear(movie) {
      const match = String(movie.releaseInfo || '').match(/(?:18|19|20)\d{2}/);
      return match ? Number(match[0]) : 0;
    },
    movieRating(movie) {
      const value = Number.parseFloat(String(movie.imdbRating || '').replace(',', '.'));
      return Number.isFinite(value) && value >= 0 && value <= 10 ? value : 0;
    },
    genreLabel(movie) {
      const genre = (movie.genres || [])[0] || '';
      const match = this.genres.find(item => item.value.toLowerCase() === genre.toLowerCase());
      return match ? match.label : genre || 'Cinema';
    },
    filteredMovies(source) {
      let movies = [...source];
      const query = this.searchQuery.trim().toLocaleLowerCase();
      if (query && (this.view === 'favorites' || query.length < 2)) {
        movies = movies.filter(movie => movie.name.toLocaleLowerCase().includes(query));
      }
      if (this.selectedGenre && (this.view === 'favorites' || query.length >= 2)) {
        movies = movies.filter(movie => movie.genres.some(genre => genre.toLowerCase() === this.selectedGenre.toLowerCase()));
      }
      if (this.yearFilter !== 'all') {
        movies = movies.filter(movie => {
          const year = this.movieYear(movie);
          if (!year) return false;
          if (this.yearFilter === 'classic') return year < 1990;
          const start = Number(this.yearFilter);
          return year >= start && (start === 2020 || year < start + 10);
        });
      }
      if (this.ratingFilter) movies = movies.filter(movie => this.movieRating(movie) >= this.ratingFilter);
      if (this.sortBy === 'rating') movies.sort((a, b) => this.movieRating(b) - this.movieRating(a));
      if (this.sortBy === 'newest') movies.sort((a, b) => this.movieYear(b) - this.movieYear(a));
      if (this.sortBy === 'oldest') movies.sort((a, b) => (this.movieYear(a) || 9999) - (this.movieYear(b) || 9999));
      if (this.sortBy === 'name') movies.sort((a, b) => a.name.localeCompare(b.name));
      return movies;
    },
    cancelCatalog() {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
      this.requestId++;
      this.controller?.abort();
      this.controller = null;
    },
    scheduleFetch() {
      if (this.view !== 'explore' || this.suspendFetch) return;
      this.cancelCatalog();
      this.items = [];
      this.error = '';
      this.hasMore = true;
      this.page = -1;
      this.loading = true;
      this.loadingMore = false;
      this.searchTimer = setTimeout(() => this.fetchMovies(false), 320);
    },
    catalogUrl(page) {
      const query = this.searchQuery.trim();
      const extra = query.length >= 2 ? 'search=' + encodeURIComponent(query) : this.selectedGenre ? 'genre=' + encodeURIComponent(this.selectedGenre) : '';
      const parts = [];
      if (extra) parts.push(extra);
      if (page) parts.push('skip=' + page * PAGE_SIZE);
      return API_BASE + '/catalog/movie/top' + (parts.length ? '/' + parts.join('&') : '') + '.json';
    },
    async fetchMovies(more = false) {
      if (this.view !== 'explore' || (more && (this.loading || this.loadingMore || !this.hasMore))) return;
      clearTimeout(this.searchTimer);
      const request = ++this.requestId;
      this.controller?.abort();
      this.controller = new AbortController();
      const controller = this.controller;
      let timeout = setTimeout(() => controller.abort(), 16000);
      if (more) this.loadingMore = true;
      else {
        this.loading = true;
        this.items = [];
        this.page = -1;
        this.hasMore = true;
      }
      this.error = '';
      try {
        const known = new Set(this.items.map(movie => movie.id));
        let scanned = 0;
        do {
          const nextPage = this.page + 1;
          const response = await fetch(this.catalogUrl(nextPage), { signal: controller.signal });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const payload = await response.json();
          if (!payload || !Array.isArray(payload.metas)) throw new Error('Resposta invalida');
          if (request !== this.requestId) return;
          const fresh = [];
          for (const source of payload.metas) {
            const movie = this.normalizeMovie(source);
            if (!movie || known.has(movie.id)) continue;
            known.add(movie.id);
            fresh.push(movie);
          }
          this.items.push(...fresh);
          this.page = nextPage;
          this.hasMore = payload.metas.length >= PAGE_SIZE && fresh.length > 0;
          scanned++;
        } while (this.hasMore && this.localFilterActive && this.filteredMovies(this.items).length < MIN_VISIBLE && scanned < MAX_PAGES_PER_LOAD);
      } catch (error) {
        if (request !== this.requestId) return;
        if (error.name === 'AbortError' && controller.signal.aborted) {
          this.error = 'A consulta demorou demasiado tempo. Tenta novamente.';
        } else {
          this.error = String(error.message).includes('429')
            ? 'O servico esta temporariamente ocupado. Tenta novamente.'
            : 'Nao foi possivel consultar os filmes. Verifica a ligacao e tenta novamente.';
        }
      } finally {
        clearTimeout(timeout);
        if (request === this.requestId) {
          this.loading = false;
          this.loadingMore = false;
        }
      }
    },
    selectGenre(value) {
      this.selectedGenre = value;
    },
    resetFilters() {
      if (this.view === 'favorites' && !this.favorites.length) {
        this.showExplore();
        return;
      }
      this.searchQuery = '';
      this.selectedGenre = '';
      this.yearFilter = 'all';
      this.ratingFilter = 0;
      this.sortBy = 'featured';
    },
    showFavorites() {
      this.cancelCatalog();
      this.view = 'favorites';
      this.loading = false;
      this.loadingMore = false;
      this.error = '';
      this.searchQuery = '';
      this.selectedGenre = '';
      this.yearFilter = 'all';
      this.ratingFilter = 0;
      this.sortBy = 'featured';
      this.scrollToCatalog();
    },
    showExplore() {
      const fromFavorites = this.view === 'favorites';
      if (fromFavorites) this.suspendFetch = true;
      this.searchQuery = '';
      this.selectedGenre = '';
      this.yearFilter = 'all';
      this.ratingFilter = 0;
      this.sortBy = 'featured';
      this.view = 'explore';
      if (fromFavorites) {
        this.$nextTick(() => {
          this.suspendFetch = false;
          this.fetchMovies();
          this.scrollToCatalog();
        });
      } else {
        this.scrollToCatalog();
      }
    },
    goHome() {
      this.showExplore();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    scrollToCatalog() {
      this.$nextTick(() => document.getElementById('catalogo')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    },
    isFavorite(id) {
      return this.favorites.some(movie => movie.id === id);
    },
    toggleFavorite(movie) {
      if (this.isFavorite(movie.id)) {
        this.favorites = this.favorites.filter(item => item.id !== movie.id);
        this.announcement = movie.name + ' removido da tua lista.';
      } else {
        const clean = this.normalizeMovie(movie);
        if (!clean) return;
        this.favorites.unshift(clean);
        this.announcement = movie.name + ' guardado na tua lista.';
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.favorites));
      } catch {
        this.announcement = 'Nao foi possivel guardar a lista neste navegador.';
      }
    },
    cancelDetails() {
      this.detailRequestId++;
      this.detailController?.abort();
      this.detailController = null;
    },
    async openMovie(movie) {
      this.cancelDetails();
      const request = this.detailRequestId;
      this.previousFocus = document.activeElement;
      this.activeFilm = { ...movie };
      this.detailsLoading = true;
      const controller = new AbortController();
      this.detailController = controller;
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(API_BASE + '/meta/movie/' + encodeURIComponent(movie.id) + '.json', { signal: controller.signal });
        if (!response.ok) throw new Error('Detalhe indisponivel');
        const payload = await response.json();
        if (request === this.detailRequestId && payload.meta && this.activeFilm?.id === movie.id) {
          this.activeFilm = { ...movie, ...this.normalizeMovie({ ...movie, ...payload.meta }) };
        }
      } catch {
        if (request === this.detailRequestId) this.announcement = 'A mostrar os dados disponiveis para este filme.';
      } finally {
        clearTimeout(timeout);
        if (request === this.detailRequestId) this.detailsLoading = false;
      }
    },
    closeMovie() {
      this.cancelDetails();
      this.activeFilm = null;
      this.detailsLoading = false;
      this.$nextTick(() => this.previousFocus?.focus?.());
    },
    formatPeople(value) {
      return Array.isArray(value) ? value.join(', ') : String(value || '');
    },
    imdbLink(movie) {
      return /^tt\d+$/.test(movie.id || '') ? 'https://www.imdb.com/title/' + movie.id + '/' : '';
    },
    surpriseMe() {
      const candidates = this.visibleFilms.length ? this.visibleFilms : this.items;
      if (candidates.length) this.openMovie(candidates[Math.floor(Math.random() * candidates.length)]);
      else this.scrollToCatalog();
    },
    hideImage(event) {
      event.target.style.display = 'none';
    },
    handleKeydown(event) {
      if (this.activeFilm && event.key === 'Escape') {
        event.preventDefault();
        this.closeMovie();
        return;
      }
      if (this.activeFilm && event.key === 'Tab' && this.$refs.movieDialog) {
        const controls = [...this.$refs.movieDialog.querySelectorAll('button:not([disabled]), a[href]')];
        if (!controls.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === this.$refs.movieDialog)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !this.$refs.movieDialog.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
      if (event.key === '/' && !this.activeFilm && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        event.preventDefault();
        document.getElementById('movie-search')?.focus();
      }
    }
  }
});

app.mount('#app');
