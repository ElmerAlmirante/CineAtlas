const STORAGE_KEY = 'cineatlas_favoritos_v2';
const OLD_STORAGE_KEY = 'cineatlas_favoritos_v1';
const PAGE_INCREMENT = 16;
const MAX_REQUESTS_PER_BATCH = 5;
const BATCH_DEADLINE_MS = 19000;

const app = Vue.createApp({
  data() {
    return {
      items: [],
      visibleCount: PAGE_INCREMENT,
      favorites: [],
      view: 'explore',
      searchQuery: '',
      selectedGenre: '',
      yearFilter: 'all',
      ratingFilter: 0,
      sortBy: 'featured',
      loading: true,
      loadingMore: false,
      hasMore: true,
      error: '',
      detailError: '',
      detailsLoading: false,
      activeFilm: null,
      announcement: '',
      plan: null,
      cursor: CinemaCatalog.initialCursor(),
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
    pendingSearch() {
      return this.view === 'explore' && this.searchQuery.trim().length === 1;
    },
    localFilterActive() {
      return this.yearFilter !== 'all' || this.ratingFilter > 0 || Boolean(this.selectedGenre);
    },
    filteredFilms() {
      return this.filterMovies(this.view === 'favorites' ? this.favorites : this.items);
    },
    visibleFilms() {
      return this.view === 'favorites' ? this.filteredFilms : this.filteredFilms.slice(0, this.visibleCount);
    },
    canLoadMore() {
      return this.view === 'explore' && (this.filteredFilms.length > this.visibleCount || this.hasMore);
    },
    resultsLabel() {
      if (this.view === 'favorites') return 'A minha lista';
      if (this.searchQuery.trim().length >= 2) return 'Resultados da pesquisa';
      if (this.selectedGenre) return 'Filmes por genero';
      return 'Filmes em destaque';
    },
    partialNotice() {
      if (this.view !== 'explore' || this.loading || this.pendingSearch || !this.hasMore) return '';
      if (this.sortBy === 'name' || this.sortBy === 'rating' || this.sortBy === 'newest' || this.sortBy === 'oldest') return 'A ordenacao considera os filmes ja carregados. Continua a pesquisa para ver mais titulos.';
      if (this.searchQuery.trim().length >= 2 && (this.yearFilter !== 'all' || this.ratingFilter)) {
        return 'O ano e a avaliacao sao filtrados dentro dos resultados da pesquisa. Podes procurar nas paginas seguintes.';
      }
      if (this.localFilterActive) return 'A mostrar os resultados encontrados ate agora. Podes continuar a pesquisa para encontrar mais filmes.';
      return 'A mostrar parte do catalogo. Carrega mais para ver outros filmes.';
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
    sortBy() {
      this.scheduleFetch();
    },
    activeFilm(film, previous) {
      document.body.classList.toggle('modal-open', Boolean(film));
      if (film && !previous) this.$nextTick(() => this.$refs.movieDialog?.focus());
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
    safeImage(url) {
      return typeof url === 'string' && /^https:\/\/[^\s]+$/i.test(url) ? url : '';
    },
    normalizeMovie(movie) {
      if (!movie || !/^tt\d+$/.test(String(movie.id || '')) || typeof movie.name !== 'string' || !movie.name.trim()) return null;
      return {
        id: movie.id,
        name: movie.name.trim(),
        poster: this.safeImage(movie.poster),
        releaseInfo: String(movie.releaseInfo || movie.year || ''),
        imdbRating: movie.imdbRating || '',
        genres: Array.isArray(movie.genres) ? movie.genres.filter(item => typeof item === 'string').slice(0, 10) : [],
        description: typeof movie.description === 'string' ? movie.description : '',
        runtime: typeof movie.runtime === 'string' ? movie.runtime : '',
        director: Array.isArray(movie.director) || typeof movie.director === 'string' ? movie.director : '',
        cast: Array.isArray(movie.cast) ? movie.cast.filter(item => typeof item === 'string').slice(0, 12) : []
      };
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
      const found = this.genres.find(item => item.value.toLowerCase() === genre.toLowerCase());
      return found ? found.label : genre || 'Cinema';
    },
    filterMovies(source) {
      let movies = [...source];
      const query = this.searchQuery.trim().toLocaleLowerCase();
      if (this.view === 'favorites' && query) {
        movies = movies.filter(movie => movie.name.toLocaleLowerCase().includes(query));
      }
      if (this.selectedGenre) {
        movies = movies.filter(movie => movie.genres.some(genre => genre.toLowerCase() === this.selectedGenre.toLowerCase()));
      }
      if (this.yearFilter !== 'all') {
        movies = movies.filter(movie => {
          const year = this.movieYear(movie);
          if (!year) return false;
          if (this.yearFilter === 'classic') return year >= 1920 && year <= 1989;
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
      this.visibleCount = PAGE_INCREMENT;
      this.error = '';
      this.cursor = CinemaCatalog.initialCursor();
      this.hasMore = true;
      this.loadingMore = false;
      if (this.pendingSearch) {
        this.hasMore = false;
        this.loading = false;
        return;
      }
      this.loading = true;
      this.searchTimer = setTimeout(() => this.fetchMovies(), 320);
    },
    async fetchMovies(more = false) {
      if (this.view !== 'explore' || this.pendingSearch) return;
      if (more && (this.loading || this.loadingMore || !this.hasMore)) return;

      clearTimeout(this.searchTimer);
      const request = ++this.requestId;
      this.controller?.abort();
      const controller = new AbortController();
      this.controller = controller;
      const deadline = Date.now() + BATCH_DEADLINE_MS;

      if (more) {
        this.loadingMore = true;
        if (!this.items.length) this.loading = true;
      } else {
        this.loading = true;
        this.visibleCount = PAGE_INCREMENT;
        this.items = [];
        this.cursor = CinemaCatalog.initialCursor();
        this.plan = CinemaCatalog.createPlan({
          search: this.searchQuery,
          genre: this.selectedGenre,
          year: this.yearFilter,
          rating: this.ratingFilter,
          sort: this.sortBy
        });
        this.hasMore = true;
      }
      this.error = '';

      try {
        const known = new Set(this.items.map(movie => movie.id));
        let scanned = 0;
        const scanLimit = this.localFilterActive ? MAX_REQUESTS_PER_BATCH : 1;

        while (this.hasMore && scanned < scanLimit) {
          const url = CinemaCatalog.requestUrl(this.plan, this.cursor);
          if (!url) {
            this.hasMore = false;
            break;
          }

          const payload = await CinemaCatalog.read(url, controller.signal, { deadline });
          if (request !== this.requestId) return;

          const fresh = [];
          for (const source of payload.metas) {
            const movie = this.normalizeMovie(source);
            if (!movie || known.has(movie.id)) continue;
            known.add(movie.id);
            fresh.push(movie);
          }

          this.items.push(...fresh);
          const count = payload.metas.length;
          this.cursor = CinemaCatalog.nextCursor(this.plan, this.cursor, count);
          this.hasMore = CinemaCatalog.moreAvailable(this.plan, this.cursor, count);
          scanned++;

          if (this.filterMovies(this.items).length >= this.visibleCount) break;
        }
      } catch (error) {
        if (request !== this.requestId) return;
        if (error.code === 'CANCELLED') return;
        if (error.code === 'TIMEOUT') {
          this.error = 'A consulta demorou demasiado tempo. Podes continuar a partir da ultima pagina.';
        } else if (error.code === 'RATE_LIMIT') {
          this.error = 'O servico esta temporariamente ocupado. Tenta novamente.';
        } else if (error.code === 'INVALID') {
          this.error = 'O servico devolveu dados inesperados. Tenta novamente.';
        } else {
          this.error = 'Nao foi possivel consultar os filmes. Verifica a ligacao e tenta novamente.';
        }
      } finally {
        if (request === this.requestId) {
          this.loading = false;
          this.loadingMore = false;
        }
      }
    },
    loadMore() {
      if (this.loading || this.loadingMore || !this.canLoadMore) return;
      this.visibleCount += PAGE_INCREMENT;
      if (this.filteredFilms.length < this.visibleCount && this.hasMore) this.fetchMovies(true);
    },
    retryCatalog() {
      if (this.plan && this.hasMore) this.fetchMovies(true);
      else this.fetchMovies();
    },
    resetFilters() {
      if (this.view === 'favorites' && !this.favorites.length) {
        this.showExplore();
        return;
      }
      const alreadyClear = !this.searchQuery && !this.selectedGenre && this.yearFilter === 'all' && !this.ratingFilter && this.sortBy === 'featured';
      this.searchQuery = '';
      this.selectedGenre = '';
      this.yearFilter = 'all';
      this.ratingFilter = 0;
      this.sortBy = 'featured';
      if (alreadyClear && this.view === 'explore') this.fetchMovies();
    },
    showFavorites() {
      this.cancelCatalog();
      this.suspendFetch = true;
      this.view = 'favorites';
      this.loading = false;
      this.loadingMore = false;
      this.error = '';
      this.searchQuery = '';
      this.selectedGenre = '';
      this.yearFilter = 'all';
      this.ratingFilter = 0;
      this.sortBy = 'featured';
      this.$nextTick(() => { this.suspendFetch = false; });
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
      this.detailError = '';
      this.detailsLoading = true;
      const controller = new AbortController();
      this.detailController = controller;
      try {
        const payload = await CinemaCatalog.read('https://v3-cinemeta.strem.io/meta/movie/' + encodeURIComponent(movie.id) + '.json', controller.signal, { kind: 'details', deadline: Date.now() + 14000 });
        if (request !== this.detailRequestId) return;
        const extra = this.normalizeMovie({ ...movie, ...(payload.meta || {}) });
        if (!extra) throw new Error('Detalhe invalido');
        if (this.activeFilm?.id === movie.id) this.activeFilm = extra;
      } catch (error) {
        if (request === this.detailRequestId && error.code !== 'CANCELLED') {
          this.detailError = 'Nao foi possivel consultar todos os detalhes. Estao apresentados os dados disponiveis.';
        }
      } finally {
        if (request === this.detailRequestId) this.detailsLoading = false;
      }
    },
    closeMovie() {
      this.cancelDetails();
      this.activeFilm = null;
      this.detailError = '';
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
      const candidates = this.visibleFilms;
      if (candidates.length) this.openMovie(candidates[Math.floor(Math.random() * candidates.length)]);
      else {
        this.announcement = 'Nao existem filmes nesta selecao.';
        this.scrollToCatalog();
      }
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
