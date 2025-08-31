/**
 * caching proxy for TheSportsDB
 * intercepts requests, caches API responses, and saves me API calls.
 */

addEventListener('fetch', event => {
    // We need to handle pre-flight CORS requests for browsers
    if (event.request.method === 'OPTIONS') {
      event.respondWith(handleOptions(event.request));
    } else {
      event.respondWith(handleRequest(event));
    }
  });
  
  /**
   * Handles the main data request.
   */
  async function handleRequest(event) {
    const request = event.request;
    const cache = caches.default;
    const url = new URL(request.url);
    const day = url.searchParams.get('day');
    const variety = url.searchParams.get('variety'); // New parameter for variety mode
    
    // Check cache first for any request
    const cacheKey = new Request(url.toString(), request);
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // If no specific day is requested, fetch from multiple days for variety
    if (!day) {
      const allEvents = [];
      const today = getTodaysDate();
      
      // Determine how many days to fetch based on variety parameter
      const daysToFetch = variety === 'max' ? 30 : 7; // Default to 7 days for efficiency
      
      console.log(`Fetching events for ${daysToFetch} days starting from ${today}`);
      
      // Fetch from today + next N days for variety
      // Use Promise.allSettled for better performance and error handling
      const datePromises = [];
      for (let i = 0; i < daysToFetch; i++) {
        const date = new Date();
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().slice(0, 10);
        
        const apiUrl = `https://www.thesportsdb.com/api/v1/json/${THE_SPORTS_DB_API_KEY}/eventsday.php?d=${dateStr}`;
        datePromises.push(
          fetch(apiUrl)
            .then(response => response.json())
            .then(data => ({ success: true, data, date: dateStr }))
            .catch(error => ({ success: false, error: error.message, date: dateStr }))
        );
      }
      
      // Wait for all requests to complete
      const results = await Promise.allSettled(datePromises);
      
      // Process successful results
      let successfulFetches = 0;
      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value.success && result.value.data.events) {
          allEvents.push(...result.value.data.events);
          successfulFetches++;
        }
      });
      
      console.log(`Successfully fetched from ${successfulFetches}/${daysToFetch} dates`);
      
      // Remove duplicates and return
      const uniqueEvents = allEvents.filter((event, index, self) => 
        index === self.findIndex(e => e.idEvent === event.idEvent)
      );
      
      console.log(`Returning ${uniqueEvents.length} unique events`);
      
      const response = new Response(JSON.stringify({ 
        events: uniqueEvents,
        meta: {
          totalFetched: allEvents.length,
          uniqueEvents: uniqueEvents.length,
          daysFetched: successfulFetches,
          cacheTime: new Date().toISOString()
        }
      }), {
        headers: { 
          'Content-Type': 'application/json', 
          ...corsHeaders,
          'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
        }
      });
      
      // Cache the response
      event.waitUntil(cache.put(cacheKey, response.clone()));
      
      return response;
    }
    
    // Handle specific day request
    try {
      const apiUrl = `https://www.thesportsdb.com/api/v1/json/${THE_SPORTS_DB_API_KEY}/eventsday.php?d=${day}`;
      const apiResponse = await fetch(apiUrl);
      const data = await apiResponse.json();
      
      const response = new Response(JSON.stringify(data), {
        headers: { 
          'Content-Type': 'application/json', 
          ...corsHeaders,
          'Cache-Control': 'public, max-age=1800' // Cache for 30 minutes
        }
      });
      
      // Cache the response
      event.waitUntil(cache.put(cacheKey, response.clone()));
      
      return response;
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }
  
  /**
   * CORS headers to allow your website to make requests to this worker.
   * IMPORTANT: In a production app, you might want to change '*' to your actual domain
   * e.g., 'https://unclelukie.github.io'
   */
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  
  /**
   * Handles the pre-flight OPTIONS request sent by browsers.
   */
  function handleOptions(request) {
    if (
      request.headers.get('Origin') !== null &&
      request.headers.get('Access-Control-Request-Method') !== null &&
      request.headers.get('Access-Control-Request-Headers') !== null
    ) {
      // Handle CORS pre-flight request.
      return new Response(null, {
        headers: corsHeaders,
      });
    } else {
      // Handle standard OPTIONS request.
      return new Response(null, {
        headers: {
          Allow: 'GET, HEAD, OPTIONS',
        },
      });
    }
  }
  
  /**
   * A helper function to get today's date in YYYY-MM-DD format.
   */
  function getTodaysDate() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }