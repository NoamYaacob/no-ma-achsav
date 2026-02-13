// === Nu Ma Achshav Podcast Website ===

const RSS_FEED_URL = 'https://anchor.fm/s/fca75880/podcast/rss';
const DATA_URL = 'data/episodes.json';

let allEpisodes = [];
let podcastData = null;
let searchTimeout = null;

// === Initialize ===
document.addEventListener('DOMContentLoaded', () => {
  loadEpisodes();
  setupSearch();
  setupModal();
  setupBackToTop();
});

// === Load Episodes ===
async function loadEpisodes() {
  const loading = document.getElementById('loading');
  try {
    // Try loading from pre-built JSON first
    let data = null;
    try {
      const response = await fetch(DATA_URL);
      if (response.ok) {
        data = await response.json();
      }
    } catch (e) {
      // JSON not available, fall through to RSS
    }

    // Fallback: parse RSS feed directly
    if (!data) {
      data = await fetchAndParseRSS();
    }

    podcastData = data.podcast;
    allEpisodes = data.episodes;

    // Update UI
    updatePodcastInfo();
    renderEpisodes(allEpisodes);
    loading.style.display = 'none';
  } catch (err) {
    console.error('Error loading episodes:', err);
    loading.innerHTML = '<p>שגיאה בטעינת הפרקים. נסו לרענן את הדף.</p>';
  }
}

// === Fetch and Parse RSS Feed ===
async function fetchAndParseRSS() {
  // Use multiple CORS proxy options
  const corsProxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(RSS_FEED_URL)}`,
    `https://corsproxy.io/?${encodeURIComponent(RSS_FEED_URL)}`,
  ];

  let xml = null;
  for (const proxyUrl of corsProxies) {
    try {
      const response = await fetch(proxyUrl);
      if (response.ok) {
        xml = await response.text();
        break;
      }
    } catch (e) {
      continue;
    }
  }

  if (!xml) {
    throw new Error('Could not fetch RSS feed');
  }

  return parseRSSXml(xml);
}

function parseRSSXml(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  const channel = doc.querySelector('channel');

  const podcast = {
    title: getTextContent(channel, 'title') || 'נו מה עכשיו?',
    description: getTextContent(channel, 'description') || '',
    author: channel.querySelector('itunes\\:author, author')?.textContent || 'צח רוקח ונועם אונגר',
    image: channel.querySelector('itunes\\:image')?.getAttribute('href') ||
           channel.querySelector('image url')?.textContent || '',
    lastBuildDate: new Date().toISOString(),
  };

  const items = channel.querySelectorAll('item');
  const episodes = Array.from(items).map((item, index) => {
    const description = stripHtml(
      getTextContent(item, 'content\\:encoded') || getTextContent(item, 'description') || ''
    );
    const shortDescription = stripHtml(getTextContent(item, 'description') || '').substring(0, 300);
    const durationRaw = item.querySelector('itunes\\:duration')?.textContent || '';
    const durationSeconds = parseDuration(durationRaw);
    const quotes = extractQuotes(getTextContent(item, 'content\\:encoded') || getTextContent(item, 'description') || '');

    const enclosure = item.querySelector('enclosure');
    const audioUrl = enclosure?.getAttribute('url') || '';

    const episodeImage = item.querySelector('itunes\\:image')?.getAttribute('href') || podcast.image;
    const episodeNum = item.querySelector('itunes\\:episode')?.textContent || null;

    return {
      title: getTextContent(item, 'title') || '',
      description,
      shortDescription,
      pubDate: getTextContent(item, 'pubDate') || '',
      audioUrl,
      duration: formatDuration(durationSeconds),
      durationSeconds,
      image: episodeImage,
      episodeNumber: episodeNum ? parseInt(episodeNum) : items.length - index,
      quotes,
      link: getTextContent(item, 'link') || '',
    };
  });

  episodes.sort((a, b) => b.episodeNumber - a.episodeNumber);

  return {
    podcast,
    episodes,
    totalEpisodes: episodes.length,
    fetchedAt: new Date().toISOString(),
  };
}

function getTextContent(parent, selector) {
  const el = parent.querySelector(selector);
  return el ? el.textContent : '';
}

function stripHtml(html) {
  if (!html) return '';
  const temp = document.createElement('div');
  temp.innerHTML = html;
  return temp.textContent || temp.innerText || '';
}

function extractQuotes(text) {
  if (!text) return [];
  const quotes = [];
  const patterns = [
    /["""]([^"""]+)["""]/g,
    /״([^״]+)״/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const quote = match[1].trim();
      if (quote.length > 3 && !quotes.includes(quote)) {
        quotes.push(quote);
      }
    }
  }
  return quotes;
}

function parseDuration(str) {
  if (!str) return null;
  const parts = str.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parseInt(str) || null;
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} שעות ו-${m} דקות`;
  return `${m} דקות`;
}

// === Update Podcast Info ===
function updatePodcastInfo() {
  if (!podcastData) return;

  const imgEl = document.getElementById('podcast-image');
  if (podcastData.image) {
    imgEl.src = podcastData.image;
    imgEl.alt = podcastData.title;
  }

  document.getElementById('total-episodes').textContent = allEpisodes.length;

  // Calculate total hours
  const totalSeconds = allEpisodes.reduce((sum, ep) => sum + (ep.durationSeconds || 0), 0);
  const totalHours = Math.round(totalSeconds / 3600);
  document.getElementById('total-hours').textContent = totalHours;
}

// === Render Episodes ===
function renderEpisodes(episodes, query = '') {
  const grid = document.getElementById('episodes-grid');
  const noResults = document.getElementById('no-results');

  if (episodes.length === 0) {
    grid.innerHTML = '';
    noResults.style.display = 'block';
    return;
  }

  noResults.style.display = 'none';

  grid.innerHTML = episodes.map(ep => {
    const title = query ? highlightText(ep.title, query) : ep.title;
    const desc = query ? highlightText(ep.shortDescription, query) : ep.shortDescription;
    const date = formatDate(ep.pubDate);

    const quotesHtml = ep.quotes.length > 0
      ? `<div class="episode-quotes">${ep.quotes.slice(0, 3).map(q =>
          `<span class="episode-quote-tag">${query ? highlightText(q, query) : q}</span>`
        ).join('')}</div>`
      : '';

    return `
      <article class="episode-card" data-episode='${JSON.stringify(ep).replace(/'/g, "&#39;")}'>
        <div class="episode-card-inner">
          <div class="episode-header">
            <div class="episode-number">${ep.episodeNumber}</div>
            <div class="episode-title-area">
              <h3 class="episode-title">${title}</h3>
              <div class="episode-meta">
                <span>${date}</span>
                ${ep.duration ? `<span>${ep.duration}</span>` : ''}
              </div>
            </div>
          </div>
          <p class="episode-description">${desc}</p>
          ${quotesHtml}
          <div class="episode-footer">
            <button class="episode-play-btn">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              פרטים והאזנה
            </button>
            ${ep.duration ? `<span class="episode-duration">${ep.duration}</span>` : ''}
          </div>
        </div>
      </article>
    `;
  }).join('');

  // Add click handlers
  grid.querySelectorAll('.episode-card').forEach(card => {
    card.addEventListener('click', () => {
      const ep = JSON.parse(card.getAttribute('data-episode'));
      openModal(ep);
    });
  });
}

// === Search ===
function setupSearch() {
  const input = document.getElementById('search-input');
  const clearBtn = document.getElementById('clear-search');
  const resultsInfo = document.getElementById('search-results-info');
  const resultsCount = document.getElementById('results-count');

  input.addEventListener('input', () => {
    const query = input.value.trim();
    clearBtn.style.display = query ? 'block' : 'none';

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      if (!query) {
        renderEpisodes(allEpisodes);
        resultsInfo.style.display = 'none';
        return;
      }

      const filtered = searchEpisodes(query);
      renderEpisodes(filtered, query);

      resultsInfo.style.display = 'block';
      resultsCount.innerHTML = `נמצאו <span class="highlight-count">${filtered.length}</span> פרקים מתוך ${allEpisodes.length}`;
    }, 200);
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.style.display = 'none';
    resultsInfo.style.display = 'none';
    renderEpisodes(allEpisodes);
    input.focus();
  });
}

function searchEpisodes(query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  return allEpisodes.filter(ep => {
    const searchableText = [
      ep.title,
      ep.description,
      ep.shortDescription,
      ...(ep.quotes || []),
    ].join(' ').toLowerCase();

    return terms.every(term => searchableText.includes(term));
  });
}

function highlightText(text, query) {
  if (!query || !text) return text;
  const terms = query.split(/\s+/).filter(Boolean);
  let result = text;
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    result = result.replace(regex, '<mark class="search-highlight">$1</mark>');
  }
  return result;
}

// === Modal ===
function setupModal() {
  const overlay = document.getElementById('modal-overlay');
  const closeBtn = document.getElementById('modal-close');

  closeBtn.addEventListener('click', closeModal);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

function openModal(episode) {
  const overlay = document.getElementById('modal-overlay');

  document.getElementById('modal-image').src = episode.image || '';
  document.getElementById('modal-episode-number').textContent = `פרק ${episode.episodeNumber}`;
  document.getElementById('modal-title').textContent = episode.title;
  document.getElementById('modal-date').textContent = formatDate(episode.pubDate);
  document.getElementById('modal-duration').textContent = episode.duration || '';
  document.getElementById('modal-description').textContent = episode.description;

  // Audio
  const audio = document.getElementById('modal-audio');
  if (episode.audioUrl) {
    audio.src = episode.audioUrl;
    audio.parentElement.style.display = 'block';
  } else {
    audio.parentElement.style.display = 'none';
  }

  // Quotes
  const quotesSection = document.getElementById('modal-quotes');
  const quotesList = document.getElementById('modal-quotes-list');
  if (episode.quotes && episode.quotes.length > 0) {
    quotesSection.style.display = 'block';
    quotesList.innerHTML = episode.quotes.map(q =>
      `<div class="quote-item">"${q}"</div>`
    ).join('');
  } else {
    quotesSection.style.display = 'none';
  }

  // Spotify link
  const spotifyLink = document.getElementById('modal-spotify-link');
  spotifyLink.href = `https://open.spotify.com/search/${encodeURIComponent(episode.title)}`;

  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  const audio = document.getElementById('modal-audio');
  audio.pause();
  audio.src = '';
  overlay.classList.remove('active');
  document.body.style.overflow = '';
}

// === Back to Top ===
function setupBackToTop() {
  const btn = document.getElementById('back-to-top');

  window.addEventListener('scroll', () => {
    if (window.scrollY > 400) {
      btn.classList.add('visible');
    } else {
      btn.classList.remove('visible');
    }
  });

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// === Utilities ===
function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('he-IL', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

// Global function for reset button
function resetSearch() {
  const input = document.getElementById('search-input');
  input.value = '';
  document.getElementById('clear-search').style.display = 'none';
  document.getElementById('search-results-info').style.display = 'none';
  renderEpisodes(allEpisodes);
  input.focus();
}
