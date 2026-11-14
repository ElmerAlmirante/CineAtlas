const API_BASE = 'https://v3-cinemeta.strem.io';
const PAGE_SIZE = 100;
const STORAGE_KEY = 'cineatlas_favoritos_v1';

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
      page: 0,
      hasMore: false,
      loading: true,
      loadingMore: false,
      detailsLoading: false,
      error: '',
      activeFilm: null,
      announcement: '',
      requestId: 0,
      controller: null,
      searchTimer: null,
      previousFocus: null,
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
      return this.items.find(movie => movie.poster && movie.imdbRating) || this.items.find(movie => movie.poster) || null;
    },
    yearFilterActive() {
      return this.yearFilter !== 'all';
    },
    visibleFilms() {
      let movies = this.view === 'favorites' ? [...this.favorites] : [...this.items];
      const query = this.searchQuery.toLocaleLowerCase().trim();

      if (query && (this.view === 'favorites' || query.length < 2)) {
        movies = movies.filter(movie => movie.name.toLocaleLowerCase().includes(query));
      }
      if (this.selectedGenre && (this.view === 'favorites' || query)) {
        movies = movies.filter(movie => (movie.genres || []).some(genre => genre.toLowerCase() === this.selectedGenre.toLowerCase()));
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
      if (this.ratingFilter) {
        movies = movies.filter(movie => this.movieRating(movie) >= this.ratingFilter);
      }
      if (this.sortBy === 'rating') {
        movies.sort((a, b) => this.movieRating(b) - this.movieRating(a));
      } else if (this.sortBy === 'newest') {
        movies.sort((a, b) => this.movieYear(b) - this.movieYear(a));
      } else if (this.sortBy === 'oldest') {
        movies.sort((a, b) => (this.movieYear(a) || 9999) - (this.movieYear(b) || 9999));
      } else if (this.sortBy === 'name') {
        movies.sort((a, b) => a.name.localeCompare(b.name));
      }
      return movies;
    }
  },
  watch: {
    searchQuery() {
      clearTimeout(this.searchTimer);
      if (this.view === 'explore') {
        this.searchTimer = setTimeout(() => this.fetchMovies(false), 420);
      }
    },
    activeFilm(value) {
      document.body.classList.toggle('modal-open', !!value);
      if (value) this.$nextTick(() => this.$refs.movieDialog?.focus());
    }
  },
  mounted() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      this.favorites = Array.isArray(saved) ? saved.filter(movie => movie && movie.id && movie.name) : [];
    } catch {
      this.favorites = [];
    }
    this.fetchMovies(false);
    window.addEventListener('keydown', this.handleKeydown);
  },
  beforeUnmount() {
    window.removeEventListener('keydown', this.handleKeydown);
    document.body.classList.remove('modal-open');
    clearTimeout(this.searchTimer);
    this.controller?.abort();
  },
  methods: {
    async fetchMovies(more = false) {
      if (this.view !== 'explore' || (more && (this.loading || this.loadingMore))) return;
      const request = ++this.requestId;
      this.controller?.abort();
      this.controller = new AbortController();
      this.error = '';
      if (more) this.loadingMore = true;
      else {
        this.loading = true;
        this.items = [];
        this.page = 0;
        this.hasMore = false;
      }
      const nextPage = more ? this.page + 1 : 0;
      const search = this.searchQuery.trim();
      const extra = search.length >= 2
        ? 'search=' + encodeURIComponent(search)
        : this.selectedGenre
          ? 'genre=' + encodeURIComponent(this.selectedGenre)
          : '';
      const pieces = [];
      if (extra) pieces.push(extra);
      if (nextPage) pieces.push('skip=' + nextPage * PAGE_SIZE);
      const url = API_BASE + '/catalog/movie/top' + (pieces.length ? '/' + pieces.join('&') : '') + '.json';

      try {
        const response = await fetch(url, { signal: this.controller.signal });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const payload = await response.json();
        if (!Array.isArray(payload.metas)) throw new Error('Resposta invalida');
        if (request !== this.requestId) return;
        const incoming = payload.metas.filter(movie => movie && movie.id && movie.name && movie.type === 'movie');
        const known = new Set(more ? this.items.map(movie => movie.id) : []);
        const fresh = incoming.filter(movie => !known.has(movie.id) && known.add(movie.id));
        this.items = more ? [...this.items, ...fresh] : fresh;
        this.page = nextPage;
        this.hasMore = payload.metas.length >= PAGE_SIZE && fresh.length > 0;
      } catch (error) {
        if (request !== this.requestId || error.name === 'AbortError') return;
        this.error = error.message.includes('429')
          ? 'O servico esta ocupado. Tenta novamente daqui a pouco.'
          : 'Verifica a ligacao a internet e volta a tentar.';
      } finally {
        if (request === this.requestId) {
          this.loading = false;
          this.loadingMore = false;
        }
      }
    },
    selectGenre(value) {
      if (this.selectedGenre === value) return;
      this.selectedGenre = value;
      if (this.view === 'explore') this.fetchMovies(false);
    },
    showFavorites() {
      this.view = 'favorites';
      this.controller?.abort();
      this.requestId++;
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
      const wasFavorites = this.view === 'favorites';
      this.view = 'explore';
      this.searchQuery = '';
      this.selectedGenre = '';
      this.yearFilter = 'all';
      this.ratingFilter = 0;
      this.sortBy = 'featured';
      if (wasFavorites && !this.items.length) this.fetchMovies(false);
      this.scrollToCatalog();
    },
    goHome() {
      this.showExplore();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    scrollToCatalog() {
      this.$nextTick(() => document.getElementById('catalogo')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    },
    resetFilters() {
      this.yearFilter = 'all';
      this.ratingFilter = 0;
      this.sortBy = 'featured';
      if (this.view === 'favorites' && !this.favorites.length) {
        this.showExplore();
      } else {
        this.searchQuery = '';
        this.selectGenre('');
      }
    },
    movieYear(movie) {
      const match = String(movie.releaseInfo || movie.year || '').match(/(?:18|19|20)\d{2}/);
      return match ? Number(match[0]) : 0;
    },
    movieRating(movie) {
      const rating = Number.parseFloat(String(movie.imdbRating || '').replace(',', '.'));
      return Number.isFinite(rating) && rating > 0 ? rating : 0;
    },
    genreLabel(movie) {
      const genre = (movie.genres || [])[0];
      const found = this.genres.find(item => item.value.toLowerCase() === String(genre || '').toLowerCase());
      return found ? found.label : genre || 'Cinema';
    },
    isFavorite(id) {
      return this.favorites.some(movie => movie.id === id);
    },
    toggleFavorite(movie) {
      if (this.isFavorite(movie.id)) {
        this.favorites = this.favorites.filter(item => item.id !== movie.id);
        this.announcement = movie.name + ' removido da tua lista.';
      } else {
        this.favorites.unshift({ ...movie });
        this.announcement = movie.name + ' guardado na tua lista.';
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.favorites));
      } catch {
        this.announcement = 'Nao foi possivel guardar a lista neste navegador.';
      }
    },
    async openMovie(movie) {
      this.previousFocus = document.activeElement;
      this.activeFilm = { ...movie };
      this.detailsLoading = true;
      try {
        const response = await fetch(API_BASE + '/meta/movie/' + encodeURIComponent(movie.id) + '.json');
        if (!response.ok) throw new Error('Detalhe indisponivel');
        const payload = await response.json();
        if (this.activeFilm && this.activeFilm.id === movie.id && payload.meta) {
          this.activeFilm = { ...movie, ...payload.meta };
        }
      } catch {
        this.announcement = 'A mostrar os dados disponiveis deste filme.';
      } finally {
        if (this.activeFilm && this.activeFilm.id === movie.id) this.detailsLoading = false;
      }
    },
    closeMovie() {
      this.activeFilm = null;
      this.detailsLoading = false;
      this.$nextTick(() => this.previousFocus?.focus?.());
    },
    formatPeople(people) {
      if (Array.isArray(people)) return people.join(', ');
      return String(people || '');
    },
    imdbLink(movie) {
      return /^tt\d+$/.test(movie.id || '') ? 'https://www.imdb.com/title/' + movie.id + '/' : '';
    },
    surpriseMe() {
      const selection = this.visibleFilms.length ? this.visibleFilms : this.items;
      if (selection.length) this.openMovie(selection[Math.floor(Math.random() * selection.length)]);
      else this.scrollToCatalog();
    },
    hideImage(event) {
      event.target.style.display = 'none';
    },
    handleKeydown(event) {
      if (event.key === 'Tab' && this.activeFilm && this.$refs.movieDialog) {
        const controls = [...this.$refs.movieDialog.querySelectorAll('button:not([disabled]), a[href]')];
        if (controls.length) {
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === this.$refs.movieDialog)) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
      if (event.key === 'Escape' && this.activeFilm) {
        this.closeMovie();
        return;
      }
      if (event.key === '/' && !this.activeFilm && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        event.preventDefault();
        document.getElementById('movie-search')?.focus();
      }
    }
  }
});

app.mount('#app');
