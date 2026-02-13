const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { parseString } = require('xml2js');

const RSS_FEED_URL = 'https://anchor.fm/s/fca75880/podcast/rss';
const YOUTUBE_PLAYLIST_FEED = 'https://www.youtube.com/feeds/videos.xml?playlist_id=PLojIjH_TowtdOL4dChJBw7O1pN3-yQscF';
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'episodes.json');
const LOCAL_RSS_PATH = path.join(__dirname, '..', 'data', 'rss.xml');

function fetchUrl(url) {
  // Use curl for reliable fetching (handles redirects, DNS, etc.)
  try {
    const result = execSync(`curl -s -L --max-time 30 "${url}"`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return result;
  } catch (err) {
    // Fallback: try reading local RSS file
    if (fs.existsSync(LOCAL_RSS_PATH)) {
      console.log('Network fetch failed, using local RSS file...');
      return fs.readFileSync(LOCAL_RSS_PATH, 'utf8');
    }
    throw err;
  }
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractQuotes(description) {
  if (!description) return [];
  const quotes = [];
  // Match text in Hebrew quotes or regular quotes
  const quotePatterns = [
    /["""]([^"""]+)["""]/g,
    /״([^״]+)״/g,
    /\"([^\"]+)\"/g,
  ];
  for (const pattern of quotePatterns) {
    let match;
    while ((match = pattern.exec(description)) !== null) {
      const quote = match[1].trim();
      if (quote.length > 3 && !quotes.includes(quote)) {
        quotes.push(quote);
      }
    }
  }
  return quotes;
}

function parseDuration(durationStr) {
  if (!durationStr) return null;
  const parts = durationStr.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parseInt(durationStr) || null;
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function main() {
  console.log('Fetching RSS feed from:', RSS_FEED_URL);

  const xml = fetchUrl(RSS_FEED_URL);
  console.log('RSS feed fetched successfully, parsing...');

  const result = await new Promise((resolve, reject) => {
    parseString(xml, { explicitArray: false, trim: true }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });

  const channel = result.rss.channel;

  // Extract podcast metadata
  const podcast = {
    title: channel.title || 'נו מה עכשיו?',
    description: channel.description || '',
    author: channel['itunes:author'] || 'צח רוקח ונועם אונגר',
    image: '',
    link: channel.link || '',
    language: channel.language || 'he',
    lastBuildDate: new Date().toISOString(),
  };

  // Get image URL
  if (channel['itunes:image'] && channel['itunes:image'].$) {
    podcast.image = channel['itunes:image'].$.href;
  } else if (channel.image && channel.image.url) {
    podcast.image = channel.image.url;
  }

  // Extract episodes
  const items = Array.isArray(channel.item) ? channel.item : [channel.item];

  const episodes = items.map((item, index) => {
    const description = stripHtml(
      item['content:encoded'] || item.description || ''
    );
    const shortDescription = stripHtml(item.description || '');
    const durationRaw = item['itunes:duration'] || '';
    const durationSeconds = parseDuration(durationRaw);
    const quotes = extractQuotes(item['content:encoded'] || item.description || '');

    let audioUrl = '';
    if (item.enclosure && item.enclosure.$) {
      audioUrl = item.enclosure.$.url || '';
    }

    let imageUrl = '';
    if (item['itunes:image'] && item['itunes:image'].$) {
      imageUrl = item['itunes:image'].$.href;
    }

    const episodeNum = item['itunes:episode'] || null;
    const season = item['itunes:season'] || null;

    // Try to extract episode number from title (e.g., "פרק 75 - ...")
    let titleEpNum = null;
    const titleMatch = (item.title || '').match(/פרק\s+(\d+)/);
    if (titleMatch) {
      titleEpNum = parseInt(titleMatch[1]);
    }

    return {
      title: item.title || '',
      description: description,
      shortDescription: shortDescription.substring(0, 300),
      pubDate: item.pubDate || '',
      audioUrl: audioUrl,
      duration: formatDuration(durationSeconds),
      durationSeconds: durationSeconds,
      image: imageUrl || podcast.image,
      episodeNumber: titleEpNum || (episodeNum ? parseInt(episodeNum) : items.length - index),
      season: season ? parseInt(season) : 1,
      quotes: quotes,
      guid: item.guid && item.guid._ ? item.guid._ : (item.guid || ''),
      link: item.link || '',
    };
  });

  // Fetch YouTube playlist and match videos to episodes
  console.log('Fetching YouTube playlist...');
  try {
    const ytXml = fetchUrl(YOUTUBE_PLAYLIST_FEED);
    const ytResult = await new Promise((resolve, reject) => {
      parseString(ytXml, { explicitArray: false, trim: true }, (err, res) => {
        if (err) reject(err);
        else resolve(res);
      });
    });

    const entries = ytResult.feed.entry;
    const ytEntries = Array.isArray(entries) ? entries : (entries ? [entries] : []);
    const ytMap = {};

    for (const entry of ytEntries) {
      const videoId = entry['yt:videoId'];
      const title = entry.title || '';
      const match = title.match(/פרק\s+(\d+)/);
      if (match && videoId) {
        ytMap[parseInt(match[1])] = videoId;
      }
    }

    console.log(`Found ${Object.keys(ytMap).length} YouTube videos`);

    for (const ep of episodes) {
      ep.youtubeId = ytMap[ep.episodeNumber] || null;
    }
  } catch (err) {
    console.warn('Warning: Could not fetch YouTube playlist:', err.message);
    for (const ep of episodes) {
      ep.youtubeId = null;
    }
  }

  // Sort episodes by episode number descending (newest first)
  episodes.sort((a, b) => b.episodeNumber - a.episodeNumber);

  const output = {
    podcast,
    episodes,
    totalEpisodes: episodes.length,
    fetchedAt: new Date().toISOString(),
  };

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Successfully saved ${episodes.length} episodes to ${OUTPUT_PATH}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
