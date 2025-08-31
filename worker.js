/**
 * Rugby Hub - lazy caching proxy for TheSportsDB.
 * This worker fetches upcoming events from rugby and football leagues only.
 */

const API_KEY = THE_SPORTS_DB_API_KEY; 

const EVENTS_CACHE_TTL_SECONDS = 7200; 

const LEAGUES_CACHE_TTL_SECONDS = 86400;

const API_CALL_DELAY_MS = 100;

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

addEventListener('fetch', event => {
  if (event.request.method === 'OPTIONS') {
    event.respondWith(handleOptions(event.request));
  } else {
    event.respondWith(handleRequest(event));
  }
});

async function handleRequest(event) {
  const cache = caches.default;
  const request = event.request;

  // Check the cache for the final, combined data first.
  let response = await cache.match(request);
  if (response) {
    console.log("CACHE HIT: Serving the big combined list of events from cache.");
    return response;
  }

  console.log("CACHE MISS: Generating a new list of all upcoming events. This might take a moment...");
  
  try {
    // STEP 1: Get all leagues (from cache or API)
    const allLeagues = await getAllLeagues(cache);
    if (!allLeagues || allLeagues.length === 0) {
      throw new Error("Could not retrieve the list of leagues.");
    }

    console.log(`Found ${allLeagues.length} leagues. Now fetching upcoming events for each...`);

    // STEP 2: Get the next events for each league (filtered for rugby/football)
    const allEvents = await fetchEventsForLeagues(allLeagues);
    console.log(`Successfully fetched a total of ${allEvents.length} rugby/football events.`);

    // STEP 3: Combine, create a response, and cache it.
    const responseBody = JSON.stringify({ events: allEvents });
    response = new Response(responseBody, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `s-maxage=${EVENTS_CACHE_TTL_SECONDS}`,
        ...corsHeaders,
      },
    });

    // Cache the final result.
    event.waitUntil(cache.put(request, response.clone()));
    
    return response;

  } catch (error) {
    console.error("Failed to fetch and process events:", error);
    return new Response(JSON.stringify({ error: 'Failed to fetch data from the upstream API.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

/**
 * Fetches the master list of all leagues, caching it for a long time.
 */
async function getAllLeagues(cache) {
  const leagueUrl = `https://www.thesportsdb.com/api/v1/json/${API_KEY}/all_leagues.php`;
  const cacheKey = new Request(leagueUrl);
  
  let cached = await cache.match(cacheKey);
  if (cached) {
    console.log("LEAGUES: Cache hit.");
    const data = await cached.json();
    return data.leagues;
  }

  console.log("LEAGUES: Cache miss. Fetching from API.");
  const response = await fetch(cacheKey);
  if (!response.ok) return null;
  
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('Cache-Control', `s-maxage=${LEAGUES_CACHE_TTL_SECONDS}`);
  
  // Asynchronously cache the new response
  const cachePromise = cache.put(cacheKey, newResponse.clone());
  event.waitUntil(cachePromise);

  const data = await newResponse.json();
  return data.leagues;
}

/**
 * Iterates through leagues and fetches upcoming events for rugby and football leagues only.
 */
async function fetchEventsForLeagues(leagues) {
  const allEvents = [];
  const rugbyFootballSports = [
    'American Football', 'Rugby Union', 'Rugby League', 'Australian Football'
  ];
  
  for (const league of leagues) {
    // Only fetch for rugby and football leagues
    if (rugbyFootballSports.includes(league.strSport)) {
      const eventsUrl = `https://www.thesportsdb.com/api/v1/json/${API_KEY}/eventsnextleague.php?id=${league.idLeague}`;
      try {
        const response = await fetch(eventsUrl);
        if (response.ok) {
          const data = await response.json();
          if (data.events) {
            allEvents.push(...data.events);
          }
        }
        // IMPORTANT: Respect the rate limit!
        await sleep(API_CALL_DELAY_MS);
      } catch (e) {
          console.warn(`Could not fetch events for league ${league.idLeague}: ${e.message}`);
      }
    }
  }
  return allEvents;
}


// --- CORS HANDLING ---
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function handleOptions(request) {
  if (
    request.headers.get('Origin') !== null &&
    request.headers.get('Access-Control-Request-Method') !== null &&
    request.headers.get('Access-Control-Request-Headers') !== null
  ) {
    return new Response(null, { headers: corsHeaders });
  } else {
    return new Response(null, { headers: { Allow: 'GET, HEAD, OPTIONS' } });
  }
}