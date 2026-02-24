class App {
    constructor() {
        this.currentTab = 'tv';
        this.currentView = 'home';
        this.userId = 'user_1';
        this.searchDebounceTimer = null;
        this.currentSearchFilter = 'all';
        this.init();
    }

    async init() {
        await db.initPromise;
        this.navigate('home');
        window.addEventListener('scroll', () => {
            document.getElementById('header').classList.toggle('scrolled', window.scrollY > 50);
        });
    }

    navigate(view) {
        this.currentView = view;
        document.querySelectorAll('.nav-item').forEach((item, i) => {
            item.classList.toggle('active',
                (view === 'home' && i === 0) || (view === 'search' && i === 1) ||
                (view === 'mylist' && i === 2) || (view === 'downloads' && i === 3)
            );
        });
        const main = document.getElementById('mainContent');
        if (view === 'home')         this.renderHome(main);
        else if (view === 'search')  this.renderSearch(main);
        else if (view === 'mylist')  this.renderMyList(main);
        else if (view === 'downloads') this.renderDownloads(main);
    }

    switchTab(tab) {
        this.currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        this.navigate(this.currentView);
    }

    // ─── CARD HELPERS ────────────────────────────────────────────────────────

    imgFallback(title) {
        const enc = encodeURIComponent(title || '').substring(0, 20);
        return `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='210'><rect width='140' height='210' fill='%231a1a1a'/><text x='70' y='110' text-anchor='middle' fill='%23555' font-size='11' font-family='sans-serif'>${enc}</text></svg>`;
    }

    // FIX #3 & #10: Scrollable content row with left/right arrow buttons
    buildContentRow(shows, extraCardHTML = (show) => '') {
        const rowId = 'row_' + Math.random().toString(36).substr(2, 6);
        return `
            <div class="row-wrapper">
                <button class="scroll-arrow scroll-left" onclick="app.scrollRow('${rowId}', -1)" aria-label="Scroll left">‹</button>
                <div class="content-row" id="${rowId}">
                    ${shows.map(show => `
                        <div class="content-card" onclick="app.showDetails('${show.id}')">
                            <img src="${show.poster_url}"
                                 class="card-image"
                                 alt="${show.title}"
                                 onerror="this.src='${this.imgFallback(show.title)}'">
                            <div class="card-overlay">
                                <div class="card-title">${show.title}</div>
                                ${extraCardHTML(show)}
                            </div>
                        </div>
                    `).join('')}
                </div>
                <button class="scroll-arrow scroll-right" onclick="app.scrollRow('${rowId}', 1)" aria-label="Scroll right">›</button>
            </div>
        `;
    }

    scrollRow(rowId, direction) {
        const row = document.getElementById(rowId);
        if (row) row.scrollBy({ left: direction * 320, behavior: 'smooth' });
    }

    // ─── HOME ────────────────────────────────────────────────────────────────

    async renderHome(container) {
        container.innerHTML = `
            <div class="skeleton" style="height:60vh;margin:-15px -15px 20px;border-radius:0;"></div>
            <div style="padding:0 5px;">
                <div class="skeleton" style="height:20px;width:160px;margin-bottom:15px;"></div>
                <div style="display:flex;gap:10px;">${Array(5).fill('<div class="skeleton skeleton-card"></div>').join('')}</div>
            </div>`;

        try {
            const type = api.normaliseType(this.currentTab);
            const hasHistory = (await db.getUserShows(this.userId)).length > 0;

            // FIX #8: Onboarding for first-time users
            if (!hasHistory) {
                const trending = await api.getTrending(type);
                for (const s of trending) await db.saveShow(s);

                const hero = trending[0];
                container.innerHTML = `
                    <div class="hero" style="background-image:url('${hero?.backdrop_url || ''}')">
                        <div class="hero-content">
                            <div class="hero-title">${hero?.title || 'Welcome'}</div>
                            <div class="hero-meta">
                                <span class="hero-rating">${hero?.imdb_score || 'N/A'} IMDB</span>
                                <span>${hero?.year || ''}</span>
                            </div>
                            <div class="hero-buttons">
                                <button class="btn btn-primary" onclick="app.showDetails('${hero?.id}')">ℹ More Info</button>
                                <button class="btn btn-secondary" onclick="app.navigate('search')">🔍 Search</button>
                            </div>
                        </div>
                    </div>
                    <div class="onboarding-banner">
                        <div class="onboarding-icon">🎬</div>
                        <div>
                            <strong>Welcome to StreamTrack UK!</strong>
                            <p>Search for shows and movies, add them to your list, and we'll recommend what to watch next.</p>
                        </div>
                        <button class="btn btn-primary" onclick="app.navigate('search')" style="flex-shrink:0;">Get Started</button>
                    </div>
                    <div class="section-header"><h2 class="section-title">Trending Now</h2></div>
                    ${this.buildContentRow(trending, show => `<div style="font-size:11px;color:#46d369;">${show.imdb_score || 'N/A'} ⭐</div>`)}
                `;
                return;
            }

            const [recs, continueWatching, trending] = await Promise.all([
                recommendations.getRecommendations(this.userId, type, 20),
                db.getUserShows(this.userId, 'watching', type),
                api.getTrending(type)
            ]);

            let html = '';

            // Hero
            if (recs.length > 0) {
                const hero = recs[0];
                html += `
                    <div class="hero" style="background-image:url('${hero.backdrop_url}')">
                        <div class="hero-content">
                            <div class="hero-title">${hero.title}</div>
                            <div class="hero-meta">
                                <span class="hero-rating">${hero.imdb_score || 'N/A'} IMDB</span>
                                <span>${hero.year || ''}</span>
                                <span>${type === 'tv'
                                    ? `${hero.total_seasons} Season${hero.total_seasons !== 1 ? 's' : ''}`
                                    : `${hero.runtime || '?'} min`}</span>
                            </div>
                            <div class="hero-buttons">
                                <button class="btn btn-primary" onclick="app.showDetails('${hero.id}')">ℹ More Info</button>
                                <button class="btn btn-secondary" onclick="app.updateStatus('${hero.id}', 'watchlist', true)">＋ Watchlist</button>
                            </div>
                        </div>
                    </div>`;
            }

            // Continue Watching
            if (continueWatching.length > 0) {
                const cwShows = await Promise.all(continueWatching.map(item => db.getShow(item.show_id)));
                const validCW = continueWatching.map((item, i) => ({ item, show: cwShows[i] })).filter(x => x.show);

                const rowId = 'cw_' + Math.random().toString(36).substr(2,6);
                html += `
                    <div class="section-header"><h2 class="section-title">Continue Watching</h2></div>
                    <div class="row-wrapper">
                        <button class="scroll-arrow scroll-left" onclick="app.scrollRow('${rowId}',-1)">‹</button>
                        <div class="content-row" id="${rowId}">
                            ${validCW.map(({ item, show }) => {
                                const progress = item.current_episode
                                    ? Math.round((item.current_episode / (show.total_episodes || 1)) * 100) : 0;
                                return `
                                    <div class="content-card" onclick="app.showDetails('${show.id}')">
                                        <img src="${show.poster_url}" class="card-image" alt="${show.title}"
                                             onerror="this.src='${this.imgFallback(show.title)}'">
                                        <span class="status-badge watching">Watching</span>
                                        <div class="card-overlay">
                                            <div class="card-title">${show.title}</div>
                                            <div class="card-progress">
                                                <div class="card-progress-bar" style="width:${progress}%"></div>
                                            </div>
                                            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:5px;">
                                                <span style="font-size:11px;">S${item.current_season||1}:E${item.current_episode||1}</span>
                                                <button class="quick-ep-btn"
                                                    onclick="event.stopPropagation();app.quickAddEpisode('${show.id}',${item.current_season||1},${item.current_episode||1},${show.total_episodes||1},${show.total_seasons||1})">
                                                    +1 EP
                                                </button>
                                            </div>
                                        </div>
                                    </div>`;
                            }).join('')}
                        </div>
                        <button class="scroll-arrow scroll-right" onclick="app.scrollRow('${rowId}',1)">›</button>
                    </div>`;
            }

            // Because You Watched
            const watched = await db.getUserShows(this.userId, 'completed', type);
            if (watched.length > 0) {
                const byw = await recommendations.getBecauseYouWatched(this.userId, watched[0].show_id, 20);
                if (byw.length > 0) {
                    html += `<div class="section-header"><h2 class="section-title">Because You Watched</h2></div>
                    ${this.buildContentRow(byw, show => `<div style="font-size:11px;color:#aaa;">${show.reason}</div>`)}`;
                }
            }

            // Trending
            html += `<div class="section-header"><h2 class="section-title">Trending Now</h2></div>
                ${this.buildContentRow(trending, show => `<div style="font-size:11px;color:#46d369;">${show.imdb_score||'N/A'} ⭐</div>`)}`;

            // Recommended
            if (recs.length > 1) {
                html += `<div class="section-header"><h2 class="section-title">Recommended For You</h2></div>
                    ${this.buildContentRow(recs.slice(1), show => `<div style="font-size:11px;color:#aaa;">${show.genres?.slice(0,2).join(', ')}</div>`)}`;
            }

            container.innerHTML = html;

        } catch (error) {
            console.error('Home load error:', error);
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">⚠️</div>
                    <p>Failed to load content. Please check your connection.</p>
                    <button class="btn btn-primary" onclick="app.navigate('home')" style="margin-top:20px;">Retry</button>
                </div>`;
        }
    }

    // ─── QUICK EP ────────────────────────────────────────────────────────────

    async quickAddEpisode(showId, currentSeason, currentEpisode, totalEpisodes, totalSeasons) {
        let newSeason = currentSeason;
        let newEpisode = currentEpisode + 1;

        if (newEpisode > totalEpisodes) {
            if (currentSeason < totalSeasons) {
                newSeason++;
                newEpisode = 1;
                this.showToast(`Started Season ${newSeason}! 🎉`);
            } else {
                await db.updateUserShow(this.userId, showId, { status: 'completed', current_season: currentSeason, current_episode: currentEpisode, type: this.currentTab });
                this.showToast('Show completed! ✅');
                this.navigate('home');
                return;
            }
        } else {
            this.showToast(`Marked S${newSeason}:E${newEpisode} ✓`);
        }

        await db.updateUserShow(this.userId, showId, { status: 'watching', current_season: newSeason, current_episode: newEpisode, type: this.currentTab });
        this.navigate('home');
    }

    // ─── SEARCH ──────────────────────────────────────────────────────────────

    renderSearch(container) {
        container.innerHTML = `
            <div class="search-container">
                <input type="text" class="search-box" placeholder="Search titles, genres, people..."
                       id="searchInput" oninput="app.handleSearchInput(event)"
                       onkeydown="app.handleSearchKeydown(event)" autocomplete="off">
                <div class="filter-chips">
                    <button class="chip active" onclick="app.setSearchFilter('all',this)">All</button>
                    <button class="chip" onclick="app.setSearchFilter('action',this)">Action</button>
                    <button class="chip" onclick="app.setSearchFilter('comedy',this)">Comedy</button>
                    <button class="chip" onclick="app.setSearchFilter('drama',this)">Drama</button>
                    <button class="chip" onclick="app.setSearchFilter('sci-fi',this)">Sci-Fi</button>
                    <button class="chip" onclick="app.setSearchFilter('thriller',this)">Thriller</button>
                    <button class="chip" onclick="app.setSearchFilter('horror',this)">Horror</button>
                    <button class="chip" onclick="app.setSearchFilter('romance',this)">Romance</button>
                </div>
                <div id="searchResults"></div>
            </div>`;
        this.currentSearchFilter = 'all';
        document.getElementById('searchInput').focus();
    }

    handleSearchInput(event) {
        const query = event.target.value.trim();
        clearTimeout(this.searchDebounceTimer);
        if (query.length < 2) { document.getElementById('searchResults').innerHTML = ''; return; }
        this.searchDebounceTimer = setTimeout(() => this.performSearch(query), 350);
    }

    handleSearchKeydown(event) {
        if (event.key === 'Enter') {
            clearTimeout(this.searchDebounceTimer);
            const query = event.target.value.trim();
            if (query.length >= 2) this.performSearch(query);
        }
    }

    async performSearch(query) {
        const resultsContainer = document.getElementById('searchResults');
        if (!resultsContainer) return;

        // FIX #9: Show local results immediately, then update with API results
        const localResults = await db.searchLocal(query, this.currentTab);
        if (localResults.length > 0) this.renderSearchResults(resultsContainer, localResults);
        else resultsContainer.innerHTML = `<div style="display:flex;gap:10px;flex-wrap:wrap;">${Array(6).fill('<div class="skeleton skeleton-card" style="margin-bottom:15px;"></div>').join('')}</div>`;

        try {
            if (db.isOnline) {
                const results = await api.search(query, this.currentTab);
                for (const show of results) await db.saveShow(show);
                const filtered = this.currentSearchFilter !== 'all'
                    ? results.filter(s => s.genres?.some(g => g.toLowerCase().includes(this.currentSearchFilter)))
                    : results;
                this.renderSearchResults(resultsContainer, filtered.length > 0 ? filtered : results);
            }
        } catch (e) {
            if (localResults.length === 0) resultsContainer.innerHTML = '<p style="color:#aaa;padding:20px 0;">Search failed. Try again.</p>';
        }
    }

    renderSearchResults(container, results) {
        if (results.length === 0) {
            container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>No results found</p></div>`;
            return;
        }
        container.innerHTML = `
            <div class="content-row" style="flex-wrap:wrap;">
                ${results.map(show => `
                    <div class="content-card" style="margin-bottom:15px;" onclick="app.showDetails('${show.id}')">
                        <img src="${show.poster_url}" class="card-image" alt="${show.title}"
                             onerror="this.src='${this.imgFallback(show.title)}'">
                        <div class="card-title" style="margin-top:5px;">${show.title}</div>
                        <div style="font-size:11px;color:#aaa;">${show.year||''} • ${show.imdb_score||'N/A'} ⭐</div>
                    </div>`).join('')}
            </div>`;
    }

    setSearchFilter(filter, el) {
        this.currentSearchFilter = filter;
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        el.classList.add('active');
        const query = document.getElementById('searchInput')?.value.trim();
        if (query && query.length >= 2) this.performSearch(query);
    }

    // ─── MY LIST ─────────────────────────────────────────────────────────────

    async renderMyList(container) {
        container.innerHTML = `
            <div style="padding:80px 15px 20px;">
                <div class="list-tabs">
                    <button class="list-tab active" onclick="app.filterList('all')">All</button>
                    <button class="list-tab" onclick="app.filterList('watching')">Watching</button>
                    <button class="list-tab" onclick="app.filterList('completed')">Completed</button>
                    <button class="list-tab" onclick="app.filterList('watchlist')">Watchlist</button>
                </div>
                <div id="listContent"></div>
            </div>`;
        this.filterList('all');
    }

    async filterList(status) {
        document.querySelectorAll('.list-tab').forEach(tab => {
            const s = tab.textContent.toLowerCase() === 'all' ? 'all' : tab.textContent.toLowerCase();
            tab.classList.toggle('active', s === status);
        });

        const listContent = document.getElementById('listContent');
        const userShows = await db.getUserShows(this.userId, status === 'all' ? null : status, this.currentTab);

        if (userShows.length === 0) {
            listContent.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📋</div>
                    <p>Your ${this.currentTab === 'tv' ? 'TV' : 'Movie'} list is empty</p>
                    <p style="font-size:13px;margin-top:10px;">Search for titles to start tracking!</p>
                    <button class="btn btn-primary" onclick="app.navigate('search')" style="margin-top:15px;">🔍 Search</button>
                </div>`;
            return;
        }

        const showDetails = await Promise.all(userShows.map(s => db.getShow(s.show_id)));

        listContent.innerHTML = `
            <div class="content-row" style="flex-wrap:wrap;">
                ${showDetails.map((show, i) => {
                    if (!show) return '';
                    const userShow = userShows[i];
                    const progress = userShow.current_episode
                        ? Math.round((userShow.current_episode / (show.total_episodes||1)) * 100) : 0;

                    return `
                        <div class="content-card" style="margin-bottom:15px;" onclick="app.showDetails('${show.id}')">
                            <img src="${show.poster_url}" class="card-image" alt="${show.title}"
                                 onerror="this.src='${this.imgFallback(show.title)}'">
                            <span class="status-badge ${userShow.status}">${userShow.status}</span>
                            <!-- FIX #11: Remove button -->
                            <button class="remove-btn" title="Remove from list"
                                onclick="event.stopPropagation();app.removeFromList('${show.id}')">✕</button>
                            <div style="margin-top:5px;">
                                <div class="card-title">${show.title}</div>
                                ${userShow.status === 'watching' ? `
                                    <div class="card-progress" style="margin-top:5px;">
                                        <div class="card-progress-bar" style="width:${progress}%"></div>
                                    </div>
                                    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:3px;">
                                        <span style="font-size:11px;color:#aaa;">S${userShow.current_season||1}:E${userShow.current_episode||1}</span>
                                        <button class="quick-ep-btn"
                                            onclick="event.stopPropagation();app.quickAddEpisode('${show.id}',${userShow.current_season||1},${userShow.current_episode||1},${show.total_episodes||1},${show.total_seasons||1})">
                                            +1 EP
                                        </button>
                                    </div>
                                ` : `
                                    <div onclick="event.stopPropagation();" style="margin-top:5px;">
                                        ${this.renderStars(userShow.personal_rating, show.id, true)}
                                    </div>`}
                            </div>
                        </div>`;
                }).join('')}
            </div>`;
    }

    // FIX #11: Remove from list
    async removeFromList(showId) {
        if (!confirm('Remove from your list?')) return;
        await db.removeUserShow(this.userId, showId);
        this.showToast('Removed from list');
        this.filterList('all');
    }

    // ─── STAR RATING ─────────────────────────────────────────────────────────

    renderStars(currentRating, showId, small = false) {
        const size = small ? '14px' : '24px';
        return `<div class="star-row" style="display:flex;gap:2px;">
            ${[1,2,3,4,5].map(star => `
                <span class="star" style="font-size:${size};cursor:pointer;padding:2px;transition:transform 0.15s;"
                      onmouseover="this.style.transform='scale(1.3)'"
                      onmouseout="this.style.transform='scale(1)'"
                      onclick="event.stopPropagation();app.setRating('${showId}',${star})">
                    ${star <= (currentRating||0) ? '⭐' : '☆'}
                </span>`).join('')}
            ${currentRating ? `<span style="font-size:11px;color:#aaa;margin-left:4px;line-height:${size};">${currentRating}/5</span>` : ''}
        </div>`;
    }

    // FIX #6: Update stars immediately in place without full re-render
    async setRating(showId, rating) {
        const userShows = await db.getUserShows(this.userId);
        const existing = userShows.find(us => us.show_id === showId) || {};
        const newRating = existing.personal_rating === rating ? null : rating;

        await db.updateUserShow(this.userId, showId, { ...existing, show_id: showId, personal_rating: newRating });

        // Update all star rows for this show immediately in place
        document.querySelectorAll(`[data-show-id="${showId}"] .star-row`).forEach(row => {
            row.outerHTML = this.renderStars(newRating, showId, true);
        });

        // If modal is open, re-render the star section there too
        const modalRatingSection = document.getElementById('modal-rating-' + showId);
        if (modalRatingSection) {
            modalRatingSection.innerHTML = this.renderStars(newRating, showId, false);
        }

        this.showToast(newRating ? `Rated ${newRating}/5 ⭐` : 'Rating removed');
    }

    // ─── DETAIL MODAL ────────────────────────────────────────────────────────

    async showDetails(showId) {
        const modal = document.getElementById('detailModal');
        const modalHeader = document.getElementById('modalHeader');
        const modalContent = document.getElementById('modalContent');

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';

        // Show skeleton immediately (FIX #17)
        modalHeader.style.backgroundImage = '';
        modalContent.innerHTML = `
            <div class="skeleton" style="height:32px;width:60%;margin-bottom:12px;"></div>
            <div class="skeleton" style="height:14px;width:40%;margin-bottom:20px;"></div>
            <div class="skeleton" style="height:80px;margin-bottom:20px;"></div>
            <div style="display:flex;gap:10px;">
                <div class="skeleton" style="height:70px;flex:1;border-radius:4px;"></div>
                <div class="skeleton" style="height:70px;flex:1;border-radius:4px;"></div>
                <div class="skeleton" style="height:70px;flex:1;border-radius:4px;"></div>
            </div>`;

        let show = await db.getShow(showId);
        if (!show && db.isOnline) {
            try {
                const tmdbId = parseInt(showId.replace('tmdb_', ''));
                show = await api.getShowByTmdbId(tmdbId, this.currentTab);
                if (show) await db.saveShow(show);
            } catch (e) { console.error('Failed to fetch show:', e); }
        }

        if (!show) {
            modalContent.innerHTML = '<p style="padding:20px;color:#aaa;">Failed to load. Please check your connection.</p>';
            return;
        }

        const userShows = await db.getUserShows(this.userId);
        const userShow = userShows.find(us => us.show_id === showId);

        // FIX #4: Show poster as thumbnail beside title instead of using it as cropped header
        // Use backdrop for header (landscape), poster as a portrait thumbnail
        modalHeader.style.backgroundImage = `url('${show.backdrop_url}')`;

        const isWatching  = userShow?.status === 'watching';
        const isCompleted = userShow?.status === 'completed';
        const isWatchlist = userShow?.status === 'watchlist';

        // ── Streaming ──
        // Refresh stale streaming data automatically
        let streaming = show.streaming || [];
        if (offlineManager.isStreamingStale(show) && db.isOnline) {
            try {
                streaming = await api.getWatchProviders(show.tmdb_id, show.type);
                show.streaming = streaming;
                show.streaming_fetched_at = new Date().toISOString();
                await db.saveShow(show);
            } catch (e) {}
        }

        const ukStreaming = streaming.filter(s => s.country === 'UK');
        const streamingHTML = `
            <div class="info-section">
                <div class="info-title">Where to Watch in UK</div>
                ${ukStreaming.length > 0 ? `
                    <div class="streaming-options">
                        ${ukStreaming.map(s => `
                            <a href="${s.url||'#'}" target="_blank" class="streaming-option">
                                ${s.logo
                                    ? `<img src="${s.logo}" class="streaming-logo-img" alt="${s.name}" onerror="this.style.display='none'">`
                                    : `<div class="streaming-logo" style="background:${s.color||'#333'}">${s.name.substring(0,2).toUpperCase()}</div>`}
                                <div class="streaming-info">
                                    <div class="streaming-name">
                                        ${s.name}
                                        ${s.free ? '<span class="free-badge">FREE</span>' : ''}
                                    </div>
                                    <div class="streaming-type">
                                        ${s.free ? 'Free to watch' : s.type === 'subscription' ? 'Subscription' : s.type === 'rent' ? 'Available to rent' : s.type === 'buy' ? 'Available to buy' : s.type}
                                    </div>
                                </div>
                                <span style="color:#aaa;">→</span>
                            </a>`).join('')}
                    </div>` : `
                    <p style="color:#aaa;font-size:13px;padding:10px 0;">
                        Not currently available on UK streaming services.
                        <a href="https://www.justwatch.com/uk/search?q=${encodeURIComponent(show.title)}"
                           target="_blank" style="color:#e50914;text-decoration:none;"> Check JustWatch →</a>
                    </p>`}
            </div>`;

        // FIX #4: Show poster as portrait card alongside title
        const posterHTML = `
            <div class="modal-poster-row">
                <img src="${show.poster_url}" class="modal-poster-thumb" alt="${show.title}"
                     onerror="this.style.display='none'">
                <div class="modal-title-block">
                    <div class="modal-title">${show.title}</div>
                    <div class="modal-meta">
                        ${show.imdb_score ? `<span class="modal-rating">${show.imdb_score} IMDB</span>` : ''}
                        ${show.rotten_tomatoes ? `<span>${show.rotten_tomatoes} 🍅</span>` : ''}
                        ${show.year ? `<span>${show.year}</span>` : ''}
                        <span>${show.type === 'tv'
                            ? `${show.total_seasons} Season${show.total_seasons!==1?'s':''}`
                            : `${show.runtime||'?'} min`}</span>
                        ${show.genres?.length ? `<span style="color:#aaa;">${show.genres.slice(0,3).join(' · ')}</span>` : ''}
                    </div>
                </div>
            </div>`;

        // ── Cast ──
        const castHTML = show.cast?.length ? `
            <div class="info-section">
                <div class="info-title">Cast</div>
                <div class="cast-list">
                    ${show.cast.map(actor => `
                        <div class="cast-member">
                            <img src="${actor.image||''}" class="cast-image" alt="${actor.name}"
                                 onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2270%22 height=%2270%22><rect width=%2270%22 height=%2270%22 fill=%22%23333%22 rx=%2235%22/></svg>'">
                            <div class="cast-name">${actor.name}</div>
                            <div style="font-size:10px;color:#aaa;">${actor.character||''}</div>
                        </div>`).join('')}
                </div>
            </div>` : '';

        // FIX #5: Real episode list with show/hide per season
        const episodesHTML = (show.type === 'tv') ? `
            <div class="info-section" id="episodes-section">
                <div class="info-title" style="display:flex;justify-content:space-between;align-items:center;">
                    <span>Episodes</span>
                    ${show.total_seasons > 1 ? `
                        <select id="seasonSelect" onchange="app.loadEpisodes('${show.tmdb_id}', this.value, '${showId}')"
                                style="background:#333;border:none;color:white;padding:5px 10px;border-radius:4px;font-size:13px;">
                            ${Array.from({length: show.total_seasons}, (_,i) => `<option value="${i+1}">Season ${i+1}</option>`).join('')}
                        </select>` : ''}
                </div>
                <div id="episode-list-container">
                    <div class="skeleton" style="height:60px;margin-bottom:8px;border-radius:8px;"></div>
                    <div class="skeleton" style="height:60px;margin-bottom:8px;border-radius:8px;"></div>
                    <div class="skeleton" style="height:60px;border-radius:8px;"></div>
                </div>
            </div>` : '';

        modalContent.innerHTML = `
            ${posterHTML}
            <p class="modal-synopsis">${show.synopsis || 'No description available.'}</p>
            <div class="modal-actions">
                <button class="action-btn ${isWatching?'active':''}" onclick="app.updateStatus('${show.id}','watching')">
                    <span style="font-size:18px;">▶</span><span>Watching</span>
                </button>
                <button class="action-btn ${isWatchlist?'active':''}" onclick="app.updateStatus('${show.id}','watchlist')">
                    <span style="font-size:18px;">＋</span><span>Watchlist</span>
                </button>
                <button class="action-btn ${isCompleted?'active':''}" onclick="app.updateStatus('${show.id}','completed')">
                    <span style="font-size:18px;">✓</span><span>Completed</span>
                </button>
            </div>
            <div class="info-section">
                <div class="info-title">Your Rating</div>
                <div id="modal-rating-${show.id}">${this.renderStars(userShow?.personal_rating, show.id, false)}</div>
            </div>
            ${streamingHTML}
            ${castHTML}
            ${episodesHTML}`;

        // Load first season's episodes
        if (show.type === 'tv') {
            this.loadEpisodes(show.tmdb_id, 1, showId);
        }
    }

    // FIX #5: Load real episode data
    async loadEpisodes(tmdbId, season, showId) {
        const container = document.getElementById('episode-list-container');
        if (!container) return;

        container.innerHTML = `
            <div class="skeleton" style="height:60px;margin-bottom:8px;border-radius:8px;"></div>
            <div class="skeleton" style="height:60px;margin-bottom:8px;border-radius:8px;"></div>
            <div class="skeleton" style="height:60px;border-radius:8px;"></div>`;

        const userShows = await db.getUserShows(this.userId);
        const userShow = userShows.find(us => us.show_id === showId);
        const episodes = await api.getSeasonEpisodes(tmdbId, season);

        if (episodes.length === 0) {
            container.innerHTML = '<p style="color:#aaa;font-size:13px;">No episode data available.</p>';
            return;
        }

        container.innerHTML = `
            <div class="episode-list">
                ${episodes.map(ep => {
                    const watched = userShow?.current_season > parseInt(season) ||
                        (userShow?.current_season == parseInt(season) && userShow?.current_episode >= ep.number);
                    return `
                        <div class="episode-item ${watched?'episode-watched':''}"
                             onclick="app.updateProgress('${showId}', ${season}, ${ep.number})">
                            ${ep.stillUrl ? `<img src="${ep.stillUrl}" class="episode-still" alt="Episode ${ep.number}" onerror="this.style.display='none'">` : '<div class="episode-still-placeholder"></div>'}
                            <div class="episode-info">
                                <div class="episode-title">
                                    <span style="color:#aaa;margin-right:8px;">${ep.number}.</span>
                                    ${ep.title}
                                    ${watched ? '<span style="color:#46d369;margin-left:8px;font-size:12px;">✓ Watched</span>' : ''}
                                </div>
                                ${ep.overview ? `<div class="episode-overview">${ep.overview.substring(0,120)}${ep.overview.length>120?'…':''}</div>` : ''}
                                <div style="display:flex;gap:10px;margin-top:4px;">
                                    ${ep.runtime ? `<span style="font-size:11px;color:#aaa;">⏱ ${ep.runtime} min</span>` : ''}
                                    ${ep.airDate ? `<span style="font-size:11px;color:#aaa;">📅 ${ep.airDate}</span>` : ''}
                                    ${ep.rating ? `<span style="font-size:11px;color:#f5c518;">⭐ ${ep.rating}</span>` : ''}
                                </div>
                            </div>
                        </div>`;
                }).join('')}
            </div>`;
    }

    closeModal() {
        document.getElementById('detailModal').classList.remove('active');
        document.body.style.overflow = '';
    }

    // ─── STATUS ──────────────────────────────────────────────────────────────

    async updateStatus(showId, status, fromHome = false) {
        const userShows = await db.getUserShows(this.userId);
        const existing = userShows.find(us => us.show_id === showId) || {};
        await db.updateUserShow(this.userId, showId, { ...existing, show_id: showId, status, type: this.currentTab });
        this.showToast(`Marked as ${status} ✓`);
        if (!fromHome) this.showDetails(showId);
    }

    async updateProgress(showId, season, episode) {
        const userShows = await db.getUserShows(this.userId);
        const existing = userShows.find(us => us.show_id === showId) || {};
        await db.updateUserShow(this.userId, showId, { ...existing, show_id: showId, status: 'watching', current_season: parseInt(season), current_episode: episode, type: this.currentTab });
        this.showToast(`Progress saved: S${season}:E${episode} ✓`);
        this.showDetails(showId);
    }

    // ─── DOWNLOADS ───────────────────────────────────────────────────────────

    async renderDownloads(container) {
        const usage = await offlineManager.getStorageUsage();
        container.innerHTML = `
            <div style="padding:80px 15px 20px;">
                <h2 style="margin-bottom:20px;">Offline Content</h2>
                ${usage ? `
                    <div style="background:#1a1a1a;padding:15px;border-radius:8px;margin-bottom:20px;">
                        <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
                            <span>Storage Used</span>
                            <span>${(usage.usage/1024/1024).toFixed(1)} MB</span>
                        </div>
                        <div style="height:6px;background:#333;border-radius:3px;overflow:hidden;">
                            <div style="width:${usage.percent}%;height:100%;background:var(--netflix-red);"></div>
                        </div>
                        <div style="font-size:12px;color:#aaa;margin-top:5px;">${usage.percent}% of available space</div>
                    </div>` : ''}
                <button class="btn btn-primary" id="syncBtn" onclick="app.syncOfflineContent(this)" style="width:100%;margin-bottom:20px;">
                    🔄 Sync My List for Offline
                </button>
                <div id="offlineList"></div>
            </div>`;
        this.loadOfflineList();
    }

    async loadOfflineList() {
        const container = document.getElementById('offlineList');
        if (!container) return;
        const myShows = await db.getUserShows(this.userId);
        const showDetails = (await Promise.all(myShows.map(s => db.getShow(s.show_id)))).filter(Boolean);
        if (showDetails.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">⬇️</div>
                    <p>No offline content yet</p>
                    <p style="font-size:13px;margin-top:10px;">Sync your list to access it without internet</p>
                </div>`;
            return;
        }
        container.innerHTML = `
            <div class="content-row" style="flex-wrap:wrap;">
                ${showDetails.map(show => `
                    <div class="content-card" style="margin-bottom:15px;" onclick="app.showDetails('${show.id}')">
                        <img src="${show.poster_url}" class="card-image" alt="${show.title}" onerror="this.src='${this.imgFallback(show.title)}'">
                        <div style="margin-top:5px;">
                            <div class="card-title">${show.title}</div>
                            <div style="font-size:11px;color:#46d369;">${show.streaming?.some(s=>s.country==='UK')?'✓ Available in UK':'Check availability'}</div>
                        </div>
                    </div>`).join('')}
            </div>`;
    }

    async syncOfflineContent(btn) {
        btn.textContent = 'Syncing...';
        btn.disabled = true;
        try {
            const count = await offlineManager.preloadForOffline(this.userId);
            this.showToast(`Synced ${count} titles for offline viewing`);
            this.loadOfflineList();
        } catch (e) {
            this.showToast('Sync failed. Please try again.');
        } finally {
            btn.textContent = '🔄 Sync My List for Offline';
            btn.disabled = false;
        }
    }

    // ─── MISC ────────────────────────────────────────────────────────────────

    showNotifications() { this.showToast('No new notifications'); }
    showProfile()       { this.showToast('Profile settings coming soon'); }

    showToast(message) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2500);
    }
}

const app = new App();
